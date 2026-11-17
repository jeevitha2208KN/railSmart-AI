import { getDb } from './database.ts';
import { hashPassword } from '../services/security.ts';
import type { OptimizerWeights, SafetyParams, TrainCategory, Direction } from '../types.ts';

export const DEFAULT_WEIGHTS: OptimizerWeights = {
  W1_served: 1000,
  W2_delay: 10,
  W3_waiting: 5,
  W4_changed: 3,
  W5_shift: 1,
  W6_connections: 50,
  W7_balance: 2,
  max_shift_min: 35,
  max_freight_starvation_min: 45,
  time_limit_sec: 15,
  mode: 'WEIGHTED',
};

export const DEFAULT_SAFETY: SafetyParams = {
  default_headway_min: 5,
  clearance_min: 2,
  default_dwell_min: 2,
  horizon_start_min: 360, // 06:00
  horizon_end_min: 720,   // 12:00
  max_connection_hold_min: 10,
};

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

export function seedDatabase(forceReset = false): { seeded: boolean; counts: Record<string, number> } {
  const db = getDb();

  if (!forceReset) {
    const row = db.prepare('SELECT COUNT(*) as c FROM stations').get() as { c: number };
    if (row.c > 0) {
      const trainsCount = (db.prepare('SELECT COUNT(*) as c FROM trains').get() as { c: number }).c;
      return { seeded: false, counts: { stations: row.c, trains: trainsCount } };
    }
  }

  db.exec('PRAGMA foreign_keys = OFF;');
  const tables = [
    'sim_events', 'sim_runs', 'recommendations', 'schedules', 'optimization_runs',
    'conflicts', 'delay_history', 'weather_events', 'disruptions', 'sensor_readings',
    'maintenance_orders', 'connections', 'train_routes', 'trains', 'rakes', 'crews',
    'platforms', 'sections', 'stations', 'scenarios', 'audit_log', 'copilot_log',
    'users', 'system_settings',
  ];
  for (const t of tables) {
    db.exec(`DELETE FROM ${t};`);
    db.exec(`DELETE FROM sqlite_sequence WHERE name='${t}';`);
  }
  db.exec('PRAGMA foreign_keys = ON;');

  // 1. Users
  const insertUser = db.prepare('INSERT INTO users (username, password_hash, role, language) VALUES (?, ?, ?, ?)');
  insertUser.run('admin', hashPassword('admin123'), 'ADMIN', 'EN');
  insertUser.run('controller', hashPassword('controller123'), 'CONTROLLER', 'EN');
  insertUser.run('viewer', hashPassword('viewer123'), 'VIEWER', 'EN');

  // 2. System settings
  const insertSetting = db.prepare('INSERT INTO system_settings (key, value_json, description) VALUES (?, ?, ?)');
  insertSetting.run('optimizer_weights', JSON.stringify(DEFAULT_WEIGHTS), 'CP-SAT/Heuristic objective weights and solver limits');
  insertSetting.run('safety_params', JSON.stringify(DEFAULT_SAFETY), 'Simulation defaults for headway, clearance, dwell and horizon (not certified signalling rules)');

  // 3. Stations (12-station realistic trunk + single-line bottleneck corridor, 165 km)
  const stationDefs = [
    { code: 'PUNE', name: 'Pune Terminus (Synth)', km: 0, lat: 18.5289, lon: 73.8745, numP: 4, maxLen: 720, loop: 1, lc: 2, llen: 700, dwell: 3, cap: 8, jn: 1 },
    { code: 'LNL',  name: 'Loni Kalbhor', km: 16, lat: 18.4912, lon: 74.0185, numP: 2, maxLen: 680, loop: 1, lc: 1, llen: 680, dwell: 2, cap: 4, jn: 0 },
    { code: 'URI',  name: 'Uruli Kanchan', km: 29, lat: 18.4810, lon: 74.1322, numP: 2, maxLen: 680, loop: 1, lc: 1, llen: 680, dwell: 2, cap: 4, jn: 0 },
    { code: 'KDG',  name: 'Kedgaon Loop', km: 47, lat: 18.4852, lon: 74.2940, numP: 2, maxLen: 660, loop: 1, lc: 1, llen: 680, dwell: 2, cap: 4, jn: 0 },
    { code: 'DD',   name: 'Daund Central Jn', km: 74, lat: 18.4651, lon: 74.5784, numP: 4, maxLen: 720, loop: 1, lc: 2, llen: 720, dwell: 4, cap: 8, jn: 1 },
    { code: 'BHIG', name: 'Bhigwan Crossing', km: 96, lat: 18.2995, lon: 74.7652, numP: 2, maxLen: 650, loop: 1, lc: 1, llen: 680, dwell: 2, cap: 3, jn: 0 },
    { code: 'JEUR', name: 'Jeur Halt & Loop', km: 118, lat: 18.2602, lon: 74.9912, numP: 2, maxLen: 640, loop: 1, lc: 1, llen: 670, dwell: 2, cap: 3, jn: 0 },
    { code: 'KEM',  name: 'Kem Yard', km: 132, lat: 18.1870, lon: 75.1120, numP: 2, maxLen: 660, loop: 1, lc: 1, llen: 680, dwell: 2, cap: 4, jn: 0 },
    { code: 'KWV',  name: 'Kurduwadi Jn', km: 146, lat: 18.0844, lon: 75.4240, numP: 3, maxLen: 700, loop: 1, lc: 2, llen: 700, dwell: 3, cap: 6, jn: 1 },
    { code: 'MA',   name: 'Madha', km: 162, lat: 18.0278, lon: 75.5245, numP: 2, maxLen: 650, loop: 1, lc: 1, llen: 680, dwell: 2, cap: 4, jn: 0 },
    { code: 'MO',   name: 'Mohol', km: 178, lat: 17.8141, lon: 75.6378, numP: 2, maxLen: 650, loop: 1, lc: 1, llen: 680, dwell: 2, cap: 4, jn: 0 },
    { code: 'SUR',  name: 'Solapur Division', km: 196, lat: 17.6599, lon: 75.9064, numP: 4, maxLen: 740, loop: 1, lc: 2, llen: 720, dwell: 4, cap: 8, jn: 1 },
  ];

  const insertStn = db.prepare(`
    INSERT INTO stations (code, name, km, lat, lon, num_platforms, platform_max_length_m, has_loop, loop_count, loop_length_m, dwell_min_default, station_capacity, is_junction)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPlat = db.prepare(`
    INSERT INTO platforms (station_id, number, length_m, electrified, status, accepts_categories)
    VALUES (?, ?, ?, 1, 'AVAILABLE', ?)
  `);

  const stationIds: number[] = [];
  const stationPlatforms: Record<number, number[]> = {};

  for (const s of stationDefs) {
    const res = insertStn.run(s.code, s.name, s.km, s.lat, s.lon, s.numP, s.maxLen, s.loop, s.lc, s.llen, s.dwell, s.cap, s.jn);
    const stnId = Number(res.lastInsertRowid);
    stationIds.push(stnId);
    stationPlatforms[stnId] = [];
    for (let p = 1; p <= s.numP; p++) {
      // Make PF-2 at DD slightly shorter (520m) so long freight/superfast trains must respect length!
      const len = s.code === 'DD' && p === 2 ? 520 : s.maxLen - (p - 1) * 20;
      const cats = p === s.numP && s.numP >= 3 ? 'PASSENGER,EXPRESS,GOODS,SPECIAL' : 'PASSENGER,EXPRESS,SUPERFAST,GOODS,EMERGENCY,SPECIAL';
      const pRes = insertPlat.run(stnId, `PF-${p}`, len, cats);
      stationPlatforms[stnId].push(Number(pRes.lastInsertRowid));
    }
  }

  // 4. Sections (mix of DOUBLE and congested SINGLE track in the middle DD->KWV)
  const insertSec = db.prepare(`
    INSERT INTO sections (code, from_station_id, to_station_id, distance_km, track_type, num_tracks, capacity_trains, max_speed_kmph, min_run_time_min, max_run_time_min, headway_min, direction_mode, electrified, gradient_factor, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'BIDIRECTIONAL', 1, ?, 'OPEN')
  `);

  const sectionIds: number[] = [];
  const sectionMeta: Array<{ id: number; dist: number; trackType: 'SINGLE' | 'DOUBLE'; minRun: number; maxRun: number; maxSpeed: number }> = [];

  for (let i = 0; i < stationDefs.length - 1; i++) {
    const a = stationDefs[i];
    const b = stationDefs[i + 1];
    const dist = Math.round((b.km - a.km) * 10) / 10;
    // Sections 4..7 (DD-BHIG, BHIG-JEUR, JEUR-KEM, KEM-KWV) are single-line bottleneck!
    const isSingle = i >= 4 && i <= 7;
    const trackType = isSingle ? 'SINGLE' : 'DOUBLE';
    const numTracks = isSingle ? 1 : 2;
    const capTrains = isSingle ? 2 : 4;
    const maxSpeed = isSingle ? 95 : 115;
    const grad = i === 5 ? 1.08 : 1.0;
    const minRun = Math.max(8, Math.round((dist / maxSpeed) * 60 * grad));
    const maxRun = Math.round(minRun * 1.45) + 4;
    const headway = isSingle ? 5 : 4;
    const code = `${a.code}-${b.code}`;
    const res = insertSec.run(code, stationIds[i], stationIds[i + 1], dist, trackType, numTracks, capTrains, maxSpeed, minRun, maxRun, headway, grad);
    const id = Number(res.lastInsertRowid);
    sectionIds.push(id);
    sectionMeta.push({ id, dist, trackType, minRun, maxRun, maxSpeed });
  }

  // 5. Rakes and Crews
  const insertRake = db.prepare('INSERT INTO rakes (rake_no, next_train_id, turnaround_min, ready_time) VALUES (?, NULL, ?, ?)');
  const rakeIds: number[] = [];
  for (let r = 1; r <= 12; r++) {
    const res = insertRake.run(`RK-${String(r).padStart(2, '0')}`, 25, 360);
    rakeIds.push(Number(res.lastInsertRowid));
  }

  const insertCrew = db.prepare('INSERT INTO crews (crew_no, duty_start, max_duty_hours, base_station_id) VALUES (?, ?, ?, ?)');
  const crewIds: number[] = [];
  for (let c = 1; c <= 14; c++) {
    const baseStn = c % 2 === 0 ? stationIds[0] : stationIds[11];
    const dutyStart = 360 + (c % 5) * 35;
    const res = insertCrew.run(`CRW-${String(c).padStart(2, '0')}`, dutyStart, 9.5, baseStn);
    crewIds.push(Number(res.lastInsertRowid));
  }

  // 6. Trains + Routes + Original Schedules
  // Build 26 active trains in the 06:00–12:00 window (360–720 min) with deliberate conflicts:
  //   - 3 single-line crossing conflicts on DD-BHIG, BHIG-JEUR, JEUR-KEM
  //   - Freight G-501 blocking Superfast 12002
  //   - Platform clash at DD (PF-1) between 12951 and 11027
  // Plus 38 additional off-peak daily trains (total 64 trains/day!)
  interface SeedTrainSpec {
    train_no: string;
    name: string;
    category: TrainCategory;
    priority: number;
    direction: Direction;
    length_m: number;
    max_speed_kmph: number;
    dep_min: number;
    start_idx: number;
    end_idx: number;
    active: number;
    forced_pf_at_dd?: number; // index 0-based
    may_advance?: number;
  }

  const activeSpecs: SeedTrainSpec[] = [
    // UP trains (PUNE -> SUR, station idx 0 -> 11)
    { train_no: '12951', name: 'Deccan Queen SF', category: 'SUPERFAST', priority: 9, direction: 'UP', length_m: 540, max_speed_kmph: 115, dep_min: 370, start_idx: 0, end_idx: 11, active: 1, forced_pf_at_dd: 0 },
    { train_no: '11027', name: 'Daund Morning Exp', category: 'EXPRESS', priority: 7, direction: 'UP', length_m: 480, max_speed_kmph: 95, dep_min: 382, start_idx: 0, end_idx: 11, active: 1, forced_pf_at_dd: 0 },
    { train_no: 'G-501', name: 'Coal Freight Heavy', category: 'GOODS', priority: 2, direction: 'UP', length_m: 640, max_speed_kmph: 58, dep_min: 398, start_idx: 2, end_idx: 11, active: 1 },
    { train_no: '12002', name: 'Shatabdi Spl SF', category: 'SUPERFAST', priority: 10, direction: 'UP', length_m: 460, max_speed_kmph: 120, dep_min: 416, start_idx: 0, end_idx: 11, active: 1 },
    { train_no: 'P-101', name: 'Pune–Daund Shuttle', category: 'PASSENGER', priority: 4, direction: 'UP', length_m: 340, max_speed_kmph: 75, dep_min: 425, start_idx: 0, end_idx: 8, active: 1 },
    { train_no: '17222', name: 'Coastal Express', category: 'EXPRESS', priority: 7, direction: 'UP', length_m: 500, max_speed_kmph: 100, dep_min: 460, start_idx: 0, end_idx: 11, active: 1 },
    { train_no: 'G-503', name: 'Container Rake UP', category: 'GOODS', priority: 3, direction: 'UP', length_m: 620, max_speed_kmph: 64, dep_min: 472, start_idx: 0, end_idx: 11, active: 1 },
    { train_no: 'P-103', name: 'Daund–Kurduwadi Local', category: 'PASSENGER', priority: 5, direction: 'UP', length_m: 340, max_speed_kmph: 78, dep_min: 495, start_idx: 2, end_idx: 11, active: 1 },
    { train_no: '12702', name: 'Hussainsagar SF', category: 'SUPERFAST', priority: 9, direction: 'UP', length_m: 540, max_speed_kmph: 115, dep_min: 520, start_idx: 0, end_idx: 11, active: 1 },
    { train_no: 'G-505', name: 'Cement Rake UP', category: 'GOODS', priority: 2, direction: 'UP', length_m: 630, max_speed_kmph: 60, dep_min: 535, start_idx: 0, end_idx: 11, active: 1 },
    { train_no: 'P-105', name: 'Solapur Passenger', category: 'PASSENGER', priority: 4, direction: 'UP', length_m: 360, max_speed_kmph: 80, dep_min: 560, start_idx: 0, end_idx: 11, active: 1 },
    { train_no: '11013', name: 'Coimbatore Express', category: 'EXPRESS', priority: 8, direction: 'UP', length_m: 520, max_speed_kmph: 105, dep_min: 590, start_idx: 0, end_idx: 11, active: 1 },
    { train_no: 'SP-901', name: 'Inspection Special', category: 'SPECIAL', priority: 8, direction: 'UP', length_m: 220, max_speed_kmph: 110, dep_min: 615, start_idx: 0, end_idx: 8, active: 1, may_advance: 1 },

    // DOWN trains (SUR -> PUNE, station idx 11 -> 0) — timed to hit single-line crossings!
    { train_no: '12158', name: 'Siddheshwar SF DN', category: 'SUPERFAST', priority: 9, direction: 'DOWN', length_m: 540, max_speed_kmph: 115, dep_min: 390, start_idx: 11, end_idx: 0, active: 1 },
    { train_no: 'P-102', name: 'Solapur–Pune Pass', category: 'PASSENGER', priority: 4, direction: 'DOWN', length_m: 350, max_speed_kmph: 78, dep_min: 378, start_idx: 11, end_idx: 0, active: 1 },
    { train_no: 'G-502', name: 'Steel Freight DN', category: 'GOODS', priority: 2, direction: 'DOWN', length_m: 640, max_speed_kmph: 60, dep_min: 405, start_idx: 11, end_idx: 0, active: 1 },
    { train_no: '11302', name: 'Udyan Express DN', category: 'EXPRESS', priority: 8, direction: 'DOWN', length_m: 520, max_speed_kmph: 105, dep_min: 445, start_idx: 11, end_idx: 0, active: 1 },
    { train_no: 'P-104', name: 'Kurduwadi Local DN', category: 'PASSENGER', priority: 4, direction: 'DOWN', length_m: 340, max_speed_kmph: 76, dep_min: 470, start_idx: 10, end_idx: 0, active: 1 },
    { train_no: 'G-504', name: 'Grain Freight DN', category: 'GOODS', priority: 3, direction: 'DOWN', length_m: 620, max_speed_kmph: 62, dep_min: 490, start_idx: 11, end_idx: 0, active: 1 },
    { train_no: '16340', name: 'Nagercoil Exp DN', category: 'EXPRESS', priority: 7, direction: 'DOWN', length_m: 500, max_speed_kmph: 100, dep_min: 525, start_idx: 11, end_idx: 0, active: 1 },
    { train_no: '12001', name: 'Intercity SF DN', category: 'SUPERFAST', priority: 10, direction: 'DOWN', length_m: 460, max_speed_kmph: 120, dep_min: 550, start_idx: 11, end_idx: 0, active: 1 },
    { train_no: 'P-106', name: 'Bhigwan Shuttle DN', category: 'PASSENGER', priority: 4, direction: 'DOWN', length_m: 330, max_speed_kmph: 78, dep_min: 575, start_idx: 9, end_idx: 0, active: 1 },
    { train_no: 'G-506', name: 'Petroleum Tanker DN', category: 'GOODS', priority: 3, direction: 'DOWN', length_m: 610, max_speed_kmph: 60, dep_min: 595, start_idx: 11, end_idx: 0, active: 1 },
    { train_no: '17014', name: 'Hadapsar Exp DN', category: 'EXPRESS', priority: 7, direction: 'DOWN', length_m: 490, max_speed_kmph: 100, dep_min: 610, start_idx: 11, end_idx: 0, active: 1 },
    { train_no: 'P-108', name: 'Midday Passenger DN', category: 'PASSENGER', priority: 5, direction: 'DOWN', length_m: 350, max_speed_kmph: 80, dep_min: 635, start_idx: 11, end_idx: 0, active: 1 },
    { train_no: 'EM-01', name: 'Medical Relief Van', category: 'EMERGENCY', priority: 10, direction: 'DOWN', length_m: 180, max_speed_kmph: 120, dep_min: 485, start_idx: 8, end_idx: 0, active: 1, may_advance: 1 },
  ];

  // Add 38 off-peak daily trains (00:00–05:45 and 12:15–23:45) so total roster = 64 trains
  const offPeakSpecs: SeedTrainSpec[] = [];
  const catCycle: Array<{ cat: TrainCategory; prio: number; spd: number; len: number }> = [
    { cat: 'PASSENGER', prio: 4, spd: 78, len: 340 },
    { cat: 'GOODS', prio: 2, spd: 60, len: 620 },
    { cat: 'EXPRESS', prio: 7, spd: 100, len: 500 },
    { cat: 'PASSENGER', prio: 4, spd: 78, len: 350 },
    { cat: 'SUPERFAST', prio: 9, spd: 115, len: 540 },
    { cat: 'GOODS', prio: 3, spd: 62, len: 630 },
    { cat: 'SPECIAL', prio: 6, spd: 95, len: 300 },
  ];
  for (let k = 0; k < 38; k++) {
    const tpl = catCycle[k % catCycle.length];
    const dir: Direction = k % 2 === 0 ? 'UP' : 'DOWN';
    const dep = k < 12 ? 30 + k * 25 : 735 + (k - 12) * 26;
    offPeakSpecs.push({
      train_no: `2${String(410 + k)}`,
      name: `${tpl.cat === 'GOODS' ? 'Freight' : tpl.cat === 'PASSENGER' ? 'Local' : tpl.cat === 'SPECIAL' ? 'Spl' : 'Trunk'} ${410 + k} ${dir}`,
      category: tpl.cat,
      priority: tpl.prio,
      direction: dir,
      length_m: tpl.len,
      max_speed_kmph: tpl.spd,
      dep_min: dep,
      start_idx: dir === 'UP' ? 0 : 11,
      end_idx: dir === 'UP' ? 11 : 0,
      active: 0,
    });
  }

  const allSpecs = [...activeSpecs, ...offPeakSpecs];

  const insertTrain = db.prepare(`
    INSERT INTO trains (train_no, name, category, priority, direction, length_m, max_speed_kmph, origin_id, destination_id, sch_departure, sch_arrival, actual_departure, est_arrival, status, current_section_id, current_station_id, lat, lon, rake_id, crew_id, may_advance, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRoute = db.prepare(`
    INSERT INTO train_routes (train_id, seq, station_id, sch_arrival, sch_departure, min_dwell_min, platform_id, is_stop)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSched = db.prepare(`
    INSERT INTO schedules (run_id, train_id, station_id, kind, arrival, departure, section_id, entry_time, exit_time, platform_id, used_loop)
    VALUES (NULL, ?, ?, 'ORIGINAL', ?, ?, ?, ?, ?, ?, 0)
  `);

  const trainIdMap: Record<string, number> = {};

  for (let idx = 0; idx < allSpecs.length; idx++) {
    const sp = allSpecs[idx];
    const step = sp.direction === 'UP' ? 1 : -1;
    const nodeIndices: number[] = [];
    for (let s = sp.start_idx; sp.direction === 'UP' ? s <= sp.end_idx : s >= sp.end_idx; s += step) {
      nodeIndices.push(s);
    }

    // Build original timetable along route
    let curT = sp.dep_min;
    const stops: Array<{
      stnIdx: number;
      arr: number;
      dep: number;
      dwell: number;
      secId: number | null;
      entry: number | null;
      exit: number | null;
      pfId: number;
      isStop: number;
    }> = [];

    for (let r = 0; r < nodeIndices.length; r++) {
      const stnIdx = nodeIndices[r];
      const stnDef = stationDefs[stnIdx];
      const stnId = stationIds[stnIdx];
      const pfList = stationPlatforms[stnId];

      let pfIdx = sp.direction === 'UP' ? 0 : Math.min(1, pfList.length - 1);
      if (stnIdx === 4 && sp.forced_pf_at_dd !== undefined) {
        pfIdx = sp.forced_pf_at_dd;
      } else if (sp.category === 'GOODS' && pfList.length >= 3) {
        pfIdx = pfList.length - 1;
      }
      const pfId = pfList[Math.min(pfIdx, pfList.length - 1)];

      const isFirst = r === 0;
      const isLast = r === nodeIndices.length - 1;
      const isStop = isFirst || isLast || sp.category === 'PASSENGER' || stnDef.jn === 1 || stnIdx % 2 === 0 ? 1 : 0;
      const dwell = isFirst || isLast ? 0 : isStop ? stnDef.dwell : 0;

      const arr = curT;
      const dep = isLast ? arr : arr + dwell;

      let secId: number | null = null;
      let entry: number | null = null;
      let exit: number | null = null;
      if (!isLast) {
        const nextStnIdx = nodeIndices[r + 1];
        const secIdx = Math.min(stnIdx, nextStnIdx);
        const sec = sectionMeta[secIdx];
        secId = sec.id;
        const effSpeed = Math.min(sp.max_speed_kmph, sec.maxSpeed);
        const runMin = Math.max(sec.minRun, Math.round((sec.dist / effSpeed) * 60));
        entry = dep;
        exit = dep + runMin;
        curT = exit;
      }

      stops.push({ stnIdx, arr, dep, dwell, secId, entry, exit, pfId, isStop });
    }

    const originId = stationIds[sp.start_idx];
    const destId = stationIds[sp.end_idx];
    const schDep = stops[0].dep;
    const schArr = stops[stops.length - 1].arr;
    // Give realistic current position around sim_time = 450 (07:30)
    const simNow = 450;
    let status = 'SCHEDULED';
    let curSecId: number | null = null;
    let curStnId: number | null = originId;
    let lat = stationDefs[sp.start_idx].lat;
    let lon = stationDefs[sp.start_idx].lon;

    if (sp.active === 1) {
      if (schArr <= simNow) {
        status = 'COMPLETED';
        curStnId = destId;
        lat = stationDefs[sp.end_idx].lat;
        lon = stationDefs[sp.end_idx].lon;
      } else if (schDep <= simNow) {
        status = sp.train_no === 'G-501' || sp.train_no === '11027' || sp.train_no === '12158' ? 'DELAYED' : 'RUNNING';
        // Interpolate position
        for (const st of stops) {
          if (st.entry !== null && st.exit !== null && simNow >= st.entry && simNow <= st.exit) {
            curSecId = st.secId;
            curStnId = null;
            const nextStnIdx = sp.direction === 'UP' ? st.stnIdx + 1 : st.stnIdx - 1;
            const frac = (simNow - st.entry) / Math.max(1, st.exit - st.entry);
            lat = stationDefs[st.stnIdx].lat + (stationDefs[nextStnIdx].lat - stationDefs[st.stnIdx].lat) * frac;
            lon = stationDefs[st.stnIdx].lon + (stationDefs[nextStnIdx].lon - stationDefs[st.stnIdx].lon) * frac;
            break;
          } else if (simNow >= st.arr && simNow <= st.dep) {
            curStnId = stationIds[st.stnIdx];
            lat = stationDefs[st.stnIdx].lat;
            lon = stationDefs[st.stnIdx].lon;
            break;
          }
        }
      }
    }

    const res = insertTrain.run(
      sp.train_no,
      sp.name,
      sp.category,
      sp.priority,
      sp.direction,
      sp.length_m,
      sp.max_speed_kmph,
      originId,
      destId,
      schDep,
      schArr,
      schDep,
      schArr,
      status,
      curSecId,
      curStnId,
      lat,
      lon,
      rakeIds[idx % rakeIds.length],
      crewIds[idx % crewIds.length],
      sp.may_advance ?? 0,
      sp.active
    );
    const trainId = Number(res.lastInsertRowid);
    trainIdMap[sp.train_no] = trainId;

    for (let r = 0; r < stops.length; r++) {
      const st = stops[r];
      insertRoute.run(trainId, r + 1, stationIds[st.stnIdx], st.arr, st.dep, st.dwell, st.pfId, st.isStop);
      if (sp.active === 1) {
        insertSched.run(trainId, stationIds[st.stnIdx], st.arr, st.dep, st.secId, st.entry, st.exit, st.pfId);
      }
    }
  }

  // Link rakes with valid turnaround windows (>= 25 min after arrival)
  db.prepare('UPDATE rakes SET next_train_id = ?, ready_time = ? WHERE id = ?').run(trainIdMap['17014'], 540, rakeIds[0]);
  db.prepare('UPDATE rakes SET next_train_id = ?, ready_time = ? WHERE id = ?').run(trainIdMap['P-108'], 580, rakeIds[3]);

  // Passenger connections
  const insertConn = db.prepare('INSERT INTO connections (feeder_train_id, connecting_train_id, station_id, min_transfer_min, max_hold_min, passengers_est) VALUES (?, ?, ?, ?, ?, ?)');
  insertConn.run(trainIdMap['P-101'], trainIdMap['17222'], stationIds[4], 6, 10, 84);
  insertConn.run(trainIdMap['P-102'], trainIdMap['11302'], stationIds[8], 5, 10, 62);

  // 7. Delay history: 90 days x 224 records/day = 20,160 rows!
  const rng = mulberry32(20261117);
  const insertDelay = db.prepare(`
    INSERT INTO delay_history (train_id, station_id, date, sch_arrival, actual_arrival, delay_min, weather, congestion_index, hour, dow, prev_delay_min)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const allTrainIds = Object.values(trainIdMap);
  const weathers = ['CLEAR', 'CLEAR', 'CLEAR', 'CLEAR', 'RAIN', 'FOG', 'HEAT', 'STORM'];
  const baseDate = new Date('2026-08-18T00:00:00Z');

  db.exec('BEGIN TRANSACTION;');
  for (let day = 0; day < 90; day++) {
    const d = new Date(baseDate.getTime() + day * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const isWinterFogSeason = day > 60;
    const isMonsoon = day < 35;

    for (let rowIdx = 0; rowIdx < 224; rowIdx++) {
      const tid = allTrainIds[rowIdx % allTrainIds.length];
      const stnIdx = (rowIdx * 3 + day) % stationIds.length;
      const stnId = stationIds[stnIdx];
      const hour = (5 + (rowIdx % 18)) % 24;
      const isPeak = (hour >= 7 && hour <= 10) || (hour >= 17 && hour <= 20);

      let weather = weathers[Math.floor(rng() * weathers.length)];
      if (isWinterFogSeason && hour >= 5 && hour <= 9 && rng() < 0.45) weather = 'FOG';
      else if (isMonsoon && rng() < 0.38) weather = 'RAIN';
      else if (rng() < 0.72) weather = 'CLEAR';

      const congestion = Math.min(1.0, Math.max(0.1, (isPeak ? 0.65 : 0.32) + (stnIdx >= 4 && stnIdx <= 8 ? 0.2 : 0) + (rng() - 0.5) * 0.25));
      const prevDelay = Math.max(0, Math.round((rng() < 0.45 ? rng() * 14 : rng() * 4) * 10) / 10);
      const weatherPenalty = weather === 'FOG' ? 11 : weather === 'STORM' ? 14 : weather === 'RAIN' ? 6 : weather === 'HEAT' ? 3 : 0;
      const isSingleSection = stnIdx >= 4 && stnIdx <= 8;
      const delay = Math.max(
        0,
        Math.round(
          (0.68 * prevDelay +
            congestion * 13.5 +
            weatherPenalty +
            (isSingleSection ? 4.2 : 0.8) +
            (isPeak ? 3.5 : 0) +
            (rng() - 0.35) * 5.0) *
            10
        ) / 10
      );
      const schArr = hour * 60 + ((rowIdx * 7) % 60);
      const actArr = schArr + Math.round(delay);

      insertDelay.run(tid, stnId, dateStr, schArr, actArr, delay, weather, Math.round(congestion * 100) / 100, hour, dow, prevDelay);
    }
  }
  db.exec('COMMIT;');

  // 8. Sensor readings (with injected anomalies on sections 4 and 7 for Predictive Maintenance)
  const insertSensor = db.prepare(`
    INSERT INTO sensor_readings (section_id, ts, vibration, temperature, strain, track_gauge_dev, is_simulated)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  db.exec('BEGIN TRANSACTION;');
  for (let sIdx = 0; sIdx < sectionIds.length; sIdx++) {
    const secId = sectionIds[sIdx];
    const isFaulty4 = sIdx === 4;
    const isFaulty7 = sIdx === 7;
    for (let h = 0; h < 48; h++) {
      const ts = new Date(Date.now() - (48 - h) * 3600000).toISOString();
      const recentAnomaly = h >= 42 && (isFaulty4 || isFaulty7);
      const vib = recentAnomaly ? (isFaulty4 ? 7.8 + rng() * 2.1 : 6.5 + rng() * 1.6) : 1.6 + rng() * 1.1;
      const temp = recentAnomaly && isFaulty7 ? 51 + rng() * 6 : 33 + rng() * 7;
      const strain = recentAnomaly ? 390 + rng() * 90 : 140 + rng() * 45;
      const gauge = recentAnomaly ? (isFaulty4 ? 4.4 + rng() * 1.4 : 3.6 + rng() * 1.1) : 0.4 + rng() * 0.7;
      insertSensor.run(secId, ts, Math.round(vib * 100) / 100, Math.round(temp * 10) / 10, Math.round(strain * 10) / 10, Math.round(gauge * 100) / 100);
    }
  }
  db.exec('COMMIT;');

  // 9. Initial clear weather baseline + sample maintenance order
  db.prepare(`
    INSERT INTO weather_events (type, severity, section_id, start_min, end_min, speed_factor, headway_bonus_min, source, active)
    VALUES ('CLEAR', 1, NULL, 360, 720, 1.0, 0, 'SIMULATED', 1)
  `).run();

  db.prepare(`
    INSERT INTO maintenance_orders (section_id, priority, status, due_date, window_start_min, window_end_min, note)
    VALUES (?, 'HIGH', 'OPEN', '2026-11-18', 640, 680, 'Elevated rail vibration & gauge deviation detected on single-line Daund–Bhigwan block')
  `).run(sectionIds[4]);

  db.prepare(`
    INSERT INTO audit_log (user_id, username, action, entity, entity_id, detail_json)
    VALUES (1, 'system', 'SEED_DATABASE', 'corridor', '1', '{"note":"Initialized synthetic 12-station trunk corridor with 64 daily trains and 20,160 delay history records"}')
  `).run();

  return {
    seeded: true,
    counts: {
      stations: stationIds.length,
      sections: sectionIds.length,
      trains: allSpecs.length,
      active_trains: activeSpecs.length,
      delay_history: 90 * 224,
    },
  };
}
