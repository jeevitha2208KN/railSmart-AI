import { GoogleGenAI } from '@google/genai';
import { getDb } from '../db/database.ts';
import { scanConflicts } from './conflictEngine.ts';
import { computeEnergySummary } from './energyEngine.ts';
import { analyzeMaintenanceHealth } from './maintenanceEngine.ts';
import { analyzeDelayPropagation } from './propagationService.ts';
import { capacitySnapshotForCopilot } from './copilotHelpers.ts';
import { loadScheduleRows, verifySchedule } from './verifier.ts';

export interface CopilotResponse {
  intent: string;
  sql_or_tool_used: string;
  answer: string;
  evidence: Array<Record<string, unknown>>;
  rephrased_by_gemini: boolean;
}

interface IntentRule {
  intent: string;
  patterns: RegExp[];
  handler: (q: string) => { sql: string; summary: string; evidence: Array<Record<string, unknown>> };
}

function getLatestOptRun() {
  const db = getDb();
  return db.prepare('SELECT * FROM optimization_runs ORDER BY id DESC LIMIT 1').get() as
    | { id: number; status: string; solve_time_ms: number; original_kpi_json: string; optimized_kpi_json: string; objective_value: number }
    | undefined;
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: 'DELAYED_TRAINS',
    patterns: [/delay(ed)? train/i, /which train.*late/i, /running late/i, /late trains/i],
    handler: () => {
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT t.train_no, t.name, t.category, t.priority, t.status,
                  s1.code as origin, s2.code as destination,
                  COALESCE(MAX(sc.arrival) - t.sch_arrival, 0) as est_delay_min
           FROM trains t
           JOIN stations s1 ON s1.id = t.origin_id
           JOIN stations s2 ON s2.id = t.destination_id
           LEFT JOIN schedules sc ON sc.train_id = t.id AND sc.kind = 'ORIGINAL'
           WHERE t.is_active = 1
           GROUP BY t.id
           HAVING t.status = 'DELAYED' OR est_delay_min > 0
           ORDER BY est_delay_min DESC LIMIT 10`
        )
        .all() as Array<Record<string, unknown>>;
      const summary =
        rows.length > 0
          ? `Found ${rows.length} delayed or conflict-impacted trains in the active window. Top affected: ${rows
              .slice(0, 3)
              .map((r) => `${r.train_no} (${r.name})`)
              .join(', ')}.`
          : 'All active trains are currently operating on schedule with zero recorded delays.';
      return {
        sql: "SELECT train_no, name, category, status FROM trains WHERE is_active = 1 AND status = 'DELAYED'...",
        summary,
        evidence: rows,
      };
    },
  },
  {
    intent: 'MOST_CONGESTED_SECTION',
    patterns: [/congested section/i, /bottleneck/i, /busiest section/i, /most traffic/i],
    handler: () => {
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT sec.code, sec.track_type, sec.distance_km, sec.headway_min,
                  COUNT(sc.id) as scheduled_movements,
                  SUM(COALESCE(sc.exit_time - sc.entry_time, 0)) as occupied_min
           FROM sections sec
           LEFT JOIN schedules sc ON sc.section_id = sec.id AND sc.kind = 'ORIGINAL'
           GROUP BY sec.id
           ORDER BY (occupied_min * 1.0 / MAX(1, sec.num_tracks)) DESC
           LIMIT 5`
        )
        .all() as Array<Record<string, unknown>>;
      const top = rows[0];
      return {
        sql: 'SELECT sec.code, sec.track_type, COUNT(sc.id) as scheduled_movements, SUM(exit_time - entry_time) as occupied_min FROM sections...',
        summary: top
          ? `The most congested bottleneck is ${top.code} (${top.track_type} track) with ${top.scheduled_movements} movements and ${top.occupied_min} occupied track-minutes in the 6h window.`
          : 'No section occupancy data found.',
        evidence: rows,
      };
    },
  },
  {
    intent: 'WHY_TRAIN_DELAYED',
    patterns: [/why.*train/i, /why is (\w+-?\d+)/i, /reason.*(\d{4,5}|G-\d+|P-\d+|EM-\d+)/i],
    handler: (q) => {
      const db = getDb();
      const m = q.match(/(\d{4,5}|G-\d+|P-\d+|EM-\d+|SP-\d+)/i);
      const trainNo = m ? m[1].toUpperCase() : 'G-501';
      const tr = db.prepare('SELECT * FROM trains WHERE UPPER(train_no) = ?').get(trainNo) as { id: number; train_no: string; name: string; status: string } | undefined;
      if (!tr) {
        return { sql: 'SELECT * FROM trains WHERE train_no = ?', summary: `I don't have data for train ${trainNo}.`, evidence: [] };
      }
      const conflicts = scanConflicts('ORIGINAL', false).filter((c) => c.train_ids.includes(tr.id));
      const recs = db
        .prepare('SELECT action, delta_min, reason, rule_ref FROM recommendations WHERE train_id = ? ORDER BY id DESC LIMIT 3')
        .all(tr.id) as Array<Record<string, unknown>>;
      return {
        sql: `conflictEngine.scanConflicts() + recommendations WHERE train_id = ${tr.id}`,
        summary:
          conflicts.length > 0
            ? `Train ${tr.train_no} (${tr.name}) faces ${conflicts.length} conflict(s): ${conflicts[0].recommended_action}`
            : recs.length > 0
              ? `Train ${tr.train_no} adjustment: ${recs[0].reason}`
              : `Train ${tr.train_no} (${tr.name}) has status ${tr.status} with no blocking conflicts.`,
        evidence: [...conflicts.map((c) => ({ type: c.category, severity: c.severity, detail: c.recommended_action })), ...recs],
      };
    },
  },
  {
    intent: 'CURRENT_THROUGHPUT',
    patterns: [/throughput/i, /trains per hour/i, /how many trains/i, /capacity/i],
    handler: () => {
      const orig = verifySchedule(loadScheduleRows('ORIGINAL'), 'ORIGINAL').kpis;
      const latest = getLatestOptRun();
      const optKpi = latest ? JSON.parse(latest.optimized_kpi_json) : null;
      return {
        sql: 'verifier.verifySchedule(ORIGINAL vs latest OPTIMIZED run)',
        summary: optKpi
          ? `Baseline throughput is ${orig.throughput_per_hour} trains/hr (${orig.completed_trains} completed). After optimization, throughput improves to ${optKpi.throughput_per_hour} trains/hr (${optKpi.completed_trains} completed).`
          : `Current baseline throughput is ${orig.throughput_per_hour} trains/hr across ${orig.active_trains} active trains in the 6h window.`,
        evidence: [{ mode: 'ORIGINAL', ...orig }, ...(optKpi ? [{ mode: 'OPTIMIZED', ...optKpi }] : [])],
      };
    },
  },
  {
    intent: 'COMPARE_SCHEDULES',
    patterns: [/compare/i, /before.*after/i, /improvement/i, /waiting time reduction/i, /delay saved/i],
    handler: () => {
      const latest = getLatestOptRun();
      if (!latest) {
        return {
          sql: 'SELECT * FROM optimization_runs ORDER BY id DESC LIMIT 1',
          summary: 'No optimization run has been executed yet. Click "Optimize Schedule" in the top bar to generate a comparison.',
          evidence: [],
        };
      }
      const o = JSON.parse(latest.original_kpi_json);
      const n = JSON.parse(latest.optimized_kpi_json);
      const delayDrop = o.total_delay_min > 0 ? Math.round(((o.total_delay_min - n.total_delay_min) / o.total_delay_min) * 1000) / 10 : 0;
      const waitDrop = o.total_waiting_min > 0 ? Math.round(((o.total_waiting_min - n.total_waiting_min) / o.total_waiting_min) * 1000) / 10 : 0;
      return {
        sql: `SELECT * FROM optimization_runs WHERE id = ${latest.id}`,
        summary: `Optimization Run #${latest.id} (${latest.solve_time_ms} ms) reduced total delay by ${delayDrop}% (${o.total_delay_min} → ${n.total_delay_min} min) and waiting time by ${waitDrop}% (${o.total_waiting_min} → ${n.total_waiting_min} min), resolving ${o.conflict_count} conflicts.`,
        evidence: [
          { metric: 'Total Delay (min)', original: o.total_delay_min, optimized: n.total_delay_min },
          { metric: 'Total Waiting (min)', original: o.total_waiting_min, optimized: n.total_waiting_min },
          { metric: 'Throughput (trains/hr)', original: o.throughput_per_hour, optimized: n.throughput_per_hour },
          { metric: 'Critical Conflicts', original: o.conflict_count, optimized: n.conflict_count },
        ],
      };
    },
  },
  {
    intent: 'NEXT_CONFLICTS',
    patterns: [/conflict/i, /clash/i, /crossing/i, /headway/i, /deadlock/i],
    handler: () => {
      const conflicts = scanConflicts('ORIGINAL', false);
      return {
        sql: 'conflictEngine.scanConflicts("ORIGINAL")',
        summary: `Detected ${conflicts.length} active conflicts on the baseline timetable (${conflicts.filter((c) => c.severity === 'CRITICAL').length} CRITICAL).`,
        evidence: conflicts.slice(0, 10).map((c) => ({
          category: c.category,
          severity: c.severity,
          trains: c.train_nos.join(', '),
          location: c.section_code || c.station_code || '-',
          impact_min: c.predicted_impact_min,
          action: c.recommended_action,
        })),
      };
    },
  },
  {
    intent: 'EXPLAIN_RECOMMENDATIONS',
    patterns: [/recommend/i, /explain schedule/i, /decision/i, /hold/i, /loop/i],
    handler: () => {
      const db = getDb();
      const recs = db
        .prepare(
          `SELECT t.train_no, s.code as station, r.action, r.delta_min, r.reason, r.rule_ref, r.accepted
           FROM recommendations r
           JOIN trains t ON t.id = r.train_id
           LEFT JOIN stations s ON s.id = r.station_id
           ORDER BY r.run_id DESC, ABS(r.delta_min) DESC LIMIT 8`
        )
        .all() as Array<Record<string, unknown>>;
      return {
        sql: 'SELECT train_no, station, action, delta_min, reason FROM recommendations ORDER BY run_id DESC LIMIT 8',
        summary:
          recs.length > 0
            ? `Showing ${recs.length} top AI dispatch recommendations. Top action: ${recs[0].action} on ${recs[0].train_no} at ${recs[0].station} (${recs[0].delta_min}m).`
            : 'No optimization recommendations stored yet. Run the optimizer first.',
        evidence: recs,
      };
    },
  },
  {
    intent: 'PLATFORM_STATUS',
    patterns: [/platform/i, /station occupancy/i, /daund/i],
    handler: () => {
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT s.code as station, p.number, p.length_m, p.status, p.electrified
           FROM platforms p JOIN stations s ON s.id = p.station_id
           ORDER BY s.km, p.id LIMIT 15`
        )
        .all() as Array<Record<string, unknown>>;
      const blocked = rows.filter((r) => r.status === 'BLOCKED').length;
      return {
        sql: 'SELECT s.code, p.number, p.length_m, p.status FROM platforms p JOIN stations s...',
        summary: `Platform inventory across 12 stations (${blocked} blocked). Note: DD PF-2 is 520m, requiring length screening for long freight/superfast rakes.`,
        evidence: rows,
      };
    },
  },
  {
    intent: 'MAINTENANCE_ALERTS',
    patterns: [/maintenance/i, /sensor/i, /vibration/i, /anomaly/i, /health/i, /track fault/i],
    handler: () => {
      const health = analyzeMaintenanceHealth();
      return {
        sql: 'maintenanceEngine.analyzeMaintenanceHealth() on sensor_readings',
        summary: `Predictive maintenance flagged ${health.anomalies.length} anomalous section(s): ${health.anomalies
          .map((a) => `${a.section_code} (Health ${a.health_score}/100)`)
          .join(', ')}.`,
        evidence: health.sections.slice(0, 6).map((s) => ({
          section: s.section_code,
          health_score: s.health_score,
          anomaly: s.is_anomaly,
          vibration: s.latest_vibration,
          gauge_dev_mm: s.latest_gauge_dev,
          best_window: `${s.recommended_window.start_min}-${s.recommended_window.end_min}m`,
        })),
      };
    },
  },
  {
    intent: 'ENERGY_SAVINGS',
    patterns: [/energy/i, /kwh/i, /co2/i, /carbon/i, /fuel/i, /coasting/i],
    handler: () => {
      const e = computeEnergySummary();
      return {
        sql: 'energyEngine.computeEnergySummary()',
        summary: `Estimated traction energy drops by ${e.savings_kwh.toLocaleString()} kWh (${e.savings_pct}% savings, ~${e.savings_co2_kg.toLocaleString()} kg CO2 avoided) by eliminating ${Math.max(0, e.original.total_stops - e.optimized.total_stops)} unplanned signal stops.`,
        evidence: [
          { metric: 'Original Energy (kWh)', value: e.original.total_kwh },
          { metric: 'Optimized Energy (kWh)', value: e.optimized.total_kwh },
          { metric: 'Energy Saved (kWh)', value: e.savings_kwh },
          { metric: 'CO2 Avoided (kg est)', value: e.savings_co2_kg },
        ],
      };
    },
  },
  {
    intent: 'WEATHER_DISRUPTION',
    patterns: [/weather/i, /fog/i, /rain/i, /storm/i, /disruption/i, /tsr/i, /block/i],
    handler: () => {
      const db = getDb();
      const w = db.prepare('SELECT type, severity, speed_factor, headway_bonus_min, source FROM weather_events WHERE active = 1').all() as Array<Record<string, unknown>>;
      const d = db.prepare('SELECT type, description, start_min, end_min, speed_limit_kmph FROM disruptions WHERE active = 1').all() as Array<Record<string, unknown>>;
      return {
        sql: 'SELECT * FROM weather_events WHERE active = 1; SELECT * FROM disruptions WHERE active = 1;',
        summary: `Active weather: ${w.map((x) => `${x.type} (sev ${x.severity}, speed x${x.speed_factor})`).join('; ') || 'Clear'}. Active disruptions: ${d.length}.`,
        evidence: [...w, ...d],
      };
    },
  },
  {
    intent: 'BLAST_RADIUS',
    patterns: [/blast radius/i, /propagat/i, /knock-on/i, /cascade/i, /affected/i],
    handler: (q) => {
      const db = getDb();
      const m = q.match(/(\d{4,5}|G-\d+|P-\d+|EM-\d+)/i);
      const tr = m
        ? (db.prepare('SELECT id FROM trains WHERE UPPER(train_no) = ?').get(m[1].toUpperCase()) as { id: number } | undefined)
        : (db.prepare("SELECT id FROM trains WHERE is_active = 1 AND category = 'GOODS' LIMIT 1").get() as { id: number } | undefined);
      if (!tr) return { sql: 'SELECT id FROM trains', summary: "I don't have that train data.", evidence: [] };
      const prop = analyzeDelayPropagation(tr.id, 20, 'ORIGINAL');
      return {
        sql: `propagationService.analyzeDelayPropagation(train_id=${tr.id}, +20m)`,
        summary: `A +20 min shock to ${prop.root_train?.train_no} affects ${prop.affected_count} downstream trains totaling ${prop.total_knock_on_min} min of knock-on delay.`,
        evidence: prop.nodes.slice(0, 8) as unknown as Array<Record<string, unknown>>,
      };
    },
  },
  {
    intent: 'CAPACITY_HEADROOM',
    patterns: [/more trains/i, /headroom/i, /upgrade/i, /double track/i, /roi/i],
    handler: () => {
      const cap = capacitySnapshotForCopilot();
      return {
        sql: 'scenarioEngine.runCapacitySweep()',
        summary: `Corridor bottleneck is ${cap.bottleneck_section}. Safe headroom before saturation is +${cap.safe_headroom_trains} additional trains/window. Top ROI upgrade: ${cap.top_upgrade?.section_code} (${cap.top_upgrade?.recommended_upgrade}).`,
        evidence: cap.curve as unknown as Array<Record<string, unknown>>,
      };
    },
  },
  {
    intent: 'FREIGHT_TRAINS',
    patterns: [/freight/i, /goods/i, /starvation/i],
    handler: () => {
      const db = getDb();
      const rows = db
        .prepare("SELECT train_no, name, priority, length_m, max_speed_kmph, status FROM trains WHERE is_active = 1 AND category = 'GOODS'")
        .all() as Array<Record<string, unknown>>;
      return {
        sql: "SELECT train_no, name, priority, length_m, max_speed_kmph, status FROM trains WHERE is_active = 1 AND category = 'GOODS'",
        summary: `There are ${rows.length} active freight/goods rakes in the control window, subject to the max freight starvation fairness cap.`,
        evidence: rows,
      };
    },
  },
  {
    intent: 'CREW_RAKE_LINKS',
    patterns: [/crew/i, /rake/i, /turnaround/i, /duty/i, /connection/i, /passenger transfer/i],
    handler: () => {
      const db = getDb();
      const conns = db
        .prepare(
          `SELECT t1.train_no as feeder, t2.train_no as connecting, s.code as station, c.min_transfer_min, c.passengers_est
           FROM connections c JOIN trains t1 ON t1.id = c.feeder_train_id JOIN trains t2 ON t2.id = c.connecting_train_id JOIN stations s ON s.id = c.station_id`
        )
        .all() as Array<Record<string, unknown>>;
      return {
        sql: 'SELECT feeder, connecting, station, min_transfer_min, passengers_est FROM connections...',
        summary: `Tracking ${conns.length} protected passenger connections across junction hubs.`,
        evidence: conns,
      };
    },
  },
  {
    intent: 'SYSTEM_DISCLAIMER',
    patterns: [/safety/i, /signalling/i, /certif/i, /disclaimer/i, /authority/i],
    handler: () => ({
      sql: 'system_policy.disclaimer',
      summary: 'RailSmart AI is a simulation and decision-support prototype only. It is not certified for real train control and never connects to live signalling/interlocking equipment. Final authority rests with the Section Controller.',
      evidence: [],
    }),
  },
];

export async function askCopilot(question: string, userId?: number): Promise<CopilotResponse> {
  const db = getDb();
  const q = question.trim();

  let matched = INTENT_RULES.find((r) => r.patterns.some((p) => p.test(q)));
  if (!matched) {
    // Broad keyword fallback across additional intents
    if (/station/i.test(q)) {
      const stations = db.prepare('SELECT code, name, km, num_platforms, has_loop, is_junction FROM stations ORDER BY km').all() as Array<Record<string, unknown>>;
      const res: CopilotResponse = {
        intent: 'STATIONS_LIST',
        sql_or_tool_used: 'SELECT code, name, km, num_platforms, has_loop FROM stations ORDER BY km',
        answer: `The synthetic corridor spans ${stations.length} stations over 196 km (${stations[0]?.code} to ${stations[stations.length - 1]?.code}).`,
        evidence: stations,
        rephrased_by_gemini: false,
      };
      db.prepare('INSERT INTO copilot_log (user_id, question, intent, sql_or_tool_used, answer) VALUES (?, ?, ?, ?, ?)').run(
        userId ?? null,
        q,
        res.intent,
        res.sql_or_tool_used,
        res.answer
      );
      return res;
    }
    if (/audit|log|history/i.test(q)) {
      const logs = db.prepare('SELECT ts, username, action, entity FROM audit_log ORDER BY id DESC LIMIT 10').all() as Array<Record<string, unknown>>;
      const res: CopilotResponse = {
        intent: 'AUDIT_LOG',
        sql_or_tool_used: 'SELECT ts, username, action, entity FROM audit_log ORDER BY id DESC LIMIT 10',
        answer: `Showing the ${logs.length} most recent controller & system audit events.`,
        evidence: logs,
        rephrased_by_gemini: false,
      };
      db.prepare('INSERT INTO copilot_log (user_id, question, intent, sql_or_tool_used, answer) VALUES (?, ?, ?, ?, ?)').run(
        userId ?? null,
        q,
        res.intent,
        res.sql_or_tool_used,
        res.answer
      );
      return res;
    }

    // Default helpful response without hallucinating
    const fallback: CopilotResponse = {
      intent: 'UNSUPPORTED_QUERY',
      sql_or_tool_used: 'intent_router (no matching whitelisted tool)',
      answer: "I don't have a specific tool for that phrasing. Try asking about delayed trains, most congested section, why Train G-501 is delayed, current throughput, schedule comparison, conflicts, platform status, maintenance alerts, energy savings, weather disruptions, blast radius, or capacity headroom.",
      evidence: [],
      rephrased_by_gemini: false,
    };
    db.prepare('INSERT INTO copilot_log (user_id, question, intent, sql_or_tool_used, answer) VALUES (?, ?, ?, ?, ?)').run(
      userId ?? null,
      q,
      fallback.intent,
      fallback.sql_or_tool_used,
      fallback.answer
    );
    return fallback;
  }

  const out = matched.handler(q);
  let finalAnswer = out.summary;
  let rephrased = false;

  // Optional Gemini rephrasing strictly grounded in verified output
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
    try {
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const resp = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Question: ${q}\nVerified summary: ${out.summary}\nVerified data rows: ${JSON.stringify(out.evidence.slice(0, 6))}`,
        config: {
          systemInstruction:
            'You are RailSmart AI Copilot. Rephrase the verified summary concisely in 2-3 crisp railway operations sentences using ONLY the provided verified data. Never invent numbers, trains, or facts not present in the verified data.',
        },
      });
      if (resp.text && resp.text.trim().length > 10) {
        finalAnswer = resp.text.trim();
        rephrased = true;
      }
    } catch {
      // Keep deterministic verified summary if API fails
    }
  }

  db.prepare('INSERT INTO copilot_log (user_id, question, intent, sql_or_tool_used, answer) VALUES (?, ?, ?, ?, ?)').run(
    userId ?? null,
    q,
    matched.intent,
    out.sql,
    finalAnswer
  );

  return {
    intent: matched.intent,
    sql_or_tool_used: out.sql,
    answer: finalAnswer,
    evidence: out.evidence,
    rephrased_by_gemini: rephrased,
  };
}
