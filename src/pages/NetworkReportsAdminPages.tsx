import { useEffect, useState } from 'react';
import { apiFetch, exportRowsToCsv, exportRowsToExcel, generatePdfReport } from '../lib/api.ts';
import type { KpiSummary, RecommendationItem, SectionItem, StationItem, TrainItem } from '../types/rail.ts';
import { CorridorMap } from '../components/CorridorMap.tsx';
import { CheckCircle2, Database, FileSpreadsheet, FileText, Network, Plus, RotateCcw, Shield, Wrench } from 'lucide-react';

// --- MODULE 2: NETWORK MANAGEMENT ---
export function NetworkPage({ refreshTick, onMutated }: { refreshTick: number; onMutated: () => void }) {
  const [stations, setStations] = useState<StationItem[]>([]);
  const [sections, setSections] = useState<SectionItem[]>([]);
  const [trains, setTrains] = useState<TrainItem[]>([]);
  const [validation, setValidation] = useState<{ valid: boolean; issues: string[] } | null>(null);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newKm, setNewKm] = useState(145);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const [st, sec, tr] = await Promise.all([
      apiFetch<StationItem[]>('/stations'),
      apiFetch<SectionItem[]>('/sections'),
      apiFetch<TrainItem[]>('/trains?active_only=true'),
    ]);
    setStations(st);
    setSections(sec);
    setTrains(tr);
  };

  useEffect(() => {
    load().catch(() => {});
  }, [refreshTick]);

  const validateGraph = async () => {
    const out = await apiFetch<{ valid: boolean; issues: string[] }>('/network/validate');
    setValidation(out);
  };

  const toggleSectionTrack = async (sec: SectionItem) => {
    const nextType = sec.track_type === 'SINGLE' ? 'DOUBLE' : 'SINGLE';
    await apiFetch(`/sections/${sec.id}`, {
      method: 'PUT',
      body: JSON.stringify({ track_type: nextType }),
    });
    setMsg(`Updated ${sec.code} track_type to ${nextType}.`);
    await load();
    onMutated();
  };

  const toggleSectionStatus = async (sec: SectionItem) => {
    const nextStatus = sec.status === 'OPEN' ? 'BLOCKED' : 'OPEN';
    await apiFetch(`/sections/${sec.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: nextStatus }),
    });
    setMsg(`Updated ${sec.code} status to ${nextStatus}.`);
    await load();
    onMutated();
  };

  const addStation = async () => {
    if (!newCode.trim() || !newName.trim()) return;
    await apiFetch('/stations', {
      method: 'POST',
      body: JSON.stringify({ code: newCode.trim().toUpperCase(), name: newName.trim(), km: newKm, num_platforms: 2, has_loop: true }),
    });
    setNewCode('');
    setNewName('');
    setMsg('Station added to topology.');
    await load();
    onMutated();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Corridor Network Graph, Stations & Block Sections</h2>
          <p className="text-xs text-slate-400">
            Inspect or modify Pune–Daund–Solapur topology, switch Single ↔ Double track for doubling studies, and validate graph integrity.
          </p>
        </div>
        <button
          onClick={validateGraph}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#162F54] hover:bg-[#1E3D6B] border border-slate-600/60 text-xs font-medium text-slate-100"
        >
          <Network className="w-3.5 h-3.5 text-sky-400" /> Validate Network Topology
        </button>
      </div>

      {msg && <div className="rounded-lg bg-sky-950/50 border border-sky-500/40 px-4 py-2 text-xs text-sky-200">{msg}</div>}
      {validation && (
        <div
          className={`rounded-lg px-4 py-2.5 text-xs border ${
            validation.valid ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200' : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
          }`}
        >
          {validation.valid ? 'Network topology passed all graph, connectivity, and run-time sanity checks.' : `Issues: ${validation.issues.join('; ')}`}
        </div>
      )}

      <CorridorMap stations={stations} sections={sections} trains={trains} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100">Block Sections ({sections.length})</h3>
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700/60">
                  <th className="py-2 text-left">Code</th>
                  <th className="py-2 text-right">Dist</th>
                  <th className="py-2 text-left">Track</th>
                  <th className="py-2 text-left">Status</th>
                  <th className="py-2 text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono">
                {sections.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 font-semibold text-slate-100">{s.code}</td>
                    <td className="py-2 text-right text-slate-300 tabular-nums">{s.distance_km}km</td>
                    <td className={`py-2 ${s.track_type === 'SINGLE' ? 'text-amber-300' : 'text-emerald-300'}`}>{s.track_type}</td>
                    <td className={`py-2 ${s.status === 'OPEN' ? 'text-emerald-400' : 'text-rose-400'}`}>{s.status}</td>
                    <td className="py-2 text-right space-x-1.5 font-sans">
                      <button onClick={() => toggleSectionTrack(s)} className="px-2 py-0.5 rounded bg-[#162F54] hover:bg-[#1E3D6B] text-slate-200">
                        Flip Track
                      </button>
                      <button onClick={() => toggleSectionStatus(s)} className="px-2 py-0.5 rounded bg-[#162F54] hover:bg-[#1E3D6B] text-slate-200">
                        {s.status === 'OPEN' ? 'Block' : 'Open'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100">Stations ({stations.length})</h3>
          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700/60">
                  <th className="py-2 text-left">Code</th>
                  <th className="py-2 text-left">Name</th>
                  <th className="py-2 text-right">KM</th>
                  <th className="py-2 text-right">PF / Loops</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {stations.map((st) => (
                  <tr key={st.id}>
                    <td className="py-2 font-mono font-semibold text-slate-100">{st.code}</td>
                    <td className="py-2 text-slate-200">{st.name}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-slate-300">{st.km}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-slate-300">
                      {st.num_platforms} / {st.loop_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pt-3 border-t border-slate-700/60 flex flex-wrap items-center gap-2 text-xs">
            <input placeholder="Code (e.g. MADH)" value={newCode} onChange={(e) => setNewCode(e.target.value)} className="w-24 rounded bg-[#0B1B33] border border-slate-700 px-2 py-1.5 font-mono text-slate-100" />
            <input placeholder="Station Name" value={newName} onChange={(e) => setNewName(e.target.value)} className="flex-1 rounded bg-[#0B1B33] border border-slate-700 px-2 py-1.5 text-slate-100" />
            <input type="number" value={newKm} onChange={(e) => setNewKm(Number(e.target.value))} className="w-20 rounded bg-[#0B1B33] border border-slate-700 px-2 py-1.5 font-mono text-slate-100" />
            <button onClick={addStation} className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- MODULE 15: REPORTS & EXPORTS ---
export function ReportsPage({ refreshTick }: { refreshTick: number }) {
  const [kpis, setKpis] = useState<{ original: KpiSummary; optimized: KpiSummary | null } | null>(null);
  const [recs, setRecs] = useState<RecommendationItem[]>([]);
  const [trains, setTrains] = useState<TrainItem[]>([]);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<typeof kpis>('/analytics/kpis'),
      apiFetch<RecommendationItem[]>('/optimize/runs/latest/recommendations'),
      apiFetch<TrainItem[]>('/trains?active_only=true'),
    ])
      .then(([k, r, tr]) => {
        setKpis(k);
        setRecs(r);
        setTrains(tr);
      })
      .catch(() => {});
  }, [refreshTick]);

  const exportPdf = () => {
    if (!kpis) return;
    const orig = kpis.original;
    const opt = kpis.optimized ?? orig;
    generatePdfReport(
      'Pune–Daund–Solapur Corridor Dispatch Report',
      [
        {
          heading: '1. Optimization KPI Comparison',
          lines: [
            `Original Total Delay: ${orig.total_delay_min} min  |  Optimized Total Delay: ${opt.total_delay_min} min`,
            `Section Throughput: ${orig.throughput_per_hour} -> ${opt.throughput_per_hour} trains/hr`,
            `On-Time Performance: ${orig.on_time_pct}% -> ${opt.on_time_pct}%`,
            `Safety Conflicts: ${orig.conflict_count} -> ${opt.conflict_count}`,
          ],
        },
        {
          heading: '2. Top Controller Recommendations',
          lines: recs.slice(0, 15).map((r) => `${r.train_no} (${r.category}) [${r.action}]: ${r.reason}`),
        },
      ],
      'railsmart_dispatch_report.pdf'
    );
  };

  const exportExcel = () => {
    exportRowsToExcel('railsmart_operations_workbook.xlsx', [
      {
        name: 'Active_Trains',
        rows: trains.map((t) => ({
          train_no: t.train_no,
          name: t.name,
          category: t.category,
          priority: t.priority,
          direction: t.direction,
          origin: t.origin_code,
          destination: t.destination_code,
          status: t.status,
        })),
      },
      {
        name: 'Recommendations',
        rows: recs.map((r) => ({
          train_no: r.train_no,
          action: r.action,
          station: r.station_code ?? '',
          delta_min: r.delta_min,
          reason: r.reason,
          status: r.accepted === 1 ? 'ACCEPTED' : r.accepted === 0 ? 'REJECTED' : 'PENDING',
        })),
      },
    ]);
  };

  const exportCsv = () => {
    exportRowsToCsv(
      'railsmart_recommendations.csv',
      recs.map((r) => ({
        train_no: r.train_no,
        action: r.action,
        station: r.station_code ?? '',
        delta_min: r.delta_min,
        reason: r.reason,
        rule_ref: r.rule_ref,
        accepted: r.accepted === 1 ? 'ACCEPTED' : r.accepted === 0 ? 'REJECTED' : 'PENDING',
      }))
    );
  };

  const handleFileUpload = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return;
    const headers = lines[0].split(',').map((h) => h.trim());
    const rows = lines.slice(1).map((ln) => {
      const cols = ln.split(',');
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => (obj[h] = (cols[i] ?? '').trim()));
      return obj;
    });
    const out = await apiFetch<{ imported: number; note: string }>('/import/trains', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    });
    setImportMsg(`Validated ${out.imported} CSV timetable rows (${out.note}).`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Operational Reports, Audit Downloads & CSV Import</h2>
        <p className="text-xs text-slate-400">
          Generate executive PDF briefings, multi-sheet Excel workbooks, or raw CSV schedules directly from live SQLite records.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button onClick={exportPdf} className="rounded-lg bg-[#102442] hover:bg-[#162F54] border border-slate-700/60 p-5 text-left space-y-2 transition-colors">
          <FileText className="w-6 h-6 text-rose-400" />
          <div className="text-sm font-semibold text-slate-100">Download Executive PDF Report</div>
          <div className="text-xs text-slate-400">KPI before/after table, recommendations & mandatory decision-support disclaimer.</div>
        </button>

        <button onClick={exportExcel} className="rounded-lg bg-[#102442] hover:bg-[#162F54] border border-slate-700/60 p-5 text-left space-y-2 transition-colors">
          <FileSpreadsheet className="w-6 h-6 text-emerald-400" />
          <div className="text-sm font-semibold text-slate-100">Download Multi-Sheet Excel (.xlsx)</div>
          <div className="text-xs text-slate-400">Exports Active Trains and Recommendations sheets for offline division review.</div>
        </button>

        <button onClick={exportCsv} className="rounded-lg bg-[#102442] hover:bg-[#162F54] border border-slate-700/60 p-5 text-left space-y-2 transition-colors">
          <Database className="w-6 h-6 text-sky-400" />
          <div className="text-sm font-semibold text-slate-100">Download Recommendations CSV</div>
          <div className="text-xs text-slate-400">Flat CSV export of controller dispatch actions and rule citations.</div>
        </button>
      </div>

      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">Direct Backend Schedule CSV Download & Timetable CSV Validator</h3>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <a href="/api/v1/export/schedule.csv?kind=OPTIMIZED" className="px-3 py-2 rounded bg-[#162F54] hover:bg-[#1E3D6B] text-slate-100 font-medium">
            Download Optimized Timetable (.csv)
          </a>
          <a href="/api/v1/export/schedule.csv?kind=ORIGINAL" className="px-3 py-2 rounded bg-[#162F54] hover:bg-[#1E3D6B] text-slate-100 font-medium">
            Download Original Timetable (.csv)
          </a>
          <label className="px-3 py-2 rounded bg-sky-600/20 border border-sky-500/40 text-sky-200 cursor-pointer">
            Upload Train CSV to Validate
            <input type="file" accept=".csv" className="hidden" onChange={(e) => handleFileUpload(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        {importMsg && <div className="text-xs text-emerald-300">{importMsg}</div>}
      </div>
    </div>
  );
}

// --- MODULE 16: SYSTEM ADMINISTRATION ---
export function AdminPage({ refreshTick, onMutated }: { refreshTick: number; onMutated: () => void }) {
  const [health, setHealth] = useState<{ status: string; database: string; counts: Record<string, number>; gemini_configured: boolean } | null>(null);
  const [users, setUsers] = useState<Array<{ id: number; username: string; role: string; language: string; created_at: string }>>([]);
  const [audit, setAudit] = useState<Array<{ id: number; username: string; role: string; action: string; target_type: string; created_at: string }>>([]);
  const [weights, setWeights] = useState({ W1_delay: 1.0, W2_wait: 0.4, W3_priority: 0.35, W4_changed: 4.0, W5_shift: 0.15 });
  const [safety, setSafety] = useState({ min_headway_min: 5, buffer_time_min: 2, crossing_clearance_min: 3, max_dwell_hold_min: 25 });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const [h, u, a, s] = await Promise.all([
      apiFetch<typeof health>('/admin/health'),
      apiFetch<typeof users>('/admin/users'),
      apiFetch<typeof audit>('/admin/audit'),
      apiFetch<{ weights: typeof weights; safety: typeof safety }>('/admin/settings'),
    ]);
    setHealth(h);
    setUsers(u);
    setAudit(a);
    setWeights(s.weights);
    setSafety(s.safety);
  };

  useEffect(() => {
    load().catch(() => {});
  }, [refreshTick]);

  const saveSettings = async () => {
    setErr(null);
    setMsg(null);
    try {
      await apiFetch('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ weights, safety }),
      });
      setMsg('Persisted optimizer weights & safety parameters.');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Saving settings requires ADMIN role.');
    }
  };

  const resetSeed = async () => {
    setErr(null);
    setMsg(null);
    try {
      await apiFetch('/admin/seed', { method: 'POST' });
      setMsg('Database re-seeded with fresh corridor state and initial optimization completed.');
      await load();
      onMutated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Reset failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">System Administration, RBAC & Safety Parameters</h2>
          <p className="text-xs text-slate-400">
            Configure objective weights, safety headways, inspect SQLite health, and review the immutable controller audit ledger.
          </p>
        </div>
        <button
          onClick={resetSeed}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-600/90 hover:bg-rose-500 text-xs font-semibold text-white"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Re-seed Demo Corridor
        </button>
      </div>

      {msg && <div className="rounded-lg bg-emerald-950/40 border border-emerald-500/40 px-4 py-2 text-xs text-emerald-200">{msg}</div>}
      {err && <div className="rounded-lg bg-rose-950/40 border border-rose-500/40 px-4 py-2 text-xs text-rose-200">{err}</div>}

      {health && (
        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold">
            <CheckCircle2 className="w-4 h-4" /> Engine Status: {health.status} · {health.database}
          </div>
          <div className="flex flex-wrap gap-4 font-mono tabular-nums text-slate-300">
            {Object.entries(health.counts).map(([k, v]) => (
              <span key={k}>
                {k}: <strong className="text-slate-100">{v.toLocaleString()}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Wrench className="w-4 h-4 text-sky-400" /> Optimizer Weights & Safety Bounds (ADMIN)
          </h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-slate-400 block">W1 Delay Weight</span>
              <input type="number" step={0.1} value={weights.W1_delay} onChange={(e) => setWeights({ ...weights, W1_delay: Number(e.target.value) })} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-1.5 font-mono text-slate-100" />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400 block">W3 Priority Weight</span>
              <input type="number" step={0.05} value={weights.W3_priority} onChange={(e) => setWeights({ ...weights, W3_priority: Number(e.target.value) })} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-1.5 font-mono text-slate-100" />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400 block">Min Headway (min)</span>
              <input type="number" min={3} max={15} value={safety.min_headway_min} onChange={(e) => setSafety({ ...safety, min_headway_min: Number(e.target.value) })} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-1.5 font-mono text-slate-100" />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400 block">Crossing Clearance (min)</span>
              <input type="number" min={1} max={10} value={safety.crossing_clearance_min} onChange={(e) => setSafety({ ...safety, crossing_clearance_min: Number(e.target.value) })} className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-1.5 font-mono text-slate-100" />
            </label>
          </div>
          <button onClick={saveSettings} className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white">
            Save Safety & Solver Settings
          </button>
        </div>

        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" /> Configured RBAC Accounts
          </h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700/60">
                <th className="py-2 text-left">Username</th>
                <th className="py-2 text-left">Role</th>
                <th className="py-2 text-left">Language</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="py-2 text-slate-100">{u.username}</td>
                  <td className="py-2 text-sky-300">{u.role}</td>
                  <td className="py-2 text-slate-400">{u.language}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">Controller Audit Log (Latest 25 Actions)</h3>
        <div className="overflow-x-auto max-h-64">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700/60">
                <th className="py-1.5 text-left">Timestamp</th>
                <th className="py-1.5 text-left">User (Role)</th>
                <th className="py-1.5 text-left">Action</th>
                <th className="py-1.5 text-left">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {audit.slice(0, 25).map((a) => (
                <tr key={a.id}>
                  <td className="py-1.5 text-slate-400">{a.created_at.slice(0, 19).replace('T', ' ')}</td>
                  <td className="py-1.5 text-slate-200">
                    {a.username} ({a.role})
                  </td>
                  <td className="py-1.5 text-sky-300">{a.action}</td>
                  <td className="py-1.5 text-slate-300">{a.target_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
