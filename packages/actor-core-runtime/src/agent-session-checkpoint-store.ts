import type { JsonValue } from './types.js';

export const AGENT_SESSION_CHECKPOINT_SCHEMA_VERSION = 1 as const;

export type AgentSessionCheckpointReadOutcome =
  | 'missing'
  | 'present'
  | 'stale'
  | 'corrupt'
  | 'version_mismatch'
  | 'expired'
  | 'redacted';

export type AgentSessionCheckpointWriteOutcome =
  | 'stored'
  | 'replaced'
  | 'duplicate'
  | 'too_large'
  | 'expired'
  | 'rejected';

export type AgentSessionCheckpointRehydrationOutcome =
  | 'resumed'
  | 'deferred_for_reconciliation'
  | 'manual_recovery_required';

export interface AgentSessionCheckpointActorIdentity {
  readonly actorId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly traceId: string;
  readonly commandId: string;
  readonly correlationId: string;
  readonly causationId: string;
}

export type AgentSessionCheckpointEffectPhase =
  | 'none'
  | 'intent_recorded'
  | 'receipt_recorded'
  | 'reconciliation_required';

export interface AgentSessionCheckpointEffectState {
  readonly effectId: string;
  readonly effectAttemptId: string;
  readonly phase: AgentSessionCheckpointEffectPhase;
  readonly irreversible: boolean;
  readonly intent?: JsonValue;
  readonly receipt?: JsonValue;
}

export interface AgentSessionCheckpointContinuation {
  readonly provider: string;
  readonly adapter: string;
  readonly formatVersion: number;
  readonly payload: JsonValue | null;
  readonly payloadBytes: number;
  readonly expiresAt?: string | null;
  readonly redaction: {
    readonly disposition: 'none' | 'metadata_only';
    readonly fields: readonly string[];
  };
}

export interface AgentSessionCheckpointReconciliationState {
  readonly status: 'clear' | 'pending' | 'required';
  readonly reason?: string;
}

export interface AgentSessionCheckpointEnvelope {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly checkpointId: string;
  readonly actor: AgentSessionCheckpointActorIdentity;
  readonly deterministic: JsonValue;
  readonly effect: AgentSessionCheckpointEffectState | null;
  readonly continuation: AgentSessionCheckpointContinuation | null;
  readonly reconciliation: AgentSessionCheckpointReconciliationState;
  readonly recordedAt: string;
  readonly expiresAt: string | null;
  readonly staleAt: string | null;
  readonly redactedFields: readonly string[];
  readonly metadata?: JsonValue;
}

export type AgentSessionCheckpointParseResult =
  | { readonly ok: true; readonly value: AgentSessionCheckpointEnvelope }
  | {
      readonly ok: false;
      readonly reason: 'corrupt' | 'version_mismatch';
      readonly value: unknown;
      readonly schemaVersion?: number | null;
    };

export type AgentSessionCheckpointReadResult =
  | {
      readonly outcome: 'missing';
      readonly sessionId: string;
    }
  | {
      readonly outcome: 'present' | 'stale' | 'expired' | 'redacted';
      readonly envelope: AgentSessionCheckpointEnvelope;
      readonly fields?: readonly string[];
    }
  | {
      readonly outcome: 'corrupt';
      readonly sessionId: string;
      readonly detail: string;
    }
  | {
      readonly outcome: 'version_mismatch';
      readonly sessionId: string;
      readonly foundVersion: number | null;
      readonly supportedVersions: readonly number[];
    };

export type AgentSessionCheckpointWriteResult =
  | {
      readonly outcome: 'stored' | 'replaced' | 'duplicate';
      readonly envelope: AgentSessionCheckpointEnvelope;
      readonly previous?: AgentSessionCheckpointEnvelope;
    }
  | {
      readonly outcome: 'too_large';
      readonly envelope: AgentSessionCheckpointEnvelope;
      readonly sizeBytes: number;
      readonly maxBytes: number;
    }
  | {
      readonly outcome: 'expired';
      readonly envelope: AgentSessionCheckpointEnvelope;
    }
  | {
      readonly outcome: 'rejected';
      readonly envelope: AgentSessionCheckpointEnvelope;
      readonly reason: string;
    };

