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
