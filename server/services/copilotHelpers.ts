import { runCapacitySweep } from './scenarioEngine.ts';

export function capacitySnapshotForCopilot() {
  const cap = runCapacitySweep();
  return {
    bottleneck_section: cap.bottleneck_section,
    safe_headroom_trains: cap.safe_headroom_trains,
    top_upgrade: cap.infrastructure_roi[0] ?? null,
    curve: cap.curve,
  };
}
