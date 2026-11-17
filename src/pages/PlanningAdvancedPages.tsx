import { useEffect, useState } from 'react';
import { apiFetch, formatTimeMin } from '../lib/api.ts';
import type { KpiSummary, SectionItem, TrainItem } from '../types/rail.ts';
import { KpiCard } from '../components/KpiCard.tsx';
import { AlertCircle, Flame, GitMerge, Play, Siren, TrendingUp } from 'lucide-react';

// --- MODULE 20: EMERGENCY TRAIN INSERTION ---
export function EmergencyInsertPage({ onMutated }: { onMutated: () => void }) {
  const [trainNo, setTrainNo] = useState('EM-99');
  const [name, setName] = useState('VIP Relief / Medical Special');
  const [category, setCategory] = useState('EMERGENCY');
  const [direction, setDirection] = useState<'UP' | 'DOWN'>('UP');
  const [depMin, setDepMin] = useState(445);
  const [priority, setPriority] = useState(10);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{
    train_no: string;
    before_kpis: KpiSummary;
    after_kpis: KpiSummary;
    trains_disturbed: number;
    solve_time_ms: number;
    recommendations: Array<{ id: number; train_no: string; action: string; delta_min: number; reason: string }>;
  } | null>(null);

  const handleInsert = async () => {
    setBusy(true);
    try {
      const out = await apiFetch<typeof res>('/scenarios/emergency-insert', {
        method: 'POST',
        body: JSON.stringify({
          train_no: trainNo,
          name,
          category,
          direction,
          dep_min: depMin,
          priority,
        }),
      });
      setRes(out);
      onMutated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Emergency & Unscheduled Train Insertion</h2>
        <p className="text-xs text-slate-400">
          Carve out an immediate conflict-free path for Relief, Medical, VIP, or Defence Specials while minimizing disturbance to running passenger trains.
        </p>
      </div>

      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-slate-400 block">Train No</span>
            <input value={trainNo} onChange={(e) => setTrainNo(e.target.value)} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-2 font-mono text-slate-100" />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-slate-400 block">Special Train Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-2 text-slate-100" />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400 block">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-2 text-slate-100">
              <option value="EMERGENCY">EMERGENCY</option>
              <option value="SPECIAL">SPECIAL (VIP)</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-slate-400 block">Direction</span>
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'UP' | 'DOWN')} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-2 text-slate-100">
              <option value="UP">UP (PUNE → SUR)</option>
              <option value="DOWN">DOWN (SUR → PUNE)</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-slate-400 block">Dep Time ({formatTimeMin(depMin)})</span>
            <input type="number" min={360} max={660} value={depMin} onChange={(e) => setDepMin(Number(e.target.value))} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-2 font-mono text-slate-100" />
          </label>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-400">
            Priority Weight: <span className="font-mono text-slate-200">{priority}/10</span> (Min-disturbance W4=8, W5=3)
            <input type="range" min={5} max={10} value={priority} onChange={(e) => setPriority(Number(e.target.value))} className="ml-3 accent-rose-400 align-middle" />
          </div>
          <button
            onClick={handleInsert}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Siren className="w-4 h-4" /> {busy ? 'Re-planning Corridor...' : 'Insert Special & Re-Plan'}
          </button>
        </div>
      </div>

      {res && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Inserted Special" value={res.train_no} subtext={`Solved in ${res.solve_time_ms} ms`} tone="positive" />
            <KpiCard label="Trains Disturbed" value={res.trains_disturbed} subtext="Min-perturbation replan" tone="warning" />
            <KpiCard
              label="Total Corridor Delay"
              value={res.after_kpis.total_delay_min}
              unit="min"
              delta={res.after_kpis.total_delay_min - res.before_kpis.total_delay_min}
              higherIsBetter={false}
              subtext={`Before: ${res.before_kpis.total_delay_min}m`}
            />
            <KpiCard label="Safety Conflicts" value={res.after_kpis.conflict_count} tone={res.after_kpis.conflict_count === 0 ? 'positive' : 'critical'} subtext="Verified across all 7 rules" />
          </div>

          <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-2">
            <h3 className="text-sm font-semibold text-slate-100">Resulting Schedule Adjustments</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/60">
                    <th className="py-2 text-left">Train</th>
                    <th className="py-2 text-left">Action</th>
                    <th className="py-2 text-right">Delta (min)</th>
                    <th className="py-2 text-left">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {res.recommendations.slice(0, 12).map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 font-mono font-semibold text-slate-100">{r.train_no}</td>
                      <td className="py-2 font-mono text-sky-300">{r.action}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-amber-300">+{r.delta_min}m</td>
                      <td className="py-2 text-slate-300">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- MODULE 21: PASSENGER CONNECTIONS, RAKE TURNAROUND & CREW DUTY ---
export function ConnectionsResourcesPage({ refreshTick }: { refreshTick: number }) {
  const [data, setData] = useState<{
    connections: Array<{
      id: number;
      station_code: string;
      feeder_train: string;
      connecting_train: string;
      feeder_arrival: number;
      connecting_departure: number;
      min_transfer_min: number;
      actual_margin_min: number;
      passengers_est: number;
      status: string;
      recommendation: string;
    }>;
    rakes: Array<{ id: number; rake_no: string; turnaround_min: number; prev_train_no: string | null; next_train_no: string | null; prev_arr: number | null; next_dep: number | null }>;
    crews: Array<{ id: number; crew_no: string; base_station: string; assigned_trains: number; projected_duty_hours: number; max_duty_hours: number; status: string }>;
  } | null>(null);

  useEffect(() => {
    apiFetch<typeof data>('/scenarios/connections-resources').then(setData).catch(() => {});
  }, [refreshTick]);

  if (!data) return <div className="text-xs text-slate-400">Loading connections, rakes & crew rosters...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Passenger Connections, Rake Turnarounds & Crew Duty Limits</h2>
        <p className="text-xs text-slate-400">
          Protects feeder-to-connecting passenger transfers, locomotive/rake turnaround gaps, and 10h crew duty hours-of-service compliance.
        </p>
      </div>

      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <GitMerge className="w-4 h-4 text-sky-400" /> Passenger Transfer Connection Protection
        </h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400 border-b border-slate-700/60">
              <th className="py-2 text-left">Junction</th>
              <th className="py-2 text-left">Feeder → Connecting</th>
              <th className="py-2 text-right">Pax</th>
              <th className="py-2 text-right">Margin / Min</th>
              <th className="py-2 text-left">Status</th>
              <th className="py-2 text-left">Controller Advice</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {data.connections.map((c) => (
              <tr key={c.id}>
                <td className="py-2 font-mono font-semibold text-slate-100">{c.station_code}</td>
                <td className="py-2 font-mono text-slate-200">
                  {c.feeder_train} ({formatTimeMin(c.feeder_arrival)}) → {c.connecting_train} ({formatTimeMin(c.connecting_departure)})
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-slate-300">{c.passengers_est}</td>
                <td className="py-2 text-right font-mono tabular-nums text-slate-200">
                  {c.actual_margin_min}m / {c.min_transfer_min}m
                </td>
                <td className={`py-2 font-mono font-semibold ${c.status === 'PROTECTED' ? 'text-emerald-400' : 'text-rose-400'}`}>{c.status}</td>
                <td className="py-2 text-slate-300">{c.recommendation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100">Rake Turnaround Chains</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700/60">
                <th className="py-2 text-left">Rake</th>
                <th className="py-2 text-left">Inbound → Outbound</th>
                <th className="py-2 text-right">Turnaround</th>
                <th className="py-2 text-right">Gap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {data.rakes.map((rk) => {
                const gap = rk.next_dep && rk.prev_arr ? rk.next_dep - rk.prev_arr : rk.turnaround_min;
                return (
                  <tr key={rk.id}>
                    <td className="py-2 font-semibold text-slate-100">{rk.rake_no}</td>
                    <td className="py-2 text-slate-300">
                      {rk.prev_train_no ?? '—'} → {rk.next_train_no ?? '—'}
                    </td>
                    <td className="py-2 text-right text-slate-400">{rk.turnaround_min}m min</td>
                    <td className={`py-2 text-right font-semibold ${gap >= rk.turnaround_min ? 'text-emerald-400' : 'text-rose-400'}`}>{gap}m</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100">Crew Duty Hours Compliance</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700/60">
                <th className="py-2 text-left">Crew</th>
                <th className="py-2 text-left">Base</th>
                <th className="py-2 text-right">Trains</th>
                <th className="py-2 text-right">Projected / Max</th>
                <th className="py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {data.crews.map((cr) => (
                <tr key={cr.id}>
                  <td className="py-2 font-semibold text-slate-100">{cr.crew_no}</td>
                  <td className="py-2 text-slate-300">{cr.base_station}</td>
                  <td className="py-2 text-right text-slate-300">{cr.assigned_trains}</td>
                  <td className="py-2 text-right text-slate-200">
                    {cr.projected_duty_hours}h / {cr.max_duty_hours}h
                  </td>
                  <td
                    className={`py-2 text-right font-semibold ${
                      cr.status === 'COMPLIANT' ? 'text-emerald-400' : cr.status === 'WARNING' ? 'text-amber-400' : 'text-rose-400'
                    }`}
                  >
                    {cr.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- MODULE 22: RESILIENCE & CAPACITY PLANNING ---
export function CapacityPlanningPage({ refreshTick }: { refreshTick: number }) {
  const [data, setData] = useState<{
    bottleneck_section: string;
    current_active_trains: number;
    safe_headroom_trains: number;
    curve: Array<{ added_trains: number; total_trains: number; throughput_per_hr: number; avg_delay_min: number; utilization_pct: number; saturated: boolean }>;
    infrastructure_roi: Array<{
      section_id: number;
      section_code: string;
      current_track: string;
      distance_km: number;
      recommended_upgrade: string;
      capacity_gain_trains_day: number;
      delay_saved_min_day: number;
      est_cost_cr: number;
      roi_score: number;
    }>;
  } | null>(null);

  useEffect(() => {
    apiFetch<typeof data>('/scenarios/capacity-sweep').then(setData).catch(() => {});
  }, [refreshTick]);

  if (!data) return <div className="text-xs text-slate-400">Running UIC-406 corridor capacity sweep...</div>;

  const maxDelay = Math.max(25, ...data.curve.map((c) => c.avg_delay_min));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Corridor Resilience, Saturation Curve & Infrastructure ROI</h2>
        <p className="text-xs text-slate-400">
          Incremental traffic sweep (+0 to +10 additional trains) identifying single-line saturation knee & capital doubling priority.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="Primary Bottleneck" value={data.bottleneck_section} subtext="UIC-406 cycle-time limiter" tone="warning" />
        <KpiCard label="Current 6h Active Load" value={data.current_active_trains} unit="trains" subtext="Inside peak 06:00–12:00 window" />
        <KpiCard label="Safe Headroom Before Knee" value={`+${data.safe_headroom_trains}`} unit="trains" subtext="Before avg delay > 18 min" tone="positive" />
      </div>

      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-sky-400" /> Traffic Saturation Curve (+0 to +10 Trains)
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-center">
          <svg viewBox="0 0 420 190" className="w-full h-48 bg-[#0B1B33] rounded border border-slate-700/50">
            {[0, 0.25, 0.5, 0.75, 1].map((g) => (
              <line key={g} x1="40" y1={160 - g * 130} x2="395" y2={160 - g * 130} stroke="#1E293B" strokeWidth="1" />
            ))}
            <polyline
              fill="none"
              stroke="#38BDF8"
              strokeWidth="2.5"
              points={data.curve
                .map((pt, i) => {
                  const x = 50 + (i / Math.max(1, data.curve.length - 1)) * 330;
                  const y = 160 - (pt.avg_delay_min / maxDelay) * 130;
                  return `${x},${y}`;
                })
                .join(' ')}
            />
            {data.curve.map((pt, i) => {
              const x = 50 + (i / Math.max(1, data.curve.length - 1)) * 330;
              const y = 160 - (pt.avg_delay_min / maxDelay) * 130;
              return (
                <g key={pt.added_trains}>
                  <circle cx={x} cy={y} r={4.5} fill={pt.saturated ? '#F43F5E' : '#10B981'} />
                  <text x={x} y={178} textAnchor="middle" fill="#94A3B8" fontSize="10" className="font-mono">
                    +{pt.added_trains}
                  </text>
                  <text x={x} y={y - 9} textAnchor="middle" fill="#E2E8F0" fontSize="9" className="font-mono">
                    {pt.avg_delay_min}m
                  </text>
                </g>
              );
            })}
          </svg>

          <table className="w-full text-xs font-mono tabular-nums">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700/60">
                <th className="py-1.5 text-left">Added</th>
                <th className="py-1.5 text-right">Total</th>
                <th className="py-1.5 text-right">Throughput/hr</th>
                <th className="py-1.5 text-right">Avg Delay</th>
                <th className="py-1.5 text-right">Track Util</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {data.curve.map((c) => (
                <tr key={c.added_trains} className={c.saturated ? 'text-rose-300' : 'text-slate-200'}>
                  <td className="py-1.5">+{c.added_trains} trains</td>
                  <td className="py-1.5 text-right">{c.total_trains}</td>
                  <td className="py-1.5 text-right">{c.throughput_per_hr}</td>
                  <td className="py-1.5 text-right">{c.avg_delay_min}m</td>
                  <td className="py-1.5 text-right">{c.utilization_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">Ranked Infrastructure Upgrade ROI</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700/60">
                <th className="py-2 text-left">Section</th>
                <th className="py-2 text-left">Track</th>
                <th className="py-2 text-left">Recommended Engineering Upgrade</th>
                <th className="py-2 text-right">Cap Gain/Day</th>
                <th className="py-2 text-right">Delay Saved/Day</th>
                <th className="py-2 text-right">Est Cost (₹ Cr)</th>
                <th className="py-2 text-right">ROI Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {data.infrastructure_roi.map((u) => (
                <tr key={u.section_id}>
                  <td className="py-2 font-mono font-semibold text-slate-100">{u.section_code}</td>
                  <td className="py-2 font-mono text-amber-300">{u.current_track}</td>
                  <td className="py-2 text-slate-200">{u.recommended_upgrade}</td>
                  <td className="py-2 text-right font-mono tabular-nums text-emerald-400">+{u.capacity_gain_trains_day}</td>
                  <td className="py-2 text-right font-mono tabular-nums text-sky-300">{u.delay_saved_min_day}m</td>
                  <td className="py-2 text-right font-mono tabular-nums text-slate-300">{u.est_cost_cr}</td>
                  <td className="py-2 text-right font-mono tabular-nums font-semibold text-slate-100">{u.roi_score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- MODULE 12: WHAT-IF SCENARIO SIMULATOR ---
interface ScenarioResult {
  name: string;
  type: string;
  original_kpis: KpiSummary;
  optimized_kpis: KpiSummary;
  delay_reduction_pct: number;
  per_train?: Array<{ train_id: number; train_no: string; name: string; category: string; original_delay_min: number; optimized_delay_min: number; saved_min: number }>;
}

export function WhatIfPage() {
  const [trains, setTrains] = useState<TrainItem[]>([]);
  const [sections, setSections] = useState<SectionItem[]>([]);
  const [name, setName] = useState('Custom Single-Line Stress');
  const [type, setType] = useState('DELAY_20');
  const [targetTrainId, setTargetTrainId] = useState<number>(0);
  const [targetSectionId, setTargetSectionId] = useState<number>(0);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [worstCases, setWorstCases] = useState<ScenarioResult[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([apiFetch<TrainItem[]>('/trains?active_only=true'), apiFetch<SectionItem[]>('/sections')])
      .then(([tr, sec]) => {
        setTrains(tr);
        setSections(sec);
        if (tr.length > 0) setTargetTrainId(tr[0].id);
        const sing = sec.find((s) => s.track_type === 'SINGLE') ?? sec[0];
        if (sing) setTargetSectionId(sing.id);
      })
      .catch(() => {});
  }, []);

  const runCustom = async () => {
    setBusy(true);
    try {
      const out = await apiFetch<ScenarioResult>('/scenarios/run', {
        method: 'POST',
        body: JSON.stringify({
          name,
          type,
          target_train_id: targetTrainId || undefined,
          target_section_id: targetSectionId || undefined,
          seed: 42,
        }),
      });
      setResult(out);
    } finally {
      setBusy(false);
    }
  };

  const runBatch = async () => {
    setBusy(true);
    try {
      const out = await apiFetch<ScenarioResult[]>('/scenarios/worst-case', { method: 'POST' });
      setWorstCases(out);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">What-If Scenario Lab & Worst-Case Sweep</h2>
          <p className="text-xs text-slate-400">
            Stress-test Digital Twin original vs optimized schedules across 10 disruption scenarios with deterministic seed parity.
          </p>
        </div>
        <button
          onClick={runBatch}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white disabled:opacity-50"
        >
          <Flame className="w-3.5 h-3.5" /> Run Worst-Case Batch Sweep (6 Scenarios)
        </button>
      </div>

      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-slate-400 block">Scenario Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-2 text-slate-100" />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400 block">Disruption Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-2 text-slate-100">
              {['DELAY_10', 'DELAY_20', 'DELAY_30', 'SECTION_BLOCK', 'PLATFORM_DOWN', 'HEAVY_RAIN', 'FOG_PROTOCOL', 'EXTRA_TRAIN', 'FREIGHT_SURGE', 'DOUBLE_FAILURE'].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-slate-400 block">Target Train</span>
            <select value={targetTrainId} onChange={(e) => setTargetTrainId(Number(e.target.value))} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-2 text-slate-100">
              {trains.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.train_no} · {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-slate-400 block">Target Section</span>
            <select value={targetSectionId} onChange={(e) => setTargetSectionId(Number(e.target.value))} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-2 text-slate-100">
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} ({s.track_type})
                </option>
              ))}
            </select>
          </label>
        </div>
        <button onClick={runCustom} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white">
          <Play className="w-3.5 h-3.5" /> Execute What-If Comparison
        </button>
      </div>

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Original Sim Delay" value={result.original_kpis.total_delay_min} unit="min" tone="critical" />
            <KpiCard label="Optimized Sim Delay" value={result.optimized_kpis.total_delay_min} unit="min" tone="positive" />
            <KpiCard label="Delay Saved Under Stress" value={`${result.delay_reduction_pct}%`} tone="positive" />
            <KpiCard label="Conflicts (Orig → Opt)" value={`${result.original_kpis.conflict_count} → ${result.optimized_kpis.conflict_count}`} />
          </div>

          {result.per_train && (
            <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-slate-100">Per-Train Resilience Breakdown ({result.name})</h3>
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-700/60">
                      <th className="py-2 text-left">Train</th>
                      <th className="py-2 text-left">Category</th>
                      <th className="py-2 text-right">Orig Delay</th>
                      <th className="py-2 text-right">Opt Delay</th>
                      <th className="py-2 text-right">Minutes Saved</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                    {result.per_train.slice(0, 15).map((pt) => (
                      <tr key={pt.train_id}>
                        <td className="py-1.5 font-semibold text-slate-100">
                          {pt.train_no} <span className="font-sans font-normal text-slate-400">· {pt.name}</span>
                        </td>
                        <td className="py-1.5 text-slate-300">{pt.category}</td>
                        <td className="py-1.5 text-right text-rose-300">{pt.original_delay_min}m</td>
                        <td className="py-1.5 text-right text-emerald-300">{pt.optimized_delay_min}m</td>
                        <td className={`py-1.5 text-right font-semibold ${pt.saved_min >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {pt.saved_min >= 0 ? `+${pt.saved_min}m` : `${pt.saved_min}m`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {worstCases.length > 0 && (
        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400" /> Worst-Case Batch Sweep Summary
          </h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700/60">
                <th className="py-2 text-left">Scenario</th>
                <th className="py-2 text-right">Orig Delay</th>
                <th className="py-2 text-right">Opt Delay</th>
                <th className="py-2 text-right">Reduction</th>
                <th className="py-2 text-right">Opt Conflicts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {worstCases.map((wc) => (
                <tr key={wc.type}>
                  <td className="py-2 font-sans font-medium text-slate-100">{wc.name}</td>
                  <td className="py-2 text-right text-rose-300">{wc.original_kpis.total_delay_min}m</td>
                  <td className="py-2 text-right text-emerald-300">{wc.optimized_kpis.total_delay_min}m</td>
                  <td className="py-2 text-right font-semibold text-emerald-400">{wc.delay_reduction_pct}%</td>
                  <td className="py-2 text-right text-slate-200">{wc.optimized_kpis.conflict_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
