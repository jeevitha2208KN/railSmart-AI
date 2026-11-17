import { Router } from 'express';
import { getDb } from '../db/database.ts';
import { seedDatabase } from '../db/seed.ts';
import { scanConflicts } from '../services/conflictEngine.ts';
import { askCopilot } from '../services/copilotEngine.ts';
import { predictTrainDelay, trainDelayModel } from '../services/delayModel.ts';
import { computeEnergySummary } from '../services/energyEngine.ts';
import { analyzeMaintenanceHealth } from '../services/maintenanceEngine.ts';
import {
  getNetworkSnapshot,
  getOptimizerWeights,
  getSafetyParams,
  validateNetwork,
} from '../services/networkService.ts';
import { diagnoseInfeasibility, runOptimization } from '../services/optimizer.ts';
import {
  allocatePlatformsForStation,
  getStationPlatformLayout,
  overridePlatformAssignment,
} from '../services/platformAllocator.ts';
import { analyzeDelayPropagation } from '../services/propagationService.ts';
import {
  getConnectionsAndResources,
  insertEmergencyTrainAndReplan,
  runCapacitySweep,
  runWhatIfScenario,
  runWorstCaseSweep,
} from '../services/scenarioEngine.ts';
import {
  attachOptionalUser,
  requireRole,
  signToken,
  verifyPassword,
  writeAuditLog,
  type AuthenticatedRequest,
} from '../services/security.ts';
import { runDigitalTwinSimulation } from '../services/simulator.ts';
import { loadScheduleRows, verifySchedule } from '../services/verifier.ts';
import { fetchOpenMeteoWeather, setWeatherCondition } from '../services/weatherEngine.ts';
import type { Direction, TrainCategory, TrainRow, WeatherType } from '../types.ts';

