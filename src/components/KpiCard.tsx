import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

interface KpiCardProps {
  label: string;
  value: string | number;
  unit?: string;
  subtext?: string;
  delta?: number | null;
  deltaLabel?: string;
  higherIsBetter?: boolean;
  tone?: 'neutral' | 'positive' | 'warning' | 'critical';
}

export function KpiCard({
  label,
  value,
  unit,
  subtext,
  delta,
  deltaLabel,
  higherIsBetter = true,
  tone = 'neutral',
}: KpiCardProps) {
  const toneBorder =
    tone === 'critical'
      ? 'border-rose-500/40'
      : tone === 'warning'
        ? 'border-amber-500/35'
        : tone === 'positive'
          ? 'border-emerald-500/35'
          : 'border-slate-700/60';

  const hasDelta = delta !== undefined && delta !== null && delta !== 0;
  const isGood = hasDelta ? (higherIsBetter ? delta > 0 : delta < 0) : false;

  return (
    <div className={`rounded-lg bg-[#102442] border ${toneBorder} p-4 flex flex-col justify-between gap-2`}>
      <div className="text-xs font-medium text-slate-400 truncate">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold text-slate-50 font-mono tabular-nums tracking-tight">{value}</span>
        {unit && <span className="text-xs text-slate-400 font-mono">{unit}</span>}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs min-h-[18px]">
        {subtext ? <span className="text-slate-400 truncate">{subtext}</span> : <span />}
        {hasDelta ? (
          <span
            className={`inline-flex items-center gap-0.5 font-mono tabular-nums font-medium shrink-0 ${
              isGood ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {delta > 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
            {delta > 0 ? `+${delta}` : delta}
            {deltaLabel ? ` ${deltaLabel}` : ''}
          </span>
        ) : delta === 0 ? (
          <span className="inline-flex items-center gap-0.5 font-mono text-slate-500 shrink-0">
            <Minus className="w-3 h-3" /> 0
          </span>
        ) : null}
      </div>
    </div>
  );
}
