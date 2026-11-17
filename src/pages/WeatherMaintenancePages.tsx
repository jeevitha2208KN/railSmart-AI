import { useEffect, useState } from 'react';
import { apiFetch, formatTimeMin } from '../lib/api.ts';
import type { SectionItem } from '../types/rail.ts';
import { KpiCard } from '../components/KpiCard.tsx';
import { AlertTriangle, CloudRain, ShieldAlert, Wrench, XCircle } from 'lucide-react';

interface WeatherEventRow {
  id: number;
  type: string;
  severity: number;
  speed_factor: number;
  headway_bonus_min: number;
  source: string;
  active: number;
  created_at: string;
}

interface DisruptionRow {
  id: number;
  type: string;
  section_id: number | null;
  section_code: string | null;
  start_min: number;
  end_min: number;
  speed_limit_kmph: number | null;
  description: string;
  active: number;
}

export function WeatherDisruptionsPage({
  refreshTick,
  onMutated,
}: {
  refreshTick: number;
  onMutated: () => void;
}) {
  const [weatherList, setWeatherList] = useState<WeatherEventRow[]>([]);
  const [liveWeather, setLiveWeather] = useState<{
    source: string;
    temperature_c: number;
    windspeed_kmph: number;
    precipitation_mm: number;
    mapped_type: string;
    mapped_severity: number;
  } | null>(null);
  const [disruptions, setDisruptions] = useState<DisruptionRow[]>([]);
  const [sections, setSections] = useState<SectionItem[]>([]);

  const [wType, setWType] = useState('FOG');
  const [wSeverity, setWSeverity] = useState(3);
  const [dType, setDType] = useState('TSR');
  const [dSectionId, setDSectionId] = useState<number>(4);
  const [dSpeed, setDSpeed] = useState(45);
  const [dDesc, setDDesc] = useState('Temporary Speed Restriction for rail stress inspection');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadData = async () => {
    const [w, d, s] = await Promise.all([
      apiFetch<WeatherEventRow[]>('/weather'),
      apiFetch<DisruptionRow[]>('/disruptions'),
      apiFetch<SectionItem[]>('/sections'),
    ]);
    setWeatherList(w);
    setDisruptions(d);
    setSections(s);
    if (s.length > 0 && !s.some((x) => x.id === dSectionId)) setDSectionId(s[0].id);
  };

  useEffect(() => {
    loadData().catch(() => {});
  }, [refreshTick]);

  const fetchLiveOpenMeteo = async () => {
    setBusy(true);
    try {
      const live = await apiFetch<typeof liveWeather>('/weather/live');
      setLiveWeather(live);
      if (live) {
        setWType(live.mapped_type);
        setWSeverity(live.mapped_severity);
      }
    } finally {
      setBusy(false);
    }
  };

  const applyWeather = async (type = wType, sev = wSeverity, source = 'SIMULATED') => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch<{ weather: { type: string; speed_factor: number; headway_bonus_min: number }; optimization?: { optimized_kpis: { total_delay_min: number } } }>('/weather', {
        method: 'POST',
        body: JSON.stringify({ type, severity: sev, source, reoptimize: true }),
      });
      setMsg(
        `Applied ${res.weather.type} (speed x${res.weather.speed_factor}, +${res.weather.headway_bonus_min}m headway) and re-optimized timetable (total delay: ${res.optimization?.optimized_kpis.total_delay_min ?? '—'}m).`
      );
      await loadData();
      onMutated();
    } finally {
      setBusy(false);
    }
  };

  const createDisruption = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch('/disruptions', {
        method: 'POST',
        body: JSON.stringify({
          type: dType,
          section_id: dSectionId,
          start_min: 430,
          end_min: 495,
          speed_limit_kmph: dType === 'SECTION_BLOCK' ? 0 : dSpeed,
          description: dDesc,
          reoptimize: true,
        }),
      });
      setMsg(`Injected ${dType} disruption and re-optimized corridor schedule.`);
      await loadData();
      onMutated();
    } finally {
      setBusy(false);
    }
  };

  const clearDisruption = async (id: number) => {
    setBusy(true);
    try {
      await apiFetch(`/disruptions/${id}`, { method: 'DELETE' });
      setMsg(`Cleared disruption #${id} and re-optimized schedule.`);
      await loadData();
      onMutated();
    } finally {
      setBusy(false);
    }
  };

  const activeWeather = weatherList.find((w) => w.active === 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Weather Protocols & Live Disruption Recovery</h2>
          <p className="text-xs text-slate-400">
            Ingest real Open-Meteo corridor weather or simulate Fog/Storm/TSR/Signal Failure with instant constraint re-optimization.
          </p>
        </div>
        <button
          onClick={fetchLiveOpenMeteo}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#162F54] hover:bg-[#1E3D6B] border border-slate-600/60 text-xs font-medium text-slate-100"
        >
          <CloudRain className="w-3.5 h-3.5 text-sky-400" /> Fetch Live Open-Meteo (Daund Junction)
        </button>
      </div>

      {msg && <div className="rounded-lg bg-sky-950/50 border border-sky-500/40 px-4 py-2.5 text-xs text-sky-200">{msg}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          label="Active Weather Protocol"
          value={activeWeather?.type ?? 'CLEAR'}
          subtext={activeWeather ? `Severity ${activeWeather.severity} · Source: ${activeWeather.source}` : 'Nominal visibility'}
          tone={activeWeather && activeWeather.type !== 'CLEAR' ? 'warning' : 'positive'}
        />
        <KpiCard
          label="Speed / Headway Derating"
          value={`x${activeWeather?.speed_factor ?? 1.0}`}
          subtext={`+${activeWeather?.headway_bonus_min ?? 0} min headway safety buffer`}
        />
        <KpiCard
          label="Active Disruptions & TSRs"
          value={disruptions.filter((d) => d.active === 1).length}
          subtext="Blocks, TSRs & equipment faults"
          tone={disruptions.some((d) => d.active === 1) ? 'critical' : 'positive'}
        />
      </div>

      {liveWeather && (
        <div className="rounded-lg bg-[#102442] border border-sky-500/40 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="space-y-0.5">
            <div className="font-semibold text-slate-100">
              Open-Meteo Reading ({liveWeather.source})
            </div>
            <div className="text-slate-300 font-mono tabular-nums">
              Temp: {liveWeather.temperature_c}°C · Wind: {liveWeather.windspeed_kmph} km/h · Precip: {liveWeather.precipitation_mm} mm · Mapped: {liveWeather.mapped_type} (Sev {liveWeather.mapped_severity})
            </div>
          </div>
          <button
            onClick={() => applyWeather(liveWeather.mapped_type, liveWeather.mapped_severity, liveWeather.source)}
            className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 font-semibold text-white"
          >
            Apply Live Weather & Re-Optimize
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-slate-100">Weather Stress Injector</h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-slate-400 block">Condition</span>
              <select value={wType} onChange={(e) => setWType(e.target.value)} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-2 text-slate-100">
                <option value="CLEAR">CLEAR (Normal 100%)</option>
                <option value="FOG">FOG (Reduced Sight / Headway +2-3m)</option>
                <option value="RAIN">MONSOON RAIN</option>
                <option value="STORM">CYCLONIC STORM</option>
                <option value="HEAT">EXTREME HEAT (Track Buckling Caution)</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-slate-400 block">Severity (1–5)</span>
              <input
                type="number"
                min={1}
                max={5}
                value={wSeverity}
                onChange={(e) => setWSeverity(Number(e.target.value))}
                className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-2 text-slate-100 font-mono"
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => applyWeather()} disabled={busy} className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white">
              Apply Weather & Re-Optimize
            </button>
            <button onClick={() => applyWeather('CLEAR', 1, 'CONTROLLER_RESET')} disabled={busy} className="px-3.5 py-2 rounded-lg bg-[#162F54] hover:bg-[#1E3D6B] text-xs font-medium text-slate-200">
              Restore CLEAR Weather
            </button>
          </div>
        </div>

        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400" /> Inject Block / TSR / Fault
          </h3>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-slate-400 block">Type</span>
              <select value={dType} onChange={(e) => setDType(e.target.value)} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2 py-2 text-slate-100">
                <option value="TSR">TSR (Speed Restriction)</option>
                <option value="SECTION_BLOCK">SECTION_BLOCK (Line Closed)</option>
                <option value="SIGNAL_FAULT">SIGNAL_FAULT</option>
                <option value="TRACTION_POWER">OHE POWER OUTAGE</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-slate-400 block">Section</span>
              <select value={dSectionId} onChange={(e) => setDSectionId(Number(e.target.value))} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2 py-2 text-slate-100">
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} ({s.track_type})
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-slate-400 block">Speed Limit (km/h)</span>
              <input type="number" min={15} max={100} value={dSpeed} onChange={(e) => setDSpeed(Number(e.target.value))} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2 py-2 text-slate-100 font-mono" />
            </label>
          </div>
          <input
            type="text"
            value={dDesc}
            onChange={(e) => setDDesc(e.target.value)}
            className="w-full rounded bg-[#0B1B33] border border-slate-700 px-3 py-2 text-xs text-slate-100"
          />
          <button onClick={createDisruption} disabled={busy} className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white">
            Inject Disruption & Auto Re-Optimize
          </button>
        </div>
      </div>

      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">Disruption & TSR Log</h3>
        {disruptions.length === 0 ? (
          <div className="text-xs text-slate-400">No active or historical disruptions logged.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700/60">
                <th className="py-2 text-left">Type</th>
                <th className="py-2 text-left">Section</th>
                <th className="py-2 text-left">Window</th>
                <th className="py-2 text-left">Description</th>
                <th className="py-2 text-left">Status</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {disruptions.map((d) => (
                <tr key={d.id}>
                  <td className="py-2 font-mono font-semibold text-slate-100">{d.type}</td>
                  <td className="py-2 font-mono text-slate-300">{d.section_code ?? 'CORRIDOR'}</td>
                  <td className="py-2 font-mono tabular-nums text-slate-300">
                    {formatTimeMin(d.start_min)}–{formatTimeMin(d.end_min)}
                  </td>
                  <td className="py-2 text-slate-300">{d.description}</td>
                  <td className="py-2 font-mono">{d.active ? <span className="text-rose-400">ACTIVE</span> : <span className="text-slate-500">CLEARED</span>}</td>
                  <td className="py-2 text-right">
                    {d.active === 1 && (
                      <button
                        onClick={() => clearDisruption(d.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#162F54] hover:bg-[#1E3D6B] text-slate-200"
                      >
                        <XCircle className="w-3 h-3" /> Clear & Replan
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

interface SectionHealthItem {
  section_id: number;
  section_code: string;
  track_type: string;
  health_score: number;
  anomaly_score: number;
  is_anomaly: boolean;
  latest_vibration: number;
  latest_temperature: number;
  latest_strain: number;
  latest_gauge_dev: number;
  recommended_window: { start_min: number; end_min: number; trains_impacted: number };
  recommended_action: string;
  is_simulated: boolean;
}

interface MaintOrder {
  id: number;
  section_code: string;
  priority: string;
  status: string;
  due_date: string;
  window_start_min: number | null;
  window_end_min: number | null;
  note: string;
}

export function MaintenancePage({ refreshTick }: { refreshTick: number }) {
  const [data, setData] = useState<{ sections: SectionHealthItem[]; anomalies: SectionHealthItem[]; orders: MaintOrder[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    apiFetch<typeof data>('/maintenance/health').then(setData).catch(() => {});
  };

  useEffect(() => {
    load();
  }, [refreshTick]);

  const scheduleOrder = async (s: SectionHealthItem) => {
    await apiFetch('/maintenance/orders', {
      method: 'POST',
      body: JSON.stringify({
        section_id: s.section_id,
        priority: s.health_score < 60 ? 'CRITICAL' : 'HIGH',
        due_date: '2026-11-18',
        window_start_min: s.recommended_window.start_min,
        window_end_min: s.recommended_window.end_min,
        note: s.recommended_action,
      }),
    });
    setMsg(`Scheduled maintenance order for ${s.section_code} in ${formatTimeMin(s.recommended_window.start_min)}–${formatTimeMin(s.recommended_window.end_min)} low-traffic window.`);
    load();
  };

  if (!data) return <div className="text-xs text-slate-400">Analyzing track sensor telemetry...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Predictive Track Maintenance & Anomaly Detection</h2>
        <p className="text-xs text-slate-400">
          Multi-dimensional rolling z-score anomaly detector on simulated wayside track sensors (SIMULATED DATA). Schedules inspections in lowest-traffic windows.
        </p>
      </div>

      {msg && <div className="rounded-lg bg-emerald-950/40 border border-emerald-500/40 px-4 py-2 text-xs text-emerald-200">{msg}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="Monitored Track Sections" value={data.sections.length} subtext="48h synthetic sensor stream" />
        <KpiCard label="Detected Sensor Anomalies" value={data.anomalies.length} tone={data.anomalies.length > 0 ? 'warning' : 'positive'} subtext="Vibration / Strain / Gauge spikes" />
        <KpiCard label="Scheduled Work Orders" value={data.orders.length} subtext="Low-traffic 30m windows" />
      </div>

      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Section Health Matrix & Optimal Maintenance Slots</h3>
          <span className="text-[11px] font-mono text-amber-300">SIMULATED WAYSIDE TELEMETRY</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700/60">
                <th className="py-2 text-left">Section</th>
                <th className="py-2 text-right">Health Score</th>
                <th className="py-2 text-right">Vibration (mm/s)</th>
                <th className="py-2 text-right">Rail Temp (°C)</th>
                <th className="py-2 text-right">Gauge Dev (mm)</th>
                <th className="py-2 text-left">Best 30m Slot</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {data.sections.map((s) => (
                <tr key={s.section_id} className={s.is_anomaly ? 'bg-amber-950/20' : ''}>
                  <td className="py-2.5 font-mono font-semibold text-slate-100">
                    <span className="inline-flex items-center gap-1.5">
                      {s.is_anomaly && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                      {s.section_code}
                    </span>
                    <div className="text-[10px] font-normal text-slate-400">{s.track_type}</div>
                  </td>
                  <td className="py-2.5 text-right font-mono tabular-nums font-semibold">
                    <span className={s.health_score < 60 ? 'text-rose-400' : s.health_score < 80 ? 'text-amber-400' : 'text-emerald-400'}>
                      {s.health_score}/100
                    </span>
                  </td>
                  <td className="py-2.5 text-right font-mono tabular-nums text-slate-200">{s.latest_vibration}</td>
                  <td className="py-2.5 text-right font-mono tabular-nums text-slate-200">{s.latest_temperature}</td>
                  <td className="py-2.5 text-right font-mono tabular-nums text-slate-200">{s.latest_gauge_dev}</td>
                  <td className="py-2.5 font-mono text-slate-300">
                    {formatTimeMin(s.recommended_window.start_min)}–{formatTimeMin(s.recommended_window.end_min)} ({s.recommended_window.trains_impacted} trains)
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => scheduleOrder(s)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#162F54] hover:bg-[#1E3D6B] text-slate-100 font-medium"
                    >
                      <Wrench className="w-3 h-3" /> Schedule Block
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.orders.length > 0 && (
        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-2">
          <h3 className="text-sm font-semibold text-slate-100">Scheduled Maintenance Work Orders</h3>
          <div className="space-y-2">
            {data.orders.map((o) => (
              <div key={o.id} className="rounded bg-[#0B1B33] border border-slate-700/60 px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-mono font-semibold text-sky-300">{o.section_code}</span> · <span className="text-amber-300 font-mono">{o.priority}</span> · {o.note}
                </div>
                <span className="font-mono text-slate-400">
                  {o.window_start_min ? `${formatTimeMin(o.window_start_min)}–${formatTimeMin(o.window_end_min ?? o.window_start_min + 30)}` : o.due_date} · {o.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
