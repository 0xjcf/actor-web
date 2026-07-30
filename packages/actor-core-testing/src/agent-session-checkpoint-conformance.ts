import {
  AGENT_SESSION_CHECKPOINT_SCHEMA_VERSION,
  type AgentSessionCheckpointReadOutcome,
  type AgentSessionCheckpointRehydrationOutcome,
  type AgentSessionCheckpointWriteOutcome,
  createAgentSessionCheckpointEnvelope,
  deriveAgentSessionCheckpointRehydration,
} from '@actor-web/runtime';

export interface AgentSessionCheckpointConformanceFixture {
  readonly packageName: '@actor-web/testing';
  readonly packageVersion: '0.2.0';
  readonly schemaVersion: 1;
  readonly sourceOfTruthOwner: 'Actor-Web';
  readonly readOutcomes: readonly AgentSessionCheckpointReadOutcome[];
  readonly writeOutcomes: readonly AgentSessionCheckpointWriteOutcome[];
  readonly rehydrationOutcomes: readonly AgentSessionCheckpointRehydrationOutcome[];
  readonly representativeCheckpoint: ReturnType<typeof createAgentSessionCheckpointEnvelope>;
  readonly scenarios: readonly AgentSessionCheckpointConformanceScenario[];
}

export interface AgentSessionCheckpointConformanceScenario {
  readonly name:
    | 'clean_restart_identity_continuity'
    | 'crash_before_attempt'
    | 'crash_between_attempt_and_receipt'
    | 'crash_after_receipt_before_checkpoint'
    | 'cancellation'
    | 'manual_recovery'
    | 'reconciliation'
    | 'no_duplicate_irreversible_effect';
  readonly proofSurface: 'checkpoint_seam';
  readonly outcome: ReturnType<typeof deriveAgentSessionCheckpointRehydration>;
  readonly note: string;
}

function getOutcomeKeys<TOutcome extends string>(
  outcomes: Readonly<Record<TOutcome, true>>
): readonly TOutcome[] {
  return Object.freeze(Object.keys(outcomes) as TOutcome[]);
}

const READ_OUTCOME_SET: Readonly<Record<AgentSessionCheckpointReadOutcome, true>> = {
  missing: true,
  present: true,
  stale: true,
  corrupt: true,
  version_mismatch: true,
  expired: true,
  redacted: true,
};

const WRITE_OUTCOME_SET: Readonly<Record<AgentSessionCheckpointWriteOutcome, true>> = {
  stored: true,
  replaced: true,
  duplicate: true,
  too_large: true,
  expired: true,
  rejected: true,
};

const REHYDRATION_OUTCOME_SET: Readonly<Record<AgentSessionCheckpointRehydrationOutcome, true>> = {
  resumed: true,
  deferred_for_reconciliation: true,
  manual_recovery_required: true,
};

const READ_OUTCOMES = getOutcomeKeys(READ_OUTCOME_SET);
const WRITE_OUTCOMES = getOutcomeKeys(WRITE_OUTCOME_SET);
const REHYDRATION_OUTCOMES = getOutcomeKeys(REHYDRATION_OUTCOME_SET);
const FIXTURE_CONTINUATION_FORMATS = [
  {
    provider: 'fixture-provider',
    adapter: 'fixture-provider-adapter',
    formatVersion: 1,
  },
] as const;

function deriveFixtureRehydration(
  result: Parameters<typeof deriveAgentSessionCheckpointRehydration>[0]
): ReturnType<typeof deriveAgentSessionCheckpointRehydration> {
  return deriveAgentSessionCheckpointRehydration(result, {
    supportedContinuationFormats: FIXTURE_CONTINUATION_FORMATS,
  });
}

