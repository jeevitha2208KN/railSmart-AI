import { getDb } from '../db/database.ts';
import type { PlatformRow, ScheduleRow, SectionRow, StationRow, TrainRow } from '../types.ts';
import { loadScheduleRows, verifySchedule } from './verifier.ts';

export interface DetectedConflict {
  id?: number;
  category: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  section_id: number | null;
  section_code: string | null;
  station_id: number | null;
  station_code: string | null;
  train_ids: number[];
  train_nos: string[];
  predicted_impact_min: number;
  ml_advisory_risk: number;
  recommended_action: string;
  resolved: number;
}

export function scanConflicts(kind: 'ORIGINAL' | 'OPTIMIZED' = 'ORIGINAL', persist = true): DetectedConflict[] {
  const db = getDb();
  const rows = loadScheduleRows(kind);
  const verify = verifySchedule(rows, kind);

  const trains = db.prepare('SELECT * FROM trains').all() as unknown as TrainRow[];
  const stations = db.prepare('SELECT * FROM stations').all() as unknown as StationRow[];
  const sections = db.prepare('SELECT * FROM sections').all() as unknown as SectionRow[];
  const trainMap = new Map(trains.map((t) => [t.id, t]));
  const stnMap = new Map(stations.map((s) => [s.id, s]));
  const secMap = new Map(sections.map((s) => [s.id, s]));

  const detected: DetectedConflict[] = [];

  for (const v of verify.violations) {
    const sec = v.section_id ? secMap.get(v.section_id) : undefined;
    const stn = v.station_id ? stnMap.get(v.station_id) : undefined;
    const trNos = v.train_ids.map((id) => trainMap.get(id)?.train_no ?? String(id));
    let category = 'HEADWAY_VIOLATION';
    let action = 'Adjust departure headway by 5 min at preceding station.';
    let impact = 12;

    if (v.rule === 'SINGLE_TRACK_MUTEX') {
      category = 'SINGLE_LINE_MEET_CONFLICT';
      action = `Hold lower-priority train in loop line before ${sec?.code ?? 'single-line section'}.`;
      impact = 18;
    } else if (v.rule === 'PLATFORM_ALLOCATION') {
      category = v.message.includes('length') ? 'PLATFORM_LENGTH_MISMATCH' : 'PLATFORM_CLASH';
      action = `Reassign platform at ${stn?.code ?? 'station'} to conflict-free full-length track.`;
      impact = 9;
    } else if (v.rule === 'BLOCK_RESPECT') {
      category = 'DISRUPTION_BLOCK_OVERLAP';
      action = `Hold or reroute trains clear of blocked window on ${sec?.code ?? 'section'}.`;
      impact = 24;
    } else if (v.rule === 'RAKE_CREW_LINKAGE') {
      category = 'RAKE_CREW_CONSTRAINT';
      action = 'Allocate standby relief crew or adjust rake turnaround buffer.';
      impact = 14;
    }

    const mlRisk = Math.min(0.98, Math.round((0.45 + impact / 40) * 100) / 100);
    detected.push({
      category,
      severity: v.severity === 'CRITICAL' ? 'CRITICAL' : 'MEDIUM',
      section_id: v.section_id ?? null,
      section_code: sec?.code ?? null,
      station_id: v.station_id ?? null,
      station_code: stn?.code ?? null,
      train_ids: v.train_ids,
      train_nos: trNos,
      predicted_impact_min: impact,
      ml_advisory_risk: mlRisk,
      recommended_action: `${v.message} Action: ${action}`,
      resolved: kind === 'OPTIMIZED' ? 1 : 0,
    });
  }

  // Also check station queue buildup (> capacity)
  const stnTraffic = new Map<number, number[]>();
  for (const r of rows) {
    if (!stnTraffic.has(r.station_id)) stnTraffic.set(r.station_id, []);
    stnTraffic.get(r.station_id)!.push(r.train_id);
  }
  for (const [stnId, tids] of stnTraffic.entries()) {
    const stn = stnMap.get(stnId);
    if (!stn) continue;
    // Check simultaneous occupancy at station
    const stnRows = rows.filter((r) => r.station_id === stnId);
    for (const r of stnRows) {
      const concurrent = stnRows.filter((o) => o.arrival <= r.arrival && r.arrival < Math.max(o.departure, o.arrival + 1));
      if (concurrent.length > stn.station_capacity) {
        detected.push({
          category: 'STATION_CAPACITY_EXCEEDED',
          severity: 'HIGH',
          section_id: null,
          section_code: null,
          station_id: stnId,
          station_code: stn.code,
          train_ids: concurrent.map((c) => c.train_id),
          train_nos: concurrent.map((c) => trainMap.get(c.train_id)?.train_no ?? '?'),
          predicted_impact_min: 11,
          ml_advisory_risk: 0.72,
          recommended_action: `${stn.code} simultaneous occupancy (${concurrent.length}/${stn.station_capacity}) exceeds yard capacity.`,
          resolved: 0,
        });
        break;
      }
    }
  }

  if (persist) {
    db.prepare('DELETE FROM conflicts').run();
    const ins = db.prepare(`
      INSERT INTO conflicts (category, severity, section_id, station_id, train_ids_json, predicted_impact_min, recommended_action, resolved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of detected) {
      const res = ins.run(
        c.category,
        c.severity,
        c.section_id,
        c.station_id,
        JSON.stringify(c.train_ids),
        c.predicted_impact_min,
        c.recommended_action,
        c.resolved
      );
      c.id = Number(res.lastInsertRowid);
    }
  }

  return detected;
}