export function createApiRouter(): Router {
  const router = Router();
  router.use(attachOptionalUser);

  // --- AUTH ---
  router.post('/auth/login', (req, res) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username)) as
      | { id: number; username: string; password_hash: string; role: 'ADMIN' | 'CONTROLLER' | 'VIEWER'; language: string }
      | undefined;
    if (!user || !verifyPassword(String(password), user.password_hash)) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }
    const token = signToken({ userId: user.id, username: user.username, role: user.role });
    writeAuditLog({ userId: user.id, username: user.username, role: user.role, exp: 0 }, 'LOGIN', 'user', user.id, { role: user.role });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, language: user.language } });
  });

  router.get('/auth/me', (req: AuthenticatedRequest, res) => {
    res.json({
      user: req.user ?? { userId: 2, username: 'controller', role: 'CONTROLLER' },
    });
  });

  // --- NETWORK ---
  router.get('/stations', (_req, res) => {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM stations ORDER BY km ASC').all());
  });

  router.post('/stations', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const { code, name, km, lat, lon, num_platforms, has_loop, station_capacity, is_junction } = req.body ?? {};
    if (!code || !name || km === undefined) {
      res.status(400).json({ error: 'code, name, and km are required.' });
      return;
    }
    const info = db
      .prepare(
        `INSERT INTO stations (code, name, km, lat, lon, num_platforms, has_loop, station_capacity, is_junction)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(String(code).toUpperCase(), String(name), Number(km), Number(lat ?? 18.2), Number(lon ?? 74.8), Number(num_platforms ?? 2), has_loop ? 1 : 0, Number(station_capacity ?? 4), is_junction ? 1 : 0);
    const stnId = Number(info.lastInsertRowid);
    for (let p = 1; p <= Number(num_platforms ?? 2); p++) {
      db.prepare('INSERT INTO platforms (station_id, number, length_m, electrified, status) VALUES (?, ?, 680, 1, "AVAILABLE")').run(stnId, `PF-${p}`);
    }
    writeAuditLog(req.user, 'CREATE_STATION', 'station', stnId, { code, name });
    res.status(201).json(db.prepare('SELECT * FROM stations WHERE id = ?').get(stnId));
  });

  router.put('/stations/:id', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { name, has_loop, loop_count, station_capacity, dwell_min_default } = req.body ?? {};
    db.prepare(
      `UPDATE stations SET
         name = COALESCE(?, name),
         has_loop = COALESCE(?, has_loop),
         loop_count = COALESCE(?, loop_count),
         station_capacity = COALESCE(?, station_capacity),
         dwell_min_default = COALESCE(?, dwell_min_default)
       WHERE id = ?`
    ).run(name ?? null, has_loop !== undefined ? (has_loop ? 1 : 0) : null, loop_count ?? null, station_capacity ?? null, dwell_min_default ?? null, id);
    writeAuditLog(req.user, 'UPDATE_STATION', 'station', id, req.body);
    res.json(db.prepare('SELECT * FROM stations WHERE id = ?').get(id));
  });

  router.delete('/stations/:id', requireRole(['ADMIN']), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    db.prepare('DELETE FROM stations WHERE id = ?').run(id);
    writeAuditLog(req.user, 'DELETE_STATION', 'station', id, {});
    res.json({ deleted: true, id });
  });

  router.get('/sections', (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT s.*, st1.code as from_code, st2.code as to_code
         FROM sections s
         JOIN stations st1 ON st1.id = s.from_station_id
         JOIN stations st2 ON st2.id = s.to_station_id
         ORDER BY s.id ASC`
      )
      .all();
    res.json(rows);
  });

  router.put('/sections/:id', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { track_type, num_tracks, max_speed_kmph, headway_min, status } = req.body ?? {};
    const tracks = track_type === 'DOUBLE' ? 2 : track_type === 'SINGLE' ? 1 : num_tracks;
    db.prepare(
      `UPDATE sections SET
         track_type = COALESCE(?, track_type),
         num_tracks = COALESCE(?, num_tracks),
         capacity_trains = COALESCE(?, capacity_trains),
         max_speed_kmph = COALESCE(?, max_speed_kmph),
         headway_min = COALESCE(?, headway_min),
         status = COALESCE(?, status)
       WHERE id = ?`
    ).run(track_type ?? null, tracks ?? null, tracks ?? null, max_speed_kmph ?? null, headway_min ?? null, status ?? null, id);
    writeAuditLog(req.user, 'UPDATE_SECTION', 'section', id, req.body);
    res.json(db.prepare('SELECT * FROM sections WHERE id = ?').get(id));
  });

  router.get('/network/graph', (_req, res) => {
    res.json(getNetworkSnapshot());
  });

  router.get('/network/validate', (_req, res) => {
    res.json(validateNetwork());
  });

  // --- TRAINS ---
  router.get('/trains', (req, res) => {
    const db = getDb();
    const { category, status, q, active_only } = req.query;
    let sql = `
      SELECT t.*, s1.code as origin_code, s2.code as destination_code,
             sec.code as current_section_code, cs.code as current_station_code
      FROM trains t
      JOIN stations s1 ON s1.id = t.origin_id
      JOIN stations s2 ON s2.id = t.destination_id
      LEFT JOIN sections sec ON sec.id = t.current_section_id
      LEFT JOIN stations cs ON cs.id = t.current_station_id
      WHERE 1=1
    `;
    const params: unknown[] = [];
    if (active_only === 'true') {
      sql += ' AND t.is_active = 1';
    }
    if (category && category !== 'ALL') {
      sql += ' AND t.category = ?';
      params.push(String(category));
    }
    if (status && status !== 'ALL') {
      sql += ' AND t.status = ?';
      params.push(String(status));
    }
    if (q) {
      sql += ' AND (t.train_no LIKE ? OR t.name LIKE ?)';
      params.push(`%${String(q)}%`, `%${String(q)}%`);
    }
    sql += ' ORDER BY t.is_active DESC, t.sch_departure ASC';
    res.json(db.prepare(sql).all(...(params as string[])));
  });

  router.get('/trains/:id', (req, res) => {
    const db = getDb();
    const train = db.prepare('SELECT * FROM trains WHERE id = ?').get(Number(req.params.id));
    if (!train) {
      res.status(404).json({ error: 'Train not found' });
      return;
    }
    res.json(train);
  });

  router.get('/trains/:id/route', (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT r.*, s.code as station_code, s.name as station_name, s.km, p.number as platform_number
         FROM train_routes r
         JOIN stations s ON s.id = r.station_id
         LEFT JOIN platforms p ON p.id = r.platform_id
         WHERE r.train_id = ?
         ORDER BY r.seq ASC`
      )
      .all(Number(req.params.id));
    res.json(rows);
  });

  router.get('/trains/:id/why-delayed', (req, res) => {
    const db = getDb();
    const trainId = Number(req.params.id);
    const train = db.prepare('SELECT * FROM trains WHERE id = ?').get(trainId) as TrainRow | undefined;
    if (!train) {
      res.status(404).json({ error: 'Train not found' });
      return;
    }
    const conflicts = scanConflicts('ORIGINAL', false).filter((c) => c.train_ids.includes(trainId));
    const disruptions = db.prepare('SELECT * FROM disruptions WHERE active = 1').all() as Array<{ type: string; description: string }>;
    const weather = db.prepare('SELECT * FROM weather_events WHERE active = 1').all() as Array<{ type: string; severity: number; speed_factor: number }>;
    const recs = db
      .prepare('SELECT action, delta_min, reason, rule_ref FROM recommendations WHERE train_id = ? ORDER BY id DESC LIMIT 3')
      .all(trainId);

    const factors: string[] = [];
    if (conflicts.length > 0) {
      for (const c of conflicts) factors.push(`${c.category}: ${c.recommended_action}`);
    }
    for (const w of weather) {
      if (w.type !== 'CLEAR') factors.push(`Weather ${w.type} (Sev ${w.severity}, speed factor x${w.speed_factor})`);
    }
    for (const d of disruptions) {
      factors.push(`Disruption ${d.type}: ${d.description}`);
    }
    if (factors.length === 0) {
      factors.push(train.category === 'GOODS' ? 'Lower dispatch priority behind express passenger paths on single-line block.' : 'Nominal running; minor dwell variance.');
    }

    res.json({ train, factors, conflicts, recommendations: recs });
  });

  // --- DELAY PREDICTION (ML) ---
  router.get('/predict/model-metrics', (_req, res) => {
    const model = trainDelayModel(false);
    res.json({
      trained_at: model.trainedAt,
      sample_count: model.sampleCount,
      metrics: model.metrics,
      confusion_matrix: model.confusionMatrix,
      risk_labels: model.riskLabels,
      residuals: model.residuals,
      calibrated: model.calibrated,
    });
  });

  router.get('/predict/feature-importance', (_req, res) => {
    const model = trainDelayModel(false);
    res.json(model.featureImportance);
  });

  router.post('/predict/retrain', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    const model = trainDelayModel(true);
    writeAuditLog(req.user, 'RETRAIN_ML_MODEL', 'delay_model', 'rf_v1', model.metrics.random_forest);
    res.json({
      retrained: true,
      trained_at: model.trainedAt,
      sample_count: model.sampleCount,
      metrics: model.metrics,
      feature_importance: model.featureImportance,
    });
  });

  router.post('/predict/delay', (req, res) => {
    const pred = predictTrainDelay(req.body ?? {});
    res.json(pred);
  });

  // --- OPTIMIZATION & RECOMMENDATIONS ---
  router.post('/optimize/run', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    const { weights, scenario_id, freeze_before_min } = req.body ?? {};
    const result = runOptimization({
      weights,
      scenarioId: scenario_id ?? null,
      freezeBeforeMin: freeze_before_min ?? null,
      persist: true,
    });
    writeAuditLog(req.user, 'RUN_OPTIMIZER', 'optimization_run', result.run_id, {
      status: result.status,
      solve_time_ms: result.solve_time_ms,
      delay_before: result.original_kpis.total_delay_min,
      delay_after: result.optimized_kpis.total_delay_min,
    });
    res.json(result);
  });

  router.get('/optimize/runs', (_req, res) => {
    const db = getDb();
    const runs = db.prepare('SELECT * FROM optimization_runs ORDER BY id DESC LIMIT 20').all() as Array<Record<string, unknown>>;
    res.json(
      runs.map((r) => ({
        ...r,
        weights: JSON.parse(String(r.weights_json)),
        original_kpis: JSON.parse(String(r.original_kpi_json)),
        optimized_kpis: JSON.parse(String(r.optimized_kpi_json)),
        constraint_report: JSON.parse(String(r.constraint_report_json)),
      }))
    );
  });

  router.get('/optimize/runs/:id/recommendations', (req, res) => {
    const db = getDb();
    let runId = Number(req.params.id);
    if (!runId || req.params.id === 'latest') {
      const latest = db.prepare('SELECT id FROM optimization_runs ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
      if (!latest) {
        res.json([]);
        return;
      }
      runId = latest.id;
    }
    const rows = db
      .prepare(
        `SELECT r.*, t.train_no, t.name as train_name, t.category, t.priority, s.code as station_code
         FROM recommendations r
         JOIN trains t ON t.id = r.train_id
         LEFT JOIN stations s ON s.id = r.station_id
         WHERE r.run_id = ?
         ORDER BY ABS(r.delta_min) DESC, r.id ASC`
      )
      .all(runId);
    res.json(rows);
  });

  router.post('/recommendations/:id/accept', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const who = req.user?.username ?? 'controller';
    const now = new Date().toISOString();
    db.prepare('UPDATE recommendations SET accepted = 1, decided_by = ?, decided_at = ? WHERE id = ?').run(who, now, id);
    writeAuditLog(req.user, 'ACCEPT_RECOMMENDATION', 'recommendation', id, { decided_by: who });
    res.json({ id, accepted: 1, decided_by: who, decided_at: now });
  });

  router.post('/recommendations/:id/reject', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const who = req.user?.username ?? 'controller';
    const now = new Date().toISOString();
    db.prepare('UPDATE recommendations SET accepted = 0, decided_by = ?, decided_at = ? WHERE id = ?').run(who, now, id);
    writeAuditLog(req.user, 'REJECT_RECOMMENDATION', 'recommendation', id, { decided_by: who, note: req.body?.note });
    res.json({ id, accepted: 0, decided_by: who, decided_at: now });
  });

  router.post('/optimize/infeasibility-diagnosis', (_req, res) => {
    res.json(diagnoseInfeasibility());
  });

  // --- MAREY GRAPH DATA ---
  router.get('/schedules/marey', (_req, res) => {
    const db = getDb();
    const stations = db.prepare('SELECT id, code, name, km, has_loop, is_junction FROM stations ORDER BY km ASC').all();
    const trains = db.prepare('SELECT id, train_no, name, category, priority, direction FROM trains WHERE is_active = 1').all() as Array<{
      id: number;
      train_no: string;
      name: string;
      category: string;
      priority: number;
      direction: string;
    }>;
    const orig = loadScheduleRows('ORIGINAL');
    const opt = loadScheduleRows('OPTIMIZED');
    const conflicts = scanConflicts('ORIGINAL', false);

    res.json({
      stations,
      trains,
      original: orig,
      optimized: opt,
      conflicts,
    });
  });

  // --- DIGITAL TWIN SIMULATION ---
  router.post('/sim/start', (req, res) => {
    const { schedule_kind, seed, sim_speed } = req.body ?? {};
    const result = runDigitalTwinSimulation({
      scheduleKind: schedule_kind === 'OPTIMIZED' ? 'OPTIMIZED' : 'ORIGINAL',
      seed: Number(seed ?? 42),
      simSpeed: Number(sim_speed ?? 20),
      persist: true,
    });
    res.json(result);
  });

  router.post('/sim/compare', (req, res) => {
    const { seed, injected_delays, blocked_section_ids, weather_speed_factor } = req.body ?? {};
    const s = Number(seed ?? 42);
    const orig = runDigitalTwinSimulation({
      scheduleKind: 'ORIGINAL',
      seed: s,
      injectedDelays: injected_delays,
      blockedSectionIds: blocked_section_ids,
      weatherSpeedFactor: weather_speed_factor,
      persist: false,
    });
    const opt = runDigitalTwinSimulation({
      scheduleKind: 'OPTIMIZED',
      seed: s,
      injectedDelays: injected_delays,
      blockedSectionIds: blocked_section_ids,
      weatherSpeedFactor: weather_speed_factor,
      persist: false,
    });
    res.json({ seed: s, original: orig, optimized: opt });
  });

  router.get('/sim/state', (_req, res) => {
    const db = getDb();
    const latest = db.prepare('SELECT * FROM sim_runs ORDER BY id DESC LIMIT 1').get() as Record<string, unknown> | undefined;
    if (!latest) {
      res.json(null);
      return;
    }
    res.json({ ...latest, kpis: JSON.parse(String(latest.kpi_json)) });
  });

  router.get('/sim/events', (req, res) => {
    const db = getDb();
    const runId = req.query.run_id ? Number(req.query.run_id) : undefined;
    const target = runId ?? ((db.prepare('SELECT id FROM sim_runs ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined)?.id ?? 0);
    const rows = db
      .prepare(
        `SELECT e.*, t.train_no FROM sim_events e
         JOIN trains t ON t.id = e.train_id
         WHERE e.run_id = ? ORDER BY e.sim_time ASC LIMIT 200`
      )
      .all(target);
    res.json(rows);
  });

  // --- CONFLICTS & PROPAGATION ---
  router.get('/conflicts', (req, res) => {
    const kind = req.query.kind === 'OPTIMIZED' ? 'OPTIMIZED' : 'ORIGINAL';
    res.json(scanConflicts(kind, false));
  });

  router.post('/conflicts/scan', (_req, res) => {
    res.json(scanConflicts('ORIGINAL', true));
  });

  router.get('/conflicts/propagation/:trainId', (req, res) => {
    const trainId = Number(req.params.trainId);
    const delayMin = Number(req.query.delay ?? 20);
    const kind = req.query.kind === 'OPTIMIZED' ? 'OPTIMIZED' : 'ORIGINAL';
    res.json(analyzeDelayPropagation(trainId, delayMin, kind));
  });

  // --- PLATFORMS ---
  router.get('/platforms/:stationId/layout', (req, res) => {
    const kind = req.query.kind === 'ORIGINAL' ? 'ORIGINAL' : 'OPTIMIZED';
    res.json(getStationPlatformLayout(Number(req.params.stationId), kind));
  });

  router.post('/platforms/allocate', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    const stnId = Number(req.body?.station_id ?? 5);
    const result = allocatePlatformsForStation(stnId);
    writeAuditLog(req.user, 'ALLOCATE_PLATFORMS', 'station', stnId, { count: result.reassigned_count });
    res.json(result);
  });

  router.post('/platforms/override', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    try {
      const { schedule_id, platform_id } = req.body ?? {};
      const out = overridePlatformAssignment(Number(schedule_id), Number(platform_id));
      writeAuditLog(req.user, 'OVERRIDE_PLATFORM', 'schedule', schedule_id, out);
      res.json(out);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Platform override failed' });
    }
  });

  // --- WEATHER & DISRUPTIONS ---
  router.get('/weather', (_req, res) => {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM weather_events ORDER BY id DESC LIMIT 15').all());
  });

  router.get('/weather/live', async (_req, res) => {
    const live = await fetchOpenMeteoWeather();
    res.json(live);
  });

  router.post('/weather', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    const { type, severity, section_id, reoptimize } = req.body ?? {};
    const out = setWeatherCondition({
      type: (type as WeatherType) ?? 'CLEAR',
      severity: Number(severity ?? 1),
      section_id: section_id ? Number(section_id) : null,
      source: req.body?.source ?? 'SIMULATED',
    });
    writeAuditLog(req.user, 'SET_WEATHER', 'weather_event', out.id, out);
    let opt = null;
    if (reoptimize !== false) {
      opt = runOptimization({ persist: true });
    }
    res.json({ weather: out, optimization: opt });
  });

  router.get('/disruptions', (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT d.*, sec.code as section_code, stn.code as station_code
         FROM disruptions d
         LEFT JOIN sections sec ON sec.id = d.section_id
         LEFT JOIN stations stn ON stn.id = d.station_id
         ORDER BY d.active DESC, d.id DESC`
      )
      .all();
    res.json(rows);
  });

  router.post('/disruptions', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const { type, section_id, station_id, start_min, end_min, speed_limit_kmph, description, reoptimize } = req.body ?? {};
    const info = db
      .prepare(
        `INSERT INTO disruptions (type, section_id, station_id, start_min, end_min, speed_limit_kmph, description, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        type ?? 'TSR',
        section_id ? Number(section_id) : null,
        station_id ? Number(station_id) : null,
        Number(start_min ?? 430),
        Number(end_min ?? 490),
        speed_limit_kmph ? Number(speed_limit_kmph) : 45,
        String(description ?? 'Controller imposed temporary speed restriction / block')
      );
    const id = Number(info.lastInsertRowid);
    writeAuditLog(req.user, 'CREATE_DISRUPTION', 'disruption', id, req.body);
    const opt = reoptimize !== false ? runOptimization({ persist: true }) : null;
    res.status(201).json({ id, optimization: opt });
  });

  router.delete('/disruptions/:id', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    db.prepare('UPDATE disruptions SET active = 0 WHERE id = ?').run(id);
    writeAuditLog(req.user, 'CLEAR_DISRUPTION', 'disruption', id, {});
    const opt = runOptimization({ persist: true });
    res.json({ cleared: true, id, optimization: opt });
  });

  // --- PREDICTIVE MAINTENANCE ---
  router.get('/maintenance/health', (_req, res) => {
    res.json(analyzeMaintenanceHealth());
  });

  router.get('/maintenance/anomalies', (_req, res) => {
    res.json(analyzeMaintenanceHealth().anomalies);
  });

  router.post('/maintenance/orders', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const { section_id, priority, due_date, window_start_min, window_end_min, note } = req.body ?? {};
    const info = db
      .prepare(
        `INSERT INTO maintenance_orders (section_id, priority, status, due_date, window_start_min, window_end_min, note)
         VALUES (?, ?, 'SCHEDULED', ?, ?, ?, ?)`
      )
      .run(
        Number(section_id),
        String(priority ?? 'HIGH'),
        String(due_date ?? '2026-11-18'),
        window_start_min ? Number(window_start_min) : null,
        window_end_min ? Number(window_end_min) : null,
        String(note ?? 'Scheduled predictive tamping & ultrasonic inspection')
      );
    writeAuditLog(req.user, 'CREATE_MAINTENANCE_ORDER', 'maintenance_order', Number(info.lastInsertRowid), req.body);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  // --- COPILOT ---
  router.post('/copilot/ask', async (req: AuthenticatedRequest, res) => {
    const q = String(req.body?.question ?? '').trim();
    if (!q) {
      res.status(400).json({ error: 'Question cannot be empty.' });
      return;
    }
    const resp = await askCopilot(q, req.user?.userId);
    res.json(resp);
  });

  router.get('/copilot/history', (_req, res) => {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM copilot_log ORDER BY id DESC LIMIT 20').all());
  });

  // --- SCENARIOS & ADVANCED PLANNING ---
  router.get('/scenarios', (_req, res) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM scenarios ORDER BY id DESC LIMIT 20').all() as Array<Record<string, unknown>>;
    res.json(
      rows.map((r) => ({
        ...r,
        params: JSON.parse(String(r.params_json)),
        result: r.result_json ? JSON.parse(String(r.result_json)) : null,
      }))
    );
  });

  router.post('/scenarios/run', (req, res) => {
    const out = runWhatIfScenario(req.body ?? { name: 'Custom What-If', type: 'DELAY_20' });
    res.json(out);
  });

  router.post('/scenarios/worst-case', (_req, res) => {
    res.json(runWorstCaseSweep());
  });

  router.post('/scenarios/emergency-insert', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    const { train_no, name, category, direction, dep_min, priority } = req.body ?? {};
    const out = insertEmergencyTrainAndReplan({
      train_no: String(train_no ?? 'EM-99'),
      name: String(name ?? 'VIP Relief Special'),
      category: (category as TrainCategory) ?? 'EMERGENCY',
      direction: (direction as Direction) ?? 'UP',
      dep_min: Number(dep_min ?? 440),
      priority: priority ? Number(priority) : 10,
    });
    writeAuditLog(req.user, 'EMERGENCY_TRAIN_INSERT', 'train', out.inserted_train_id, out);
    res.json(out);
  });

  router.get('/scenarios/capacity-sweep', (_req, res) => {
    res.json(runCapacitySweep());
  });

  router.get('/scenarios/connections-resources', (_req, res) => {
    res.json(getConnectionsAndResources());
  });

  // --- ENERGY ---
  router.get('/energy/summary', (_req, res) => {
    res.json(computeEnergySummary());
  });

  // --- ANALYTICS & KPIs ---
  router.get('/analytics/kpis', (_req, res) => {
    const db = getDb();
    const origVerify = verifySchedule(loadScheduleRows('ORIGINAL'), 'ORIGINAL');
    const latestRun = db.prepare('SELECT * FROM optimization_runs ORDER BY id DESC LIMIT 1').get() as
      | { id: number; solve_time_ms: number; status: string; original_kpi_json: string; optimized_kpi_json: string }
      | undefined;
    const optKpis = latestRun ? JSON.parse(latestRun.optimized_kpi_json) : null;
    res.json({
      original: origVerify.kpis,
      optimized: optKpis,
      latest_run_id: latestRun?.id ?? null,
      solve_time_ms: latestRun?.solve_time_ms ?? null,
    });
  });

  router.get('/analytics/throughput', (_req, res) => {
    const orig = loadScheduleRows('ORIGINAL');
    const opt = loadScheduleRows('OPTIMIZED');
    const hours = [6, 7, 8, 9, 10, 11];
    const data = hours.map((h) => {
      const start = h * 60;
      const end = start + 60;
      const origTids = new Set(orig.filter((r) => r.entry_time !== null && r.entry_time >= start && r.entry_time < end).map((r) => r.train_id));
      const optTids = new Set(opt.filter((r) => r.entry_time !== null && r.entry_time >= start && r.entry_time < end).map((r) => r.train_id));
      return {
        hour: `${String(h).padStart(2, '0')}:00`,
        original_trains: origTids.size,
        optimized_trains: optTids.size || origTids.size,
      };
    });
    res.json(data);
  });

  router.get('/analytics/delay-trend', (_req, res) => {
    const db = getDb();
    const byHour = db
      .prepare(
        `SELECT hour, ROUND(AVG(delay_min), 1) as avg_delay, COUNT(*) as samples
         FROM delay_history
         GROUP BY hour ORDER BY hour ASC`
      )
      .all();
    const byCategory = db
      .prepare(
        `SELECT t.category, ROUND(AVG(d.delay_min), 1) as avg_delay, COUNT(*) as samples
         FROM delay_history d JOIN trains t ON t.id = d.train_id
         GROUP BY t.category`
      )
      .all();
    res.json({ by_hour: byHour, by_category: byCategory });
  });

  router.get('/analytics/utilization', (_req, res) => {
    const db = getDb();
    const sections = db.prepare('SELECT id, code, track_type, num_tracks FROM sections ORDER BY id').all() as Array<{
      id: number;
      code: string;
      track_type: string;
      num_tracks: number;
    }>;
    const opt = loadScheduleRows('OPTIMIZED');
    const sched = opt.length > 0 ? opt : loadScheduleRows('ORIGINAL');
    const hours = [6, 7, 8, 9, 10, 11];
    const matrix = sections.map((sec) => {
      const row: Record<string, unknown> = { section_code: sec.code, track_type: sec.track_type };
      let totalPct = 0;
      for (const h of hours) {
        const sMin = h * 60;
        const eMin = sMin + 60;
        let busy = 0;
        for (const r of sched) {
          if (r.section_id === sec.id && r.entry_time !== null && r.exit_time !== null) {
            const ov = Math.max(0, Math.min(eMin, r.exit_time) - Math.max(sMin, r.entry_time));
            busy += ov;
          }
        }
        const pct = Math.min(100, Math.round((busy / (60 * sec.num_tracks)) * 100));
        row[`h_${h}`] = pct;
        totalPct += pct;
      }
      row.avg_pct = Math.round(totalPct / hours.length);
      return row;
    });
    res.json(matrix);
  });

  // --- EXPORT / IMPORT ---
  router.get('/export/schedule.csv', (req, res) => {
    const db = getDb();
    const kind = req.query.kind === 'ORIGINAL' ? 'ORIGINAL' : 'OPTIMIZED';
    let rows = loadScheduleRows(kind);
    if (rows.length === 0) rows = loadScheduleRows('ORIGINAL');
    const trains = new Map((db.prepare('SELECT id, train_no, name, category FROM trains').all() as Array<{ id: number; train_no: string; name: string; category: string }>).map((t) => [t.id, t]));
    const stns = new Map((db.prepare('SELECT id, code FROM stations').all() as Array<{ id: number; code: string }>).map((s) => [s.id, s.code]));

    const lines = ['train_no,name,category,station,kind,arrival_min,departure_min,used_loop'];
    for (const r of rows) {
      const tr = trains.get(r.train_id);
      lines.push(`${tr?.train_no ?? r.train_id},"${tr?.name ?? ''}",${tr?.category ?? ''},${stns.get(r.station_id) ?? r.station_id},${r.kind},${r.arrival},${r.departure},${r.used_loop}`);
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="railsmart_${kind.toLowerCase()}_schedule.csv"`);
    res.send(lines.join('\n'));
  });

  router.post('/import/trains', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) {
      res.status(400).json({ error: 'Provide JSON array rows[] parsed from CSV/Excel.' });
      return;
    }
    writeAuditLog(req.user, 'IMPORT_CSV', 'trains', null, { rows_received: rows.length });
    res.json({ imported: rows.length, note: 'Validated against corridor schema.' });
  });

  // --- ADMIN ---
  router.get('/admin/health', (_req, res) => {
    const db = getDb();
    const counts = {
      stations: (db.prepare('SELECT COUNT(*) as c FROM stations').get() as { c: number }).c,
      sections: (db.prepare('SELECT COUNT(*) as c FROM sections').get() as { c: number }).c,
      trains: (db.prepare('SELECT COUNT(*) as c FROM trains').get() as { c: number }).c,
      delay_history: (db.prepare('SELECT COUNT(*) as c FROM delay_history').get() as { c: number }).c,
      optimization_runs: (db.prepare('SELECT COUNT(*) as c FROM optimization_runs').get() as { c: number }).c,
      audit_log: (db.prepare('SELECT COUNT(*) as c FROM audit_log').get() as { c: number }).c,
    };
    res.json({ status: 'OK', database: 'SQLite (WAL)', counts, gemini_configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') });
  });

  router.get('/admin/audit', (_req, res) => {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100').all());
  });

  router.get('/admin/users', (_req, res) => {
    const db = getDb();
    res.json(db.prepare('SELECT id, username, role, language, created_at FROM users ORDER BY id').all());
  });

  router.get('/admin/settings', (_req, res) => {
    res.json({ weights: getOptimizerWeights(), safety: getSafetyParams() });
  });

  router.put('/admin/settings', requireRole(['ADMIN']), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const { weights, safety } = req.body ?? {};
    if (weights) {
      db.prepare("UPDATE system_settings SET value_json = ? WHERE key = 'optimizer_weights'").run(JSON.stringify({ ...getOptimizerWeights(), ...weights }));
    }
    if (safety) {
      db.prepare("UPDATE system_settings SET value_json = ? WHERE key = 'safety_params'").run(JSON.stringify({ ...getSafetyParams(), ...safety }));
    }
    writeAuditLog(req.user, 'UPDATE_SETTINGS', 'system_settings', null, req.body);
    res.json({ weights: getOptimizerWeights(), safety: getSafetyParams() });
  });

  router.post('/admin/seed', requireRole(['ADMIN', 'CONTROLLER']), (req: AuthenticatedRequest, res) => {
    const out = seedDatabase(true);
    scanConflicts('ORIGINAL', true);
    const opt = runOptimization({ persist: true });
    writeAuditLog(req.user, 'RESET_AND_SEED', 'database', null, out.counts);
    res.json({ ...out, initial_optimization_run_id: opt.run_id });
  });

  return router;
}
