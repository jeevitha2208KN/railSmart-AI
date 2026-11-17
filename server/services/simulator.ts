import { getDb } from '../db/database.ts';
import type { KpiSummary, SectionRow, StationRow, TrainRow } from '../types.ts';
import { getActiveDisruptions, getActiveWeatherEffects, getSafetyParams } from './networkService.ts';
import { loadScheduleRows } from './verifier.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimEventOut {
  sim_time: number;
  train_id: number;
  train_no: string;
  event: string;
  station_id: number | null;
  section_id: number | null;
  detail: string;
}

export interface SimRunResult {
  run_id: number;
  schedule_kind: 'ORIGINAL' | 'OPTIMIZED';
  seed: number;
  sim_speed: number;
  kpis: KpiSummary;
  events: SimEventOut[];
  train_positions: Array<{
    train_id: number;
    train_no: string;
    name: string;
    category: string;
    direction: string;
    progress_pct: number;
    status: string;
    delay_min: number;
    waiting_min: number;
  }>;
}

interface TrainCursor {
  train: TrainRow;
  rows: ReturnType<typeof loadScheduleRows>;
  nodeIdx: number;
  readyTime: number;
  waitMin: number;
  finished: boolean;
  finishTime: number;
}

export function runDigitalTwinSimulation(options: {
  scheduleKind?: 'ORIGINAL' | 'OPTIMIZED';
  seed?: number;
  simSpeed?: number;
  injectedDelays?: Record<number, number>;
  blockedSectionIds?: number[];
  weatherSpeedFactor?: number;
  persist?: boolean;
} = {}): SimRunResult {
  const db = getDb();
  const scheduleKind = options.scheduleKind ?? 'ORIGINAL';
  const seed = options.seed ?? 42;
  const simSpeed = options.simSpeed ?? 20;
  const rng = mulberry32(seed);
  const safety = getSafetyParams();
  const weather = getActiveWeatherEffects();
  const disruptions = getActiveDisruptions();

  const trains = db.prepare('SELECT * FROM trains WHERE is_active = 1').all() as unknown as TrainRow[];
  const stations = db.prepare('SELECT * FROM stations ORDER BY km ASC').all() as unknown as StationRow[];
  const sections = db.prepare('SELECT * FROM sections').all() as unknown as SectionRow[];

  let schedRows = loadScheduleRows(scheduleKind);
  if (schedRows.length === 0 && scheduleKind === 'OPTIMIZED') {
    schedRows = loadScheduleRows('ORIGINAL');
  }

  const stnMap = new Map(stations.map((s) => [s.id, s]));
  const secMap = new Map(sections.map((s) => [s.id, s]));
  const blockedSet = new Set<number>(options.blockedSectionIds ?? []);
  for (const s of sections) {
    if (s.status === 'BLOCKED') blockedSet.add(s.id);
  }

  const byTrain = new Map<number, typeof schedRows>();
  for (const r of schedRows) {
    if (!byTrain.has(r.train_id)) byTrain.set(r.train_id, []);
    byTrain.get(r.train_id)!.push(r);
  }

  const secIntervals = new Map<number, Array<{ dir: string; entry: number; exit: number; trainNo: string }>>();
  for (const s of sections) secIntervals.set(s.id, []);

  const events: SimEventOut[] = [];
  const cursors: TrainCursor[] = [];

  for (const tr of trains) {
    const rows = (byTrain.get(tr.id) ?? []).sort((a, b) => a.arrival - b.arrival);
    if (rows.length === 0) continue;
    const injDelay = options.injectedDelays?.[tr.id] ?? 0;
    const jitter = scheduleKind === 'ORIGINAL' ? Math.max(0, Math.round((rng() - 0.35) * 3)) : 0;
    const startReady = Math.max(rows[0].departure, tr.actual_departure) + injDelay + jitter;

    events.push({
      sim_time: startReady,
      train_id: tr.id,
      train_no: tr.train_no,
      event: injDelay > 0 ? 'DEPARTURE_DELAYED' : 'DEPARTED',
      station_id: rows[0].station_id,
      section_id: null,
      detail: `${tr.train_no} (${tr.category}) ready at ${stnMap.get(rows[0].station_id)?.code}${injDelay > 0 ? ` (+${injDelay}m shock)` : ''}`,
    });

    cursors.push({
      train: tr,
      rows,
      nodeIdx: 0,
      readyTime: startReady,
      waitMin: 0,
      finished: false,
      finishTime: startReady,
    });
  }

  // Chronological discrete-event loop: always advance the earliest ready train event!
  let totalSecBusy = 0;
  let guard = 0;
  while (guard < 5000) {
    guard++;
    const active = cursors.filter((c) => !c.finished);
    if (active.length === 0) break;

    active.sort((a, b) => a.readyTime - b.readyTime || b.train.priority - a.train.priority);
    const cur = active[0];
    const r = cur.rows[cur.nodeIdx];

    if (cur.nodeIdx >= cur.rows.length - 1 || !r.section_id || r.entry_time === null || r.exit_time === null) {
      cur.finished = true;
      cur.finishTime = cur.readyTime;
      events.push({
        sim_time: cur.finishTime,
        train_id: cur.train.id,
        train_no: cur.train.train_no,
        event: 'ARRIVED_DEST',
        station_id: r.station_id,
        section_id: null,
        detail: `${cur.train.train_no} arrived at ${stnMap.get(r.station_id)?.code} (${Math.max(0, cur.finishTime - cur.train.sch_arrival)}m delay)`,
      });
      continue;
    }

    const sec = secMap.get(r.section_id)!;
    const wFactor = options.weatherSpeedFactor ?? (weather.speedFactorBySection.get(sec.id) ?? weather.globalSpeedFactor);
    const baseRun = Math.max(sec.min_run_time_min, Math.round((r.exit_time - r.entry_time) / Math.max(0.45, wFactor)));
    const reqHw = Math.max(sec.headway_min, safety.default_headway_min) + (weather.headwayBonusBySection.get(sec.id) ?? weather.globalHeadwayBonus);
    const clr = safety.clearance_min;

    let entryTime = Math.max(cur.readyTime, r.departure);
    const occs = secIntervals.get(sec.id)!;
    let heldReason: string | null = null;

    // Check section availability at entryTime
    let pushTo: number | null = null;
    if (blockedSet.has(sec.id)) {
      const blockStart = 430;
      const blockEnd = 475;
      if (entryTime < blockEnd && entryTime + baseRun > blockStart) {
        pushTo = blockEnd;
        heldReason = `Section ${sec.code} blocked (07:10–07:55)`;
      }
    }
    for (const d of disruptions) {
      if ((d.type === 'BLOCK' || d.type === 'SIGNAL_FAILURE') && d.section_id === sec.id) {
        if (entryTime < d.end_min && entryTime + baseRun > d.start_min) {
          pushTo = Math.max(pushTo ?? 0, d.end_min);
          heldReason = `${d.type} on ${sec.code}`;
        }
      }
    }
    for (const o of occs) {
      if (sec.track_type === 'SINGLE') {
        if (o.dir !== cur.train.direction) {
          if (entryTime < o.exit + clr && o.entry < entryTime + baseRun + clr) {
            pushTo = Math.max(pushTo ?? 0, o.exit + clr);
            heldReason = `Single-line meet wait for ${o.trainNo} on ${sec.code}`;
          }
        } else {
          if (Math.abs(entryTime - o.entry) < reqHw) {
            pushTo = Math.max(pushTo ?? 0, o.entry + reqHw);
            heldReason = `Headway hold behind ${o.trainNo} on ${sec.code}`;
          } else if (entryTime >= o.entry && entryTime + baseRun < o.exit + 2) {
            const safeE = o.exit + 2 - baseRun;
            if (entryTime < safeE) {
              pushTo = Math.max(pushTo ?? 0, safeE);
              heldReason = `Clearance behind slower ${o.trainNo}`;
            }
          } else if (entryTime < o.entry && entryTime + baseRun >= o.exit) {
            pushTo = Math.max(pushTo ?? 0, o.exit + 2);
            heldReason = `No mid-section overtake of ${o.trainNo}`;
          }
        }
      } else if (o.dir === cur.train.direction) {
        if (Math.abs(entryTime - o.entry) < reqHw) {
          pushTo = Math.max(pushTo ?? 0, o.entry + reqHw);
          heldReason = `Headway hold behind ${o.trainNo}`;
        } else if (entryTime >= o.entry && entryTime + baseRun < o.exit + 2) {
          const safeE = o.exit + 2 - baseRun;
          if (entryTime < safeE) {
            pushTo = Math.max(pushTo ?? 0, safeE);
            heldReason = `Clearance behind slower ${o.trainNo}`;
          }
        } else if (entryTime < o.entry && entryTime + baseRun >= o.exit) {
          pushTo = Math.max(pushTo ?? 0, o.exit + 2);
          heldReason = `No mid-section overtake of ${o.trainNo}`;
        }
      }
    }

    const concurrent = occs.filter((o) => entryTime < o.exit && o.entry < entryTime + baseRun).length;
    if (concurrent >= sec.capacity_trains) {
      const earliestExit = Math.min(...occs.filter((o) => entryTime < o.exit && o.entry < entryTime + baseRun).map((o) => o.exit));
      pushTo = Math.max(pushTo ?? 0, earliestExit + 1);
      heldReason = `Section ${sec.code} at max capacity (${sec.capacity_trains})`;
    }

    if (pushTo !== null && pushTo > cur.readyTime) {
      // Re-queue this train event at pushTo so other trains can proceed cleanly in chronological order
      const delta = pushTo - cur.readyTime;
      cur.waitMin += delta;
      events.push({
        sim_time: cur.readyTime,
        train_id: cur.train.id,
        train_no: cur.train.train_no,
        event: 'HELD_CONFLICT',
        station_id: r.station_id,
        section_id: sec.id,
        detail: `${cur.train.train_no} held +${delta}m at ${stnMap.get(r.station_id)?.code}: ${heldReason ?? 'track busy'}`,
      });
      cur.readyTime = pushTo;
      continue;
    }

    // Reserve section & advance train to next station
    const exitTime = entryTime + baseRun;
    occs.push({ dir: cur.train.direction, entry: entryTime, exit: exitTime, trainNo: cur.train.train_no });
    totalSecBusy += baseRun;

    events.push({
      sim_time: entryTime,
      train_id: cur.train.id,
      train_no: cur.train.train_no,
      event: 'ENTER_SECTION',
      station_id: r.station_id,
      section_id: sec.id,
      detail: `${cur.train.train_no} entered ${sec.code} (${entryTime}m → ${exitTime}m)`,
    });

    cur.nodeIdx++;
    const nextRow = cur.rows[cur.nodeIdx];
    const schedHold = cur.nodeIdx < cur.rows.length - 1 ? Math.max(0, nextRow.departure - nextRow.arrival) : 0;
    const minOperationalDwell = Math.min(2, schedHold);
    const earliestByPlan = cur.nodeIdx < cur.rows.length - 1 ? nextRow.departure : 0;
    const nextReady = Math.max(exitTime + minOperationalDwell, earliestByPlan);
    if (nextReady - exitTime > 3) cur.waitMin += nextReady - exitTime - 2;
    cur.readyTime = nextReady;
  }

  events.sort((a, b) => a.sim_time - b.sim_time);

  let completed = 0;
  let delayed = 0;
  let waiting = 0;
  let totalDelay = 0;
  let totalWait = 0;

  const trainPositions = cursors.map((c) => {
    const finDelay = Math.max(0, c.finishTime - c.train.sch_arrival);
    totalDelay += finDelay;
    totalWait += c.waitMin;
    if (finDelay > 3) delayed++;
    if (c.waitMin > 2) waiting++;
    if (c.finishTime <= safety.horizon_end_min + 60) completed++;
    return {
      train_id: c.train.id,
      train_no: c.train.train_no,
      name: c.train.name,
      category: c.train.category,
      direction: c.train.direction,
      progress_pct: 100,
      status: finDelay > 5 ? 'DELAYED' : 'COMPLETED',
      delay_min: finDelay,
      waiting_min: c.waitMin,
    };
  });

  const horizonMin = Math.max(60, safety.horizon_end_min - safety.horizon_start_min);
  const totalCap = Math.max(1, sections.reduce((acc, s) => acc + s.num_tracks * horizonMin, 0));
  const trackUtil = Math.min(99, Math.round((totalSecBusy / totalCap) * 1000) / 10);
  const activeCount = Math.max(1, cursors.length);

  const kpis: KpiSummary = {
    total_trains: cursors.length,
    active_trains: cursors.length,
    completed_trains: completed,
    delayed_trains: delayed,
    waiting_trains: waiting,
    throughput_per_hour: Math.round((completed / (horizonMin / 60)) * 100) / 100,
    total_delay_min: Math.round(totalDelay),
    avg_delay_min: Math.round((totalDelay / activeCount) * 10) / 10,
    total_waiting_min: Math.round(totalWait),
    avg_waiting_min: Math.round((totalWait / activeCount) * 10) / 10,
    on_time_pct: Math.round(((activeCount - delayed) / activeCount) * 1000) / 10,
    track_utilization_pct: trackUtil,
    platform_utilization_pct: Math.min(95, Math.round(trackUtil * 0.72 * 10) / 10),
    predicted_congestion_pct: Math.min(99, Math.round((trackUtil * 0.68 + delayed * 1.4) * 10) / 10),
    conflict_count: events.filter((e) => e.event === 'HELD_CONFLICT').length,
  };

  let runId = 0;
  if (options.persist !== false) {
    const res = db
      .prepare('INSERT INTO sim_runs (scenario_id, schedule_kind, sim_speed, seed, kpi_json) VALUES (NULL, ?, ?, ?, ?)')
      .run(scheduleKind, simSpeed, seed, JSON.stringify(kpis));
    runId = Number(res.lastInsertRowid);

    const insEv = db.prepare('INSERT INTO sim_events (run_id, sim_time, train_id, event, station_id, section_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)');
    db.exec('BEGIN TRANSACTION;');
    for (const ev of events.slice(0, 400)) {
      insEv.run(runId, ev.sim_time, ev.train_id, ev.event, ev.station_id, ev.section_id, ev.detail);
    }
    db.exec('COMMIT;');
  }

  return {
    run_id: runId,
    schedule_kind: scheduleKind,
    seed,
    sim_speed: simSpeed,
    kpis,
    events: events.slice(0, 250),
    train_positions: trainPositions,
  };
}