export type AgentSessionCheckpointRehydrationResult =
  | {
      readonly outcome: 'resumed';
      readonly envelope: AgentSessionCheckpointEnvelope;
    }
  | {
      readonly outcome: 'deferred_for_reconciliation';
      readonly envelope: AgentSessionCheckpointEnvelope;
      readonly reason: string;
    }
  | {
      readonly outcome: 'manual_recovery_required';
      readonly sessionId: string;
      readonly reason:
        | 'missing'
        | 'stale'
        | 'corrupt'
        | 'version_mismatch'
        | 'expired'
        | 'redacted';
      readonly detail?: string;
      readonly envelope?: AgentSessionCheckpointEnvelope;
    };

export interface AgentSessionCheckpointReadInput {
  readonly sessionId: string;
  readonly now?: () => Date;
}

export interface AgentSessionCheckpointStore {
  read(input: AgentSessionCheckpointReadInput): Promise<AgentSessionCheckpointReadResult>;
  write(envelope: AgentSessionCheckpointEnvelope): Promise<AgentSessionCheckpointWriteResult>;
}

export interface InMemoryAgentSessionCheckpointStore extends AgentSessionCheckpointStore {
  getSnapshot(): Readonly<Record<string, AgentSessionCheckpointEnvelope>>;
  clear(): void;
}

export interface AgentSessionCheckpointEnvelopeInput {
  readonly sessionId: string;
  readonly checkpointId: string;
  readonly schemaVersion?: 1;
  readonly actor: AgentSessionCheckpointActorIdentity;
  readonly deterministic: JsonValue;
  readonly effect: AgentSessionCheckpointEffectState | null;
  readonly continuation: AgentSessionCheckpointContinuation | null;
  readonly reconciliation: AgentSessionCheckpointReconciliationState;
  readonly recordedAt: string;
  readonly expiresAt?: string | null;
  readonly staleAt?: string | null;
  readonly redactedFields?: readonly string[];
  readonly metadata?: JsonValue;
}

const SUPPORTED_SCHEMA_VERSIONS = [AGENT_SESSION_CHECKPOINT_SCHEMA_VERSION] as const;

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoDateString(value: unknown): value is string {
  return hasNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry));
  }
  if (typeof value !== 'object') {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every((entry) => isJsonValue(entry));
}

function cloneJson<TValue extends JsonValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue;
}

function freezeJson<TValue>(value: TValue): TValue {
  if (Array.isArray(value)) {
    for (const entry of value) {
      freezeJson(entry);
    }
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      freezeJson(entry);
    }
  }
  return Object.freeze(value);
}

function cloneNullableJson(value: JsonValue | undefined): JsonValue | undefined {
  return value === undefined ? undefined : cloneJson(value);
}

function cloneActorIdentity(
  value: AgentSessionCheckpointActorIdentity
): AgentSessionCheckpointActorIdentity {
  return Object.freeze({
    actorId: value.actorId,
    sessionId: value.sessionId,
    turnId: value.turnId,
    traceId: value.traceId,
    commandId: value.commandId,
    correlationId: value.correlationId,
    causationId: value.causationId,
  });
}

function cloneEffectState(
  value: AgentSessionCheckpointEffectState | null
): AgentSessionCheckpointEffectState | null {
  if (value === null) {
    return null;
  }
  return Object.freeze({
    effectId: value.effectId,
    effectAttemptId: value.effectAttemptId,
    phase: value.phase,
    irreversible: value.irreversible,
    ...(value.intent === undefined ? {} : { intent: cloneJson(value.intent) }),
    ...(value.receipt === undefined ? {} : { receipt: cloneJson(value.receipt) }),
  });
}

function cloneContinuation(
  value: AgentSessionCheckpointContinuation | null
): AgentSessionCheckpointContinuation | null {
  if (value === null) {
    return null;
  }
  return Object.freeze({
    provider: value.provider,
    adapter: value.adapter,
    formatVersion: value.formatVersion,
    payload: value.payload === null ? null : cloneJson(value.payload),
    payloadBytes: value.payloadBytes,
    ...(value.expiresAt === undefined ? {} : { expiresAt: value.expiresAt }),
    redaction: Object.freeze({
      disposition: value.redaction.disposition,
      fields: Object.freeze([...value.redaction.fields]),
    }),
  });
}

