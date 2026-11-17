import { useEffect, useState } from 'react';
import { MareyChart } from '../components/MareyChart.tsx';
import { apiFetch, exportRowsToCsv, formatTimeMin } from '../lib/api.ts';
import type { ConflictItem, RecommendationItem, SchedulePoint, StationItem, UserRole } from '../types/rail.ts';
import { Check, Download, X } from 'lucide-react';

export function MareyPage({ refreshTick, onOptimize, optimizing }: { refreshTick: number; onOptimize: () => void; optimizing: boolean }) {
  const [data, setData] = useState<{
    stations: StationItem[];
    trains: Array<{ id: number; train_no: string; name: string; category: string; priority: number; direction: string }>;
    original: SchedulePoint[];
    optimized: SchedulePoint[];
    conflicts: ConflictItem[];
  } | null>(null);
  const [mode, setMode] = useState<'ORIGINAL' | 'OPTIMIZED' | 'OVERLAY'>('OVERLAY');
  const [catFilter, setCatFilter] = useState('ALL');
  const [selectedTrainId, setSelectedTrainId] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<typeof data>('/schedules/marey').then(setData);
  }, [refreshTick]);

  if (!data) return <div className="h-96 rounded-lg bg-[#102442] animate-pulse" />;

  const selectedTrain = data.trains.find((t) => t.id === selectedTrainId);
  const origStops = selectedTrainId ? data.original.filter((r) => r.train_id === selectedTrainId).sort((a, b) => a.arrival - b.arrival) : [];
  const optStops = selectedTrainId ? data.optimized.filter((r) => r.train_id === selectedTrainId).sort((a, b) => a.arrival - b.arrival) : [];
  const stnMap = new Map(data.stations.map((s) => [s.id, s]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#102442] border border-slate-700/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center p-0.5 rounded-md bg-[#0B1B33] border border-slate-700/70">
            {(['ORIGINAL', 'OPTIMIZED', 'OVERLAY'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  mode === m ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m === 'ORIGINAL' ? 'Original Only' : m === 'OPTIMIZED' ? 'Optimized Only' : 'Side-by-Side Overlay'}
              </button>
            ))}
          </div>

          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-md bg-[#0B1B33] border border-slate-700 text-slate-200"
          >
            <option value="ALL">All Categories</option>
            <option value="SUPERFAST">Superfast</option>
            <option value="EXPRESS">Express</option>
            <option value="PASSENGER">Passenger</option>
            <option value="GOODS">Goods / Freight</option>
            <option value="EMERGENCY">Emergency</option>
            <option value="SPECIAL">Special</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOptimize}
            disabled={optimizing}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-50 whitespace-nowrap"
          >
            {optimizing ? 'Re-optimizing...' : 'Re-Run Optimizer'}
          </button>
          <a
            href="/api/v1/export/schedule.csv?kind=OPTIMIZED"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </a>
        </div>
      </div>

      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4">
        <MareyChart
          stations={data.stations}
          trains={data.trains}
          original={data.original}
          optimized={data.optimized}
          conflicts={data.conflicts}
          mode={mode}
          categoryFilter={catFilter}
          selectedTrainId={selectedTrainId}
          onSelectTrain={setSelectedTrainId}
          height={520}
        />
      </div>

      {selectedTrain && (
        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-100">
              Train {selectedTrain.train_no} — {selectedTrain.name} ({selectedTrain.category} · {selectedTrain.direction})
            </h3>
            <button onClick={() => setSelectedTrainId(null)} className="text-xs text-slate-400 hover:text-slate-200">
              Clear Selection
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-left">
                  <th className="py-1.5 pr-3">Station</th>
                  <th className="py-1.5 px-2 font-mono">Orig Arr</th>
                  <th className="py-1.5 px-2 font-mono">Orig Dep</th>
                  <th className="py-1.5 px-2 font-mono text-cyan-300">Opt Arr</th>
                  <th className="py-1.5 px-2 font-mono text-cyan-300">Opt Dep</th>
                  <th className="py-1.5 pl-2 font-mono">Loop</th>
                </tr>
              </thead>
              <tbody>
                {origStops.map((o, i) => {
                  const opt = optStops[i];
                  return (
                    <tr key={o.id} className="border-b border-slate-800/50">
                      <td className="py-1.5 pr-3 font-medium text-slate-200">{stnMap.get(o.station_id)?.code} · {stnMap.get(o.station_id)?.name}</td>
                      <td className="py-1.5 px-2 font-mono text-slate-400">{formatTimeMin(o.arrival)}</td>
                      <td className="py-1.5 px-2 font-mono text-slate-400">{formatTimeMin(o.departure)}</td>
                      <td className="py-1.5 px-2 font-mono text-cyan-300">{opt ? formatTimeMin(opt.arrival) : '-'}</td>
                      <td className="py-1.5 px-2 font-mono text-cyan-300">{opt ? formatTimeMin(opt.departure) : '-'}</td>
                      <td className="py-1.5 pl-2 font-mono">{opt?.used_loop ? 'LOOP' : 'MAIN'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function DecisionConsole({ refreshTick, role, onChanged }: { refreshTick: number; role: UserRole; onChanged: () => void }) {
  const [recs, setRecs] = useState<RecommendationItem[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'ACCEPTED' | 'REJECTED'>('ALL');
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    apiFetch<RecommendationItem[]>('/optimize/runs/latest/recommendations').then(setRecs);
  };

  useEffect(() => {
    load();
  }, [refreshTick]);

  const handleDecision = async (id: number, decision: 'accept' | 'reject') => {
    setError(null);
    try {
      await apiFetch(`/recommendations/${id}/${decision}`, { method: 'POST', body: JSON.stringify({}) });
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decision failed');
    }
  };

  const visible = recs.filter((r) => {
    if (filter === 'PENDING') return r.accepted === null;
    if (filter === 'ACCEPTED') return r.accepted === 1;
    if (filter === 'REJECTED') return r.accepted === 0;
    return true;
  });

  const canDecide = role === 'ADMIN' || role === 'CONTROLLER';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#102442] border border-slate-700/60 p-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Human-in-the-Loop Controller Decision Console</h2>
          <p className="text-xs text-slate-400">
            Every recommendation includes rule reference, explainable rationale, and beneficiary/penalty trade-off. All decisions are audit-logged.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center p-0.5 rounded-md bg-[#0B1B33] border border-slate-700/70">
            {(['ALL', 'PENDING', 'ACCEPTED', 'REJECTED'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${filter === f ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            onClick={() => exportRowsToCsv('controller_recommendations.csv', recs as unknown as Array<Record<string, unknown>>)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      {error && <div className="rounded-md bg-rose-500/15 border border-rose-500/40 px-4 py-2 text-xs text-rose-200">{error}</div>}
      {!canDecide && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-4 py-2 text-xs text-amber-200">
          VIEWER role is read-only. Switch to CONTROLLER or ADMIN in the top bar to accept or reject recommendations.
        </div>
      )}

      <div className="space-y-2.5">
        {visible.length === 0 ? (
          <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-8 text-center text-sm text-slate-400">
            No recommendations match this filter.
          </div>
        ) : (
          visible.map((r) => (
            <div key={r.id} className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1.5 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="font-mono font-semibold text-cyan-300">{r.action}</span>
                  <span>·</span>
                  <span className="font-mono text-slate-100 font-medium">{r.train_no} ({r.train_name})</span>
                  <span>·</span>
                  <span>Station {r.station_code ?? '-'}</span>
                  <span>·</span>
                  <span className="font-mono">{formatTimeMin(r.from_time)} → {formatTimeMin(r.to_time)} ({r.delta_min >= 0 ? `+${r.delta_min}` : r.delta_min}m)</span>
                  <span>·</span>
                  <span className="font-mono text-slate-400">{r.rule_ref}</span>
                </div>
                <p className="text-sm text-slate-200">{r.reason}</p>
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                  <span>Benefits: <strong className="text-emerald-300 font-medium">{r.trains_benefited}</strong></span>
                  <span>Penalized: <strong className="text-amber-300 font-medium">{r.trains_penalized}</strong></span>
                  {r.decided_by && (
                    <span className="font-mono text-slate-300">
                      Status: {r.accepted === 1 ? 'ACCEPTED' : 'REJECTED'} by {r.decided_by}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  disabled={!canDecide}
                  onClick={() => handleDecision(r.id, 'accept')}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
                    r.accepted === 1
                      ? 'bg-emerald-500/25 border-emerald-400/50 text-emerald-200'
                      : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" /> Accept
                </button>
                <button
                  disabled={!canDecide}
                  onClick={() => handleDecision(r.id, 'reject')}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
                    r.accepted === 0
                      ? 'bg-rose-500/25 border-rose-400/50 text-rose-200'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/20 disabled:opacity-40'
                  }`}
                >
                  <X className="w-3.5 h-3.5" /> Reject
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
