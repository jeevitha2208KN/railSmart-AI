export type UserRole = 'ADMIN' | 'CONTROLLER' | 'VIEWER';
export type TrainCategory = 'PASSENGER' | 'EXPRESS' | 'SUPERFAST' | 'GOODS' | 'EMERGENCY' | 'SPECIAL';
export type Direction = 'UP' | 'DOWN';
export type TrackType = 'SINGLE' | 'DOUBLE';
export type SectionStatus = 'OPEN' | 'BLOCKED' | 'RESTRICTED';
export type PlatformStatus = 'AVAILABLE' | 'OCCUPIED' | 'BLOCKED';
export type WeatherType = 'CLEAR' | 'RAIN' | 'FOG' | 'HEAT' | 'STORM';
export type DisruptionType = 'TSR' | 'BLOCK' | 'BREAKDOWN' | 'SIGNAL_FAILURE' | 'PLATFORM_DOWN' | 'ACCIDENT_SIM';
export type ActionType = 'HOLD' | 'ADVANCE' | 'REROUTE_TO_LOOP' | 'CHANGE_PLATFORM' | 'PRECEDENCE' | 'NONE';

export interface StationRow {
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

export interface PlatformRow {
  id: number;
  station_id: number;
  number: string;
  length_m: number;
  electrified: number;
  status: PlatformStatus;
  accepts_categories: string;
}

export interface SectionRow {
  id: number;
  code: string;
  from_station_id: number;
  to_station_id: number;
  distance_km: number;
  track_type: TrackType;
  num_tracks: number;
  capacity_trains: number;
  max_speed_kmph: number;
  min_run_time_min: number;
  max_run_time_min: number;
  headway_min: number;
  direction_mode: 'BIDIRECTIONAL' | 'UP_ONLY' | 'DOWN_ONLY';
  electrified: number;
  gradient_factor: number;
  status: SectionStatus;
}

export interface TrainRow {
  id: number;
  train_no: string;
  name: string;
  category: TrainCategory;
  priority: number;
  direction: Direction;
  length_m: number;
  max_speed_kmph: number;
  origin_id: number;
  destination_id: number;
  sch_departure: number;
  sch_arrival: number;
  actual_departure: number;
  est_arrival: number;
  status: string;
  current_section_id: number | null;
  current_station_id: number | null;
  lat: number;
  lon: number;
  rake_id: number | null;
  crew_id: number | null;
  may_advance: number;
  is_active: number;
}

export interface TrainRouteRow {
  id: number;
  train_id: number;
  seq: number;
  station_id: number;
  sch_arrival: number;
  sch_departure: number;
  min_dwell_min: number;
  platform_id: number | null;
  is_stop: number;
}

export interface ScheduleRow {
  id: number;
  run_id: number | null;
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

export interface OptimizerWeights {
  W1_served: number;
  W2_delay: number;
  W3_waiting: number;
  W4_changed: number;
  W5_shift: number;
  W6_connections: number;
  W7_balance: number;
  max_shift_min: number;
  max_freight_starvation_min: number;
  time_limit_sec: number;
  mode: 'WEIGHTED' | 'LEXICOGRAPHIC';
}

export interface SafetyParams {
  default_headway_min: number;
  clearance_min: number;
  default_dwell_min: number;
  horizon_start_min: number;
  horizon_end_min: number;
  max_connection_hold_min: number;
}

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
