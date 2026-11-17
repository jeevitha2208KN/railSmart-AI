import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

let dbInstance: DatabaseSync | null = null;

export function getDbPath(): string {
  return process.env.RAILSMART_DB_PATH || path.resolve(process.cwd(), 'railsmart.db');
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(getDbPath());
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    initSchema(dbInstance);
  }
  return dbInstance;
}

export function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('ADMIN','CONTROLLER','VIEWER')),
      language TEXT NOT NULL DEFAULT 'EN',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      km REAL NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      num_platforms INTEGER NOT NULL DEFAULT 2,
      platform_max_length_m INTEGER NOT NULL DEFAULT 650,
      has_loop INTEGER NOT NULL DEFAULT 1,
      loop_count INTEGER NOT NULL DEFAULT 1,
      loop_length_m INTEGER NOT NULL DEFAULT 680,
      dwell_min_default INTEGER NOT NULL DEFAULT 2,
      station_capacity INTEGER NOT NULL DEFAULT 4,
      is_junction INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS platforms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      number TEXT NOT NULL,
      length_m INTEGER NOT NULL,
      electrified INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','OCCUPIED','BLOCKED')),
      accepts_categories TEXT NOT NULL DEFAULT 'PASSENGER,EXPRESS,SUPERFAST,GOODS,EMERGENCY,SPECIAL'
    );

    CREATE TABLE IF NOT EXISTS sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      from_station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      to_station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      distance_km REAL NOT NULL,
      track_type TEXT NOT NULL CHECK(track_type IN ('SINGLE','DOUBLE')),
      num_tracks INTEGER NOT NULL DEFAULT 1,
      capacity_trains INTEGER NOT NULL DEFAULT 1,
      max_speed_kmph INTEGER NOT NULL DEFAULT 110,
      min_run_time_min INTEGER NOT NULL,
      max_run_time_min INTEGER NOT NULL,
      headway_min INTEGER NOT NULL DEFAULT 5,
      direction_mode TEXT NOT NULL DEFAULT 'BIDIRECTIONAL' CHECK(direction_mode IN ('BIDIRECTIONAL','UP_ONLY','DOWN_ONLY')),
      electrified INTEGER NOT NULL DEFAULT 1,
      gradient_factor REAL NOT NULL DEFAULT 1.0,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','BLOCKED','RESTRICTED'))
    );

    CREATE TABLE IF NOT EXISTS rakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rake_no TEXT UNIQUE NOT NULL,
      next_train_id INTEGER,
      turnaround_min INTEGER NOT NULL DEFAULT 25,
      ready_time INTEGER NOT NULL DEFAULT 360
    );

    CREATE TABLE IF NOT EXISTS crews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crew_no TEXT UNIQUE NOT NULL,
      duty_start INTEGER NOT NULL,
      max_duty_hours REAL NOT NULL DEFAULT 8.0,
      base_station_id INTEGER REFERENCES stations(id)
    );

    CREATE TABLE IF NOT EXISTS trains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      train_no TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('PASSENGER','EXPRESS','SUPERFAST','GOODS','EMERGENCY','SPECIAL')),
      priority INTEGER NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('UP','DOWN')),
      length_m INTEGER NOT NULL DEFAULT 420,
      max_speed_kmph INTEGER NOT NULL DEFAULT 100,
      origin_id INTEGER NOT NULL REFERENCES stations(id),
      destination_id INTEGER NOT NULL REFERENCES stations(id),
      sch_departure INTEGER NOT NULL,
      sch_arrival INTEGER NOT NULL,
      actual_departure INTEGER NOT NULL,
      est_arrival INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      current_section_id INTEGER REFERENCES sections(id),
      current_station_id INTEGER REFERENCES stations(id),
      lat REAL NOT NULL DEFAULT 0,
      lon REAL NOT NULL DEFAULT 0,
      rake_id INTEGER REFERENCES rakes(id),
      crew_id INTEGER REFERENCES crews(id),
      may_advance INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS train_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      train_id INTEGER NOT NULL REFERENCES trains(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      station_id INTEGER NOT NULL REFERENCES stations(id),
      sch_arrival INTEGER NOT NULL,
      sch_departure INTEGER NOT NULL,
      min_dwell_min INTEGER NOT NULL DEFAULT 2,
      platform_id INTEGER REFERENCES platforms(id),
      is_stop INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feeder_train_id INTEGER NOT NULL REFERENCES trains(id) ON DELETE CASCADE,
      connecting_train_id INTEGER NOT NULL REFERENCES trains(id) ON DELETE CASCADE,
      station_id INTEGER NOT NULL REFERENCES stations(id),
      min_transfer_min INTEGER NOT NULL DEFAULT 5,
      max_hold_min INTEGER NOT NULL DEFAULT 10,
      passengers_est INTEGER NOT NULL DEFAULT 45
    );

    CREATE TABLE IF NOT EXISTS optimization_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      scenario_id INTEGER,
      status TEXT NOT NULL,
      objective_value REAL NOT NULL DEFAULT 0,
      solve_time_ms INTEGER NOT NULL DEFAULT 0,
      optimality_gap REAL NOT NULL DEFAULT 0,
      weights_json TEXT NOT NULL,
      original_kpi_json TEXT NOT NULL,
      optimized_kpi_json TEXT NOT NULL,
      constraint_report_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER REFERENCES optimization_runs(id) ON DELETE CASCADE,
      train_id INTEGER NOT NULL REFERENCES trains(id) ON DELETE CASCADE,
      station_id INTEGER NOT NULL REFERENCES stations(id),
      kind TEXT NOT NULL CHECK(kind IN ('ORIGINAL','OPTIMIZED')),
      arrival INTEGER NOT NULL,
      departure INTEGER NOT NULL,
      section_id INTEGER REFERENCES sections(id),
      entry_time INTEGER,
      exit_time INTEGER,
      platform_id INTEGER REFERENCES platforms(id),
      used_loop INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES optimization_runs(id) ON DELETE CASCADE,
      train_id INTEGER NOT NULL REFERENCES trains(id) ON DELETE CASCADE,
      station_id INTEGER REFERENCES stations(id),
      action TEXT NOT NULL CHECK(action IN ('HOLD','ADVANCE','REROUTE_TO_LOOP','CHANGE_PLATFORM','PRECEDENCE','NONE')),
      from_time INTEGER NOT NULL,
      to_time INTEGER NOT NULL,
      delta_min INTEGER NOT NULL,
      reason TEXT NOT NULL,
      rule_ref TEXT NOT NULL,
      trains_benefited TEXT NOT NULL,
      trains_penalized TEXT NOT NULL,
      accepted INTEGER,
      decided_by TEXT,
      decided_at TEXT
    );

    CREATE TABLE IF NOT EXISTS conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      category TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
      section_id INTEGER REFERENCES sections(id),
      station_id INTEGER REFERENCES stations(id),
      train_ids_json TEXT NOT NULL,
      predicted_impact_min REAL NOT NULL,
      recommended_action TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS delay_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      train_id INTEGER NOT NULL REFERENCES trains(id) ON DELETE CASCADE,
      station_id INTEGER NOT NULL REFERENCES stations(id),
      date TEXT NOT NULL,
      sch_arrival INTEGER NOT NULL,
      actual_arrival INTEGER NOT NULL,
      delay_min REAL NOT NULL,
      weather TEXT NOT NULL,
      congestion_index REAL NOT NULL,
      hour INTEGER NOT NULL,
      dow INTEGER NOT NULL,
      prev_delay_min REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weather_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('CLEAR','RAIN','FOG','HEAT','STORM')),
      severity INTEGER NOT NULL CHECK(severity BETWEEN 1 AND 5),
      section_id INTEGER REFERENCES sections(id),
      start_min INTEGER NOT NULL,
      end_min INTEGER NOT NULL,
      speed_factor REAL NOT NULL DEFAULT 1.0,
      headway_bonus_min INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'SIMULATED',
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS disruptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('TSR','BLOCK','BREAKDOWN','SIGNAL_FAILURE','PLATFORM_DOWN','ACCIDENT_SIM')),
      section_id INTEGER REFERENCES sections(id),
      station_id INTEGER REFERENCES stations(id),
      train_id INTEGER REFERENCES trains(id),
      start_min INTEGER NOT NULL,
      end_min INTEGER NOT NULL,
      speed_limit_kmph INTEGER,
      description TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sensor_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
      ts TEXT NOT NULL,
      vibration REAL NOT NULL,
      temperature REAL NOT NULL,
      strain REAL NOT NULL,
      track_gauge_dev REAL NOT NULL,
      is_simulated INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS maintenance_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
      priority TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      due_date TEXT NOT NULL,
      window_start_min INTEGER,
      window_end_min INTEGER,
      note TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sim_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_id INTEGER,
      schedule_kind TEXT NOT NULL CHECK(schedule_kind IN ('ORIGINAL','OPTIMIZED')),
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sim_speed INTEGER NOT NULL DEFAULT 10,
      seed INTEGER NOT NULL DEFAULT 42,
      kpi_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sim_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES sim_runs(id) ON DELETE CASCADE,
      sim_time INTEGER NOT NULL,
      train_id INTEGER NOT NULL,
      event TEXT NOT NULL,
      station_id INTEGER,
      section_id INTEGER,
      detail TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      params_json TEXT NOT NULL,
      result_json TEXT,
      created_by TEXT NOT NULL DEFAULT 'controller',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER,
      username TEXT NOT NULL DEFAULT 'system',
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      detail_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS copilot_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER,
      question TEXT NOT NULL,
      intent TEXT NOT NULL,
      sql_or_tool_used TEXT NOT NULL,
      answer TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      description TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_train_routes_train ON train_routes(train_id, seq);
    CREATE INDEX IF NOT EXISTS idx_schedules_run_kind ON schedules(run_id, kind, train_id);
    CREATE INDEX IF NOT EXISTS idx_delay_history_train_hour ON delay_history(train_id, hour);
    CREATE INDEX IF NOT EXISTS idx_sensor_readings_sec ON sensor_readings(section_id, id);
    CREATE INDEX IF NOT EXISTS idx_sim_events_run ON sim_events(run_id, sim_time);
  `);
}
