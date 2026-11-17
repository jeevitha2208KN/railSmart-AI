import { useEffect, useState } from 'react';
import { apiFetch, formatTimeMin } from '../lib/api.ts';
import type { StationItem } from '../types/rail.ts';
import { AlertTriangle, CheckCircle2, Layers, Sliders } from 'lucide-react';

interface PlatformOccupancyItem {
  schedule_id: number;
  train_id: number;
  train_no: string;
  name: string;
  category: string;
  direction: string;
  length_m: number;
  arrival: number;
  departure: number;
  used_loop: number;
  length_ok: boolean;
}

interface PlatformLayoutEntry {
  platform: { id: number; number: string; length_m: number; electrified: number; status: string };
  occupancies: PlatformOccupancyItem[];
  clash_count: number;
}

export function PlatformAllocationPage({ refreshTick }: { refreshTick: number }) {
  const [stations, setStations] = useState<StationItem[]>([]);
  const [stationId, setStationId] = useState<number>(5);
  const [kind, setKind] = useState<'OPTIMIZED' | 'ORIGINAL'>('OPTIMIZED');
  const [layout, setLayout] = useState<PlatformLayoutEntry[]>([]);
  const [selectedStation, setSelectedStation] = useState<StationItem | null>(null);
  const [allocMsg, setAllocMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLayout = async (sid = stationId, k = kind) => {
    setError(null);
    try {
      const res = await apiFetch<{ station: StationItem; layout: PlatformLayoutEntry[] }>(`/platforms/${sid}/layout?kind=${k}`);
      setSelectedStation(res.station);
      setLayout(res.layout);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load platform layout');
    }
  };

  useEffect(() => {
    apiFetch<StationItem[]>('/stations')
      .then((stns) => {
        setStations(stns);
        const def = stns.find((s) => s.code === 'DD') ?? stns[0];
        if (def) {
          setStationId(def.id);
          loadLayout(def.id, kind);
        }
      })
      .catch(() => {});
  }, [refreshTick]);

  useEffect(() => {
    if (stationId) loadLayout(stationId, kind);
  }, [stationId, kind]);

  const handleAutoAllocate = async () => {
    setError(null);
    setAllocMsg(null);
    try {
      const out = await apiFetch<{ reassigned_count: number }>('/platforms/allocate', {
        method: 'POST',
        body: JSON.stringify({ station_id: stationId }),
      });
      setAllocMsg(`Auto-allocated ${out.reassigned_count} train stops at ${selectedStation?.code ?? 'station'} with length & clash rules.`);
      await loadLayout(stationId, kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Allocation failed');
    }
  };

  const handleOverride = async (scheduleId: number, newPlatformId: number) => {
    setError(null);
    try {
      const out = await apiFetch<{ platform_number: string }>('/platforms/override', {
        method: 'POST',
        body: JSON.stringify({ schedule_id: scheduleId, platform_id: newPlatformId }),
      });
      setAllocMsg(`Manually reassigned schedule #${scheduleId} to ${out.platform_number}.`);
      await loadLayout(stationId, kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Override failed');
    }
  };

  const windowStart = 360;
  const windowSpan = 360;
  const totalClashes = layout.reduce((acc, l) => acc + l.clash_count, 0);
  const allOccs = layout.flatMap((l) => l.occupancies.map((o) => ({ ...o, platform: l.platform })));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Smart Platform & Loop-Line Allocation</h2>
          <p className="text-xs text-slate-400">
            Visual platform occupancy Gantt (06:00–12:00), rake-length enforcement, and controller manual override.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={stationId}
            onChange={(e) => setStationId(Number(e.target.value))}
            className="rounded-lg bg-[#102442] border border-slate-700 px-3 py-1.5 text-xs text-slate-100"
          >
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name} ({s.num_platforms} PF{s.has_loop ? ' + Loop' : ''})
              </option>
            ))}
          </select>

          <div className="inline-flex rounded-lg bg-[#102442] border border-slate-700 p-0.5 text-xs">
            {(['OPTIMIZED', 'ORIGINAL'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`px-2.5 py-1 rounded-md font-medium ${kind === k ? 'bg-sky-600 text-white' : 'text-slate-300 hover:text-white'}`}
              >
                {k === 'OPTIMIZED' ? 'Optimized' : 'Original'}
              </button>
            ))}
          </div>

          <button
            onClick={handleAutoAllocate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
          >
            <Sliders className="w-3.5 h-3.5" /> Auto-Allocate Platforms
          </button>
        </div>
      </div>

      {allocMsg && <div className="rounded-lg bg-emerald-950/40 border border-emerald-500/40 px-4 py-2 text-xs text-emerald-200">{allocMsg}</div>}
      {error && <div className="rounded-lg bg-rose-950/40 border border-rose-500/40 px-4 py-2 text-xs text-rose-200">{error}</div>}

      {/* Station Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-3.5">
          <div className="text-slate-400">Selected Station</div>
          <div className="text-base font-semibold text-slate-100 mt-1">
            {selectedStation ? `${selectedStation.code} · ${selectedStation.name}` : '—'}
          </div>
        </div>
        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-3.5">
          <div className="text-slate-400">Platforms / Loop Lines</div>
          <div className="text-base font-semibold font-mono tabular-nums text-slate-100 mt-1">
            {layout.length} PF · {selectedStation?.loop_count ?? 0} Loops
          </div>
        </div>
        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-3.5">
          <div className="text-slate-400">Assigned Movements</div>
          <div className="text-base font-semibold font-mono tabular-nums text-slate-100 mt-1">{allOccs.length}</div>
        </div>
        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-3.5">
          <div className="text-slate-400">Platform Clashes</div>
          <div className={`text-base font-semibold font-mono tabular-nums mt-1 flex items-center gap-1.5 ${totalClashes === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalClashes === 0 ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {totalClashes} clashes
          </div>
        </div>
      </div>

      {/* Platform Gantt Timeline */}
      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Layers className="w-4 h-4 text-sky-400" /> Platform Occupancy Timeline (06:00 – 12:00)
          </h3>
          <div className="flex items-center gap-4 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-sky-500 inline-block" /> Express / Superfast</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" /> Goods / Freight</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" /> Length Warning</span>
          </div>
        </div>

        {/* Hour Grid Header */}
        <div className="pl-32 pr-2 grid grid-cols-6 text-[11px] font-mono text-slate-400 border-b border-slate-700/60 pb-1">
          {[6, 7, 8, 9, 10, 11].map((h) => (
            <div key={h}>{String(h).padStart(2, '0')}:00</div>
          ))}
        </div>

        <div className="space-y-3">
          {layout.map((entry) => (
            <div key={entry.platform.id} className="flex items-center gap-3">
              <div className="w-28 shrink-0 text-xs">
                <div className="font-mono font-semibold text-slate-100">{entry.platform.number}</div>
                <div className="text-[11px] text-slate-400 font-mono">{entry.platform.length_m}m · {entry.platform.status}</div>
              </div>
              <div className="flex-1 h-10 rounded bg-[#0B1B33] border border-slate-700/60 relative overflow-hidden">
                {entry.occupancies.map((occ) => {
                  const leftPct = Math.max(0, Math.min(98, ((occ.arrival - windowStart) / windowSpan) * 100));
                  const widthPct = Math.max(1.8, Math.min(100 - leftPct, ((occ.departure - occ.arrival) / windowSpan) * 100));
                  const color = !occ.length_ok
                    ? 'bg-rose-500/85 border-rose-300'
                    : occ.category === 'GOODS'
                      ? 'bg-amber-500/80 border-amber-300'
                      : 'bg-sky-500/80 border-sky-300';
                  return (
                    <div
                      key={occ.schedule_id}
                      title={`${occ.train_no} (${occ.name}) | ${formatTimeMin(occ.arrival)}–${formatTimeMin(occ.departure)} | Len ${occ.length_m}m / PF ${entry.platform.length_m}m`}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className={`absolute top-1.5 bottom-1.5 rounded border ${color} px-1 flex items-center overflow-hidden text-[10px] font-mono text-white font-semibold`}
                    >
                      <span className="truncate">{occ.train_no}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Override Table */}
      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">Station Stop Assignments & Controller Manual Override</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700/60">
                <th className="py-2 text-left font-medium">Train</th>
                <th className="py-2 text-left font-medium">Category</th>
                <th className="py-2 text-left font-medium">Arrival</th>
                <th className="py-2 text-left font-medium">Departure</th>
                <th className="py-2 text-right font-medium">Rake Length</th>
                <th className="py-2 text-left font-medium">Fit Check</th>
                <th className="py-2 text-left font-medium">Assigned Platform</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {allOccs
                .sort((a, b) => a.arrival - b.arrival)
                .map((occ) => (
                  <tr key={occ.schedule_id} className="hover:bg-[#162F54]/50">
                    <td className="py-2 font-mono font-semibold text-slate-100">
                      {occ.train_no} <span className="font-sans font-normal text-slate-400">· {occ.name}</span>
                    </td>
                    <td className="py-2 font-mono text-slate-300">{occ.category}</td>
                    <td className="py-2 font-mono tabular-nums text-slate-200">{formatTimeMin(occ.arrival)}</td>
                    <td className="py-2 font-mono tabular-nums text-slate-200">{formatTimeMin(occ.departure)}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-slate-300">{occ.length_m}m</td>
                    <td className="py-2">
                      {occ.length_ok ? (
                        <span className="text-emerald-400 font-medium">Fits ({occ.platform.length_m}m)</span>
                      ) : (
                        <span className="text-rose-400 font-medium">Exceeds PF ({occ.platform.length_m}m)</span>
                      )}
                    </td>
                    <td className="py-2">
                      <select
                        value={occ.platform.id}
                        onChange={(e) => handleOverride(occ.schedule_id, Number(e.target.value))}
                        className="rounded bg-[#0B1B33] border border-slate-700 px-2 py-1 text-xs font-mono text-slate-100"
                      >
                        {layout.map((l) => (
                          <option key={l.platform.id} value={l.platform.id}>
                            {l.platform.number} ({l.platform.length_m}m)
                          </option>
                        ))}
                      </select>
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
