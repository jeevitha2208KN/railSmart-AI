import { useMemo, useState } from 'react';
import { formatTimeMin } from '../lib/api.ts';
import type { ConflictItem, SchedulePoint, StationItem } from '../types/rail.ts';

interface MareyTrainMeta {
  id: number;
  train_no: string;
  name: string;
  category: string;
  priority: number;
  direction: string;
}

interface MareyChartProps {
  stations: StationItem[];
  trains: MareyTrainMeta[];
  original: SchedulePoint[];
  optimized: SchedulePoint[];
  conflicts?: ConflictItem[];
  mode?: 'ORIGINAL' | 'OPTIMIZED' | 'OVERLAY';
  categoryFilter?: string;
  selectedTrainId?: number | null;
  onSelectTrain?: (trainId: number) => void;
  height?: number;
}

const CAT_COLORS: Record<string, string> = {
  SUPERFAST: '#22D3EE', // cyan-400
  EXPRESS: '#60A5FA',   // blue-400
  PASSENGER: '#34D399', // emerald-400
  GOODS: '#FBBF24',     // amber-400
  EMERGENCY: '#FB7185', // rose-400
  SPECIAL: '#C084FC',   // purple-400
};

export function MareyChart({
  stations,
  trains,
  original,
  optimized,
  conflicts = [],
  mode = 'OVERLAY',
  categoryFilter = 'ALL',
  selectedTrainId = null,
  onSelectTrain,
  height = 500,
}: MareyChartProps) {
  const [hoveredTrain, setHoveredTrain] = useState<{ train: MareyTrainMeta; info: string } | null>(null);

  const width = 1040;
  const padL = 78;
  const padR = 24;
  const padT = 24;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const minT = 360; // 06:00
  const maxT = 780; // 13:00
  const maxKm = Math.max(1, stations[stations.length - 1]?.km ?? 196);

  const stnMap = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);

  const xOf = (t: number) => padL + ((Math.max(minT, Math.min(maxT, t)) - minT) / (maxT - minT)) * plotW;
  const yOf = (km: number) => padT + (km / maxKm) * plotH;

  const buildPolylines = (rows: SchedulePoint[]) => {
    const byTrain = new Map<number, SchedulePoint[]>();
    for (const r of rows) {
      if (!byTrain.has(r.train_id)) byTrain.set(r.train_id, []);
      byTrain.get(r.train_id)!.push(r);
    }

    const lines: Array<{ train: MareyTrainMeta; points: string; firstX: number; firstY: number; startT: number; endT: number }> = [];
    for (const tr of trains) {
      if (categoryFilter !== 'ALL' && tr.category !== categoryFilter) continue;
      const pts = (byTrain.get(tr.id) ?? []).sort((a, b) => a.arrival - b.arrival);
      if (pts.length < 2) continue;

      const coords: string[] = [];
      for (const p of pts) {
        const stn = stnMap.get(p.station_id);
        if (!stn) continue;
        const y = yOf(stn.km);
        coords.push(`${xOf(p.arrival).toFixed(1)},${y.toFixed(1)}`);
        if (p.departure > p.arrival) {
          coords.push(`${xOf(p.departure).toFixed(1)},${y.toFixed(1)}`);
        }
      }
      if (coords.length >= 2) {
        const firstStn = stnMap.get(pts[0].station_id);
        lines.push({
          train: tr,
          points: coords.join(' '),
          firstX: xOf(pts[0].arrival),
          firstY: yOf(firstStn?.km ?? 0),
          startT: pts[0].departure,
          endT: pts[pts.length - 1].arrival,
        });
      }
    }
    return lines;
  };

  const origLines = useMemo(() => (mode === 'ORIGINAL' || mode === 'OVERLAY' ? buildPolylines(original) : []), [original, mode, trains, categoryFilter, stnMap]);
  const optLines = useMemo(() => (mode === 'OPTIMIZED' || mode === 'OVERLAY' ? buildPolylines(optimized) : []), [optimized, mode, trains, categoryFilter, stnMap]);

  // Single-line bottleneck shaded band (DD km 74 to KWV km 146)
  const ddKm = stations.find((s) => s.code === 'DD')?.km ?? 74;
  const kwvKm = stations.find((s) => s.code === 'KWV')?.km ?? 146;

  // Conflict intersection pins on Original schedule
  const conflictPins = useMemo(() => {
    if (mode === 'OPTIMIZED') return [];
    const pins: Array<{ x: number; y: number; label: string }> = [];
    const byTrain = new Map<number, SchedulePoint[]>();
    for (const r of original) {
      if (!byTrain.has(r.train_id)) byTrain.set(r.train_id, []);
      byTrain.get(r.train_id)!.push(r);
    }
    for (const c of conflicts.slice(0, 14)) {
      if (c.train_ids.length === 0) continue;
      const trRows = byTrain.get(c.train_ids[0]) ?? [];
      const match = c.station_id
        ? trRows.find((r) => r.station_id === c.station_id)
        : c.section_id
          ? trRows.find((r) => r.section_id === c.section_id)
          : trRows[0];
      if (match) {
        const stn = stnMap.get(match.station_id);
        if (stn) {
          pins.push({
            x: xOf(match.entry_time ?? match.arrival),
            y: yOf(stn.km),
            label: `${c.category} (${c.train_nos.join(' vs ')})`,
          });
        }
      }
    }
    return pins;
  }, [conflicts, original, mode, stnMap]);

  const timeTicks = [360, 420, 480, 540, 600, 660, 720, 780];

  return (
    <div className="relative w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-4">
          {Object.entries(CAT_COLORS).map(([cat, col]) => (
            <span key={cat} className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: col }} />
              <span>{cat}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-4 font-mono">
          {mode === 'OVERLAY' && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 border-t border-dashed border-slate-400 inline-block" /> Original
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-cyan-400 inline-block" /> Optimized
              </span>
            </>
          )}
          <span className="text-amber-300/90">Shaded Band: Single-Line Bottleneck (DD–KWV)</span>
        </div>
      </div>

      <div className="w-full overflow-x-auto rounded-lg border border-slate-700/60 bg-[#081529]">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[780px] h-auto select-none">
          {/* Single-line bottleneck shaded corridor */}
          <rect
            x={padL}
            y={yOf(ddKm)}
            width={plotW}
            height={Math.max(4, yOf(kwvKm) - yOf(ddKm))}
            fill="rgba(245, 158, 11, 0.06)"
          />

          {/* Horizontal station gridlines */}
          {stations.map((s) => {
            const y = yOf(s.km);
            return (
              <g key={s.id}>
                <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="rgba(148, 163, 184, 0.14)" strokeWidth={1} />
                <text x={padL - 8} y={y + 3.5} textAnchor="end" className="fill-slate-300 text-[10px] font-mono">
                  {s.code} ({s.km})
                </text>
              </g>
            );
          })}

          {/* Vertical time gridlines */}
          {timeTicks.map((t) => {
            const x = xOf(t);
            return (
              <g key={t}>
                <line x1={x} y1={padT} x2={x} y2={height - padB} stroke="rgba(148, 163, 184, 0.12)" strokeWidth={1} />
                <text x={x} y={height - padB + 16} textAnchor="middle" className="fill-slate-400 text-[10px] font-mono">
                  {formatTimeMin(t)}
                </text>
              </g>
            );
          })}

          {/* Original Dashed Trajectories */}
          {origLines.map((l) => {
            const color = CAT_COLORS[l.train.category] ?? '#94A3B8';
            const isSel = selectedTrainId === l.train.id;
            return (
              <g
                key={`orig-${l.train.id}`}
                className="cursor-pointer"
                onClick={() => onSelectTrain?.(l.train.id)}
                onMouseEnter={() =>
                  setHoveredTrain({
                    train: l.train,
                    info: `ORIGINAL · ${formatTimeMin(l.startT)} → ${formatTimeMin(l.endT)}`,
                  })
                }
                onMouseLeave={() => setHoveredTrain(null)}
              >
                <polyline
                  fill="none"
                  stroke={color}
                  strokeWidth={isSel ? 2.6 : mode === 'OVERLAY' ? 1.3 : 2.0}
                  strokeDasharray={mode === 'OVERLAY' ? '4 4' : undefined}
                  strokeOpacity={mode === 'OVERLAY' ? 0.48 : 0.9}
                  points={l.points}
                />
                {mode === 'ORIGINAL' && (
                  <text x={l.firstX + 3} y={l.firstY - 3} className="fill-slate-300 text-[9px] font-mono">
                    {l.train.train_no}
                  </text>
                )}
              </g>
            );
          })}

          {/* Optimized Solid Trajectories */}
          {optLines.map((l) => {
            const color = CAT_COLORS[l.train.category] ?? '#22D3EE';
            const isSel = selectedTrainId === l.train.id;
            return (
              <g
                key={`opt-${l.train.id}`}
                className="cursor-pointer"
                onClick={() => onSelectTrain?.(l.train.id)}
                onMouseEnter={() =>
                  setHoveredTrain({
                    train: l.train,
                    info: `OPTIMIZED · ${formatTimeMin(l.startT)} → ${formatTimeMin(l.endT)}`,
                  })
                }
                onMouseLeave={() => setHoveredTrain(null)}
              >
                <polyline
                  fill="none"
                  stroke={color}
                  strokeWidth={isSel ? 3.2 : 2.1}
                  strokeOpacity={selectedTrainId && !isSel ? 0.35 : 0.95}
                  points={l.points}
                />
                <text x={l.firstX + 3} y={l.firstY - 3} className="fill-slate-200 text-[9px] font-mono">
                  {l.train.train_no}
                </text>
              </g>
            );
          })}

          {/* Conflict markers on Original */}
          {conflictPins.map((pin, idx) => (
            <g key={`c-${idx}`}>
              <circle cx={pin.x} cy={pin.y} r={5} fill="rgba(244, 63, 94, 0.25)" stroke="#F43F5E" strokeWidth={1.5} />
              <title>{pin.label}</title>
            </g>
          ))}
        </svg>
      </div>

      {hoveredTrain && (
        <div className="mt-2 text-xs font-mono text-cyan-300 flex items-center justify-between px-2 py-1 rounded bg-[#102442] border border-slate-700/60">
          <span>
            {hoveredTrain.train.train_no} · {hoveredTrain.train.name} ({hoveredTrain.train.category} · P{hoveredTrain.train.priority} · {hoveredTrain.train.direction})
          </span>
          <span>{hoveredTrain.info}</span>
        </div>
      )}
    </div>
  );
}
