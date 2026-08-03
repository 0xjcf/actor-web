import {
  assertAgentExecutionConformanceFixture,
  getAgentExecutionConformanceFixture,
} from './agent-execution-conformance.js';
import {
  assertAgentSessionCheckpointConformanceFixture,
  getAgentSessionCheckpointConformanceFixture,
} from './agent-session-checkpoint-conformance.js';
import {
  assertRuntimeHostRecoveryConformanceFixture,
  getRuntimeHostRecoveryConformanceFixture,
} from './runtime-host-recovery-conformance.js';

export interface ControlPlaneConformanceFixture {
  readonly packageName: '@actor-web/testing';
  readonly packageVersion: '0.2.0';
  readonly schemaVersion: 1;
  readonly contractVersion: 1;
  readonly sourceOfTruthOwner: 'Actor-Web';
  readonly composition: Readonly<{
    readonly executionTrace: 'required';
    readonly checkpointRecovery: 'required';
    readonly reconciliationProjection: 'required';
    readonly auditTrail: 'required';
  }>;
  readonly scenarios: readonly ControlPlaneConformanceScenario[];
}

export interface ControlPlaneConformanceScenario {
  readonly name:
    | 'success'
    | 'rejection'
    | 'interruption_resume'
    | 'duplicate_suppression'
    | 'stale_projection'
    | 'operator_reconciliation';
  readonly proofSurface:
    | 'execution_trace'
    | 'checkpoint_recovery'
    | 'execution_trace+checkpoint_recovery';
  readonly expectedOutcome:
    | 'admitted_and_executed'
    | 'rejected_before_effect'
    | 'resume_requires_reconciliation'
    | 'duplicate_effect_not_replayed'
    | 'stale_projection_detected'
    | 'operator_reconciliation_required';
  readonly evidence: Readonly<{
    readonly executionFixture?:
      | 'success'
      | 'schema-rejection'
      | 'domain-rejection'
      | 'authorization-rejection'
      | 'duplicate-suppression'
      | 'interrupted'
      | 'stale-projection';
    readonly checkpointScenario?:
      | 'clean_restart_identity_continuity'
      | 'crash_before_attempt'
      | 'crash_between_attempt_and_receipt'
      | 'crash_after_receipt_before_checkpoint'
      | 'cancellation'
      | 'manual_recovery'
      | 'reconciliation'
      | 'no_duplicate_irreversible_effect';
    readonly recoveryFixture?: 'agent-loop-restart-recovery';
  }>;
}

const COMPOSITION = Object.freeze({
  executionTrace: 'required',
  checkpointRecovery: 'required',
  reconciliationProjection: 'required',
  auditTrail: 'required',
} as const);

const SCENARIOS = Object.freeze([
  Object.freeze({
    name: 'success',
    proofSurface: 'execution_trace',
    expectedOutcome: 'admitted_and_executed',
    evidence: Object.freeze({
      executionFixture: 'success',
    }),
  }),
  Object.freeze({
    name: 'rejection',
    proofSurface: 'execution_trace',
    expectedOutcome: 'rejected_before_effect',
    evidence: Object.freeze({
      executionFixture: 'authorization-rejection',
    }),
  }),
  Object.freeze({
    name: 'interruption_resume',
    proofSurface: 'execution_trace+checkpoint_recovery',
    expectedOutcome: 'resume_requires_reconciliation',
    evidence: Object.freeze({
      executionFixture: 'interrupted',
      checkpointScenario: 'crash_between_attempt_and_receipt',
      recoveryFixture: 'agent-loop-restart-recovery',
    }),
  }),
  Object.freeze({
    name: 'duplicate_suppression',
    proofSurface: 'execution_trace+checkpoint_recovery',
    expectedOutcome: 'duplicate_effect_not_replayed',
    evidence: Object.freeze({
      executionFixture: 'duplicate-suppression',
      checkpointScenario: 'no_duplicate_irreversible_effect',
      recoveryFixture: 'agent-loop-restart-recovery',
    }),
  }),
  Object.freeze({
    name: 'stale_projection',
    proofSurface: 'execution_trace',
    expectedOutcome: 'stale_projection_detected',
    evidence: Object.freeze({
      executionFixture: 'stale-projection',
    }),
  }),
  Object.freeze({
    name: 'operator_reconciliation',
    proofSurface: 'checkpoint_recovery',
    expectedOutcome: 'operator_reconciliation_required',
    evidence: Object.freeze({
      checkpointScenario: 'reconciliation',
      recoveryFixture: 'agent-loop-restart-recovery',
    }),
  }),
] as const satisfies readonly ControlPlaneConformanceScenario[]);

