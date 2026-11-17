import type { SectionItem, StationItem, TrainItem } from '../types/rail.ts';

interface CorridorMapProps {
  stations: StationItem[];
  sections: SectionItem[];
  trains?: TrainItem[];
  onSelectTrain?: (trainId: number) => void;
  onSelectStation?: (stationId: number) => void;
  height?: number;
}

export function CorridorMap({
  stations,
  sections,
  trains = [],
  onSelectTrain,
  onSelectStation,
  height = 290,
}: CorridorMapProps) {
  if (stations.length === 0) return null;

  const width = 980;
  const padX = 56;
  const padY = 48;
  const lons = stations.map((s) => s.lon);
  const lats = stations.map((s) => s.lat);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  const px = (lon: number) => padX + ((lon - minLon) / Math.max(0.01, maxLon - minLon)) * (width - padX * 2);
  const py = (lat: number) => padY + (1 - (lat - minLat) / Math.max(0.01, maxLat - minLat)) * (height - padY * 2);

  const stnMap = new Map(stations.map((s) => [s.id, s]));

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-slate-700/60 bg-[#081529]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80 text-xs text-slate-400">
        <span>Corridor Geospatial Topology · Double vs Single-Line Sections</span>
        <div className="flex items-center gap-4 font-mono">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-cyan-400 inline-block" /> Double Track
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-amber-400 inline-block" /> Single Track
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-rose-500 inline-block" /> Blocked / TSR
          </span>
          <span className="text-cyan-300">SIMULATED GPS</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[720px] h-auto select-none">
        {/* Track sections */}
        {sections.map((sec) => {
          const a = stnMap.get(sec.from_station_id);
          const b = stnMap.get(sec.to_station_id);
          if (!a || !b) return null;
          const x1 = px(a.lon);
          const y1 = py(a.lat);
          const x2 = px(b.lon);
          const y2 = py(b.lat);
          const color =
            sec.status === 'BLOCKED'
              ? '#F43F5E'
              : sec.status === 'RESTRICTED'
                ? '#FB923C'
                : sec.track_type === 'SINGLE'
                  ? '#FBBF24'
                  : '#22D3EE';

          return (
            <g key={sec.id}>
              {sec.track_type === 'DOUBLE' ? (
                <>
                  <line x1={x1} y1={y1 - 2.5} x2={x2} y2={y2 - 2.5} stroke={color} strokeWidth={2} strokeOpacity={0.85} />
                  <line x1={x1} y1={y1 + 2.5} x2={x2} y2={y2 + 2.5} stroke={color} strokeWidth={2} strokeOpacity={0.85} />
                </>
              ) : (
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={3} strokeDasharray={sec.status === 'BLOCKED' ? '5 4' : undefined} />
              )}
              <text
                x={(x1 + x2) / 2}
                y={(y1 + y2) / 2 - 9}
                textAnchor="middle"
                className="fill-slate-400 text-[9px] font-mono"
              >
                {sec.distance_km}km
              </text>
            </g>
          );
        })}

        {/* Stations */}
        {stations.map((s, idx) => {
          const x = px(s.lon);
          const y = py(s.lat);
          const labelAbove = idx % 2 === 0;
          return (
            <g key={s.id} className="cursor-pointer" onClick={() => onSelectStation?.(s.id)}>
              <circle
                cx={x}
                cy={y}
                r={s.is_junction ? 6.5 : 4.5}
                fill={s.is_junction ? '#0EA5E9' : '#1E293B'}
                stroke={s.has_loop ? '#E2E8F0' : '#94A3B8'}
                strokeWidth={2}
              />
              <text
                x={x}
                y={labelAbove ? y - 12 : y + 18}
                textAnchor="middle"
                className="fill-slate-200 text-[10px] font-mono font-medium"
              >
                {s.code}
              </text>
            </g>
          );
        })}

        {/* Active Train Positions (Simulated GPS) */}
        {trains
          .filter((t) => t.is_active === 1 && (t.status === 'RUNNING' || t.status === 'DELAYED'))
          .map((t, i) => {
            const x = px(t.lon);
            const y = py(t.lat);
            const fill = t.status === 'DELAYED' ? '#F43F5E' : t.category === 'GOODS' ? '#FBBF24' : '#34D399';
            return (
              <g key={t.id} className="cursor-pointer" onClick={() => onSelectTrain?.(t.id)}>
                <circle cx={x} cy={y} r={5.5} fill={fill} stroke="#0B1B33" strokeWidth={1.5} />
                <text
                  x={x}
                  y={y + (i % 2 === 0 ? -10 : 15)}
                  textAnchor="middle"
                  className="fill-cyan-200 text-[9px] font-mono font-semibold"
                >
                  {t.train_no} {t.direction === 'UP' ? '→' : '←'}
                </text>
              </g>
            );
          })}
      </svg>
    </div>
  );
}
