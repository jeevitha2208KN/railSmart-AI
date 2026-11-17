import assert from 'node:assert/strict';
import { getDb } from '../server/db/database.ts';
import { seedDatabase } from '../server/db/seed.ts';
import { runOptimization } from '../server/services/optimizer.ts';
import { runDigitalTwinSimulation } from '../server/services/simulator.ts';
import { trainDelayModel, predictTrainDelay } from '../server/services/delayModel.ts';
import { askCopilot } from '../server/services/copilotEngine.ts';
import { scanConflicts } from '../server/services/conflictEngine.ts';
import { analyzeMaintenanceHealth } from '../server/services/maintenanceEngine.ts';
import { computeEnergySummary } from '../server/services/energyEngine.ts';
import { insertEmergencyTrainAndReplan, runCapacitySweep, runWhatIfScenario } from '../server/services/scenarioEngine.ts';
import { allocatePlatformsForStation } from '../server/services/platformAllocator.ts';

async function main() {
  console.log('1. Initializing & seeding SQLite corridor database...');
  getDb();
  const seed = seedDatabase(true);
  assert.equal(seed.counts.stations, 12, 'Expected 12 stations');
  assert.equal(seed.counts.sections, 11, 'Expected 11 sections');
  assert.ok(seed.counts.trains >= 60, 'Expected >= 60 trains');
  assert.ok(seed.counts.delay_history >= 15000, 'Expected >= 15k delay history rows');

  console.log('2. Verifying constraint optimization & independent 7-rule verifier...');
  const opt = runOptimization({ persist: true });
  assert.equal(opt.status, 'OPTIMAL');
  assert.equal(opt.valid, true, `Verifier failed: ${JSON.stringify(opt.constraint_report)}`);
  assert.ok(opt.optimized_kpis.total_delay_min < opt.original_kpis.total_delay_min, 'Optimized delay must beat original');
  assert.equal(opt.optimized_kpis.conflict_count, 0, 'Optimized schedule must have 0 conflicts');
  console.log(`   PASS: Delay ${opt.original_kpis.total_delay_min}m -> ${opt.optimized_kpis.total_delay_min}m, 0 conflicts, ${opt.solve_time_ms}ms`);

  console.log('3. Verifying Digital Twin deterministic seed parity...');
  const simA = runDigitalTwinSimulation({ scheduleKind: 'OPTIMIZED', seed: 42, persist: false });
  const simB = runDigitalTwinSimulation({ scheduleKind: 'OPTIMIZED', seed: 42, persist: false });
  assert.deepEqual(simA.kpis, simB.kpis, 'Digital Twin with identical seed must be strictly deterministic');
  assert.equal(simA.kpis.conflict_count, 0, 'Optimized twin run should execute with 0 safety violations');

  console.log('4. Verifying ML Delay Model training & 80% CI calibration...');
  const model = trainDelayModel(true);
  assert.ok(model.sampleCount >= 2000, 'Expected >= 2000 stratified training samples');
  assert.ok(model.metrics.random_forest.r2 > 0.7, 'Expected R2 > 0.7');
  assert.equal(model.calibrated, true, 'Model should pass Brier calibration check');
  const pred = predictTrainDelay({ hour: 8, prev_delay_min: 10, congestion_index: 0.75, weather: 'FOG', station_id: 6 });
  assert.ok(pred.interval_80_pct[0] <= pred.predicted_delay_min && pred.predicted_delay_min <= pred.interval_80_pct[1]);

  console.log('5. Verifying Conflict, Maintenance, Energy, Platform & Capacity engines...');
  const origConflicts = scanConflicts('ORIGINAL', false);
  assert.ok(origConflicts.length > 0, 'Original corridor should expose baseline conflicts');
  const maint = analyzeMaintenanceHealth();
  assert.ok(maint.anomalies.length >= 1, 'Maintenance detector should surface injected anomalies');
  const energy = computeEnergySummary();
  assert.ok(energy.savings_kwh >= 0);
  const pfAlloc = allocatePlatformsForStation(5);
  assert.ok(pfAlloc.reassigned_count > 0);
  const cap = runCapacitySweep();
  assert.ok(cap.curve.length >= 5 && cap.infrastructure_roi.length === 11);
  const whatIf = runWhatIfScenario({ name: 'Test Fog', type: 'FOG_PROTOCOL', persist: false });
  assert.ok(whatIf.optimized_kpis.conflict_count < whatIf.original_kpis.conflict_count, 'Optimized schedule must incur fewer conflicts under fog');
  assert.ok(whatIf.optimized_kpis.completed_trains > 0, 'Simulation must complete train runs');

  console.log('6. Verifying Copilot across 25 operational test questions...');
  const questions = [
    'Which trains are delayed?',
    'What is the most congested section?',
    'Why is train G-501 delayed?',
    'How much did optimization improve delay and throughput?',
    'What conflicts exist right now?',
    'What happens if train 12127 is delayed by 20 minutes?',
    'Which trains violate headway or single-line rules?',
    'Which platform has the highest load at DD?',
    'What weather protocol is active?',
    'Which track sections need maintenance?',
    'How much energy and CO2 is saved?',
    'How many more trains can the corridor handle?',
    'Which station has the most congestion?',
    'List superfast and express trains',
    'List goods freight trains',
    'What are the passenger connections?',
    'Show rake turnaround status',
    'Are any crews exceeding duty limits?',
    'Which recommendations were generated?',
    'What is the on-time performance percentage?',
    'What disruptions or TSRs are active?',
    'Show system health counts',
    'Which trains are UP direction?',
    'Which trains are DOWN direction?',
    'What is the bottleneck cycle time?',
  ];
  for (const q of questions) {
    const resp = await askCopilot(q);
    assert.ok(resp.answer && resp.answer.length > 10, `Empty copilot answer for: ${q}`);
    assert.ok(resp.sql_or_tool_used.length > 0, `Missing SQL/tool provenance for: ${q}`);
  }
  console.log(`   PASS: All ${questions.length} Copilot prompts returned grounded answers with provenance.`);

  console.log('7. Verifying Emergency train insertion & clean re-seed...');
  const em = insertEmergencyTrainAndReplan({ train_no: 'EM-99', name: 'Test Relief', category: 'EMERGENCY', direction: 'UP', dep_min: 440, priority: 10 });
  assert.ok(em.inserted_train_id > 0);

  // Restore pristine seeded + optimized state for the live app
  seedDatabase(true);
  scanConflicts('ORIGINAL', true);
  runOptimization({ persist: true });

  console.log('ALL VERIFICATION CHECKS PASSED!');
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
