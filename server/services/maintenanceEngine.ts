import { getDb } from '../db/database.ts';
import type { SectionRow } from '../types.ts';
import { loadScheduleRows } from './verifier.ts';

export interface SectionHealthSummary {
  section_id: number;
  section_code: string;
  track_type: string;
  health_score: number;
  anomaly_score: number;
  is_anomaly: boolean;
  latest_vibration: number;
  latest_temperature: number;
  latest_strain: number;
  latest_gauge_dev: number;
  recommended_window: { start_min: number; end_min: number; trains_impacted: number };
  recommended_action: string;
  is_simulated: boolean;
}

export function analyzeMaintenanceHealth(): {
  sections: SectionHealthSummary[];
  anomalies: SectionHealthSummary[];
  orders: Array<{ id: number; section_id: number; section_code: string; priority: string; status: string; due_date: string; window_start_min: number | null; window_end_min: number | null; note: string }>;
} {
  const db = getDb();
  const sections = db.prepare('SELECT * FROM sections ORDER BY id ASC').all() as unknown as SectionRow[];
  const schedRows = loadScheduleRows('OPTIMIZED');
  const activeSched = schedRows.length > 0 ? schedRows : loadScheduleRows('ORIGINAL');

  const summaries: SectionHealthSummary[] = [];

  for (const sec of sections) {
    const readings = db
      .prepare('SELECT * FROM sensor_readings WHERE section_id = ? ORDER BY id ASC')
      .all(sec.id) as Array<{ id: number; vibration: number; temperature: number; strain: number; track_gauge_dev: number; ts: string }>;

    if (readings.length === 0) continue;

    // Baseline from first 75% of readings, evaluate recent 25% via rolling z-score + multi-dim Isolation-style anomaly score
    const split = Math.max(1, Math.floor(readings.length * 0.75));
    const base = readings.slice(0, split);
    const latest = readings[readings.length - 1];

    const stats = (arr: number[]) => {
      const m = arr.reduce((a, b) => a + b, 0) / arr.length;
      const sd = Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length) || 0.1;
      return { m, sd };
    };

    const vibS = stats(base.map((r) => r.vibration));
    const tmpS = stats(base.map((r) => r.temperature));
    const strS = stats(base.map((r) => r.strain));
    const ggeS = stats(base.map((r) => r.track_gauge_dev));

    const zVib = Math.max(0, (latest.vibration - vibS.m) / vibS.sd);
    const zTmp = Math.max(0, (latest.temperature - tmpS.m) / tmpS.sd);
    const zStr = Math.max(0, (latest.strain - strS.m) / strS.sd);
    const zGge = Math.max(0, (latest.track_gauge_dev - ggeS.m) / ggeS.sd);

    // Combined anomaly intensity (0..1+)
    const rawAnomaly = (zVib * 0.35 + zStr * 0.3 + zGge * 0.25 + zTmp * 0.1) / 6;
    const anomalyScore = Math.min(0.99, Math.round(rawAnomaly * 100) / 100);
    const healthScore = Math.max(12, Math.min(100, Math.round((100 - anomalyScore * 78) * 10) / 10));
    const isAnomaly = anomalyScore >= 0.42 || latest.vibration > 5.5 || latest.track_gauge_dev > 3.0;

    // Find 30-min low-traffic maintenance slot between 360..720 min
    const secOccs = activeSched.filter((r) => r.section_id === sec.id && r.entry_time !== null && r.exit_time !== null);
    let bestStart = 660;
    let minTrains = 999;
    for (let w = 360; w <= 690; w += 15) {
      const count = secOccs.filter((o) => o.entry_time! < w + 30 && o.exit_time! > w).length;
      if (count < minTrains) {
        minTrains = count;
        bestStart = w;
      }
    }

    let action = 'Routine ultrasonic inspection during next scheduled block.';
    if (healthScore < 55) {
      action = `CRITICAL: Impose 50 km/h TSR on ${sec.code} and schedule tamping/gauge correction in ${bestStart}–${bestStart + 30} min window (${minTrains} trains affected).`;
    } else if (healthScore < 75) {
      action = `WARNING: Schedule track geometry inspection on ${sec.code} in low-traffic window (${bestStart}–${bestStart + 30} min).`;
    }

    summaries.push({
      section_id: sec.id,
      section_code: sec.code,
      track_type: sec.track_type,
      health_score: healthScore,
      anomaly_score: anomalyScore,
      is_anomaly: isAnomaly,
      latest_vibration: latest.vibration,
      latest_temperature: latest.temperature,
      latest_strain: latest.strain,
      latest_gauge_dev: latest.track_gauge_dev,
      recommended_window: { start_min: bestStart, end_min: bestStart + 30, trains_impacted: minTrains },
      recommended_action: action,
      is_simulated: true,
    });
  }

  summaries.sort((a, b) => a.health_score - b.health_score);

  const orders = db
    .prepare(
      `SELECT m.*, s.code as section_code FROM maintenance_orders m
       JOIN sections s ON s.id = m.section_id
       ORDER BY m.id DESC`
    )
    .all() as Array<{ id: number; section_id: number; section_code: string; priority: string; status: string; due_date: string; window_start_min: number | null; window_end_min: number | null; note: string }>;

  return {
    sections: summaries,
    anomalies: summaries.filter((s) => s.is_anomaly),
    orders,
  };
}