export function listControlPlaneConformanceScenarios(): readonly ControlPlaneConformanceScenario[] {
  return SCENARIOS;
}

export function getControlPlaneConformanceFixture(): ControlPlaneConformanceFixture {
  const success = getAgentExecutionConformanceFixture('success');
  const authorizationRejection = getAgentExecutionConformanceFixture('authorization-rejection');
  const interrupted = getAgentExecutionConformanceFixture('interrupted');
  const duplicateSuppression = getAgentExecutionConformanceFixture('duplicate-suppression');
  const staleProjection = getAgentExecutionConformanceFixture('stale-projection');
  const checkpointFixture = getAgentSessionCheckpointConformanceFixture();
  const recoveryFixture = getRuntimeHostRecoveryConformanceFixture();

  assertAgentExecutionConformanceFixture(success);
  assertAgentExecutionConformanceFixture(authorizationRejection);
  assertAgentExecutionConformanceFixture(interrupted);
  assertAgentExecutionConformanceFixture(duplicateSuppression);
  assertAgentExecutionConformanceFixture(staleProjection);
  assertAgentSessionCheckpointConformanceFixture();
  assertRuntimeHostRecoveryConformanceFixture(recoveryFixture);

  const reconciliationScenario = checkpointFixture.scenarios.find(
    (scenario) => scenario.name === 'reconciliation'
  );
  const interruptionScenario = checkpointFixture.scenarios.find(
    (scenario) => scenario.name === 'crash_between_attempt_and_receipt'
  );
  const duplicateScenario = checkpointFixture.scenarios.find(
    (scenario) => scenario.name === 'no_duplicate_irreversible_effect'
  );

  if (!reconciliationScenario || !interruptionScenario || !duplicateScenario) {
    throw new Error('Control-plane conformance fixture prerequisites are unavailable.');
  }

  if (authorizationRejection.trace.receipts.some((receipt) => 'effectId' in receipt)) {
    throw new Error('Rejection conformance must not claim effect execution evidence.');
  }
  if (interruptionScenario.outcome.outcome !== 'deferred_for_reconciliation') {
    throw new Error('Interrupted control-plane resume must stay reconciliation-gated.');
  }
  if (duplicateScenario.outcome.outcome !== 'deferred_for_reconciliation') {
    throw new Error('Duplicate suppression recovery must stay reconciliation-gated.');
  }
  if (reconciliationScenario.outcome.outcome !== 'deferred_for_reconciliation') {
    throw new Error('Operator reconciliation must remain an explicit recovery outcome.');
  }

  return Object.freeze({
    packageName: '@actor-web/testing',
    packageVersion: '0.2.0',
    schemaVersion: 1,
    contractVersion: 1,
    sourceOfTruthOwner: 'Actor-Web',
    composition: COMPOSITION,
    scenarios: SCENARIOS,
  });
}

export function assertControlPlaneConformanceFixture(
  fixture: ControlPlaneConformanceFixture
): { ok: true } {
  if (fixture.packageName !== '@actor-web/testing') {
    throw new Error(`Unexpected control-plane fixture package ${fixture.packageName}.`);
  }
  if (fixture.packageVersion !== '0.2.0') {
    throw new Error(`Unexpected control-plane fixture version ${fixture.packageVersion}.`);
  }
  if (fixture.schemaVersion !== 1 || fixture.contractVersion !== 1) {
    throw new Error('Control-plane fixture must remain on schemaVersion=1 and contractVersion=1.');
  }
  if (fixture.sourceOfTruthOwner !== 'Actor-Web') {
    throw new Error('Control-plane fixture source of truth must remain Actor-Web.');
  }
  if (
    fixture.composition.executionTrace !== 'required' ||
    fixture.composition.checkpointRecovery !== 'required' ||
    fixture.composition.reconciliationProjection !== 'required' ||
    fixture.composition.auditTrail !== 'required'
  ) {
    throw new Error('Control-plane fixture composition is incomplete.');
  }

  const scenarioNames = fixture.scenarios.map((scenario) => scenario.name);
  const expectedScenarioNames = [
    'success',
    'rejection',
    'interruption_resume',
    'duplicate_suppression',
    'stale_projection',
    'operator_reconciliation',
  ] satisfies readonly ControlPlaneConformanceScenario['name'][];
  if (scenarioNames.length !== expectedScenarioNames.length) {
    throw new Error('Control-plane fixture scenario count drifted.');
  }
  for (const expectedScenarioName of expectedScenarioNames) {
    if (!scenarioNames.includes(expectedScenarioName)) {
      throw new Error(`Control-plane fixture is missing ${expectedScenarioName}.`);
    }
  }

  return { ok: true };
}
