import { getDb } from '../db/database.ts';
import type { PlatformRow, ScheduleRow, StationRow, TrainRow } from '../types.ts';
import { loadScheduleRows } from './verifier.ts';

export function getStationPlatformLayout(stationId: number, kind: 'ORIGINAL' | 'OPTIMIZED' = 'OPTIMIZED') {
  const db = getDb();
  const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(stationId) as StationRow | undefined;
  const platforms = db.prepare('SELECT * FROM platforms WHERE station_id = ? ORDER BY id ASC').all(stationId) as unknown as PlatformRow[];
  const trains = db.prepare('SELECT * FROM trains').all() as unknown as TrainRow[];
  const trainMap = new Map(trains.map((t) => [t.id, t]));

  let rows = loadScheduleRows(kind);
  if (rows.length === 0 && kind === 'OPTIMIZED') rows = loadScheduleRows('ORIGINAL');

  const stnRows = rows.filter((r) => r.station_id === stationId).sort((a, b) => a.arrival - b.arrival);

  const occupancy = platforms.map((pf) => {
    const items = stnRows
      .filter((r) => r.platform_id === pf.id)
      .map((r) => {
        const tr = trainMap.get(r.train_id);
        return {
          schedule_id: r.id,
          train_id: r.train_id,
          train_no: tr?.train_no ?? String(r.train_id),
          name: tr?.name ?? '',
          category: tr?.category ?? 'PASSENGER',
          direction: tr?.direction ?? 'UP',
          length_m: tr?.length_m ?? 400,
          arrival: r.arrival,
          departure: Math.max(r.departure, r.arrival + 2),
          used_loop: r.used_loop,
          length_ok: (tr?.length_m ?? 0) <= pf.length_m,
        };
      });

    // Detect overlaps on this platform
    let clashCount = 0;
    for (let i = 0; i < items.length - 1; i++) {
      if (items[i + 1].arrival < items[i].departure) clashCount++;
    }

    return {
      platform: pf,
      occupancies: items,
      clash_count: clashCount,
    };
  });

  return { station, layout: occupancy };
}

export function allocatePlatformsForStation(stationId: number) {
  const db = getDb();
  const platforms = db.prepare('SELECT * FROM platforms WHERE station_id = ? ORDER BY length_m DESC').all(stationId) as unknown as PlatformRow[];
  const trains = db.prepare('SELECT * FROM trains').all() as unknown as TrainRow[];
  const trainMap = new Map(trains.map((t) => [t.id, t]));

  const latestRun = db.prepare('SELECT id FROM optimization_runs ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
  const targetKind = latestRun ? 'OPTIMIZED' : 'ORIGINAL';
  const rows = latestRun
    ? (db.prepare("SELECT * FROM schedules WHERE kind = 'OPTIMIZED' AND run_id = ? AND station_id = ? ORDER BY arrival ASC").all(latestRun.id, stationId) as unknown as ScheduleRow[])
    : (db.prepare("SELECT * FROM schedules WHERE kind = 'ORIGINAL' AND run_id IS NULL AND station_id = ? ORDER BY arrival ASC").all(stationId) as unknown as ScheduleRow[]);

  const usedIntervals = new Map<number, Array<{ start: number; end: number }>>();
  for (const p of platforms) usedIntervals.set(p.id, []);

  const assignments: Array<{ schedule_id: number; train_no: string; old_platform_id: number | null; new_platform_id: number; platform_no: string; score: number }> = [];
  const upd = db.prepare('UPDATE schedules SET platform_id = ? WHERE id = ?');

  for (const r of rows) {
    const tr = trainMap.get(r.train_id);
    if (!tr) continue;
    const end = Math.max(r.departure, r.arrival + 2);

    let bestPf: PlatformRow | null = null;
    let bestScore = -1e9;

    for (const pf of platforms) {
      if (pf.status === 'BLOCKED') continue;
      let score = 100;
      if (pf.length_m < tr.length_m) score -= 500;
      if (!pf.accepts_categories.includes(tr.category)) score -= 80;
      if (pf.id === r.platform_id) score += 15;
      const busy = (usedIntervals.get(pf.id) ?? []).some((iv) => r.arrival < iv.end && iv.start < end);
      if (busy) score -= 1000;
      // Slight preference: UP on odd/PF-1, DOWN on PF-2
      if (tr.direction === 'UP' && pf.number.endsWith('1')) score += 10;
      if (tr.direction === 'DOWN' && pf.number.endsWith('2')) score += 10;

      if (score > bestScore) {
        bestScore = score;
        bestPf = pf;
      }
    }

    if (bestPf) {
      usedIntervals.get(bestPf.id)!.push({ start: r.arrival, end });
      upd.run(bestPf.id, r.id);
      assignments.push({
        schedule_id: r.id,
        train_no: tr.train_no,
        old_platform_id: r.platform_id,
        new_platform_id: bestPf.id,
        platform_no: bestPf.number,
        score: bestScore,
      });
    }
  }

  return { station_id: stationId, schedule_kind: targetKind, reassigned_count: assignments.length, assignments };
}

export function overridePlatformAssignment(scheduleId: number, newPlatformId: number) {
  const db = getDb();
  const pf = db.prepare('SELECT * FROM platforms WHERE id = ?').get(newPlatformId) as PlatformRow | undefined;
  if (!pf) throw new Error('Platform not found');
  if (pf.status === 'BLOCKED') throw new Error(`Platform ${pf.number} is currently BLOCKED.`);
  db.prepare('UPDATE schedules SET platform_id = ? WHERE id = ?').run(newPlatformId, scheduleId);
  return { schedule_id: scheduleId, platform_id: newPlatformId, platform_number: pf.number };
}
