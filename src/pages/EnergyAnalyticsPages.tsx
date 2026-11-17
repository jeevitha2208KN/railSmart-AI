import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { KpiCard } from '../components/KpiCard.tsx';
import { BarChart3, Leaf, Zap } from 'lucide-react';

interface EnergySummary {
  model_note: string;
  original: { total_kwh: number; co2_kg: number; total_stops: number };
  optimized: { total_kwh: number; co2_kg: number; total_stops: number };
  savings_kwh: number;
  savings_co2_kg: number;
  savings_pct: number;
  per_train: Array<{ train_id: number; train_no: string; name: string; category: string; kwh: number; stops: number; coasting_advice: string }>;
}

export function EnergyPage({ refreshTick }: { refreshTick: number }) {
  const [data, setData] = useState<EnergySummary | null>(null);

  useEffect(() => {
    apiFetch<EnergySummary>('/energy/summary').then(setData).catch(() => {});
  }, [refreshTick]);

  if (!data) return <div className="text-xs text-slate-400">Calculating traction energy & coasting profiles...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Traction Energy Efficiency & Green-Wave Coasting</h2>
        <p className="text-xs text-slate-400">{data.model_note}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Estimated Energy Saved" value={data.savings_kwh.toLocaleString()} unit="kWh" delta={data.savings_pct} deltaLabel="%" tone="positive" subtext="6h corridor dispatch" />
        <KpiCard label="Estimated CO₂ Avoided" value={data.savings_co2_kg.toLocaleString()} unit="kg" tone="positive" subtext="0.68 kg/kWh grid factor" />
        <KpiCard label="Unplanned Stops Eliminated" value={Math.max(0, data.original.total_stops - data.optimized.total_stops)} subtext={`${data.original.total_stops} → ${data.optimized.total_stops} total stops`} />
        <KpiCard label="Optimized Corridor Draw" value={data.optimized.total_kwh.toLocaleString()} unit="kWh" subtext={`Baseline: ${data.original.total_kwh.toLocaleString()} kWh`} />
      </div>

      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Leaf className="w-4 h-4 text-emerald-400" /> Driver Coasting & Pacing Advisory by Train
          </h3>
          <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
            <Zap className="w-3 h-3 text-amber-400" /> Physics Proxy Model
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700/60">
                <th className="py-2 text-left">Train</th>
                <th className="py-2 text-left">Category</th>
                <th className="py-2 text-right">Est. Traction kWh</th>
                <th className="py-2 text-right">Stops</th>
                <th className="py-2 text-left">Recommended Coasting Profile</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {data.per_train.map((tr) => (
                <tr key={tr.train_id}>
                  <td className="py-2 font-mono font-semibold text-slate-100">
                    {tr.train_no} <span className="font-sans font-normal text-slate-400">· {tr.name}</span>
                  </td>
                  <td className="py-2 font-mono text-slate-300">{tr.category}</td>
                  <td className="py-2 text-right font-mono tabular-nums text-slate-200">{tr.kwh.toLocaleString()}</td>
                  <td className="py-2 text-right font-mono tabular-nums text-slate-300">{tr.stops}</td>
                  <td className="py-2 text-emerald-300">{tr.coasting_advice}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface OptRunRecord {
  id: number;
  status: string;
  solve_time_ms: number;
  objective_value: number;
  created_at: string;
  original_kpis: { total_delay_min: number; throughput_per_hour: number; conflict_count: number };
  optimized_kpis: { total_delay_min: number; throughput_per_hour: number; conflict_count: number; on_time_pct: number };
}

export function AnalyticsPage({ refreshTick }: { refreshTick: number }) {
  const [runs, setRuns] = useState<OptRunRecord[]>([]);
  const [delayTrend, setDelayTrend] = useState<{
    by_hour: Array<{ hour: number; avg_delay: number; samples: number }>;
    by_category: Array<{ category: string; avg_delay: number; samples: number }>;
  }>({ by_hour: [], by_category: [] });

  useEffect(() => {
    Promise.all([
      apiFetch<OptRunRecord[]>('/optimize/runs'),
      apiFetch<typeof delayTrend>('/analytics/delay-trend'),
    ])
      .then(([r, dt]) => {
        setRuns(r);
        setDelayTrend(dt);
      })
      .catch(() => {});
  }, [refreshTick]);

  const maxCatDelay = Math.max(1, ...delayTrend.by_category.map((c) => c.avg_delay));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Corridor Performance Analytics & Solver History</h2>
        <p className="text-xs text-slate-400">
          Historical 90-day delay distributions across train categories alongside recorded optimization run trajectories.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-sky-400" /> Historical Mean Delay by Train Category (90 Days)
          </h3>
          <div className="space-y-3">
            {delayTrend.by_category.map((c) => (
              <div key={c.category} className="space-y-1 text-xs">
                <div className="flex justify-between font-mono">
                  <span className="text-slate-200">{c.category}</span>
                  <span className="text-slate-400 tabular-nums">
                    {c.avg_delay} min avg ({c.samples.toLocaleString()} logs)
                  </span>
                </div>
                <div className="h-2.5 rounded bg-[#0B1B33] overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded"
                    style={{ width: `${Math.max(5, Math.round((c.avg_delay / maxCatDelay) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100">24-Hour Historical Congestion Profile</h3>
          <div className="flex items-end gap-1 h-40 pt-4">
            {delayTrend.by_hour.map((h) => {
              const maxH = Math.max(1, ...delayTrend.by_hour.map((x) => x.avg_delay));
              const pct = Math.max(6, Math.round((h.avg_delay / maxH) * 100));
              return (
                <div key={h.hour} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${h.hour}:00 — ${h.avg_delay}m avg`}>
                  <div className="w-full rounded-t bg-sky-500/80" style={{ height: `${pct}%` }} />
                  <span className="text-[9px] font-mono text-slate-500">{h.hour % 3 === 0 ? h.hour : ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">Recorded Optimization Run Ledger</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono tabular-nums">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700/60">
                <th className="py-2 text-left">Run ID</th>
                <th className="py-2 text-left">Status</th>
                <th className="py-2 text-right">Solve Time</th>
                <th className="py-2 text-right">Orig Delay</th>
                <th className="py-2 text-right">Opt Delay</th>
                <th className="py-2 text-right">OTP %</th>
                <th className="py-2 text-right">Opt Conflicts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 text-slate-100">#{r.id}</td>
                  <td className="py-2 text-emerald-400">{r.status}</td>
                  <td className="py-2 text-right text-slate-300">{r.solve_time_ms} ms</td>
                  <td className="py-2 text-right text-rose-300">{r.original_kpis.total_delay_min}m</td>
                  <td className="py-2 text-right text-emerald-300">{r.optimized_kpis.total_delay_min}m</td>
                  <td className="py-2 text-right text-sky-300">{r.optimized_kpis.on_time_pct}%</td>
                  <td className="py-2 text-right text-slate-200">{r.optimized_kpis.conflict_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
