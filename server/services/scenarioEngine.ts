import { getDb } from '../db/database.ts';
import type { Direction, SectionRow, StationRow, TrainCategory, TrainRow } from '../types.ts';
import { scanConflicts } from './conflictEngine.ts';
import { runOptimization } from './optimizer.ts';
import { runDigitalTwinSimulation } from './simulator.ts';
import { loadScheduleRows, verifySchedule } from './verifier.ts';

export type WhatIfType =
  | 'DELAY_10'
  | 'DELAY_20'
  | 'DELAY_30'
  | 'SECTION_BLOCK'
  | 'PLATFORM_DOWN'
  | 'HEAVY_RAIN'
  | 'FOG_PROTOCOL'
  | 'EXTRA_TRAIN'
  | 'FREIGHT_SURGE'
  | 'DOUBLE_FAILURE';

export function runWhatIfScenario(params: {
  name: string;
  type: WhatIfType;
  target_train_id?: number;
  target_section_id?: number;
  target_station_id?: number;
  seed?: number;
  persist?: boolean;
}) {
  const db = getDb();
  const seed = params.seed ?? 42;
  const trains = db.prepare('SELECT * FROM trains WHERE is_active = 1').all() as unknown as TrainRow[];
  const sections = db.prepare('SELECT * FROM sections').all() as unknown as SectionRow[];

  const targetTrain = params.target_train_id
    ? trains.find((t) => t.id === params.target_train_id)
    : trains.find((t) => t.category === 'SUPERFAST') ?? trains[0];
  const targetSection = params.target_section_id
    ? sections.find((s) => s.id === params.target_section_id)
    : sections.find((s) => s.track_type === 'SINGLE') ?? sections[0];

  const injectedDelays: Record<number, number> = {};
  const blockedSectionIds: number[] = [];
  let weatherFactor = 1.0;

  switch (params.type) {
    case 'DELAY_10':
      if (targetTrain) injectedDelays[targetTrain.id] = 10;
      break;
    case 'DELAY_20':
      if (targetTrain) injectedDelays[targetTrain.id] = 20;
      break;
    case 'DELAY_30':
      if (targetTrain) injectedDelays[targetTrain.id] = 30;
      break;
    case 'SECTION_BLOCK':
      if (targetSection) blockedSectionIds.push(targetSection.id);
      break;
    case 'PLATFORM_DOWN':
      if (targetTrain) injectedDelays[targetTrain.id] = 12;
      break;
    case 'HEAVY_RAIN':
      weatherFactor = 0.78;
      break;
    case 'FOG_PROTOCOL':
      weatherFactor = 0.62;
      break;
    case 'EXTRA_TRAIN':
      if (trains[0]) injectedDelays[trains[0].id] = 8;
      break;
    case 'FREIGHT_SURGE':
      for (const t of trains.filter((x) => x.category === 'GOODS').slice(0, 3)) {
        injectedDelays[t.id] = 12;
      }
      break;
    case 'DOUBLE_FAILURE':
      if (targetTrain) injectedDelays[targetTrain.id] = 22;
      if (targetSection) blockedSectionIds.push(targetSection.id);
      weatherFactor = 0.75;
      break;
  }

  // Baseline vs Scenario simulation on ORIGINAL and OPTIMIZED schedules
  const origSim = runDigitalTwinSimulation({
    scheduleKind: 'ORIGINAL',
    seed,
    injectedDelays,
    blockedSectionIds,
    weatherSpeedFactor: weatherFactor,
    persist: false,
  });

  const optSim = runDigitalTwinSimulation({
    scheduleKind: 'OPTIMIZED',
    seed,
    injectedDelays,
    blockedSectionIds,
    weatherSpeedFactor: weatherFactor,
    persist: false,
  });

  // Per-train comparison
  const perTrain = origSim.train_positions.map((op) => {
    const optP = optSim.train_positions.find((x) => x.train_id === op.train_id);
    return {
      train_id: op.train_id,
      train_no: op.train_no,
      name: op.name,
      category: op.category,
      original_delay_min: op.delay_min,
      optimized_delay_min: optP?.delay_min ?? op.delay_min,
      saved_min: op.delay_min - (optP?.delay_min ?? op.delay_min),
    };
  });

  const result = {
    name: params.name,
    type: params.type,
    parameters: {
      target_train_no: targetTrain?.train_no ?? null,
      target_section_code: targetSection?.code ?? null,
      weather_speed_factor: weatherFactor,
      blocked_sections: blockedSectionIds.length,
    },
    original_kpis: origSim.kpis,
    optimized_kpis: optSim.kpis,
    delay_reduction_pct:
      origSim.kpis.total_delay_min > 0
        ? Math.round(((origSim.kpis.total_delay_min - optSim.kpis.total_delay_min) / origSim.kpis.total_delay_min) * 1000) / 10
        : 0,
    per_train: perTrain,
  };

  if (params.persist !== false) {
    db.prepare('INSERT INTO scenarios (name, type, params_json, result_json, created_by) VALUES (?, ?, ?, ?, ?)').run(
      params.name,
      params.type,
      JSON.stringify({ target_train_id: targetTrain?.id, target_section_id: targetSection?.id, weatherFactor }),
      JSON.stringify(result),
      'controller'
    );
  }

  return result;
}

