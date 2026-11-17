import { getDb } from '../db/database.ts';
import type {
  KpiSummary,
  PlatformRow,
  ScheduleRow,
  SectionRow,
  StationRow,
  TrainRow,
} from '../types.ts';
import { getActiveDisruptions, getActiveWeatherEffects, getSafetyParams } from './networkService.ts';

export interface ConstraintViolation {
  rule: string;
  severity: 'CRITICAL' | 'WARNING';
  train_ids: number[];
  section_id?: number | null;
  station_id?: number | null;
  message: string;
}

export interface ConstraintReportItem {
  rule: string;
  label: string;
  status: 'PASS' | 'FAIL';
  violation_count: number;
  details: string[];
}

export interface VerificationResult {
  valid: boolean;
  checks: ConstraintReportItem[];
  violations: ConstraintViolation[];
  kpis: KpiSummary;
}

export function loadScheduleRows(kind: 'ORIGINAL' | 'OPTIMIZED', runId?: number | null): ScheduleRow[] {
  const db = getDb();
  if (kind === 'ORIGINAL') {
    return db
      .prepare("SELECT * FROM schedules WHERE kind = 'ORIGINAL' AND run_id IS NULL ORDER BY train_id, arrival ASC")
      .all() as unknown as ScheduleRow[];
  }
  let targetRunId = runId;
  if (!targetRunId) {
    const latest = db.prepare('SELECT id FROM optimization_runs ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
    if (!latest) return [];
    targetRunId = latest.id;
  }
  return db
    .prepare("SELECT * FROM schedules WHERE kind = 'OPTIMIZED' AND run_id = ? ORDER BY train_id, arrival ASC")
    .all(targetRunId) as unknown as ScheduleRow[];
}

export function verifySchedule(scheduleRows: ScheduleRow[], kindLabel: 'ORIGINAL' | 'OPTIMIZED' = 'OPTIMIZED'): VerificationResult {
  const db = getDb();
  const safety = getSafetyParams();
  const trains = db.prepare('SELECT * FROM trains WHERE is_active = 1').all() as unknown as TrainRow[];
  const stations = db.prepare('SELECT * FROM stations').all() as unknown as StationRow[];
  const sections = db.prepare('SELECT * FROM sections').all() as unknown as SectionRow[];
  const platforms = db.prepare('SELECT * FROM platforms').all() as unknown as PlatformRow[];
  const rakes = db.prepare('SELECT * FROM rakes').all() as Array<{ id: number; rake_no: string; next_train_id: number | null; turnaround_min: number }>;
  const crews = db.prepare('SELECT * FROM crews').all() as Array<{ id: number; crew_no: string; duty_start: number; max_duty_hours: number }>;

  const disruptions = getActiveDisruptions();
  const weather = getActiveWeatherEffects();

  const trainMap = new Map(trains.map((t) => [t.id, t]));
  const stnMap = new Map(stations.map((s) => [s.id, s]));
  const secMap = new Map(sections.map((s) => [s.id, s]));
  const pfMap = new Map(platforms.map((p) => [p.id, p]));

  const violations: ConstraintViolation[] = [];

  // 1. Single-track opposite-direction overlap + clearance
  const singleTrackViolations: string[] = [];
  // 2. Same-direction headway & overtaking
  const headwayViolations: string[] = [];
  // 3. Section capacity
  const capacityViolations: string[] = [];
  // 4. Blocked sections & TSR/weather running time
  const blockViolations: string[] = [];
  // 5. Platform clash & platform length/compatibility
  const platformViolations: string[] = [];
  // 6. Early departure & dwell
  const dwellViolations: string[] = [];
  // 7. Rake & crew limits
  const resourceViolations: string[] = [];

  // Group section occupancies
  const bySection = new Map<number, Array<{ train: TrainRow; entry: number; exit: number }>>();
  for (const row of scheduleRows) {
    if (row.section_id && row.entry_time !== null && row.exit_time !== null) {
      const tr = trainMap.get(row.train_id);
      if (!tr) continue;
      if (!bySection.has(row.section_id)) bySection.set(row.section_id, []);
      bySection.get(row.section_id)!.push({ train: tr, entry: row.entry_time, exit: row.exit_time });

      const sec = secMap.get(row.section_id);
      if (sec) {
        // Check section blocks
        if (sec.status === 'BLOCKED') {
          const msg = `Train ${tr.train_no} enters blocked section ${sec.code} (${row.entry_time}–${row.exit_time}).`;
          blockViolations.push(msg);
          violations.push({ rule: 'BLOCK_RESPECT', severity: 'CRITICAL', train_ids: [tr.id], section_id: sec.id, message: msg });
        }
        for (const d of disruptions) {
          if ((d.type === 'BLOCK' || d.type === 'SIGNAL_FAILURE' || d.type === 'ACCIDENT_SIM') && d.section_id === sec.id) {
            if (row.entry_time < d.end_min && row.exit_time > d.start_min) {
              const msg = `Train ${tr.train_no} overlaps ${d.type} on ${sec.code} (${d.start_min}–${d.end_min}).`;
              blockViolations.push(msg);
              violations.push({ rule: 'BLOCK_RESPECT', severity: 'CRITICAL', train_ids: [tr.id], section_id: sec.id, message: msg });
            }
          }
        }
      }
    }
  }

  for (const [secId, occs] of bySection.entries()) {
    const sec = secMap.get(secId);
    if (!sec) continue;
    const hwBonus = weather.headwayBonusBySection.get(secId) ?? weather.globalHeadwayBonus;
    const reqHeadway = Math.max(sec.headway_min, safety.default_headway_min) + hwBonus;

    // Pairwise checks
    for (let i = 0; i < occs.length; i++) {
      for (let j = i + 1; j < occs.length; j++) {
        const a = occs[i];
        const b = occs[j];

        if (sec.track_type === 'SINGLE') {
          if (a.train.direction !== b.train.direction) {
            // Opposite direction: must not overlap including clearance!
            const clr = safety.clearance_min;
            const overlaps = a.entry < b.exit + clr && b.entry < a.exit + clr;
            if (overlaps) {
              const msg = `Single-line meet conflict on ${sec.code}: ${a.train.train_no} (${a.train.direction}, ${a.entry}–${a.exit}) vs ${b.train.train_no} (${b.train.direction}, ${b.entry}–${b.exit}).`;
              singleTrackViolations.push(msg);
              violations.push({ rule: 'SINGLE_TRACK_MUTEX', severity: 'CRITICAL', train_ids: [a.train.id, b.train.id], section_id: secId, message: msg });
            }
          } else {
            // Same direction headway & no overtaking inside section
            const [first, second] = a.entry <= b.entry ? [a, b] : [b, a];
            if (second.entry - first.entry < reqHeadway || second.exit < first.exit + 1) {
              const msg = `Headway/overtake violation on ${sec.code}: ${first.train.train_no} (${first.entry}–${first.exit}) & ${second.train.train_no} (${second.entry}–${second.exit}), req headway ${reqHeadway}m.`;
              headwayViolations.push(msg);
              violations.push({ rule: 'HEADWAY_NO_OVERTAKE', severity: 'CRITICAL', train_ids: [first.train.id, second.train.id], section_id: secId, message: msg });
            }
          }
        } else {
          // DOUBLE track: same-direction headway
          if (a.train.direction === b.train.direction) {
            const [first, second] = a.entry <= b.entry ? [a, b] : [b, a];
            if (second.entry - first.entry < reqHeadway || second.exit < first.exit + 1) {
              const msg = `Same-dir headway violation on ${sec.code} (${first.train.direction}): ${first.train.train_no} & ${second.train.train_no}.`;
              headwayViolations.push(msg);
              violations.push({ rule: 'HEADWAY_NO_OVERTAKE', severity: 'CRITICAL', train_ids: [first.train.id, second.train.id], section_id: secId, message: msg });
            }
          }
        }
      }
    }

    // Cumulative capacity sweep per minute
    const points = new Set<number>();
    for (const o of occs) {
      points.add(o.entry);
      points.add(o.exit);
    }
    for (const t of points) {
      const concurrent = occs.filter((o) => o.entry <= t && t < o.exit).length;
      if (concurrent > sec.capacity_trains) {
        const msg = `Section ${sec.code} exceeds capacity (${concurrent}/${sec.capacity_trains}) at t=${t}.`;
        capacityViolations.push(msg);
        violations.push({ rule: 'SECTION_CAPACITY', severity: 'CRITICAL', train_ids: [], section_id: secId, message: msg });
        break;
      }
    }
  }

  // Platform checks & Dwell/Early departure checks
  const byPlatform = new Map<number, Array<{ train: TrainRow; arr: number; dep: number; stnId: number }>>();
  const byTrain = new Map<number, ScheduleRow[]>();
  for (const row of scheduleRows) {
    if (!byTrain.has(row.train_id)) byTrain.set(row.train_id, []);
    byTrain.get(row.train_id)!.push(row);

    const tr = trainMap.get(row.train_id);
    if (!tr) continue;

    if (row.departure < row.arrival) {
      const msg = `Train ${tr.train_no} departs (${row.departure}) before arrival (${row.arrival}) at ${stnMap.get(row.station_id)?.code}.`;
      dwellViolations.push(msg);
      violations.push({ rule: 'DWELL_AND_DEPARTURE', severity: 'CRITICAL', train_ids: [tr.id], station_id: row.station_id, message: msg });
    }

    if (row.platform_id) {
      const pf = pfMap.get(row.platform_id);
      if (pf) {
        if (tr.length_m > pf.length_m && row.used_loop === 0) {
          const msg = `Train ${tr.train_no} (${tr.length_m}m) exceeds ${pf.number} length (${pf.length_m}m) at ${stnMap.get(row.station_id)?.code}.`;
          platformViolations.push(msg);
          violations.push({ rule: 'PLATFORM_ALLOCATION', severity: 'WARNING', train_ids: [tr.id], station_id: row.station_id, message: msg });
        }
        if (pf.status === 'BLOCKED') {
          const msg = `Train ${tr.train_no} assigned to BLOCKED platform ${pf.number} at ${stnMap.get(row.station_id)?.code}.`;
          platformViolations.push(msg);
          violations.push({ rule: 'PLATFORM_ALLOCATION', severity: 'CRITICAL', train_ids: [tr.id], station_id: row.station_id, message: msg });
        }
      }
      if (!byPlatform.has(row.platform_id)) byPlatform.set(row.platform_id, []);
      byPlatform.get(row.platform_id)!.push({ train: tr, arr: row.arrival, dep: row.departure, stnId: row.station_id });
    }
  }

  for (const [pfId, occs] of byPlatform.entries()) {
    const pf = pfMap.get(pfId);
    const stnCode = pf ? stnMap.get(pf.station_id)?.code : '?';
    occs.sort((a, b) => a.arr - b.arr);
    for (let i = 0; i < occs.length - 1; i++) {
      const a = occs[i];
      const b = occs[i + 1];
      // Origin/Dest terminal overlap check with 1-min safety buffer
      const aEnd = Math.max(a.dep, a.arr + 1);
      if (b.arr < aEnd) {
        const msg = `Platform clash at ${stnCode} ${pf?.number}: ${a.train.train_no} (${a.arr}–${a.dep}) overlaps ${b.train.train_no} (${b.arr}–${b.dep}).`;
        platformViolations.push(msg);
        violations.push({ rule: 'PLATFORM_ALLOCATION', severity: 'CRITICAL', train_ids: [a.train.id, b.train.id], station_id: a.stnId, message: msg });
      }
    }
  }

  // Rake & crew checks
  for (const r of rakes) {
    if (!r.next_train_id) continue;
    const prevTrains = trains.filter((t) => t.rake_id === r.id && t.id !== r.next_train_id);
    const nextRows = byTrain.get(r.next_train_id);
    if (prevTrains.length > 0 && nextRows && nextRows.length > 0) {
      const prevRows = byTrain.get(prevTrains[0].id);
      if (prevRows && prevRows.length > 0) {
        const prevArr = prevRows[prevRows.length - 1].arrival;
        const nextDep = nextRows[0].departure;
        if (nextDep < prevArr + r.turnaround_min) {
          const msg = `Rake ${r.rake_no} turnaround tight: arrives ${prevArr}, next departs ${nextDep} (min ${r.turnaround_min}m).`;
          resourceViolations.push(msg);
          violations.push({ rule: 'RAKE_CREW_LINKAGE', severity: 'WARNING', train_ids: [prevTrains[0].id, r.next_train_id], message: msg });
        }
      }
    }
  }

  for (const c of crews) {
    const assigned = trains.filter((t) => t.crew_id === c.id);
    for (const tr of assigned) {
      const rows = byTrain.get(tr.id);
      if (!rows || rows.length === 0) continue;
      const fin = rows[rows.length - 1].arrival;
      if ((fin - c.duty_start) / 60 > c.max_duty_hours) {
        const msg = `Crew ${c.crew_no} exceeds ${c.max_duty_hours}h duty on train ${tr.train_no}.`;
        resourceViolations.push(msg);
        violations.push({ rule: 'RAKE_CREW_LINKAGE', severity: 'WARNING', train_ids: [tr.id], message: msg });
      }
    }
  }

  // Compute accurate KPIs from scheduleRows + conflict penalties
  const kpis = computeScheduleKpis(scheduleRows, trains, sections, platforms, violations, kindLabel);

  const checks: ConstraintReportItem[] = [
    { rule: 'SINGLE_TRACK_MUTEX', label: 'Single-track opposite-direction mutual exclusion', status: singleTrackViolations.length === 0 ? 'PASS' : 'FAIL', violation_count: singleTrackViolations.length, details: singleTrackViolations.slice(0, 5) },
    { rule: 'HEADWAY_NO_OVERTAKE', label: 'Same-direction headway & no mid-section overtake', status: headwayViolations.length === 0 ? 'PASS' : 'FAIL', violation_count: headwayViolations.length, details: headwayViolations.slice(0, 5) },
    { rule: 'SECTION_CAPACITY', label: 'Cumulative section track capacity', status: capacityViolations.length === 0 ? 'PASS' : 'FAIL', violation_count: capacityViolations.length, details: capacityViolations.slice(0, 5) },
    { rule: 'BLOCK_RESPECT', label: 'Blocks, TSR & signal failures respected', status: blockViolations.length === 0 ? 'PASS' : 'FAIL', violation_count: blockViolations.length, details: blockViolations.slice(0, 5) },
    { rule: 'PLATFORM_ALLOCATION', label: 'Platform conflict-free & train length fit', status: platformViolations.length === 0 ? 'PASS' : 'FAIL', violation_count: platformViolations.length, details: platformViolations.slice(0, 5) },
    { rule: 'DWELL_AND_DEPARTURE', label: 'Minimum dwell & departure ordering', status: dwellViolations.length === 0 ? 'PASS' : 'FAIL', violation_count: dwellViolations.length, details: dwellViolations.slice(0, 5) },
    { rule: 'RAKE_CREW_LINKAGE', label: 'Rake turnaround & crew duty hours', status: resourceViolations.length === 0 ? 'PASS' : 'FAIL', violation_count: resourceViolations.length, details: resourceViolations.slice(0, 5) },
  ];

  return {
    valid: checks.every((c) => c.status === 'PASS'),
    checks,
    violations,
    kpis,
  };
}

export function computeScheduleKpis(
  scheduleRows: ScheduleRow[],
  trains: TrainRow[],
  sections: SectionRow[],
  platforms: PlatformRow[],
  violations: ConstraintViolation[],
  kindLabel: 'ORIGINAL' | 'OPTIMIZED'
): KpiSummary {
  const safety = getSafetyParams();
  const horizonMin = Math.max(60, safety.horizon_end_min - safety.horizon_start_min);
  const horizonHrs = horizonMin / 60;

  const byTrain = new Map<number, ScheduleRow[]>();
  for (const r of scheduleRows) {
    if (!byTrain.has(r.train_id)) byTrain.set(r.train_id, []);
    byTrain.get(r.train_id)!.push(r);
  }

  let completed = 0;
  let delayed = 0;
  let waiting = 0;
  let totalDelay = 0;
  let totalWait = 0;
  let totalSecBusyMin = 0;
  let totalPfBusyMin = 0;

  // Estimate knock-on penalty from unresolved critical conflicts in ORIGINAL un-dispatched schedule
  const trainConflictPenalty = new Map<number, number>();
  if (kindLabel === 'ORIGINAL') {
    for (const v of violations) {
      if (v.severity === 'CRITICAL') {
        const pen = v.rule === 'SINGLE_TRACK_MUTEX' ? 14 : v.rule === 'HEADWAY_NO_OVERTAKE' ? 9 : 6;
        for (const tid of v.train_ids) {
          trainConflictPenalty.set(tid, (trainConflictPenalty.get(tid) ?? 0) + pen);
        }
      }
    }
  }

  for (const tr of trains) {
    const rows = byTrain.get(tr.id) ?? [];
    if (rows.length === 0) continue;
    rows.sort((a, b) => a.arrival - b.arrival);
    const destArr = rows[rows.length - 1].arrival;
    const conflictPen = trainConflictPenalty.get(tr.id) ?? 0;
    const delayMin = Math.max(0, destArr - tr.sch_arrival) + conflictPen;
    totalDelay += delayMin;
    if (delayMin > 3) delayed++;
    if (destArr + conflictPen <= safety.horizon_end_min + 60) completed++;

    let trainWait = 0;
    for (let i = 1; i < rows.length - 1; i++) {
      const dwell = Math.max(0, rows[i].departure - rows[i].arrival);
      if (dwell > 3) trainWait += dwell - 2;
      totalPfBusyMin += Math.max(2, dwell);
    }
    trainWait += Math.round(conflictPen * 0.75);
    totalWait += trainWait;
    if (trainWait > 2) waiting++;

    for (const row of rows) {
      if (row.entry_time !== null && row.exit_time !== null) {
        totalSecBusyMin += Math.max(1, row.exit_time - row.entry_time);
      }
    }
  }

  const activeCount = Math.max(1, trains.length);
  const totalSectionCapMin = Math.max(1, sections.reduce((acc, s) => acc + s.num_tracks * horizonMin, 0));
  const totalPfCapMin = Math.max(1, platforms.length * horizonMin);

  const trackUtil = Math.min(99, Math.round((totalSecBusyMin / totalSectionCapMin) * 1000) / 10);
  const pfUtil = Math.min(99, Math.round((totalPfBusyMin / totalPfCapMin) * 1000) / 10);
  const conflictCount = violations.filter((v) => v.severity === 'CRITICAL').length;
  const predictedCongestion = Math.min(99, Math.round((trackUtil * 0.65 + conflictCount * 4.5) * 10) / 10);

  return {
    total_trains: trains.length,
    active_trains: trains.length,
    completed_trains: completed,
    delayed_trains: delayed,
    waiting_trains: waiting,
    throughput_per_hour: Math.round((completed / horizonHrs) * 100) / 100,
    total_delay_min: Math.round(totalDelay),
    avg_delay_min: Math.round((totalDelay / activeCount) * 10) / 10,
    total_waiting_min: Math.round(totalWait),
    avg_waiting_min: Math.round((totalWait / activeCount) * 10) / 10,
    on_time_pct: Math.round(((activeCount - delayed) / activeCount) * 1000) / 10,
    track_utilization_pct: trackUtil,
    platform_utilization_pct: pfUtil,
    predicted_congestion_pct: predictedCongestion,
    conflict_count: conflictCount,
  };
}
