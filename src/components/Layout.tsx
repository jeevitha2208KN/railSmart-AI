import { type ReactNode, useState } from 'react';
import { PAGE_LABELS, t } from '../lib/i18n.ts';
import type { Lang, PageId, UserRole } from '../types/rail.ts';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CheckSquare,
  CloudRain,
  Compass,
  Cpu,
  FileDown,
  FlaskConical,
  GitBranch,
  GitMerge,
  LayoutDashboard,
  Layers,
  Menu,
  Network,
  Play,
  Radio,
  Settings,
  Siren,
  TrainFront,
  TrendingUp,
  Wrench,
  X,
  Zap,
} from 'lucide-react';

interface LayoutProps {
  activePage: PageId;
  onNavigate: (p: PageId) => void;
  lang: Lang;
  onToggleLang: () => void;
  role: UserRole;
  onChangeRole: (r: UserRole) => void;
  onOptimize: () => void;
  optimizing: boolean;
  activeConflictCount: number;
  children: ReactNode;
}

interface NavGroup {
  groupKey: string;
  items: Array<{ id: PageId; icon: typeof LayoutDashboard }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupKey: 'nav_operations',
    items: [
      { id: 'dashboard', icon: LayoutDashboard },
      { id: 'marey', icon: Compass },
      { id: 'decision_console', icon: CheckSquare },
      { id: 'live_trains', icon: Radio },
      { id: 'digital_twin', icon: Play },
    ],
  },
  {
    groupKey: 'nav_intelligence',
    items: [
      { id: 'optimizer', icon: Cpu },
      { id: 'conflicts', icon: AlertTriangle },
      { id: 'propagation', icon: GitBranch },
      { id: 'delay_prediction', icon: Activity },
      { id: 'platforms', icon: Layers },
      { id: 'weather_disruptions', icon: CloudRain },
      { id: 'maintenance', icon: Wrench },
      { id: 'copilot', icon: Bot },
    ],
  },
  {
    groupKey: 'nav_planning',
    items: [
      { id: 'emergency_insert', icon: Siren },
      { id: 'connections_resources', icon: GitMerge },
      { id: 'capacity_planning', icon: TrendingUp },
      { id: 'what_if', icon: FlaskConical },
      { id: 'energy', icon: Zap },
    ],
  },
  {
    groupKey: 'nav_governance',
    items: [
      { id: 'network', icon: Network },
      { id: 'analytics', icon: BarChart3 },
      { id: 'reports', icon: FileDown },
      { id: 'admin', icon: Settings },
    ],
  },
];

export function Layout({
  activePage,
  onNavigate,
  lang,
  onToggleLang,
  role,
  onChangeRole,
  onOptimize,
  optimizing,
  activeConflictCount,
  children,
}: LayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const pageTitle = lang === 'HI' ? PAGE_LABELS[activePage].hi : PAGE_LABELS[activePage].en;

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#081529] border-r border-slate-800/90 text-slate-200 select-none">
      <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800/90 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-sky-600/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
            <TrainFront className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-slate-50">{t(lang, 'brand')}</div>
            <div className="text-[10px] font-mono text-slate-400">PUNE–DD–SUR CORRIDOR</div>
          </div>
        </div>
        <button onClick={() => setMobileOpen(false)} className="lg:hidden text-slate-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-5">
        {NAV_GROUPS.map((grp) => (
          <div key={grp.groupKey} className="space-y-1">
            <div className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {t(lang, grp.groupKey)}
            </div>
            {grp.items.map(({ id, icon: Icon }) => {
              const isActive = activePage === id;
              const label = lang === 'HI' ? PAGE_LABELS[id].hi : PAGE_LABELS[id].en;
              return (
                <button
                  key={id}
                  onClick={() => {
                    onNavigate(id);
                    setMobileOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-[#162F54] text-sky-300 border border-sky-500/30'
                      : 'text-slate-300 hover:bg-[#102442] hover:text-white border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-sky-400' : 'text-slate-400'}`} />
                    <span className="truncate">{label}</span>
                  </span>
                  {id === 'conflicts' && activeConflictCount > 0 && (
                    <span className="text-[10px] font-mono tabular-nums text-amber-300 shrink-0">{activeConflictCount}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-slate-800/90 text-[10px] text-slate-400 leading-relaxed">
        {t(lang, 'simulatedBadge')}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0B1B33] text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">{sidebarContent}</aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 h-full">{sidebarContent}</div>
          <div className="flex-1 bg-black/60" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Control Bar */}
        <header className="sticky top-0 z-30 h-14 bg-[#0B1B33]/95 backdrop-blur border-b border-slate-800/90 px-4 lg:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setMobileOpen(true)} className="lg:hidden text-slate-300 hover:text-white">
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-sm font-semibold text-slate-100 truncate">{pageTitle}</h1>
          </div>

          <div className="hidden xl:flex items-center gap-2 text-[11px] text-amber-300/90 font-medium truncate">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
            <span className="truncate">{t(lang, 'disclaimer')}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <select
              aria-label="Controller Role"
              value={role}
              onChange={(e) => onChangeRole(e.target.value as UserRole)}
              className="rounded-md bg-[#102442] border border-slate-700 px-2 py-1 text-xs font-mono text-slate-200"
            >
              <option value="ADMIN">ADMIN</option>
              <option value="CONTROLLER">CONTROLLER</option>
              <option value="VIEWER">VIEWER</option>
            </select>

            <button
              onClick={onToggleLang}
              className="px-2 py-1 rounded-md bg-[#102442] hover:bg-[#162F54] border border-slate-700 text-xs font-mono text-slate-200"
            >
              {lang}
            </button>

            <button
              onClick={onOptimize}
              disabled={optimizing || role === 'VIEWER'}
              title={role === 'VIEWER' ? 'Switch role to CONTROLLER or ADMIN to run optimizer' : 'Run constraint scheduler'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors"
            >
              <Cpu className="w-3.5 h-3.5" />
              {optimizing ? t(lang, 'optimizing') : t(lang, 'optimizeBtn')}
            </button>
          </div>
        </header>

        {/* Compact Safety Disclaimer & Active Conflict Strip */}
        <div className="bg-[#081529] border-b border-slate-800/80 px-4 lg:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="font-mono text-sky-400 font-semibold">{t(lang, 'simulatedBadge')}</span>
            <span className="xl:hidden text-amber-300">· {t(lang, 'disclaimer')}</span>
          </div>

          {activeConflictCount > 0 && (
            <button
              onClick={() => onNavigate('conflicts')}
              className="inline-flex items-center gap-1.5 text-amber-300 hover:text-amber-200 font-medium"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>
                <strong className="font-mono tabular-nums">{activeConflictCount}</strong> baseline corridor conflicts detected — inspect or optimize
              </span>
            </button>
          )}
        </div>

        {/* Active Page Canvas */}
        <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
