import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import type { StationItem, TrainItem } from '../types/rail.ts';
import { KpiCard } from '../components/KpiCard.tsx';
import { Activity, RefreshCw, Sparkles } from 'lucide-react';

interface ModelMetricsResponse {
  trained_at: string;
  sample_count: number;
  metrics: {
    random_forest: { mae: number; rmse: number; r2: number; accuracy_pct: number; brier_score: number };
    gradient_boosting: { mae: number; rmse: number; r2: number; accuracy_pct: number };
    linear_ridge: { mae: number; rmse: number; r2: number; accuracy_pct: number };
  };
  confusion_matrix: number[][];
  risk_labels: string[];
  residuals: Array<{ actual: number; predicted: number; error: number }>;
  calibrated: boolean;
}

interface PredictionResult {
  predicted_delay_min: number;
  interval_80_pct: [number, number];
  risk_class: string;
  delay_probability_pct: number | null;
  calibrated: boolean;
  brier_score: number;
}

export function DelayPredictionPage({ refreshTick }: { refreshTick: number }) {
  const [metrics, setMetrics] = useState<ModelMetricsResponse | null>(null);
  const [importance, setImportance] = useState<Array<{ feature: string; importance: number }>>([]);
  const [trains, setTrains] = useState<TrainItem[]>([]);
  const [stations, setStations] = useState<StationItem[]>([]);
  const [retraining, setRetraining] = useState(false);

  const [trainId, setTrainId] = useState<number>(0);
  const [hour, setHour] = useState(8);
  const [dow, setDow] = useState(2);
  const [prevDelay, setPrevDelay] = useState(8);
  const [congestion, setCongestion] = useState(0.72);
  const [weather, setWeather] = useState('CLEAR');
  const [stationId, setStationId] = useState(5);
  const [pred, setPred] = useState<PredictionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAll = async () => {
    try {
      const [m, fi, tr, st] = await Promise.all([
        apiFetch<ModelMetricsResponse>('/predict/model-metrics'),
        apiFetch<Array<{ feature: string; importance: number }>>('/predict/feature-importance'),
        apiFetch<TrainItem[]>('/trains?active_only=true'),
        apiFetch<StationItem[]>('/stations'),
      ]);
      setMetrics(m);
      setImportance(fi);
      setTrains(tr);
      setStations(st);
      if (tr.length > 0 && trainId === 0) setTrainId(tr[0].id);
      if (st.length > 0 && !st.some((x) => x.id === stationId)) setStationId(st[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load model metrics');
    }
  };

  useEffect(() => {
    loadAll();
  }, [refreshTick]);

  const runPredict = async () => {
    setError(null);
    try {
      const out = await apiFetch<PredictionResult>('/predict/delay', {
        method: 'POST',
        body: JSON.stringify({
          train_id: trainId || undefined,
          hour,
          dow,
          prev_delay_min: prevDelay,
          congestion_index: congestion,
          weather,
          station_id: stationId,
        }),
      });
      setPred(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Prediction failed');
    }
  };

  useEffect(() => {
    if (trains.length > 0) runPredict();
  }, [trains.length]);

  const handleRetrain = async () => {
    setRetraining(true);
    setError(null);
    try {
      await apiFetch('/predict/retrain', { method: 'POST' });
      await loadAll();
      await runPredict();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retrain requires Admin or Controller role');
    } finally {
      setRetraining(false);
    }
  };

  const maxImp = Math.max(0.01, ...importance.map((f) => f.importance));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">AI Delay Prediction & Model Calibration</h2>
          <p className="text-xs text-slate-400">
            In-process 18-tree Bagged Random Forest trained on {metrics?.sample_count.toLocaleString() ?? '—'} synthetic historical station logs (SIMULATED DATA).
          </p>
        </div>
        <button
          onClick={handleRetrain}
          disabled={retraining}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#162F54] hover:bg-[#1E3D6B] border border-slate-600/60 text-xs font-medium text-slate-100 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${retraining ? 'animate-spin' : ''}`} />
          {retraining ? 'Retraining...' : 'Retrain ML Ensemble'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-950/50 border border-rose-500/40 px-4 py-2.5 text-xs text-rose-200">{error}</div>
      )}

      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Random Forest MAE" value={metrics.metrics.random_forest.mae} unit="min" subtext="Out-of-sample test split" tone="positive" />
          <KpiCard label="Random Forest RMSE" value={metrics.metrics.random_forest.rmse} unit="min" subtext={`R² = ${metrics.metrics.random_forest.r2}`} />
          <KpiCard label="Risk Class Accuracy" value={`${metrics.metrics.random_forest.accuracy_pct}%`} subtext="ON_TIME / MINOR / MAJOR / SEVERE" tone="positive" />
          <KpiCard
            label="Brier Calibration Score"
            value={metrics.metrics.random_forest.brier_score}
            subtext={metrics.calibrated ? 'Calibrated (<= 0.25 threshold)' : 'Uncalibrated'}
            tone={metrics.calibrated ? 'positive' : 'warning'}
          />
        </div>
      )}

      {/* Interactive Prediction Form + Output */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">Single-Train Delay Inference (80% Prediction Interval)</h3>
            <span className="text-xs font-mono text-slate-400">Bagged RF Quantiles</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-slate-400 block">Train</span>
              <select
                value={trainId}
                onChange={(e) => setTrainId(Number(e.target.value))}
                className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-2 text-slate-100"
              >
                {trains.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.train_no} · {tr.name} ({tr.category})
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-slate-400 block">Target Station</span>
              <select
                value={stationId}
                onChange={(e) => setStationId(Number(e.target.value))}
                className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-2 text-slate-100"
              >
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-slate-400 block">Weather Condition</span>
              <select
                value={weather}
                onChange={(e) => setWeather(e.target.value)}
                className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-2 text-slate-100"
              >
                <option value="CLEAR">CLEAR</option>
                <option value="RAIN">RAIN</option>
                <option value="FOG">FOG</option>
                <option value="STORM">STORM</option>
                <option value="HEAT">HEAT</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-slate-400 block">Prior Arrival Delay (min)</span>
              <input
                type="number"
                min={0}
                max={120}
                value={prevDelay}
                onChange={(e) => setPrevDelay(Number(e.target.value))}
                className="w-full rounded bg-[#0B1B33] border border-slate-700 px-2.5 py-2 text-slate-100 font-mono tabular-nums"
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-400 block">Hour of Day ({hour}:00)</span>
              <input
                type="range"
                min={0}
                max={23}
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className="w-full accent-sky-400 mt-2"
              />
            </label>

            <label className="space-y-1">
              <span className="text-slate-400 block">Section Congestion ({Math.round(congestion * 100)}%)</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={congestion}
                onChange={(e) => setCongestion(Number(e.target.value))}
                className="w-full accent-sky-400 mt-2"
              />
            </label>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-slate-400">
              Day of Week:{' '}
              <select
                value={dow}
                onChange={(e) => setDow(Number(e.target.value))}
                className="ml-1 rounded bg-[#0B1B33] border border-slate-700 px-2 py-1 text-slate-200"
              >
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, idx) => (
                  <option key={d} value={idx}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={runPredict}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white"
            >
              <Sparkles className="w-3.5 h-3.5" /> Predict Delay & Risk
            </button>
          </div>
        </div>

        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">Predicted Outcome</h3>
            <Activity className="w-4 h-4 text-sky-400" />
          </div>
          {pred ? (
            <div className="space-y-4">
              <div>
                <div className="text-xs text-slate-400">Point Estimate</div>
                <div className="text-3xl font-semibold font-mono tabular-nums text-slate-50">
                  {pred.predicted_delay_min} <span className="text-sm text-slate-400 font-normal">min</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded bg-[#0B1B33] border border-slate-700/70 p-2.5">
                  <div className="text-slate-400">80% Interval</div>
                  <div className="font-mono tabular-nums text-slate-100 mt-0.5">
                    {pred.interval_80_pct[0]} – {pred.interval_80_pct[1]} min
                  </div>
                </div>
                <div className="rounded bg-[#0B1B33] border border-slate-700/70 p-2.5">
                  <div className="text-slate-400">Risk Class</div>
                  <div
                    className={`font-mono font-semibold mt-0.5 ${
                      pred.risk_class === 'SEVERE'
                        ? 'text-rose-400'
                        : pred.risk_class === 'MAJOR'
                          ? 'text-amber-400'
                          : pred.risk_class === 'MINOR'
                            ? 'text-sky-400'
                            : 'text-emerald-400'
                    }`}
                  >
                    {pred.risk_class}
                  </div>
                </div>
              </div>
              <div className="text-xs text-slate-300 flex items-center justify-between border-t border-slate-700/60 pt-3">
                <span>P(Delay &gt; 5 min)</span>
                <span className="font-mono tabular-nums font-semibold text-sky-300">
                  {pred.delay_probability_pct !== null ? `${pred.delay_probability_pct}%` : 'Hidden (Uncalibrated)'}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400">Select parameters and click Predict Delay.</div>
          )}
        </div>
      </div>

      {/* Model Comparison & Feature Importance */}
      {metrics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-100">Model Benchmark Comparison (Test Split)</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700/60">
                  <th className="py-2 text-left font-medium">Model</th>
                  <th className="py-2 text-right font-medium">MAE (m)</th>
                  <th className="py-2 text-right font-medium">RMSE (m)</th>
                  <th className="py-2 text-right font-medium">R²</th>
                  <th className="py-2 text-right font-medium">Class Acc</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                {[
                  { name: 'Bagged Random Forest (Active)', m: metrics.metrics.random_forest, highlight: true },
                  { name: 'Gradient Boosted Trees', m: metrics.metrics.gradient_boosting, highlight: false },
                  { name: 'Ridge Linear Baseline', m: metrics.metrics.linear_ridge, highlight: false },
                ].map((row) => (
                  <tr key={row.name} className={row.highlight ? 'bg-sky-950/30 text-slate-100' : 'text-slate-300'}>
                    <td className="py-2.5 font-sans font-medium">{row.name}</td>
                    <td className="py-2.5 text-right">{row.m.mae}</td>
                    <td className="py-2.5 text-right">{row.m.rmse}</td>
                    <td className="py-2.5 text-right">{row.m.r2}</td>
                    <td className="py-2.5 text-right">{row.m.accuracy_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="pt-2">
              <div className="text-xs font-medium text-slate-300 mb-2">4×4 Risk Classification Confusion Matrix (Actual vs Predicted)</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="py-1 text-left">Actual \ Pred</th>
                      {metrics.risk_labels.map((lbl) => (
                        <th key={lbl} className="py-1 text-right">
                          {lbl}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.confusion_matrix.map((row, rIdx) => (
                      <tr key={metrics.risk_labels[rIdx]} className="border-t border-slate-800/60">
                        <td className="py-1.5 text-slate-300">{metrics.risk_labels[rIdx]}</td>
                        {row.map((cnt, cIdx) => (
                          <td
                            key={cIdx}
                            className={`py-1.5 text-right ${rIdx === cIdx ? 'text-emerald-400 font-semibold' : 'text-slate-400'}`}
                          >
                            {cnt}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-slate-100">Permutation Feature Importance</h3>
            <div className="space-y-2.5">
              {importance.map((fi) => (
                <div key={fi.feature} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-mono">{fi.feature}</span>
                    <span className="text-slate-400 font-mono tabular-nums">{(fi.importance * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 rounded bg-[#0B1B33] overflow-hidden">
                    <div
                      className="h-full bg-sky-500 rounded"
                      style={{ width: `${Math.max(3, Math.round((fi.importance / maxImp) * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-slate-700/60">
              <div className="text-xs font-medium text-slate-300 mb-2">Actual vs Predicted Sample Residuals (Test Set)</div>
              <svg viewBox="0 0 360 130" className="w-full h-32 bg-[#0B1B33] rounded border border-slate-700/50">
                <line x1="20" y1="110" x2="340" y2="15" stroke="#334155" strokeDasharray="3 3" strokeWidth="1" />
                {metrics.residuals.slice(0, 60).map((pt, i) => {
                  const x = 20 + Math.min(45, pt.actual) * (320 / 45);
                  const y = 110 - Math.min(45, pt.predicted) * (95 / 45);
                  return <circle key={i} cx={x} cy={y} r={2.5} fill="#38BDF8" fillOpacity={0.75} />;
                })}
                <text x="24" y="22" fill="#94A3B8" fontSize="9">
                  45° Perfect Fit Diagonal
                </text>
              </svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