function getContinuationPayloadBytes(value: JsonValue | null): number {
  return value === null ? 0 : new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function cloneReconciliation(
  value: AgentSessionCheckpointReconciliationState
): AgentSessionCheckpointReconciliationState {
  return Object.freeze({
    status: value.status,
    ...(value.reason === undefined ? {} : { reason: value.reason }),
  });
}

function toEnvelopeSizeBytes(envelope: AgentSessionCheckpointEnvelope): number {
  return new TextEncoder().encode(JSON.stringify(envelope)).byteLength;
}

function isSupportedSchemaVersion(value: unknown): value is 1 {
  return value === AGENT_SESSION_CHECKPOINT_SCHEMA_VERSION;
}

function toDateMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function classifyReadResult(
  envelope: AgentSessionCheckpointEnvelope,
  now: Date
): AgentSessionCheckpointReadResult {
  if (envelope.redactedFields.length > 0) {
    return {
      outcome: 'redacted',
      envelope,
      fields: envelope.redactedFields,
    };
  }
  const expiresAtMs = toDateMs(envelope.expiresAt);
  if (expiresAtMs !== null && expiresAtMs <= now.getTime()) {
    return {
      outcome: 'expired',
      envelope,
    };
  }
  const staleAtMs = toDateMs(envelope.staleAt);
  if (staleAtMs !== null && staleAtMs <= now.getTime()) {
    return {
      outcome: 'stale',
      envelope,
    };
  }
  return {
    outcome: 'present',
    envelope,
  };
}

function isValidIdentity(value: unknown): value is AgentSessionCheckpointActorIdentity {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    hasNonEmptyString(candidate.actorId) &&
    hasNonEmptyString(candidate.sessionId) &&
    hasNonEmptyString(candidate.turnId) &&
    hasNonEmptyString(candidate.traceId) &&
    hasNonEmptyString(candidate.commandId) &&
    hasNonEmptyString(candidate.correlationId) &&
    hasNonEmptyString(candidate.causationId)
  );
}

function isValidEffectState(value: unknown): value is AgentSessionCheckpointEffectState | null {
  if (value === null) {
    return true;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    hasNonEmptyString(candidate.effectId) &&
    hasNonEmptyString(candidate.effectAttemptId) &&
    (candidate.phase === 'none' ||
      candidate.phase === 'intent_recorded' ||
      candidate.phase === 'receipt_recorded' ||
      candidate.phase === 'reconciliation_required') &&
    typeof candidate.irreversible === 'boolean' &&
    (candidate.intent === undefined || isJsonValue(candidate.intent)) &&
    (candidate.receipt === undefined || isJsonValue(candidate.receipt))
  );
}

function isValidContinuation(value: unknown): value is AgentSessionCheckpointContinuation | null {
  if (value === null) {
    return true;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    hasNonEmptyString(candidate.provider) &&
    hasNonEmptyString(candidate.adapter) &&
    typeof candidate.formatVersion === 'number' &&
    Number.isFinite(candidate.formatVersion) &&
    (candidate.payload === null || isJsonValue(candidate.payload)) &&
    typeof candidate.payloadBytes === 'number' &&
    Number.isFinite(candidate.payloadBytes) &&
    candidate.payloadBytes >= 0 &&
    (candidate.expiresAt === undefined ||
      candidate.expiresAt === null ||
      isIsoDateString(candidate.expiresAt)) &&
    !!candidate.redaction &&
    typeof candidate.redaction === 'object' &&
    (((candidate.redaction as Record<string, unknown>).disposition === 'none' &&
      isValidStringArray((candidate.redaction as Record<string, unknown>).fields)) ||
      ((candidate.redaction as Record<string, unknown>).disposition === 'metadata_only' &&
        isValidStringArray((candidate.redaction as Record<string, unknown>).fields)))
  );
}

function isValidReconciliation(value: unknown): value is AgentSessionCheckpointReconciliationState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.status === 'clear' ||
      candidate.status === 'pending' ||
      candidate.status === 'required') &&
    (candidate.reason === undefined || hasNonEmptyString(candidate.reason))
  );
}

function isValidStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => hasNonEmptyString(entry));
}

function normalizeEnvelope(
  input: AgentSessionCheckpointEnvelopeInput
): AgentSessionCheckpointEnvelope {
  const deterministic = cloneJson(input.deterministic);
  const envelope: AgentSessionCheckpointEnvelope = {
    schemaVersion: AGENT_SESSION_CHECKPOINT_SCHEMA_VERSION,
    sessionId: input.sessionId,
    checkpointId: input.checkpointId,
    actor: cloneActorIdentity(input.actor),
    deterministic,
    effect: cloneEffectState(input.effect),
    continuation: cloneContinuation(input.continuation),
    reconciliation: cloneReconciliation(input.reconciliation),
    recordedAt: input.recordedAt,
    expiresAt: input.expiresAt ?? null,
    staleAt: input.staleAt ?? null,
    redactedFields: Object.freeze([...(input.redactedFields ?? [])]),
    ...(input.metadata === undefined ? {} : { metadata: cloneJson(input.metadata) }),
  };
  freezeJson(envelope.actor);
  freezeJson(envelope.deterministic);
  if (envelope.effect) {
    freezeJson(envelope.effect);
  }
  if (envelope.continuation) {
    freezeJson(envelope.continuation);
  }
  freezeJson(envelope.reconciliation);
  if (envelope.metadata !== undefined) {
    freezeJson(envelope.metadata);
  }
  return Object.freeze(envelope);
}

