/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState } from 'react';
import { Layout } from './components/Layout.tsx';
import { apiFetch, setClientAuth } from './lib/api.ts';
import type { ConflictItem, Lang, PageId, UserRole } from './types/rail.ts';

import { ExecutiveDashboard } from './pages/ExecutiveDashboard.tsx';
import { DecisionConsole, MareyPage } from './pages/MareyAndDecisionPages.tsx';
import { DigitalTwinPage, LiveTrainsPage } from './pages/LiveTrainsAndTwinPages.tsx';
import { ConflictsPage, OptimizerPage, PropagationPage } from './pages/OptimizerAndConflictsPages.tsx';
import { DelayPredictionPage } from './pages/DelayPredictionPage.tsx';
import { PlatformAllocationPage } from './pages/PlatformAllocationPage.tsx';
import { MaintenancePage, WeatherDisruptionsPage } from './pages/WeatherMaintenancePages.tsx';
import { CopilotPage } from './pages/CopilotPage.tsx';
import {
  CapacityPlanningPage,
  ConnectionsResourcesPage,
  EmergencyInsertPage,
  WhatIfPage,
} from './pages/PlanningAdvancedPages.tsx';
import { AnalyticsPage, EnergyPage } from './pages/EnergyAnalyticsPages.tsx';
import { AdminPage, NetworkPage, ReportsPage } from './pages/NetworkReportsAdminPages.tsx';

export default function App() {
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [lang, setLang] = useState<Lang>('EN');
  const [role, setRole] = useState<UserRole>('CONTROLLER');
  const [refreshTick, setRefreshTick] = useState(0);
  const [optimizing, setOptimizing] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [activeConflictCount, setActiveConflictCount] = useState(0);

  const bumpRefresh = () => setRefreshTick((t) => t + 1);

  useEffect(() => {
    setClientAuth(role);
  }, [role]);

  useEffect(() => {
    apiFetch<ConflictItem[]>('/conflicts?kind=ORIGINAL')
      .then((list) => setActiveConflictCount(list.length))
      .catch(() => {});
  }, [refreshTick]);

  const handleGlobalOptimize = async () => {
    setOptimizing(true);
    setGlobalError(null);
    try {
      await apiFetch('/optimize/run', { method: 'POST', body: JSON.stringify({}) });
      bumpRefresh();
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : 'Optimization failed');
    } finally {
      setOptimizing(false);
    }
  };

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return <ExecutiveDashboard lang={lang} refreshTick={refreshTick} onNavigate={setActivePage} />;
      case 'marey':
        return <MareyPage refreshTick={refreshTick} onOptimize={handleGlobalOptimize} optimizing={optimizing} />;
      case 'decision_console':
        return <DecisionConsole refreshTick={refreshTick} role={role} onChanged={bumpRefresh} />;
      case 'live_trains':
        return <LiveTrainsPage refreshTick={refreshTick} />;
      case 'digital_twin':
        return <DigitalTwinPage />;
      case 'optimizer':
        return <OptimizerPage refreshTick={refreshTick} onOptimized={bumpRefresh} />;
      case 'conflicts':
        return <ConflictsPage refreshTick={refreshTick} />;
      case 'propagation':
        return <PropagationPage />;
      case 'delay_prediction':
        return <DelayPredictionPage refreshTick={refreshTick} />;
      case 'platforms':
        return <PlatformAllocationPage refreshTick={refreshTick} />;
      case 'weather_disruptions':
        return <WeatherDisruptionsPage refreshTick={refreshTick} onMutated={bumpRefresh} />;
      case 'maintenance':
        return <MaintenancePage refreshTick={refreshTick} />;
      case 'copilot':
        return <CopilotPage />;
      case 'emergency_insert':
        return <EmergencyInsertPage onMutated={bumpRefresh} />;
      case 'connections_resources':
        return <ConnectionsResourcesPage refreshTick={refreshTick} />;
      case 'capacity_planning':
        return <CapacityPlanningPage refreshTick={refreshTick} />;
      case 'what_if':
        return <WhatIfPage />;
      case 'energy':
        return <EnergyPage refreshTick={refreshTick} />;
      case 'network':
        return <NetworkPage refreshTick={refreshTick} onMutated={bumpRefresh} />;
      case 'analytics':
        return <AnalyticsPage refreshTick={refreshTick} />;
      case 'reports':
        return <ReportsPage refreshTick={refreshTick} />;
      case 'admin':
        return <AdminPage refreshTick={refreshTick} onMutated={bumpRefresh} />;
      default:
        return <ExecutiveDashboard lang={lang} refreshTick={refreshTick} onNavigate={setActivePage} />;
    }
  };

  return (
    <Layout
      activePage={activePage}
      onNavigate={setActivePage}
      lang={lang}
      onToggleLang={() => setLang((l) => (l === 'EN' ? 'HI' : 'EN'))}
      role={role}
      onChangeRole={(r) => {
        setClientAuth(r);
        setRole(r);
      }}
      onOptimize={handleGlobalOptimize}
      optimizing={optimizing}
      activeConflictCount={activeConflictCount}
    >
      {globalError && (
        <div className="mb-4 rounded-lg bg-rose-950/50 border border-rose-500/40 px-4 py-2.5 text-xs text-rose-200 flex items-center justify-between">
          <span>{globalError}</span>
          <button onClick={() => setGlobalError(null)} className="underline ml-4">
            Dismiss
          </button>
        </div>
      )}
      {renderPage()}
    </Layout>
  );
}
