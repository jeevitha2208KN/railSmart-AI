export type UserRole = 'ADMIN' | 'CONTROLLER' | 'VIEWER';
export type Lang = 'EN' | 'HI';

export type PageId =
  | 'dashboard'
  | 'marey'
  | 'decision_console'
  | 'live_trains'
  | 'digital_twin'
  | 'optimizer'
  | 'conflicts'
  | 'propagation'
  | 'delay_prediction'
  | 'platforms'
  | 'weather_disruptions'
  | 'maintenance'
  | 'copilot'
  | 'emergency_insert'
  | 'connections_resources'
  | 'capacity_planning'
  | 'what_if'
  | 'energy'
  | 'network'
  | 'analytics'
  | 'reports'
  | 'admin';

export interface KpiSummary {
  total_trains: number;
  active_trains: number;
  completed_trains: number;
  delayed_trains: number;
  waiting_trains: number;
  throughput_per_hour: number;
  total_delay_min: number;
  avg_delay_min: number;
  total_waiting_min: number;
  avg_waiting_min: number;
  on_time_pct: number;
  track_utilization_pct: number;
  platform_utilization_pct: number;
  predicted_congestion_pct: number;
  conflict_count: number;
}

export interface StationItem {
  id: number;
  code: string;
  name: string;
  km: number;
  lat: number;
  lon: number;
  num_platforms: number;
  platform_max_length_m: number;
  has_loop: number;
  loop_count: number;
  loop_length_m: number;
  dwell_min_default: number;
  station_capacity: number;
  is_junction: number;
}

export interface SectionItem {
  id: number;
  code: string;
  from_station_id: number;
  to_station_id: number;
  from_code?: string;
  to_code?: string;
  distance_km: number;
  track_type: 'SINGLE' | 'DOUBLE';
  num_tracks: number;
  capacity_trains: number;
  max_speed_kmph: number;
  min_run_time_min: number;
  max_run_time_min: number;
  headway_min: number;
  status: 'OPEN' | 'BLOCKED' | 'RESTRICTED';
}

export interface TrainItem {
  id: number;
  train_no: string;
  name: string;
  category: string;
  priority: number;
  direction: 'UP' | 'DOWN';
  length_m: number;
  max_speed_kmph: number;
  origin_id: number;
  destination_id: number;
  origin_code?: string;
  destination_code?: string;
  sch_departure: number;
  sch_arrival: number;
  status: string;
  current_section_code?: string | null;
  current_station_code?: string | null;
  lat: number;
  lon: number;
  is_active: number;
}

export interface SchedulePoint {
  id: number;
  train_id: number;
  station_id: number;
  kind: 'ORIGINAL' | 'OPTIMIZED';
  arrival: number;
  departure: number;
  section_id: number | null;
  entry_time: number | null;
  exit_time: number | null;
  platform_id: number | null;
  used_loop: number;
}

export interface RecommendationItem {
  id: number;
  run_id: number;
  train_id: number;
  train_no: string;
  train_name: string;
  category: string;
  priority: number;
  station_id: number | null;
  station_code: string | null;
  action: string;
  from_time: number;
  to_time: number;
  delta_min: number;
  reason: string;
  rule_ref: string;
  trains_benefited: string;
  trains_penalized: string;
  accepted: number | null;
  decided_by: string | null;
  decided_at: string | null;
}

export interface ConflictItem {
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
