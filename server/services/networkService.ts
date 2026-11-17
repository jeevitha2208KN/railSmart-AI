import { getDb } from '../db/database.ts';
import type {
  StationRow,
  SectionRow,
  PlatformRow,
  OptimizerWeights,
  SafetyParams,
} from '../types.ts';
import { DEFAULT_WEIGHTS, DEFAULT_SAFETY } from '../db/seed.ts';

export function getOptimizerWeights(): OptimizerWeights {
  const db = getDb();
  const row = db.prepare("SELECT value_json FROM system_settings WHERE key = 'optimizer_weights'").get() as { value_json: string } | undefined;
  if (!row) return { ...DEFAULT_WEIGHTS };
  return { ...DEFAULT_WEIGHTS, ...JSON.parse(row.value_json) };
}

export function getSafetyParams(): SafetyParams {
  const db = getDb();
  const row = db.prepare("SELECT value_json FROM system_settings WHERE key = 'safety_params'").get() as { value_json: string } | undefined;
  if (!row) return { ...DEFAULT_SAFETY };
  return { ...DEFAULT_SAFETY, ...JSON.parse(row.value_json) };
}

export function getNetworkSnapshot() {
  const db = getDb();
  const stations = db.prepare('SELECT * FROM stations ORDER BY km ASC').all() as unknown as StationRow[];
  const sections = db.prepare('SELECT * FROM sections ORDER BY id ASC').all() as unknown as SectionRow[];
  const platforms = db.prepare('SELECT * FROM platforms ORDER BY station_id, id ASC').all() as unknown as PlatformRow[];
  return { stations, sections, platforms };
}

export interface NetworkValidationIssue {
  severity: 'ERROR' | 'WARNING';
  entity: 'STATION' | 'SECTION' | 'PLATFORM' | 'GRAPH';
  entity_id: number | null;
  code: string;
  message: string;
}

export function validateNetwork(): { valid: boolean; issues: NetworkValidationIssue[]; connected_components: number } {
  const { stations, sections, platforms } = getNetworkSnapshot();
  const issues: NetworkValidationIssue[] = [];

  if (stations.length === 0) {
    issues.push({ severity: 'ERROR', entity: 'GRAPH', entity_id: null, code: 'EMPTY_NETWORK', message: 'No stations defined in database.' });
    return { valid: false, issues, connected_components: 0 };
  }

  const adj = new Map<number, number[]>();
  for (const s of stations) adj.set(s.id, []);

  for (const sec of sections) {
    if (sec.from_station_id === sec.to_station_id) {
      issues.push({ severity: 'ERROR', entity: 'SECTION', entity_id: sec.id, code: 'SELF_LOOP', message: `Section ${sec.code} connects a station to itself.` });
    }
    if (sec.capacity_trains < 1 || sec.num_tracks < 1) {
      issues.push({ severity: 'ERROR', entity: 'SECTION', entity_id: sec.id, code: 'INVALID_CAPACITY', message: `Section ${sec.code} has invalid capacity (${sec.capacity_trains}).` });
    }
    if (sec.min_run_time_min <= 0 || sec.max_run_time_min < sec.min_run_time_min) {
      issues.push({ severity: 'ERROR', entity: 'SECTION', entity_id: sec.id, code: 'INVALID_RUNTIME', message: `Section ${sec.code} has invalid run time bounds.` });
    }
    if (sec.status === 'BLOCKED') {
      issues.push({ severity: 'WARNING', entity: 'SECTION', entity_id: sec.id, code: 'SECTION_BLOCKED', message: `Section ${sec.code} is currently marked BLOCKED.` });
    }
    adj.get(sec.from_station_id)?.push(sec.to_station_id);
    adj.get(sec.to_station_id)?.push(sec.from_station_id);
  }

  for (const stn of stations) {
    const pfs = platforms.filter((p) => p.station_id === stn.id);
    if (pfs.length === 0) {
      issues.push({ severity: 'ERROR', entity: 'STATION', entity_id: stn.id, code: 'NO_PLATFORMS', message: `Station ${stn.code} has 0 platforms.` });
    } else if (pfs.every((p) => p.status === 'BLOCKED')) {
      issues.push({ severity: 'ERROR', entity: 'STATION', entity_id: stn.id, code: 'ALL_PLATFORMS_BLOCKED', message: `All platforms at ${stn.code} are BLOCKED.` });
    }
  }

  // BFS connected components
  const visited = new Set<number>();
  let components = 0;
  for (const stn of stations) {
    if (visited.has(stn.id)) continue;
    components++;
    const queue = [stn.id];
    visited.add(stn.id);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nxt of adj.get(cur) ?? []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
    }
  }

  if (components > 1) {
    issues.push({
      severity: 'ERROR',
      entity: 'GRAPH',
      entity_id: null,
      code: 'DISCONNECTED_GRAPH',
      message: `Corridor graph has ${components} disconnected components.`,
    });
  }

  return {
    valid: !issues.some((i) => i.severity === 'ERROR'),
    issues,
    connected_components: components,
  };
}

export function getActiveWeatherEffects(): {
  speedFactorBySection: Map<number, number>;
  globalSpeedFactor: number;
  headwayBonusBySection: Map<number, number>;
  globalHeadwayBonus: number;
  activeEvents: Array<{ id: number; type: string; severity: number; section_id: number | null; start_min: number; end_min: number; speed_factor: number; headway_bonus_min: number; source: string }>;
} {
  const db = getDb();
  const events = db
    .prepare('SELECT * FROM weather_events WHERE active = 1')
    .all() as Array<{ id: number; type: string; severity: number; section_id: number | null; start_min: number; end_min: number; speed_factor: number; headway_bonus_min: number; source: string }>;

  let globalSpeedFactor = 1.0;
  let globalHeadwayBonus = 0;
  const speedFactorBySection = new Map<number, number>();
  const headwayBonusBySection = new Map<number, number>();

  for (const ev of events) {
    if (ev.section_id === null) {
      globalSpeedFactor = Math.min(globalSpeedFactor, ev.speed_factor);
      globalHeadwayBonus = Math.max(globalHeadwayBonus, ev.headway_bonus_min);
    } else {
      const cur = speedFactorBySection.get(ev.section_id) ?? 1.0;
      speedFactorBySection.set(ev.section_id, Math.min(cur, ev.speed_factor));
      const curHw = headwayBonusBySection.get(ev.section_id) ?? 0;
      headwayBonusBySection.set(ev.section_id, Math.max(curHw, ev.headway_bonus_min));
    }
  }

  return { speedFactorBySection, globalSpeedFactor, headwayBonusBySection, globalHeadwayBonus, activeEvents: events };
}

export function getActiveDisruptions() {
  const db = getDb();
  return db.prepare('SELECT * FROM disruptions WHERE active = 1').all() as Array<{
    id: number;
    type: string;
    section_id: number | null;
    station_id: number | null;
    train_id: number | null;
    start_min: number;
    end_min: number;
    speed_limit_kmph: number | null;
    description: string;
    active: number;
  }>;
}
