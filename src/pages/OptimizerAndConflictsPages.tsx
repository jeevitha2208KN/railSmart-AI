import { useEffect, useState } from 'react';
import { KpiCard } from '../components/KpiCard.tsx';
import { apiFetch } from '../lib/api.ts';
import type { ConflictItem, KpiSummary, TrainItem } from '../types/rail.ts';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from 'lucide-react';

export function OptimizerPage({ refreshTick, onOptimized }: { refreshTick: number; onOptimized: () => void }) {
  const [weights, setWeights] = useState({
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
    mode: 'WEIGHTED' as 'WEIGHTED' | 'LEXICOGRAPHIC',
  });
  const [runs, setRuns] = useState<Array<{
    id: number;
    created_at: string;
    status: string;
    solve_time_ms: number;
    objective_value: number;
    original_kpis: KpiSummary;
    optimized_kpis: KpiSummary;
    constraint_report: Array<{ rule: string; label: string; status: 'PASS' | 'FAIL'; violation_count: number; details: string[] }>;
  }>>([]);
  const [diag, setDiag] = useState<{ feasible_under_relaxation: boolean; causes: Array<{ constraint_group: string; entity: string; detail: string; suggested_fix: string }> } | null>(null);
  const [running, setRunning] = useState(false);

  const load = () => {
    apiFetch<{ weights: typeof weights }>('/admin/settings').then((s) => setWeights(s.weights));
    apiFetch<typeof runs>('/optimize/runs').then(setRuns);
  };

  useEffect(() => {
    load();
  }, [refreshTick]);

  const handleRun = async () => {
    setRunning(true);
    try {
      await apiFetch('/optimize/run', { method: 'POST', body: JSON.stringify({ weights }) });
      load();
      onOptimized();
    } finally {
      setRunning(false);
    }
  };

  const handleDiagnose = async () => {
    const out = await apiFetch<typeof diag>('/optimize/infeasibility-diagnosis', { method: 'POST', body: JSON.stringify({}) });
    setDiag(out);
  };

  const latest = runs[0];

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Constraint-Based Scheduling Optimizer</h2>
            <p className="text-xs text-slate-400">Multi-objective chronological lookahead & priority swap engine with independent 7-rule verifier.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleDiagnose} className="px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:bg-slate-700">
              Diagnose Feasibility
            </button>
            <button onClick={handleRun} disabled={running} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-cyan-500 text-slate-950 text-xs font-semibold hover:bg-cyan-400 disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
              {running ? 'Solving...' : 'Solve & Verify Schedule'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
          {[
            { k: 'W1_served', label: 'W1 Served' },
            { k: 'W2_delay', label: 'W2 Delay' },
            { k: 'W3_waiting', label: 'W3 Waiting' },
            { k: 'W4_changed', label: 'W4 Changed' },
            { k: 'W6_connections', label: 'W6 Connections' },
            { k: 'max_freight_starvation_min', label: 'Max Freight Wait (m)' },
          ].map((item) => (
            <div key={item.k}>
              <label className="block text-slate-400 mb-1">{item.label}</label>
              <input
                type="number"
                value={Number((weights as Record<string, unknown>)[item.k])}
                onChange={(e) => setWeights({ ...weights, [item.k]: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 rounded bg-[#0B1B33] border border-slate-700 font-mono text-slate-100"
              />
            </div>
          ))}
        </div>
      </div>

      {diag && (
        <div className="rounded-lg bg-[#102442] border border-amber-500/40 p-4 space-y-2 text-xs">
          <div className="font-semibold text-amber-300">
            Infeasibility & Relaxation Check: {diag.feasible_under_relaxation ? 'Network feasible under current topology' : 'Blocking constraints detected'}
          </div>
          {diag.causes.length === 0 ? (
            <p className="text-slate-300">No blocking sections, platform lockouts, or tight shift bounds detected.</p>
          ) : (
            diag.causes.map((c, idx) => (
              <div key={idx} className="p-2 rounded bg-[#0B1B33] border border-slate-800">
                <span className="font-mono text-amber-300">{c.constraint_group} ({c.entity}):</span> {c.detail} — <span className="text-emerald-300">{c.suggested_fix}</span>
              </div>
            ))
          )}
        </div>
      )}

      {latest && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Solver Status" value={latest.status} subtext={`Run #${latest.id} · ${latest.solve_time_ms} ms`} tone="positive" />
            <KpiCard label="Total Delay Reduced" value={`${latest.original_kpis.total_delay_min} → ${latest.optimized_kpis.total_delay_min}`} unit="min" delta={latest.optimized_kpis.total_delay_min - latest.original_kpis.total_delay_min} higherIsBetter={false} tone="positive" />
            <KpiCard label="Throughput Gain" value={`${latest.original_kpis.throughput_per_hour} → ${latest.optimized_kpis.throughput_per_hour}`} unit="tr/hr" delta={Math.round((latest.optimized_kpis.throughput_per_hour - latest.original_kpis.throughput_per_hour) * 100) / 100} higherIsBetter={true} />
            <KpiCard label="Objective Score" value={latest.objective_value.toLocaleString()} subtext={`Conflicts: ${latest.original_kpis.conflict_count} → ${latest.optimized_kpis.conflict_count}`} />
          </div>

          <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4">
            <h3 className="text-sm font-semibold text-slate-100 mb-3">Independent Constraint Verification Report</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {latest.constraint_report.map((chk) => (
                <div key={chk.rule} className="flex items-center justify-between p-3 rounded bg-[#0B1B33] border border-slate-800 text-xs">
                  <div>
                    <div className="font-medium text-slate-200">{chk.label}</div>
                    <div className="font-mono text-[11px] text-slate-500">{chk.rule}</div>
                  </div>
                  <span className={`inline-flex items-center gap-1 font-mono font-semibold ${chk.status === 'PASS' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {chk.status === 'PASS' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    {chk.status} ({chk.violation_count})
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function ConflictsPage({ refreshTick }: { refreshTick: number }) {
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [kind, setKind] = useState<'ORIGINAL' | 'OPTIMIZED'>('ORIGINAL');

  useEffect(() => {
    apiFetch<ConflictItem[]>(`/conflicts?kind=${kind}`).then(setConflicts);
  }, [kind, refreshTick]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#102442] border border-slate-700/60 p-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Rule-Engine Conflict & Congestion Scanner</h2>
          <p className="text-xs text-slate-400">Hard safety rules always override advisory ML risk scores.</p>
        </div>
        <div className="flex items-center p-0.5 rounded-md bg-[#0B1B33] border border-slate-700">
          {(['ORIGINAL', 'OPTIMIZED'] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={`px-3 py-1.5 text-xs rounded ${kind === k ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400'}`}>
              {k} Schedule
            </button>
          ))}
        </div>
      </div>

      {conflicts.length === 0 ? (
        <div className="rounded-lg bg-[#102442] border border-emerald-500/40 p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <div className="text-sm font-semibold text-emerald-300">Zero Conflicts Detected on {kind} Schedule</div>
          <p className="text-xs text-slate-400 mt-1">All single-line meets, headways, capacities, and platform lengths verified clean.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {conflicts.slice(0, 30).map((c, idx) => (
            <div key={idx} className="rounded-lg bg-[#102442] border border-slate-700/60 p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-mono">
                  <ShieldAlert className={`w-4 h-4 ${c.severity === 'CRITICAL' ? 'text-rose-400' : 'text-amber-400'}`} />
                  <span className={c.severity === 'CRITICAL' ? 'text-rose-300 font-semibold' : 'text-amber-300 font-semibold'}>{c.severity}</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-cyan-300">{c.category}</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-300">{c.section_code || c.station_code || 'Corridor'}</span>
                </div>
                <p className="text-slate-200">{c.recommended_action}</p>
              </div>
              <div className="flex items-center gap-4 font-mono shrink-0 text-slate-300">
                <span>Impact: +{c.predicted_impact_min}m</span>
                <span>ML Risk: {(c.ml_advisory_risk * 100).toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PropagationPage() {
  const [trains, setTrains] = useState<TrainItem[]>([]);
  const [trainId, setTrainId] = useState<number>(3);
  const [shockMin, setShockMin] = useState<number>(20);
  const [data, setData] = useState<{
    root_train: { train_no: string; name: string } | null;
    nodes: Array<{ train_id: number; train_no: string; name: string; category: string; added_delay_min: number; hop: number; cause: string; station_code: string }>;
    edges: Array<{ from_train_no: string; to_train_no: string; link_type: string; delay_transferred_min: number; location: string }>;
    total_knock_on_min: number;
    affected_count: number;
  } | null>(null);

  useEffect(() => {
    apiFetch<TrainItem[]>('/trains?active_only=true').then((t) => {
      setTrains(t);
      const goods = t.find((x) => x.train_no === 'G-501') ?? t[0];
      if (goods) setTrainId(goods.id);
    });
  }, []);

  useEffect(() => {
    if (!trainId) return;
    apiFetch<typeof data>(`/conflicts/propagation/${trainId}?delay=${shockMin}&kind=ORIGINAL`).then(setData);
  }, [trainId, shockMin]);

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 flex flex-wrap items-end gap-4">
        <div className="min-w-[240px] flex-1">
          <label className="block text-xs text-slate-400 mb-1">Select Root Delayed Train</label>
          <select value={trainId} onChange={(e) => setTrainId(Number(e.target.value))} className="w-full px-3 py-2 rounded-md bg-[#0B1B33] border border-slate-700 text-xs text-slate-100">
            {trains.map((t) => (
              <option key={t.id} value={t.id}>{t.train_no} · {t.name} ({t.category})</option>
            ))}
          </select>
        </div>
        <div className="w-44">
          <label className="block text-xs text-slate-400 mb-1">Initial Delay Shock (min)</label>
          <input type="number" min={5} max={60} value={shockMin} onChange={(e) => setShockMin(Number(e.target.value))} className="w-full px-3 py-2 rounded-md bg-[#0B1B33] border border-slate-700 font-mono text-xs text-slate-100" />
        </div>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KpiCard label="Root Shock Train" value={data.root_train?.train_no ?? '-'} subtext={data.root_train?.name} />
            <KpiCard label="Downstream Trains Affected" value={data.affected_count} unit="trains" tone={data.affected_count > 3 ? 'critical' : 'warning'} />
            <KpiCard label="Total Knock-On Blast Radius" value={data.total_knock_on_min} unit="min" tone="critical" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4">
              <h3 className="text-sm font-semibold text-slate-100 mb-3">Downstream Cascade Chain</h3>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {data.nodes.map((n) => (
                  <div key={n.train_id} className="flex items-center justify-between p-2.5 rounded bg-[#0B1B33] border border-slate-800 text-xs">
                    <div>
                      <div className="font-mono text-slate-100 font-medium">Hop {n.hop} · {n.train_no} ({n.category})</div>
                      <div className="text-slate-400">{n.cause} @ {n.station_code}</div>
                    </div>
                    <span className="font-mono font-semibold text-rose-400">+{n.added_delay_min}m</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4">
              <h3 className="text-sm font-semibold text-slate-100 mb-3">Propagation Links (Headway / Crossing / Rake / Connection)</h3>
              <div className="space-y-2 max-h-80 overflow-y-auto text-xs font-mono">
                {data.edges.length === 0 ? (
                  <p className="text-slate-400">No downstream ripple links triggered at this delay threshold.</p>
                ) : (
                  data.edges.map((e, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded bg-[#0B1B33] border border-slate-800">
                      <span className="text-slate-200">{e.from_train_no} → {e.to_train_no}</span>
                      <span className="text-cyan-300">{e.link_type} @ {e.location}</span>
                      <span className="text-amber-300">+{e.delay_transferred_min}m</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