export function runWorstCaseSweep() {
  const types: Array<{ name: string; type: WhatIfType }> = [
    { name: 'Superfast +20m Delay', type: 'DELAY_20' },
    { name: 'Single-Line Block (30m)', type: 'SECTION_BLOCK' },
    { name: 'Winter Fog Protocol', type: 'FOG_PROTOCOL' },
    { name: 'Heavy Monsoon Rain', type: 'HEAVY_RAIN' },
    { name: 'Freight Surge', type: 'FREIGHT_SURGE' },
    { name: 'Compound Double Failure', type: 'DOUBLE_FAILURE' },
  ];
  return types.map((t) => runWhatIfScenario({ name: t.name, type: t.type, persist: false }));
}

export function insertEmergencyTrainAndReplan(params: {
  train_no: string;
  name: string;
  category: TrainCategory;
  direction: Direction;
  dep_min: number;
  priority?: number;
}) {
  const db = getDb();
  const stations = db.prepare('SELECT * FROM stations ORDER BY km ASC').all() as unknown as StationRow[];
  const sections = db.prepare('SELECT * FROM sections ORDER BY id ASC').all() as unknown as SectionRow[];
  const platforms = db.prepare('SELECT * FROM platforms').all() as Array<{ id: number; station_id: number }>;

  if (stations.length < 2) throw new Error('Network requires at least 2 stations.');

  const beforeOpt = loadScheduleRows('OPTIMIZED');
  const beforeVerify = verifySchedule(beforeOpt.length > 0 ? beforeOpt : loadScheduleRows('ORIGINAL'), 'OPTIMIZED');

  const originIdx = params.direction === 'UP' ? 0 : stations.length - 1;
  const destIdx = params.direction === 'UP' ? stations.length - 1 : 0;
  const step = params.direction === 'UP' ? 1 : -1;
  const maxSpeed = params.category === 'EMERGENCY' ? 120 : 105;
  const priority = params.priority ?? (params.category === 'EMERGENCY' ? 10 : 9);

  // Remove previous emergency insert with same train_no if re-tested
  const existing = db.prepare('SELECT id FROM trains WHERE train_no = ?').get(params.train_no) as { id: number } | undefined;
  if (existing) {
    db.prepare('DELETE FROM trains WHERE id = ?').run(existing.id);
  }

  let curT = params.dep_min;
  const routeNodes: Array<{ station_id: number; arr: number; dep: number; sec_id: number | null; entry: number | null; exit: number | null; pf_id: number | null }> = [];

  for (let idx = originIdx; params.direction === 'UP' ? idx <= destIdx : idx >= destIdx; idx += step) {
    const stn = stations[idx];
    const pf = platforms.find((p) => p.station_id === stn.id);
    const isLast = idx === destIdx;
    const arr = curT;
    const dep = isLast ? arr : arr + (idx === originIdx ? 0 : 1);
    let secId: number | null = null;
    let entry: number | null = null;
    let exit: number | null = null;

    if (!isLast) {
      const nextStn = stations[idx + step];
      const sec = sections.find(
        (s) =>
          (s.from_station_id === stn.id && s.to_station_id === nextStn.id) ||
          (s.from_station_id === nextStn.id && s.to_station_id === stn.id)
      );
      if (sec) {
        secId = sec.id;
        const runMin = Math.max(sec.min_run_time_min, Math.round((sec.distance_km / Math.min(maxSpeed, sec.max_speed_kmph)) * 60));
        entry = dep;
        exit = dep + runMin;
        curT = exit;
      }
    }
    routeNodes.push({ station_id: stn.id, arr, dep, sec_id: secId, entry, exit, pf_id: pf?.id ?? null });
  }

  const schArr = routeNodes[routeNodes.length - 1].arr;
  const trRes = db
    .prepare(
      `INSERT INTO trains (train_no, name, category, priority, direction, length_m, max_speed_kmph, origin_id, destination_id, sch_departure, sch_arrival, actual_departure, est_arrival, status, current_section_id, current_station_id, lat, lon, may_advance, is_active)
       VALUES (?, ?, ?, ?, ?, 240, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', NULL, ?, ?, ?, 1, 1)`
    )
    .run(
      params.train_no,
      params.name,
      params.category,
      priority,
      params.direction,
      maxSpeed,
      stations[originIdx].id,
      stations[destIdx].id,
      params.dep_min,
      schArr,
      params.dep_min,
      schArr,
      stations[originIdx].id,
      stations[originIdx].lat,
      stations[originIdx].lon
    );
  const newTrainId = Number(trRes.lastInsertRowid);

  const insRt = db.prepare('INSERT INTO train_routes (train_id, seq, station_id, sch_arrival, sch_departure, min_dwell_min, platform_id, is_stop) VALUES (?, ?, ?, ?, ?, 1, ?, 1)');
  const insOrig = db.prepare("INSERT INTO schedules (run_id, train_id, station_id, kind, arrival, departure, section_id, entry_time, exit_time, platform_id, used_loop) VALUES (NULL, ?, ?, 'ORIGINAL', ?, ?, ?, ?, ?, ?, 0)");
  routeNodes.forEach((n, idx) => {
    insRt.run(newTrainId, idx + 1, n.station_id, n.arr, n.dep, n.pf_id);
    insOrig.run(newTrainId, n.station_id, n.arr, n.dep, n.sec_id, n.entry, n.exit, n.pf_id);
  });

  // Re-optimize with emergency priority & minimum disturbance weights
  const opt = runOptimization({
    emergencyTrainId: newTrainId,
    weights: { W4_changed: 8, W5_shift: 3 },
    persist: true,
  });

  const changedTrains = opt.recommendations.filter((r) => r.delta_min !== 0).length;

  return {
    inserted_train_id: newTrainId,
    train_no: params.train_no,
    before_kpis: beforeVerify.kpis,
    after_kpis: opt.optimized_kpis,
    trains_disturbed: changedTrains,
    solve_time_ms: opt.solve_time_ms,
    run_id: opt.run_id,
    recommendations: opt.recommendations,
  };
}

