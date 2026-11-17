# RailSmart AI — 5-Minute Live Control-Room Demo Script

## 0:00 – 0:45 | Corridor Problem & Executive Baseline
1. Open **Executive Dashboard** (`dashboard`). Point out the synthetic **Pune → Daund → Solapur** 12-station, 196 km corridor with a single-line bottleneck (`DD–KWV`) and double-track outer sections (`PUNE–DD`, `KWV–SUR`).
2. Highlight the **SIMULATED DATA** badge and mandatory **Section Controller Decision-Support Disclaimer** in the header bar.
3. Show the before/after KPIs computed live from SQLite (`Original` baseline conflicts vs `Optimized` 0 conflicts, ~42% delay reduction, +16.7% throughput).

## 0:45 – 1:45 | Marey Time–Distance Diagram & Explainable Decision Console
1. Switch to **Time–Distance (Marey) Graph** (`marey`). Toggle between **Original**, **Optimized**, and **Overlay** views. Point out the shaded single-line bottleneck zone (`DD–KWV`) where crossing holds and loop-line overtakes eliminate head-on conflicts.
2. Open **Decision Console** (`decision_console`). Show each actionable recommendation (`HOLD_AT_LOOP`, `CROSSING_WAIT`, `OVERTAKE_HOLD`) with its exact `rule_ref`, benefited vs penalized trains, and one-click **Accept / Reject** persisted to `audit_log`.

## 1:45 – 2:45 | Digital Twin Replay & Multi-Hop Blast Radius
1. Open **Digital Twin Simulation** (`digital_twin`). Run a side-by-side seeded comparison (`seed = 42`) between the **Original** and **Optimized** timetables and point out the live KPI delta and chronological event feed.
2. Switch to **Delay Propagation & Blast** (`propagation`), inject a +20 min delay on Superfast `12127` (*Mumbai–Pune Intercity*), and trace the multi-hop headway/crossing/platform cascade across downstream trains.

## 2:45 – 3:45 | ML Delay Prediction, Weather & Predictive Maintenance
1. Open **AI Delay Prediction (ML)** (`delay_prediction`). Inspect the 18-tree Bagged Random Forest out-of-sample benchmark vs Gradient Boosting and Ridge, 4×4 confusion matrix, Brier calibration check, and run a live single-train 80% confidence interval prediction.
2. Visit **Weather & Disruptions** (`weather_disruptions`) to fetch live **Open-Meteo** weather for Daund Junction (with transparent fallback) or inject a `TSR` / `SECTION_BLOCK` and watch automatic re-optimization.

## 3:45 – 4:30 | Grounded Railway Copilot & Emergency Insertion
1. Open **Railway AI Copilot** (`copilot`). Click *"What happens if train 12127 is delayed by 20 minutes?"* and expand **Show SQL & Evidence** to prove deterministic tool grounding.
2. Open **Emergency Train Insertion** (`emergency_insert`), inject `EM-99` (*VIP Relief Special*), and verify how the solver inserts it at priority 10 while keeping corridor disturbance minimal.

## 4:30 – 5:00 | Capacity ROI, Reports & Governance
1. Open **Resilience & Capacity** (`capacity_planning`) to view the +0 to +10 train saturation curve and ranked section doubling ROI.
2. Visit **Reports & Downloads** (`reports`) to export a live PDF briefing or multi-sheet Excel workbook.