export function createAgentSessionCheckpointEnvelope(
  input: AgentSessionCheckpointEnvelopeInput
): AgentSessionCheckpointEnvelope {
  if (!hasNonEmptyString(input.sessionId)) {
    throw new Error('Agent session checkpoint requires a non-empty sessionId.');
  }
  if (!hasNonEmptyString(input.checkpointId)) {
    throw new Error('Agent session checkpoint requires a non-empty checkpointId.');
  }
  if (input.actor.sessionId !== input.sessionId) {
    throw new Error('Actor sessionId must match the checkpoint sessionId.');
  }
  if (!isIsoDateString(input.recordedAt)) {
    throw new Error('Agent session checkpoint recordedAt must be an ISO timestamp.');
  }
  if (
    input.expiresAt !== undefined &&
    input.expiresAt !== null &&
    !isIsoDateString(input.expiresAt)
  ) {
    throw new Error('Agent session checkpoint expiresAt must be an ISO timestamp when provided.');
  }
  if (input.staleAt !== undefined && input.staleAt !== null && !isIsoDateString(input.staleAt)) {
    throw new Error('Agent session checkpoint staleAt must be an ISO timestamp when provided.');
  }
  if (!isJsonValue(input.deterministic)) {
    throw new Error('Agent session checkpoint deterministic state must be JSON-safe.');
  }
  if (input.metadata !== undefined && !isJsonValue(input.metadata)) {
    throw new Error('Agent session checkpoint metadata must be JSON-safe.');
  }
  if (input.continuation) {
    if (
      input.continuation.redaction.disposition === 'none' &&
      input.continuation.payloadBytes !== getContinuationPayloadBytes(input.continuation.payload)
    ) {
      throw new Error(
        'Agent session checkpoint continuation payloadBytes must match the stored payload size.'
      );
    }
    if (
      input.continuation.redaction.disposition === 'metadata_only' &&
      input.continuation.payload !== null
    ) {
      throw new Error(
        'Agent session checkpoint metadata-only continuation redaction must omit the payload.'
      );
    }
  }
  return normalizeEnvelope(input);
}

export function parseAgentSessionCheckpointEnvelope(
  input: unknown
): AgentSessionCheckpointParseResult {
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      reason: 'corrupt',
      value: input,
    };
  }
  const candidate = input as Record<string, unknown>;
  const schemaVersion = candidate.schemaVersion;
  if (!isSupportedSchemaVersion(schemaVersion)) {
    return {
      ok: false,
      reason: 'version_mismatch',
      value: input,
      schemaVersion: typeof schemaVersion === 'number' ? schemaVersion : null,
    };
  }
  if (
    !hasNonEmptyString(candidate.sessionId) ||
    !hasNonEmptyString(candidate.checkpointId) ||
    !isValidIdentity(candidate.actor) ||
    candidate.actor.sessionId !== candidate.sessionId ||
    !isJsonValue(candidate.deterministic) ||
    !isValidEffectState(candidate.effect) ||
    !isValidContinuation(candidate.continuation) ||
    !isValidReconciliation(candidate.reconciliation) ||
    !isIsoDateString(candidate.recordedAt) ||
    !(
      candidate.expiresAt === null ||
      candidate.expiresAt === undefined ||
      isIsoDateString(candidate.expiresAt)
    ) ||
    !(
      candidate.staleAt === null ||
      candidate.staleAt === undefined ||
      isIsoDateString(candidate.staleAt)
    ) ||
    !isValidStringArray(candidate.redactedFields) ||
    (candidate.metadata !== undefined && !isJsonValue(candidate.metadata))
  ) {
    return {
      ok: false,
      reason: 'corrupt',
      value: input,
    };
  }
  return {
    ok: true,
    value: normalizeEnvelope({
      sessionId: candidate.sessionId,
      checkpointId: candidate.checkpointId,
      actor: candidate.actor,
      deterministic: candidate.deterministic,
      effect: candidate.effect as AgentSessionCheckpointEffectState | null,
      continuation: candidate.continuation as AgentSessionCheckpointContinuation | null,
      reconciliation: candidate.reconciliation,
      recordedAt: candidate.recordedAt,
      expiresAt: (candidate.expiresAt as string | null | undefined) ?? null,
      staleAt: (candidate.staleAt as string | null | undefined) ?? null,
      redactedFields: candidate.redactedFields,
      metadata: cloneNullableJson(candidate.metadata as JsonValue | undefined),
    }),
  };
}

