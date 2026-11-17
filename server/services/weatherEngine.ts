import { getDb } from '../db/database.ts';
import type { WeatherType } from '../types.ts';

export function computeWeatherFactors(type: WeatherType, severity: number): { speed_factor: number; headway_bonus_min: number } {
  const sev = Math.max(1, Math.min(5, severity));
  switch (type) {
    case 'FOG':
      return { speed_factor: Math.max(0.45, 0.85 - sev * 0.08), headway_bonus_min: sev >= 3 ? 3 : 2 };
    case 'STORM':
      return { speed_factor: Math.max(0.48, 0.82 - sev * 0.07), headway_bonus_min: sev >= 3 ? 3 : 2 };
    case 'RAIN':
      return { speed_factor: Math.max(0.65, 0.94 - sev * 0.05), headway_bonus_min: sev >= 4 ? 2 : 1 };
    case 'HEAT':
      return { speed_factor: Math.max(0.75, 0.96 - sev * 0.04), headway_bonus_min: 1 };
    case 'CLEAR':
    default:
      return { speed_factor: 1.0, headway_bonus_min: 0 };
  }
}

export async function fetchOpenMeteoWeather(lat = 18.4651, lon = 74.5784): Promise<{
  source: 'LIVE_OPEN_METEO' | 'SIMULATED_FALLBACK';
  temperature_c: number;
  windspeed_kmph: number;
  precipitation_mm: number;
  weathercode: number;
  mapped_type: WeatherType;
  mapped_severity: number;
  fetched_at: string;
}> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,weather_code,wind_speed_10m`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      current?: {
        temperature_2m?: number;
        precipitation?: number;
        weather_code?: number;
        wind_speed_10m?: number;
      };
    };
    const temp = data.current?.temperature_2m ?? 28;
    const precip = data.current?.precipitation ?? 0;
    const wind = data.current?.wind_speed_10m ?? 10;
    const wmo = data.current?.weather_code ?? 0;

    let mappedType: WeatherType = 'CLEAR';
    let mappedSev = 1;
    if (wmo === 45 || wmo === 48) {
      mappedType = 'FOG';
      mappedSev = 3;
    } else if (wmo >= 95 || wind > 45) {
      mappedType = 'STORM';
      mappedSev = 4;
    } else if (precip > 2 || (wmo >= 51 && wmo <= 82)) {
      mappedType = 'RAIN';
      mappedSev = precip > 10 ? 4 : 2;
    } else if (temp >= 41) {
      mappedType = 'HEAT';
      mappedSev = 3;
    }

    return {
      source: 'LIVE_OPEN_METEO',
      temperature_c: temp,
      windspeed_kmph: wind,
      precipitation_mm: precip,
      weathercode: wmo,
      mapped_type: mappedType,
      mapped_severity: mappedSev,
      fetched_at: new Date().toISOString(),
    };
  } catch {
    return {
      source: 'SIMULATED_FALLBACK',
      temperature_c: 29.4,
      windspeed_kmph: 14.2,
      precipitation_mm: 0.0,
      weathercode: 1,
      mapped_type: 'CLEAR',
      mapped_severity: 1,
      fetched_at: new Date().toISOString(),
    };
  }
}

export function setWeatherCondition(params: {
  type: WeatherType;
  severity: number;
  section_id?: number | null;
  start_min?: number;
  end_min?: number;
  source?: string;
}) {
  const db = getDb();
  const { speed_factor, headway_bonus_min } = computeWeatherFactors(params.type, params.severity);

  if (params.section_id == null) {
    db.prepare('UPDATE weather_events SET active = 0 WHERE section_id IS NULL').run();
  } else {
    db.prepare('UPDATE weather_events SET active = 0 WHERE section_id = ?').run(params.section_id);
  }

  const res = db
    .prepare(
      `INSERT INTO weather_events (type, severity, section_id, start_min, end_min, speed_factor, headway_bonus_min, source, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      params.type,
      params.severity,
      params.section_id ?? null,
      params.start_min ?? 360,
      params.end_min ?? 720,
      speed_factor,
      headway_bonus_min,
      params.source ?? 'SIMULATED'
    );

  return {
    id: Number(res.lastInsertRowid),
    type: params.type,
    severity: params.severity,
    speed_factor,
    headway_bonus_min,
    source: params.source ?? 'SIMULATED',
  };
}