const REPRESENTATIVE_CHECKPOINT = createAgentSessionCheckpointEnvelope({
  sessionId: 'session:checkpoint:fixture',
  checkpointId: 'checkpoint:fixture:001',
  actor: {
    actorId: 'runtime://agent/session:checkpoint:fixture',
    sessionId: 'session:checkpoint:fixture',
    turnId: 'turn:fixture:001',
    traceId: 'trace:fixture:001',
    commandId: 'command:fixture:001',
    correlationId: 'corr:fixture:001',
    causationId: 'cause:fixture:001',
  },
  deterministic: {
    history: [{ role: 'user', content: 'Resume work.' }],
    steps: 1,
    pendingToolCalls: [],
    lastError: null,
  },
  effect: {
    effectId: 'effect:fixture:001',
    effectAttemptId: 'effect-attempt:fixture:001',
    phase: 'intent_recorded',
    irreversible: true,
    intent: {
      effectType: 'tool_call',
      toolName: 'repo.diff',
      idempotencyScope: 'tool:repo.diff',
    },
  },
  continuation: {
    provider: 'fixture-provider',
    adapter: 'fixture-provider-adapter',
    formatVersion: 1,
    payload: {
      cursor: 'opaque-state',
    },
    payloadBytes: new TextEncoder().encode(
      JSON.stringify({
        cursor: 'opaque-state',
      })
    ).byteLength,
    redaction: {
      disposition: 'none',
      fields: [],
    },
  },
  reconciliation: {
    status: 'pending',
    reason: 'awaiting_effect_receipt',
  },
  recordedAt: '2026-07-29T13:45:00.000Z',
  expiresAt: null,
});

const CLEAN_RESTART_CHECKPOINT = createAgentSessionCheckpointEnvelope({
  ...REPRESENTATIVE_CHECKPOINT,
  checkpointId: 'checkpoint:fixture:clean-restart',
  effect: {
    effectId: 'effect:fixture:clean-restart',
    effectAttemptId: 'effect-attempt:fixture:clean-restart',
    phase: 'receipt_recorded',
    irreversible: true,
    intent: {
      effectType: 'tool_call',
      toolName: 'repo.diff',
      idempotencyScope: 'tool:repo.diff',
    },
    receipt: {
      outcome: 'ok',
    },
  },
  reconciliation: {
    status: 'clear',
  },
});

const CANCELLATION_CHECKPOINT = createAgentSessionCheckpointEnvelope({
  ...REPRESENTATIVE_CHECKPOINT,
  checkpointId: 'checkpoint:fixture:cancelled',
  deterministic: {
    history: [
      { role: 'user', content: 'Resume work.' },
      { role: 'assistant', content: 'Cancelled by operator.' },
    ],
    steps: 1,
    pendingToolCalls: [],
    lastError: {
      code: 'CANCELLED',
      message: 'Operator cancelled the in-flight turn.',
    },
  },
  effect: null,
  continuation: null,
  reconciliation: {
    status: 'clear',
  },
});

const CRASH_BETWEEN_ATTEMPT_AND_RECEIPT_CHECKPOINT = createAgentSessionCheckpointEnvelope({
  ...REPRESENTATIVE_CHECKPOINT,
  checkpointId: 'checkpoint:fixture:attempt-without-receipt',
  effect: {
    effectId: 'effect:fixture:attempt-without-receipt',
    effectAttemptId: 'effect-attempt:fixture:attempt-without-receipt',
    phase: 'intent_recorded',
    irreversible: true,
    intent: {
      effectType: 'tool_call',
      toolName: 'repo.diff',
      idempotencyScope: 'tool:repo.diff',
    },
  },
  reconciliation: {
    status: 'pending',
    reason: 'awaiting_effect_receipt',
  },
});

const CRASH_AFTER_RECEIPT_BEFORE_CHECKPOINT = createAgentSessionCheckpointEnvelope({
  ...REPRESENTATIVE_CHECKPOINT,
  checkpointId: 'checkpoint:fixture:receipt-ahead-of-checkpoint',
  effect: {
    effectId: 'effect:fixture:receipt-ahead-of-checkpoint',
    effectAttemptId: 'effect-attempt:fixture:receipt-ahead-of-checkpoint',
    phase: 'receipt_recorded',
    irreversible: true,
    intent: {
      effectType: 'tool_call',
      toolName: 'repo.diff',
      idempotencyScope: 'tool:repo.diff',
    },
    receipt: {
      outcome: 'ok',
      source: 'effect_journal',
    },
  },
  reconciliation: {
    status: 'pending',
    reason: 'effect_receipt_ahead_of_agent_checkpoint',
  },
});

const RECONCILIATION_CHECKPOINT = createAgentSessionCheckpointEnvelope({
  ...REPRESENTATIVE_CHECKPOINT,
  checkpointId: 'checkpoint:fixture:reconciliation-cursor',
  effect: null,
  reconciliation: {
    status: 'required',
    reason: 'runtime_reconciliation_cursor_pending',
  },
});

