# RailSmart AI — Problem Statement & 22-Module Architecture Mapping

| Requirement / Module | Implementation Files | Primary REST Endpoints |
|---|---|---|
| M1: Executive Dashboard | `src/pages/ExecutiveDashboard.tsx`, `server/services/verifier.ts` | `GET /api/v1/analytics/kpis`, `/throughput`, `/delay-trend`, `/utilization` |
| M2: Network Management | `src/pages/NetworkReportsAdminPages.tsx`, `server/services/networkService.ts` | `GET/POST/PUT/DELETE /api/v1/stations`, `/sections`, `/network/validate` |
| M3: Live Train Monitoring | `src/pages/LiveTrainsAndTwinPages.tsx`, `src/components/CorridorMap.tsx` | `GET /api/v1/trains`, `/trains/:id/route`, `/trains/:id/why-delayed` |
| M4: AI Delay Prediction (ML) | `src/pages/DelayPredictionPage.tsx`, `server/services/delayModel.ts` | `GET /predict/model-metrics`, `/feature-importance`, `POST /predict/delay`, `/retrain` |
| M5: Smart Train Scheduling | `src/pages/OptimizerAndConflictsPages.tsx`, `server/services/optimizer.ts`, `verifier.ts` | `POST /api/v1/optimize/run`, `GET /optimize/runs`, `POST /infeasibility-diagnosis` |
| M6: Digital Twin Simulation | `src/pages/LiveTrainsAndTwinPages.tsx`, `server/services/simulator.ts` | `POST /api/v1/sim/start`, `POST /api/v1/sim/compare`, `GET /sim/events` |
| M7: Conflict & Congestion | `src/pages/OptimizerAndConflictsPages.tsx`, `server/services/conflictEngine.ts` | `GET /api/v1/conflicts`, `POST /api/v1/conflicts/scan` |
| M8: Smart Platform Allocation | `src/pages/PlatformAllocationPage.tsx`, `server/services/platformAllocator.ts` | `GET /platforms/:stationId/layout`, `POST /platforms/allocate`, `/override` |
| M9: Weather & Disruptions | `src/pages/WeatherMaintenancePages.tsx`, `server/services/weatherEngine.ts` | `GET /weather/live`, `POST /weather`, `GET/POST/DELETE /disruptions` |
| M10: Predictive Maintenance | `src/pages/WeatherMaintenancePages.tsx`, `server/services/maintenanceEngine.ts` | `GET /maintenance/health`, `/anomalies`, `POST /maintenance/orders` |
| M11: Railway AI Copilot | `src/pages/CopilotPage.tsx`, `server/services/copilotEngine.ts`, `copilotHelpers.ts` | `POST /api/v1/copilot/ask`, `GET /api/v1/copilot/history` |
| M12: What-If Scenario Lab | `src/pages/PlanningAdvancedPages.tsx`, `server/services/scenarioEngine.ts` | `POST /scenarios/run`, `POST /scenarios/worst-case`, `GET /scenarios` |
| M13: Energy Efficiency | `src/pages/EnergyAnalyticsPages.tsx`, `server/services/energyEngine.ts` | `GET /api/v1/energy/summary` |
| M14: Performance Analytics | `src/pages/EnergyAnalyticsPages.tsx` | `GET /analytics/delay-trend`, `/optimize/runs` |
| M15: Reports & Downloads | `src/pages/NetworkReportsAdminPages.tsx`, `src/lib/api.ts` | `GET /export/schedule.csv`, `POST /import/trains` + client `jsPDF` & `xlsx` |
| M16: System Administration | `src/pages/NetworkReportsAdminPages.tsx`, `server/services/security.ts` | `GET /admin/health`, `/audit`, `/users`, `PUT /admin/settings`, `POST /admin/seed` |
| M17: Marey Time–Distance Graph | `src/pages/MareyAndDecisionPages.tsx`, `src/components/MareyChart.tsx` | `GET /api/v1/schedules/marey` |
| M18: Controller Decision Console | `src/pages/MareyAndDecisionPages.tsx` | `GET /optimize/runs/:id/recommendations`, `POST /recommendations/:id/accept|reject` |
| M19: Delay Propagation & Blast | `src/pages/OptimizerAndConflictsPages.tsx`, `server/services/propagationService.ts` | `GET /api/v1/conflicts/propagation/:trainId` |
| M20: Emergency Train Insertion | `src/pages/PlanningAdvancedPages.tsx`, `server/services/scenarioEngine.ts` | `POST /api/v1/scenarios/emergency-insert` |
| M21: Connections, Rake & Crew | `src/pages/PlanningAdvancedPages.tsx`, `server/services/scenarioEngine.ts` | `GET /api/v1/scenarios/connections-resources` |
| M22: Resilience & Capacity | `src/pages/PlanningAdvancedPages.tsx`, `server/services/scenarioEngine.ts` | `GET /api/v1/scenarios/capacity-sweep` |
