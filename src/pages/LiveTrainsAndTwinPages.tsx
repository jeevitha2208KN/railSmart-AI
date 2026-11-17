import { useEffect, useState } from 'react';
import { CorridorMap } from '../components/CorridorMap.tsx';
import { KpiCard } from '../components/KpiCard.tsx';
import { apiFetch, exportRowsToCsv, formatTimeMin } from '../lib/api.ts';
import type { KpiSummary, SectionItem, StationItem, TrainItem } from '../types/rail.ts';
import { Download, Pause, Play, RotateCcw, Search } from 'lucide-react';

export function LiveTrainsPage({ refreshTick }: { refreshTick: number }) {
  const [trains, setTrains] = useState<TrainItem[]>([]);
  const [network, setNetwork] = useState<{ stations: StationItem[]; sections: SectionItem[] }>({ stations: [], sections: [] });
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{
    route: Array<{ seq: number; station_code: string; station_name: string; km: number; sch_arrival: number; sch_departure: number; platform_number: string | null }>;
    why: { factors: string[] } | null;
  } | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<TrainItem[]>('/trains?active_only=true'),
      apiFetch<{ stations: StationItem[]; sections: SectionItem[] }>('/network/graph'),
    ]).then(([t, n]) => {
      setTrains(t);
      setNetwork(n);
      if (!selectedId && t.length > 0) setSelectedId(t[0].id);
    });
  }, [refreshTick]);

  useEffect(() => {
    if (!selectedId) return;
    Promise.all([
      apiFetch<Array<{ seq: number; station_code: string; station_name: string; km: number; sch_arrival: number; sch_departure: number; platform_number: string | null }>>(`/trains/${selectedId}/route`),
      apiFetch<{ factors: string[] }>(`/trains/${selectedId}/why-delayed`),
    ]).then(([route, why]) => setDetail({ route, why }));
  }, [selectedId]);

  const filtered = trains.filter((t) => {
    if (cat !== 'ALL' && t.category !== cat) return false;
    if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
    if (search && !`${t.train_no} ${t.name}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const selectedTrain = trains.find((t) => t.id === selectedId);

  return (
    <div className="space-y-5">
      <CorridorMap stations={network.stations} sections={network.sections} trains={trains} onSelectTrain={setSelectedId} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter train number or name..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-[#0B1B33] border border-slate-700 text-slate-200"
              />
            </div>
            <div className="flex items-center gap-2">
              <select value={cat} onChange={(e) => setCat(e.target.value)} className="px-2.5 py-1.5 text-xs rounded-md bg-[#0B1B33] border border-slate-700 text-slate-200">
                <option value="ALL">All Categories</option>
                <option value="SUPERFAST">Superfast</option>
                <option value="EXPRESS">Express</option>
                <option value="PASSENGER">Passenger</option>
                <option value="GOODS">Goods</option>
                <option value="EMERGENCY">Emergency</option>
                <option value="SPECIAL">Special</option>
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2.5 py-1.5 text-xs rounded-md bg-[#0B1B33] border border-slate-700 text-slate-200">
                <option value="ALL">All Statuses</option>
                <option value="RUNNING">RUNNING</option>
                <option value="DELAYED">DELAYED</option>
                <option value="SCHEDULED">SCHEDULED</option>
                <option value="COMPLETED">COMPLETED</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[420px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#102442] border-b border-slate-800 text-slate-400 text-left">
                <tr>
                  <th className="py-2 pr-2">Train</th>
                  <th className="py-2 px-2">Category</th>
                  <th className="py-2 px-2">Dir</th>
                  <th className="py-2 px-2">Route</th>
                  <th className="py-2 px-2 font-mono">Sch Dep</th>
                  <th className="py-2 px-2 font-mono">Sch Arr</th>
                  <th className="py-2 pl-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={`border-b border-slate-800/60 cursor-pointer hover:bg-slate-800/40 ${selectedId === t.id ? 'bg-cyan-500/10' : ''}`}
                  >
                    <td className="py-2 pr-2 font-mono font-medium text-slate-100">{t.train_no} · {t.name}</td>
                    <td className="py-2 px-2 text-slate-300">{t.category} (P{t.priority})</td>
                    <td className="py-2 px-2 font-mono text-slate-300">{t.direction}</td>
                    <td className="py-2 px-2 font-mono text-slate-400">{t.origin_code} → {t.destination_code}</td>
                    <td className="py-2 px-2 font-mono tabular-nums">{formatTimeMin(t.sch_departure)}</td>
                    <td className="py-2 px-2 font-mono tabular-nums">{formatTimeMin(t.sch_arrival)}</td>
                    <td className={`py-2 pl-2 font-mono font-medium ${t.status === 'DELAYED' ? 'text-rose-400' : t.status === 'RUNNING' ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {t.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Train Drawer + Why Delayed */}
        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-4">
          {selectedTrain && detail ? (
            <>
              <div>
                <div className="text-xs text-cyan-400 font-mono">{selectedTrain.train_no} · SIMULATED GPS ({selectedTrain.lat.toFixed(3)}, {selectedTrain.lon.toFixed(3)})</div>
                <h3 className="text-base font-semibold text-slate-100">{selectedTrain.name}</h3>
                <p className="text-xs text-slate-400">
                  {selectedTrain.category} · Priority {selectedTrain.priority} · Length {selectedTrain.length_m}m · Max {selectedTrain.max_speed_kmph} km/h
                </p>
              </div>

              <div className="rounded bg-[#0B1B33] border border-slate-800 p-3 space-y-1.5">
                <div className="text-xs font-semibold text-amber-300">Why Is This Train Delayed / Held?</div>
                {detail.why?.factors.map((f, idx) => (
                  <p key={idx} className="text-xs text-slate-300">{f}</p>
                ))}
              </div>

              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-left">
                      <th className="py-1">Stn</th>
                      <th className="py-1 font-mono">Arr</th>
                      <th className="py-1 font-mono">Dep</th>
                      <th className="py-1 font-mono">PF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.route.map((r) => (
                      <tr key={r.seq} className="border-b border-slate-800/40">
                        <td className="py-1 font-mono text-slate-200">{r.station_code}</td>
                        <td className="py-1 font-mono text-slate-400">{formatTimeMin(r.sch_arrival)}</td>
                        <td className="py-1 font-mono text-slate-300">{formatTimeMin(r.sch_departure)}</td>
                        <td className="py-1 font-mono text-slate-400">{r.platform_number ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-400">Select any train row or map marker to inspect route & delay diagnostics.</div>
          )}
        </div>
      </div>
    </div>
  );
}

interface SimComparePayload {
  seed: number;
  original: { kpis: KpiSummary; events: Array<{ sim_time: number; train_no: string; event: string; detail: string }> };
  optimized: { kpis: KpiSummary; events: Array<{ sim_time: number; train_no: string; event: string; detail: string }> };
}

export function DigitalTwinPage() {
  const [trains, setTrains] = useState<TrainItem[]>([]);
  const [sections, setSections] = useState<SectionItem[]>([]);
  const [seed, setSeed] = useState(42);
  const [speed, setSpeed] = useState(20);
  const [playing, setPlaying] = useState(false);
  const [cursorTime, setCursorTime] = useState(450);
  const [injectTrainId, setInjectTrainId] = useState<number | ''>('');
  const [injectDelayMin, setInjectDelayMin] = useState(20);
  const [blockSecId, setBlockSecId] = useState<number | ''>('');
  const [weatherFactor, setWeatherFactor] = useState(1.0);
  const [result, setResult] = useState<SimComparePayload | null>(null);
  const [running, setRunning] = useState(false);

  const runComparison = async () => {
    setRunning(true);
    try {
      const injected_delays = injectTrainId ? { [Number(injectTrainId)]: injectDelayMin } : undefined;
      const blocked_section_ids = blockSecId ? [Number(blockSecId)] : undefined;
      const data = await apiFetch<SimComparePayload>('/sim/compare', {
        method: 'POST',
        body: JSON.stringify({ seed, injected_delays, blocked_section_ids, weather_speed_factor: weatherFactor }),
      });
      setResult(data);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    Promise.all([apiFetch<TrainItem[]>('/trains?active_only=true'), apiFetch<SectionItem[]>('/sections')]).then(([t, s]) => {
      setTrains(t);
      setSections(s);
    });
    runComparison();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setCursorTime((prev) => (prev >= 760 ? 360 : prev + Math.max(1, Math.round(speed / 10))));
    }, 250);
    return () => clearInterval(id);
  }, [playing, speed]);

  const orig = result?.original.kpis;
  const opt = result?.optimized.kpis;
  const visibleEvents = (result?.optimized.events ?? []).filter((e) => e.sim_time <= cursorTime).slice(-35).reverse();

  return (
    <div className="space-y-5">
      {/* Controls Bar */}
      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-cyan-500 text-slate-950 text-xs font-semibold hover:bg-cyan-400"
            >
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {playing ? 'Pause Playback' : 'Play Twin'}
            </button>
            <button
              onClick={() => {
                setPlaying(false);
                setCursorTime(360);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:bg-slate-700"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="px-2.5 py-1.5 rounded-md bg-[#0B1B33] border border-slate-700 text-xs font-mono text-slate-200">
              <option value={1}>Speed x1</option>
              <option value={10}>Speed x10</option>
              <option value={20}>Speed x20</option>
              <option value={50}>Speed x50</option>
              <option value={100}>Speed x100</option>
            </select>
            <span className="text-xs font-mono text-cyan-300 px-2">Sim Clock: {formatTimeMin(cursorTime)}</span>
          </div>

          <button
            onClick={runComparison}
            disabled={running}
            className="px-3 py-1.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs font-medium hover:bg-emerald-500/30"
          >
            {running ? 'Simulating...' : 'Run Deterministic Comparison (Seed ' + seed + ')'}
          </button>
        </div>

        <input
          type="range"
          min={360}
          max={760}
          value={cursorTime}
          onChange={(e) => setCursorTime(Number(e.target.value))}
          className="w-full accent-cyan-400"
        />

        {/* Shock injectors */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-slate-800 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">Inject Train Delay</label>
            <select value={injectTrainId} onChange={(e) => setInjectTrainId(e.target.value ? Number(e.target.value) : '')} className="w-full px-2.5 py-1.5 rounded bg-[#0B1B33] border border-slate-700 text-slate-200">
              <option value="">None (Baseline)</option>
              {trains.map((t) => (
                <option key={t.id} value={t.id}>{t.train_no} · {t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Delay Shock (min)</label>
            <input type="number" min={0} max={60} value={injectDelayMin} onChange={(e) => setInjectDelayMin(Number(e.target.value))} className="w-full px-2.5 py-1.5 rounded bg-[#0B1B33] border border-slate-700 font-mono text-slate-200" />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Block Section</label>
            <select value={blockSecId} onChange={(e) => setBlockSecId(e.target.value ? Number(e.target.value) : '')} className="w-full px-2.5 py-1.5 rounded bg-[#0B1B33] border border-slate-700 text-slate-200">
              <option value="">All Open</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{s.code} ({s.track_type})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Weather Speed Factor</label>
            <select value={weatherFactor} onChange={(e) => setWeatherFactor(Number(e.target.value))} className="w-full px-2.5 py-1.5 rounded bg-[#0B1B33] border border-slate-700 font-mono text-slate-200">
              <option value={1.0}>Clear (1.0x)</option>
              <option value={0.82}>Moderate Rain (0.82x)</option>
              <option value={0.62}>Dense Fog (0.62x)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Original vs Optimized Twin KPI Comparison */}
      {orig && opt && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Sim Total Delay (Opt vs Orig)" value={opt.total_delay_min} unit="min" subtext={`Orig Sim: ${orig.total_delay_min} min`} delta={opt.total_delay_min - orig.total_delay_min} higherIsBetter={false} tone="positive" />
          <KpiCard label="Sim Unplanned Conflicts" value={opt.conflict_count} unit="events" subtext={`Orig Sim: ${orig.conflict_count} holds`} delta={opt.conflict_count - orig.conflict_count} higherIsBetter={false} tone={opt.conflict_count === 0 ? 'positive' : 'warning'} />
          <KpiCard label="Sim Throughput" value={opt.throughput_per_hour} unit="tr/hr" subtext={`Orig Sim: ${orig.throughput_per_hour} tr/hr`} delta={Math.round((opt.throughput_per_hour - orig.throughput_per_hour) * 100) / 100} higherIsBetter={true} />
          <KpiCard label="Deterministic Seed" value={seed} subtext="Identical RNG parity across runs" />
        </div>
      )}

      {/* Event Stream */}
      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-100">Discrete-Event Simulation Log (up to {formatTimeMin(cursorTime)})</h3>
          <button
            onClick={() => result && exportRowsToCsv('sim_events.csv', result.optimized.events)}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
          >
            <Download className="w-3.5 h-3.5" /> Export Log
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto space-y-1.5 font-mono text-xs">
          {visibleEvents.map((ev, i) => (
            <div key={i} className="flex items-start gap-3 py-1 border-b border-slate-800/50">
              <span className="text-cyan-400 w-12 shrink-0">{formatTimeMin(ev.sim_time)}</span>
              <span className={`w-32 shrink-0 ${ev.event === 'HELD_CONFLICT' ? 'text-amber-300' : ev.event === 'ARRIVED_DEST' ? 'text-emerald-300' : 'text-slate-300'}`}>
                {ev.event}
              </span>
              <span className="text-slate-200">{ev.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