const NO_DUPLICATE_IRREVERSIBLE_EFFECT_CHECKPOINT = createAgentSessionCheckpointEnvelope({
  ...REPRESENTATIVE_CHECKPOINT,
  checkpointId: 'checkpoint:fixture:no-duplicate-effect',
  effect: {
    effectId: 'effect:fixture:no-duplicate-effect',
    effectAttemptId: 'effect-attempt:fixture:no-duplicate-effect',
    phase: 'reconciliation_required',
    irreversible: true,
    intent: {
      effectType: 'tool_call',
      toolName: 'repo.diff',
      idempotencyScope: 'tool:repo.diff',
    },
  },
  reconciliation: {
    status: 'required',
    reason: 'verify_irreversible_effect_before_retry',
  },
});

const SCENARIOS = [
  {
    name: 'clean_restart_identity_continuity',
    proofSurface: 'checkpoint_seam',
    outcome: deriveFixtureRehydration({
      outcome: 'present',
      envelope: CLEAN_RESTART_CHECKPOINT,
    }),
    note: 'The same actor/session/turn/trace/command lineage is present on the resumed checkpoint.',
  },
  {
    name: 'crash_before_attempt',
    proofSurface: 'checkpoint_seam',
    outcome: deriveFixtureRehydration({
      outcome: 'missing',
      sessionId: 'session:checkpoint:fixture',
    }),
    note: 'No durable checkpoint exists yet, so resume requires manual recovery.',
  },
  {
    name: 'crash_between_attempt_and_receipt',
    proofSurface: 'checkpoint_seam',
    outcome: deriveFixtureRehydration({
      outcome: 'present',
      envelope: CRASH_BETWEEN_ATTEMPT_AND_RECEIPT_CHECKPOINT,
    }),
    note: 'An irreversible effect intent was recorded without a settled receipt, so rehydration defers to reconciliation.',
  },
  {
    name: 'crash_after_receipt_before_checkpoint',
    proofSurface: 'checkpoint_seam',
    outcome: deriveFixtureRehydration({
      outcome: 'present',
      envelope: CRASH_AFTER_RECEIPT_BEFORE_CHECKPOINT,
    }),
    note: 'An effect-journal receipt ahead of the agent checkpoint remains reconciliation-gated.',
  },
  {
    name: 'cancellation',
    proofSurface: 'checkpoint_seam',
    outcome: deriveFixtureRehydration({
      outcome: 'present',
      envelope: CANCELLATION_CHECKPOINT,
    }),
    note: 'A cancelled deterministic state can resume without reviving pending irreversible work.',
  },
  {
    name: 'manual_recovery',
    proofSurface: 'checkpoint_seam',
    outcome: deriveFixtureRehydration({
      outcome: 'corrupt',
      sessionId: 'session:checkpoint:fixture',
      detail: 'invalid_json',
    }),
    note: 'Corrupt checkpoint payloads require manual recovery.',
  },
  {
    name: 'reconciliation',
    proofSurface: 'checkpoint_seam',
    outcome: deriveFixtureRehydration({
      outcome: 'present',
      envelope: RECONCILIATION_CHECKPOINT,
    }),
    note: 'Pending reconciliation remains explicit and is not collapsed into resumed execution.',
  },
  {
    name: 'no_duplicate_irreversible_effect',
    proofSurface: 'checkpoint_seam',
    outcome: deriveFixtureRehydration({
      outcome: 'present',
      envelope: NO_DUPLICATE_IRREVERSIBLE_EFFECT_CHECKPOINT,
    }),
    note: 'The seam defers instead of replaying an irreversible effect whose receipt is not durably settled.',
  },
] as const satisfies readonly AgentSessionCheckpointConformanceScenario[];

export function getAgentSessionCheckpointConformanceFixture(): AgentSessionCheckpointConformanceFixture {
  return Object.freeze({
    packageName: '@actor-web/testing',
    packageVersion: '0.2.0',
    schemaVersion: AGENT_SESSION_CHECKPOINT_SCHEMA_VERSION,
    sourceOfTruthOwner: 'Actor-Web',
    readOutcomes: READ_OUTCOMES,
    writeOutcomes: WRITE_OUTCOMES,
    rehydrationOutcomes: REHYDRATION_OUTCOMES,
    representativeCheckpoint: REPRESENTATIVE_CHECKPOINT,
    scenarios: SCENARIOS,
  });
}

export function assertAgentSessionCheckpointConformanceFixture(): {
  readonly ok: true;
  readonly rehydration: ReturnType<typeof deriveAgentSessionCheckpointRehydration>;
} {
  return {
    ok: true,
    rehydration: deriveFixtureRehydration({
      outcome: 'present',
      envelope: REPRESENTATIVE_CHECKPOINT,
    }),
  };
}
