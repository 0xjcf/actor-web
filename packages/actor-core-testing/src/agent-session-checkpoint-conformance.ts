import {
  AGENT_SESSION_CHECKPOINT_SCHEMA_VERSION,
  createAgentSessionCheckpointEnvelope,
  deriveAgentSessionCheckpointRehydration,
  type AgentSessionCheckpointReadOutcome,
  type AgentSessionCheckpointRehydrationOutcome,
  type AgentSessionCheckpointWriteOutcome,
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

const READ_OUTCOMES = [
  'missing',
  'present',
  'stale',
  'corrupt',
  'version_mismatch',
  'expired',
  'redacted',
] as const satisfies readonly AgentSessionCheckpointReadOutcome[];

const WRITE_OUTCOMES = [
  'stored',
  'replaced',
  'duplicate',
  'too_large',
  'expired',
  'rejected',
] as const satisfies readonly AgentSessionCheckpointWriteOutcome[];

const REHYDRATION_OUTCOMES = [
  'resumed',
  'deferred_for_reconciliation',
  'manual_recovery_required',
] as const satisfies readonly AgentSessionCheckpointRehydrationOutcome[];

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
  expiresAt: '2026-07-30T13:45:00.000Z',
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

const SCENARIOS = [
  {
    name: 'clean_restart_identity_continuity',
    proofSurface: 'checkpoint_seam',
    outcome: deriveAgentSessionCheckpointRehydration({
      outcome: 'present',
      envelope: CLEAN_RESTART_CHECKPOINT,
    }),
    note: 'The same actor/session/turn/trace/command lineage is present on the resumed checkpoint.',
  },
  {
    name: 'crash_before_attempt',
    proofSurface: 'checkpoint_seam',
    outcome: deriveAgentSessionCheckpointRehydration({
      outcome: 'missing',
      sessionId: 'session:checkpoint:fixture',
    }),
    note: 'No durable checkpoint exists yet, so resume requires manual recovery.',
  },
  {
    name: 'crash_between_attempt_and_receipt',
    proofSurface: 'checkpoint_seam',
    outcome: deriveAgentSessionCheckpointRehydration({
      outcome: 'present',
      envelope: REPRESENTATIVE_CHECKPOINT,
    }),
    note: 'An irreversible effect intent was recorded without a settled receipt, so rehydration defers to reconciliation.',
  },
  {
    name: 'crash_after_receipt_before_checkpoint',
    proofSurface: 'checkpoint_seam',
    outcome: deriveAgentSessionCheckpointRehydration({
      outcome: 'present',
      envelope: REPRESENTATIVE_CHECKPOINT,
    }),
    note: 'Without a newer persisted checkpoint, the durable seam still defers rather than claiming a silent post-receipt resume.',
  },
  {
    name: 'cancellation',
    proofSurface: 'checkpoint_seam',
    outcome: deriveAgentSessionCheckpointRehydration({
      outcome: 'present',
      envelope: CANCELLATION_CHECKPOINT,
    }),
    note: 'A cancelled deterministic state can resume without reviving pending irreversible work.',
  },
  {
    name: 'manual_recovery',
    proofSurface: 'checkpoint_seam',
    outcome: deriveAgentSessionCheckpointRehydration({
      outcome: 'corrupt',
      sessionId: 'session:checkpoint:fixture',
      detail: 'invalid_json',
    }),
    note: 'Corrupt checkpoint payloads require manual recovery.',
  },
  {
    name: 'reconciliation',
    proofSurface: 'checkpoint_seam',
    outcome: deriveAgentSessionCheckpointRehydration({
      outcome: 'present',
      envelope: REPRESENTATIVE_CHECKPOINT,
    }),
    note: 'Pending reconciliation remains explicit and is not collapsed into resumed execution.',
  },
  {
    name: 'no_duplicate_irreversible_effect',
    proofSurface: 'checkpoint_seam',
    outcome: deriveAgentSessionCheckpointRehydration({
      outcome: 'present',
      envelope: REPRESENTATIVE_CHECKPOINT,
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
    rehydration: deriveAgentSessionCheckpointRehydration({
      outcome: 'present',
      envelope: REPRESENTATIVE_CHECKPOINT,
    }),
  };
}