export function runCapacitySweep() {
  const db = getDb();
  const sections = db.prepare('SELECT * FROM sections ORDER BY id ASC').all() as unknown as SectionRow[];
  const baseSim = runDigitalTwinSimulation({ scheduleKind: 'OPTIMIZED', seed: 42, persist: false });
  const baseTrains = baseSim.kpis.active_trains;

  // Sweep +0 to +10 additional trains on the single-line bottleneck corridor
  const singleSections = sections.filter((s) => s.track_type === 'SINGLE');
  const bottleneck = singleSections.sort((a, b) => b.min_run_time_min - a.min_run_time_min)[0] ?? sections[0];

  // Theoretical UIC-406 section capacity on bottleneck single line over 6h (360m)
  const cycleMin = bottleneck.min_run_time_min * 2 + bottleneck.headway_min + 4;
  const maxSlots6h = Math.floor((360 / cycleMin) * 2);

  const curve: Array<{
    added_trains: number;
    total_trains: number;
    throughput_per_hr: number;
    avg_delay_min: number;
    utilization_pct: number;
    saturated: boolean;
  }> = [];

  for (let add = 0; add <= 10; add += 2) {
    const total = baseTrains + add;
    const loadRatio = total / Math.max(1, maxSlots6h + 8);
    const congestionFactor = loadRatio > 0.85 ? Math.pow(loadRatio - 0.72, 2.1) * 95 : loadRatio * 8;
    const avgDelay = Math.round((baseSim.kpis.avg_delay_min + congestionFactor) * 10) / 10;
    const completed = Math.min(total, Math.round(total * (loadRatio > 1.05 ? 0.82 : 0.96)));
    const throughput = Math.round((completed / 6) * 100) / 100;
    const util = Math.min(99.5, Math.round((baseSim.kpis.track_utilization_pct + add * 3.4) * 10) / 10);

    curve.push({
      added_trains: add,
      total_trains: total,
      throughput_per_hr: throughput,
      avg_delay_min: avgDelay,
      utilization_pct: util,
      saturated: avgDelay > 18 || util >= 90,
    });
  }

  // ROI ranking for infrastructure upgrades
  const upgrades = sections
    .map((s) => {
      const isSingle = s.track_type === 'SINGLE';
      const delaySavedMinPerDay = isSingle ? Math.round(s.min_run_time_min * 8.5) : Math.round(s.min_run_time_min * 1.4);
      const capGainTrains = isSingle ? 14 : 4;
      const estCostCr = isSingle ? Math.round(s.distance_km * 11.5) : Math.round(s.distance_km * 4.0);
      const roiScore = Math.round(((delaySavedMinPerDay * capGainTrains) / Math.max(1, estCostCr)) * 10) / 10;
      return {
        section_id: s.id,
        section_code: s.code,
        current_track: s.track_type,
        distance_km: s.distance_km,
        recommended_upgrade: isSingle ? 'Double-tracking + Electronic Interlocking' : 'Intermediate Block Signal (IBS) + Loop Extension',
        capacity_gain_trains_day: capGainTrains,
        delay_saved_min_day: delaySavedMinPerDay,
        est_cost_cr: estCostCr,
        roi_score: roiScore,
      };
    })
    .sort((a, b) => b.roi_score - a.roi_score);

  return {
    bottleneck_section: bottleneck.code,
    current_active_trains: baseTrains,
    safe_headroom_trains: Math.max(2, curve.filter((c) => !c.saturated).slice(-1)[0]?.added_trains ?? 4),
    curve,
    infrastructure_roi: upgrades,
  };
}

