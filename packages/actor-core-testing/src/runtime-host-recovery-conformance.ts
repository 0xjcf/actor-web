import {
  assertAgentExecutionConformanceFixture,
  listAgentExecutionConformanceFixtures,
} from './agent-execution-conformance.js';
import {
  assertAgentSessionCheckpointConformanceFixture,
  getAgentSessionCheckpointConformanceFixture,
} from './agent-session-checkpoint-conformance.js';

export interface RuntimeHostRecoveryConformanceFixture {
  readonly name: 'agent-loop-restart-recovery';
  readonly packageName: '@actor-web/testing';
  readonly packageVersion: '0.2.0';
  readonly contractVersion: 1;
  readonly sourceOfTruthOwner: 'Actor-Web';
  readonly checkpointScenario:
    | 'crash_between_attempt_and_receipt'
    | 'no_duplicate_irreversible_effect';
  readonly expected: {
    readonly restartBeforeReceipt: 'deferred_for_reconciliation';
    readonly noDuplicateIrreversibleEffect: 'deferred_for_reconciliation';
    readonly reconciliationReceiptRequired: true;
  };
}

export function getRuntimeHostRecoveryConformanceFixture(): RuntimeHostRecoveryConformanceFixture {
  const checkpointFixture = getAgentSessionCheckpointConformanceFixture();
  const executionFixture = listAgentExecutionConformanceFixtures().find(
    (fixture) => fixture.name === 'duplicate-suppression'
  );
  assertAgentSessionCheckpointConformanceFixture();
  if (!executionFixture) {
    throw new Error('Runtime host recovery conformance requires the duplicate-suppression fixture.');
  }
  assertAgentExecutionConformanceFixture(executionFixture);

  const crashBetweenAttemptAndReceipt = checkpointFixture.scenarios.find(
    (scenario) => scenario.name === 'crash_between_attempt_and_receipt'
  );
  const noDuplicateEffect = checkpointFixture.scenarios.find(
    (scenario) => scenario.name === 'no_duplicate_irreversible_effect'
  );
  const reconciliationReceipt = executionFixture.trace.receipts.find(
    (receipt) => receipt.receiptKind === 'reconciliation'
  );
  if (!crashBetweenAttemptAndReceipt || !noDuplicateEffect || !reconciliationReceipt) {
    throw new Error('Runtime host recovery conformance fixture prerequisites are unavailable.');
  }
  if (crashBetweenAttemptAndReceipt.outcome.outcome !== 'deferred_for_reconciliation') {
    throw new Error(
      'Runtime host recovery fixture requires pre-receipt restart to remain reconciliation-gated.'
    );
  }
  if (noDuplicateEffect.outcome.outcome !== 'deferred_for_reconciliation') {
    throw new Error(
      'Runtime host recovery fixture requires duplicate irreversible effects to stay reconciliation-gated.'
    );
  }
  if (reconciliationReceipt.receiptKind !== 'reconciliation') {
    throw new Error('Runtime host recovery fixture requires an explicit reconciliation receipt.');
  }

  return Object.freeze({
    name: 'agent-loop-restart-recovery',
    packageName: '@actor-web/testing',
    packageVersion: '0.2.0',
    contractVersion: 1,
    sourceOfTruthOwner: 'Actor-Web',
    checkpointScenario: 'crash_between_attempt_and_receipt',
    expected: Object.freeze({
      restartBeforeReceipt: 'deferred_for_reconciliation',
      noDuplicateIrreversibleEffect: 'deferred_for_reconciliation',
      reconciliationReceiptRequired: true,
    }),
  });
}

export function assertRuntimeHostRecoveryConformanceFixture(
  fixture: RuntimeHostRecoveryConformanceFixture
): void {
  if (fixture.name !== 'agent-loop-restart-recovery') {
    throw new Error(`Unexpected runtime host recovery fixture ${fixture.name}.`);
  }
  if (fixture.expected.restartBeforeReceipt !== 'deferred_for_reconciliation') {
    throw new Error(
      'Runtime host recovery fixture must defer pre-receipt restarts for reconciliation.'
    );
  }
  if (fixture.expected.noDuplicateIrreversibleEffect !== 'deferred_for_reconciliation') {
    throw new Error(
      'Runtime host recovery fixture must defer duplicate irreversible effects for reconciliation.'
    );
  }
  if (!fixture.expected.reconciliationReceiptRequired) {
    throw new Error('Runtime host recovery fixture must require a reconciliation receipt.');
  }
}