export function deriveAgentSessionCheckpointRehydration(
  result: AgentSessionCheckpointReadResult
): AgentSessionCheckpointRehydrationResult {
  switch (result.outcome) {
    case 'missing':
      return {
        outcome: 'manual_recovery_required',
        sessionId: result.sessionId,
        reason: 'missing',
      };
    case 'corrupt':
      return {
        outcome: 'manual_recovery_required',
        sessionId: result.sessionId,
        reason: 'corrupt',
        detail: result.detail,
      };
    case 'version_mismatch':
      return {
        outcome: 'manual_recovery_required',
        sessionId: result.sessionId,
        reason: 'version_mismatch',
        detail: `Unsupported schema version: ${String(result.foundVersion)}`,
      };
    case 'expired':
      return {
        outcome: 'manual_recovery_required',
        sessionId: result.envelope.sessionId,
        reason: 'expired',
        envelope: result.envelope,
      };
    case 'stale':
      return {
        outcome: 'manual_recovery_required',
        sessionId: result.envelope.sessionId,
        reason: 'stale',
        envelope: result.envelope,
      };
    case 'redacted':
      return {
        outcome: 'manual_recovery_required',
        sessionId: result.envelope.sessionId,
        reason: 'redacted',
        envelope: result.envelope,
        detail: result.fields?.join(','),
      };
    case 'present': {
      const effect = result.envelope.effect;
      if (
        effect?.irreversible &&
        effect.phase === 'intent_recorded' &&
        effect.receipt === undefined
      ) {
        return {
          outcome: 'deferred_for_reconciliation',
          envelope: result.envelope,
          reason: 'Irreversible effect intent was recorded without a settled receipt.',
        };
      }
      if (
        result.envelope.reconciliation.status === 'pending' ||
        result.envelope.reconciliation.status === 'required' ||
        effect?.phase === 'reconciliation_required'
      ) {
        return {
          outcome: 'deferred_for_reconciliation',
          envelope: result.envelope,
          reason:
            result.envelope.reconciliation.reason ??
            'Checkpoint requires reconciliation before resume.',
        };
      }
      return {
        outcome: 'resumed',
        envelope: result.envelope,
      };
    }
  }
}

export function createInMemoryAgentSessionCheckpointStore(): InMemoryAgentSessionCheckpointStore {
  const entries = new Map<string, AgentSessionCheckpointEnvelope>();

  return {
    async read(input) {
      const envelope = entries.get(input.sessionId);
      if (!envelope) {
        return {
          outcome: 'missing',
          sessionId: input.sessionId,
        };
      }
      return classifyReadResult(envelope, (input.now ?? (() => new Date()))());
    },
    async write(envelope) {
      const now = new Date();
      const expiresAt = toDateMs(envelope.expiresAt);
      if (expiresAt !== null && expiresAt <= now.getTime()) {
        return {
          outcome: 'expired',
          envelope,
        };
      }
      const previous = entries.get(envelope.sessionId);
      if (previous?.checkpointId === envelope.checkpointId) {
        return {
          outcome: 'duplicate',
          envelope: previous,
          previous,
        };
      }
      entries.set(envelope.sessionId, envelope);
      if (previous) {
        return {
          outcome: 'replaced',
          envelope,
          previous,
        };
      }
      return {
        outcome: 'stored',
        envelope,
      };
    },
    getSnapshot() {
      const snapshot: Record<string, AgentSessionCheckpointEnvelope> = {};
      for (const [sessionId, envelope] of entries.entries()) {
        snapshot[sessionId] = envelope;
      }
      return Object.freeze(snapshot);
    },
    clear() {
      entries.clear();
    },
  };
}

export function getAgentSessionCheckpointSupportedSchemaVersions(): readonly number[] {
  return SUPPORTED_SCHEMA_VERSIONS;
}

export function getAgentSessionCheckpointEnvelopeSizeBytes(
  envelope: AgentSessionCheckpointEnvelope
): number {
  return toEnvelopeSizeBytes(envelope);
}