export function getConnectionsAndResources() {
  const db = getDb();
  const rows = loadScheduleRows('OPTIMIZED');
  const activeSched = rows.length > 0 ? rows : loadScheduleRows('ORIGINAL');
  const trains = db.prepare('SELECT * FROM trains WHERE is_active = 1').all() as unknown as TrainRow[];
  const stations = db.prepare('SELECT * FROM stations').all() as unknown as StationRow[];
  const trainMap = new Map(trains.map((t) => [t.id, t]));
  const stnMap = new Map(stations.map((s) => [s.id, s]));

  const connections = db.prepare('SELECT * FROM connections').all() as Array<{
    id: number;
    feeder_train_id: number;
    connecting_train_id: number;
    station_id: number;
    min_transfer_min: number;
    max_hold_min: number;
    passengers_est: number;
  }>;

  const connReport = connections.map((c) => {
    const f = trainMap.get(c.feeder_train_id);
    const t = trainMap.get(c.connecting_train_id);
    const fRow = activeSched.find((r) => r.train_id === c.feeder_train_id && r.station_id === c.station_id);
    const tRow = activeSched.find((r) => r.train_id === c.connecting_train_id && r.station_id === c.station_id);
    const transferWindow = fRow && tRow ? tRow.departure - fRow.arrival : c.min_transfer_min;
    const protectedOk = transferWindow >= c.min_transfer_min;
    return {
      id: c.id,
      station_code: stnMap.get(c.station_id)?.code ?? '',
      feeder_train: f?.train_no ?? '',
      connecting_train: t?.train_no ?? '',
      feeder_arrival: fRow?.arrival ?? 0,
      connecting_departure: tRow?.departure ?? 0,
      min_transfer_min: c.min_transfer_min,
      actual_margin_min: transferWindow,
      max_hold_min: c.max_hold_min,
      passengers_est: c.passengers_est,
      status: protectedOk ? 'PROTECTED' : 'AT_RISK',
      recommendation: protectedOk
        ? `Connection safe (${transferWindow}m transfer margin for ${c.passengers_est} pax).`
        : `Hold ${t?.train_no} by ${c.min_transfer_min - transferWindow}m to protect ${c.passengers_est} transferring passengers.`,
    };
  });

  const rakes = db
    .prepare(
      `SELECT r.*, t1.train_no as prev_train_no, t2.train_no as next_train_no, t1.sch_arrival as prev_arr, t2.sch_departure as next_dep
       FROM rakes r
       LEFT JOIN trains t1 ON t1.rake_id = r.id AND t1.id != COALESCE(r.next_train_id, -1)
       LEFT JOIN trains t2 ON t2.id = r.next_train_id
       WHERE r.next_train_id IS NOT NULL`
    )
    .all() as Array<{ id: number; rake_no: string; turnaround_min: number; prev_train_no: string | null; next_train_no: string | null; prev_arr: number | null; next_dep: number | null }>;

  const crews = db
    .prepare(
      `SELECT c.*, s.code as base_station, COUNT(t.id) as assigned_trains, MAX(t.sch_arrival) as last_arrival
       FROM crews c
       LEFT JOIN stations s ON s.id = c.base_station_id
       LEFT JOIN trains t ON t.crew_id = c.id AND t.is_active = 1
       GROUP BY c.id`
    )
    .all() as Array<{ id: number; crew_no: string; duty_start: number; max_duty_hours: number; base_station: string; assigned_trains: number; last_arrival: number | null }>;

  const crewReport = crews.map((c) => {
    const dutyHrs = c.last_arrival ? Math.round(((c.last_arrival - c.duty_start) / 60) * 10) / 10 : 0;
    return {
      ...c,
      projected_duty_hours: Math.max(0, dutyHrs),
      status: dutyHrs > c.max_duty_hours ? 'VIOLATION' : dutyHrs > c.max_duty_hours - 1 ? 'WARNING' : 'COMPLIANT',
    };
  });

  return { connections: connReport, rakes, crews: crewReport };
}
