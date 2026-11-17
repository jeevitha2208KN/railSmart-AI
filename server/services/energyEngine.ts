import { getDb } from '../db/database.ts';
import type { ScheduleRow, SectionRow, TrainRow } from '../types.ts';
import { loadScheduleRows } from './verifier.ts';

function getCategoryMassTons(category: string): number {
  switch (category) {
    case 'GOODS': return 3400;
    case 'SUPERFAST': return 1150;
    case 'EXPRESS': return 1050;
    case 'PASSENGER': return 680;
    case 'SPECIAL': return 450;
    case 'EMERGENCY': return 320;
    default: return 900;
  }
}

export function computeEnergySummary() {
  const db = getDb();
  const trains = db.prepare('SELECT * FROM trains WHERE is_active = 1').all() as unknown as TrainRow[];
  const sections = db.prepare('SELECT * FROM sections').all() as unknown as SectionRow[];
  const secMap = new Map(sections.map((s) => [s.id, s]));

  const origRows = loadScheduleRows('ORIGINAL');
  const optRows = loadScheduleRows('OPTIMIZED');
  const activeOpt = optRows.length > 0 ? optRows : origRows;

  const estimateForSchedule = (rows: ScheduleRow[], isBaselineWithConflicts: boolean) => {
    const byTrain = new Map<number, ScheduleRow[]>();
    for (const r of rows) {
      if (!byTrain.has(r.train_id)) byTrain.set(r.train_id, []);
      byTrain.get(r.train_id)!.push(r);
    }

    let totalKwh = 0;
    let totalStops = 0;
    const perTrain: Array<{ train_id: number; train_no: string; name: string; category: string; kwh: number; stops: number; coasting_advice: string }> = [];

    for (const tr of trains) {
      const trRows = (byTrain.get(tr.id) ?? []).sort((a, b) => a.arrival - b.arrival);
      const mass = getCategoryMassTons(tr.category);
      let distKm = 0;
      let stops = 0;
      let extraGrad = 0;

      for (let i = 0; i < trRows.length; i++) {
        const r = trRows[i];
        if (r.section_id) {
          const sec = secMap.get(r.section_id);
          if (sec) {
            distKm += sec.distance_km;
            extraGrad += Math.max(0, sec.gradient_factor - 1.0) * sec.distance_km;
          }
        }
        if (i > 0 && i < trRows.length - 1) {
          const dwell = r.departure - r.arrival;
          if (dwell >= 2) stops++;
        }
      }
      // Baseline un-optimized timetable incurs unplanned stop-starts at signal/crossing conflicts
      if (isBaselineWithConflicts && tr.priority <= 7) stops += 2;

      // Estimated traction + acceleration-from-stop model (kWh)
      const cruiseKwh = distKm * (mass / 1000) * 14.5 + extraGrad * (mass / 1000) * 32;
      const stopStartPenaltyKwh = stops * (mass / 1000) * 28.0;
      const kwh = Math.round(cruiseKwh + stopStartPenaltyKwh);
      totalKwh += kwh;
      totalStops += stops;

      const optSpeed = Math.round(tr.max_speed_kmph * 0.86);
      perTrain.push({
        train_id: tr.id,
        train_no: tr.train_no,
        name: tr.name,
        category: tr.category,
        kwh,
        stops,
        coasting_advice: tr.category === 'GOODS'
          ? `Maintain steady ${optSpeed} km/h green-wave pacing to avoid loop-line stop-start (-28 kWh/stop).`
          : `Coast 1.8 km before scheduled halts at ${optSpeed} km/h target cruise.`,
      });
    }

    // 0.68 kg CO2 per kWh grid factor (estimated model)
    const co2Kg = Math.round(totalKwh * 0.68);
    return { totalKwh, co2Kg, totalStops, perTrain };
  };

  const origEst = estimateForSchedule(origRows, true);
  const optEst = estimateForSchedule(activeOpt, false);
  const savedKwh = Math.max(0, origEst.totalKwh - optEst.totalKwh);
  const savedCo2Kg = Math.max(0, origEst.co2Kg - optEst.co2Kg);
  const savingsPct = origEst.totalKwh > 0 ? Math.round((savedKwh / origEst.totalKwh) * 1000) / 10 : 0;

  return {
    model_note: 'Estimated physics-proxy traction & stop-start model (not metered locomotive telemetry)',
    original: { total_kwh: origEst.totalKwh, co2_kg: origEst.co2Kg, total_stops: origEst.totalStops },
    optimized: { total_kwh: optEst.totalKwh, co2_kg: optEst.co2Kg, total_stops: optEst.totalStops },
    savings_kwh: savedKwh,
    savings_co2_kg: savedCo2Kg,
    savings_pct: savingsPct,
    per_train: optEst.perTrain,
  };
}
