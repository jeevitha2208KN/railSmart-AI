import { getDb } from '../db/database.ts';
import { fetchOpenMeteoWeather } from '../services/weatherEngine.ts';
import type { TrainRow } from '../types.ts';

export interface DataSourceAdapter {
  name: string;
  sourceLabel: 'SYNTHETIC' | 'CSV_IMPORT' | 'LIVE_API' | 'NTES_LIKE_JSON';
  getTrains(): Promise<TrainRow[]>;
  getWeather(): Promise<{ source: string; type: string; severity: number; detail: string }>;
  getDelays(limit?: number): Promise<Array<Record<string, unknown>>>;
}

export class SyntheticSource implements DataSourceAdapter {
  name = 'Synthetic Corridor Source';
  sourceLabel = 'SYNTHETIC' as const;

  async getTrains(): Promise<TrainRow[]> {
    const db = getDb();
    return db.prepare('SELECT * FROM trains WHERE is_active = 1').all() as unknown as TrainRow[];
  }

  async getWeather() {
    const db = getDb();
    const row = db.prepare('SELECT * FROM weather_events WHERE active = 1 ORDER BY id DESC LIMIT 1').get() as
      | { type: string; severity: number; speed_factor: number }
      | undefined;
    return {
      source: 'SYNTHETIC',
      type: row?.type ?? 'CLEAR',
      severity: row?.severity ?? 1,
      detail: `Simulated corridor weather (speed factor x${row?.speed_factor ?? 1.0})`,
    };
  }

  async getDelays(limit = 100) {
    const db = getDb();
    return db.prepare('SELECT * FROM delay_history ORDER BY id DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>;
  }
}

export class OpenMeteoSource implements DataSourceAdapter {
  name = 'Open-Meteo Live Weather Adapter';
  sourceLabel = 'LIVE_API' as const;

  async getTrains(): Promise<TrainRow[]> {
    return new SyntheticSource().getTrains();
  }

  async getWeather() {
    const w = await fetchOpenMeteoWeather();
    return {
      source: w.source,
      type: w.mapped_type,
      severity: w.mapped_severity,
      detail: `${w.temperature_c}°C, Wind ${w.windspeed_kmph} km/h, Precip ${w.precipitation_mm} mm`,
    };
  }

  async getDelays(limit = 100) {
    return new SyntheticSource().getDelays(limit);
  }
}

export class NTESLikeSource implements DataSourceAdapter {
  name = 'NTES-Compatible Authorized JSON Feed Stub';
  sourceLabel = 'NTES_LIKE_JSON' as const;
  private payload: { trains?: TrainRow[]; delays?: Array<Record<string, unknown>> };

  constructor(payload: { trains?: TrainRow[]; delays?: Array<Record<string, unknown>> } = {}) {
    this.payload = payload;
  }

  async getTrains(): Promise<TrainRow[]> {
    if (this.payload.trains && this.payload.trains.length > 0) return this.payload.trains;
    return new SyntheticSource().getTrains();
  }

  async getWeather() {
    return new SyntheticSource().getWeather();
  }

  async getDelays(limit = 100) {
    if (this.payload.delays) return this.payload.delays.slice(0, limit);
    return new SyntheticSource().getDelays(limit);
  }
}
