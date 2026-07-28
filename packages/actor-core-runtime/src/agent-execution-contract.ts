import type { ActorEventEnvelope } from './runtime-projection.js';
import type { JsonValue } from './types.js';

declare const AGENT_EXECUTION_TRACE_IDEMPOTENCY_KEY_BRAND: unique symbol;

export const AGENT_EXECUTION_CONTRACT_VERSION = 1;

export type AgentExecutionTraceIdempotencyKey = string & {
  readonly [AGENT_EXECUTION_TRACE_IDEMPOTENCY_KEY_BRAND]: 'AgentExecutionTraceIdempotencyKey';
};

export type AgentExecutionTraceParseResult =
  | {
      readonly ok: true;
      readonly value: AgentExecutionTrace;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'unsupported_version'
        | 'invalid_trace_id'
        | 'invalid_actor_id'
        | 'invalid_session_id'
        | 'invalid_command_id'
        | 'invalid_receipts'
        | 'invalid_terminal_lineage';
      readonly value: unknown;
      readonly receiptId?: string;
    };

export type AgentExecutionTraceValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'invalid_terminal_lineage';
      readonly receiptId: string;
    };

export type BrandedStringParseResult<TValue extends string> =
  | {
      readonly outcome: 'valid';
      readonly value: TValue;
    }
  | {
      readonly outcome: 'invalid';
      readonly reason: 'expected_non_empty_string';
      readonly value: unknown;
    };

export type AgentExecutionAdmissionStage =
  | 'schema-admitted'
  | 'domain-accepted'
  | 'execution-authorized';

export type AgentExecutionReceiptStatus =
  | 'observed'
  | 'authorized'
  | 'rejected'
  | 'succeeded'
  | 'timeout'
  | 'retrying'
  | 'cancelled'
  | 'reconciled'
  | 'stale_projection'
  | 'partial_failure'
  | 'failed';

export interface AgentExecutionPrincipal {
  readonly id: string;
  readonly role?: string;
  readonly [key: string]: JsonValue | undefined;
}

export interface AgentExecutionAuthorizationFact {
  readonly policy: string;
  readonly decision: 'approved' | 'denied';
  readonly [key: string]: JsonValue | undefined;
}

export interface AgentExecutionOutcomeFact {
  readonly code: string;
  readonly detail?: string;
  readonly [key: string]: JsonValue | undefined;
}

export interface AgentExecutionRetryFact {
  readonly attempt: number;
  readonly reason: string;
  readonly policy: string;
}

export interface AgentExecutionCancellationFact {
  readonly reason: string;
  readonly requestedBy: string;
}

export interface AgentExecutionReconciliationFact {
  readonly outcome: string;
  readonly source: string;
}

export interface AgentExecutionStaleProjectionFact {
  readonly checkpointId: string;
  readonly revision: number;
  readonly expectedRevision: number;
}

export interface AgentExecutionResultFact {
  readonly output?: JsonValue;
  readonly [key: string]: JsonValue | undefined;
}

export interface AgentExecutionEventFact {
  readonly kind: ActorEventEnvelope['kind'];
  readonly type: string;
  readonly payload: JsonValue;
}

export interface AgentExecutionReceiptBase {
  readonly version: 1;
  readonly receiptId: string;
  readonly traceId: string;
  readonly recordId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly commandId: string;
  readonly sequence: number;
  readonly receiptKind: string;
  readonly status: AgentExecutionReceiptStatus;
  readonly occurredAt: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly effectId?: string;
  readonly effectAttemptId?: string;
  readonly provider?: string;
  readonly idempotencyKey?: string;
}

export interface AgentExecutionEventReceipt extends AgentExecutionReceiptBase {
  readonly receiptKind: 'event';
  readonly status: 'observed';
  readonly event: AgentExecutionEventFact;
}

export interface AgentExecutionAuthorizedReceipt extends AgentExecutionReceiptBase {
  readonly receiptKind: 'authorization';
  readonly status: 'authorized';
  readonly admissionStage: 'execution-authorized';
  readonly principal: AgentExecutionPrincipal;
  readonly authorization: AgentExecutionAuthorizationFact;
}

export interface AgentExecutionRejectedReceipt extends AgentExecutionReceiptBase {
  readonly receiptKind: 'rejection';
  readonly status: 'rejected';
  readonly admissionStage: AgentExecutionAdmissionStage;
  readonly reason: AgentExecutionOutcomeFact;
}

export interface AgentExecutionSuccessReceipt extends AgentExecutionReceiptBase {
  readonly receiptKind: 'result';
  readonly status: 'succeeded';
  readonly result: AgentExecutionResultFact;
}

export interface AgentExecutionTimeoutReceipt extends AgentExecutionReceiptBase {
  readonly receiptKind: 'timeout';
  readonly status: 'timeout';
  readonly timeoutMs: number;
}

export interface AgentExecutionRetryReceipt extends AgentExecutionReceiptBase {
  readonly receiptKind: 'retry';
  readonly status: 'retrying';
  readonly retry: AgentExecutionRetryFact;
}

export interface AgentExecutionCancellationReceipt extends AgentExecutionReceiptBase {
  readonly receiptKind: 'cancellation';
  readonly status: 'cancelled';
  readonly cancellation: AgentExecutionCancellationFact;
}

export interface AgentExecutionReconciliationReceipt extends AgentExecutionReceiptBase {
  readonly receiptKind: 'reconciliation';
  readonly status: 'reconciled';
  readonly reconciliation: AgentExecutionReconciliationFact;
}

export interface AgentExecutionStaleProjectionReceipt extends AgentExecutionReceiptBase {
  readonly receiptKind: 'projection';
  readonly status: 'stale_projection';
  readonly projection: AgentExecutionStaleProjectionFact;
}

export interface AgentExecutionEffectAttemptReceipt extends AgentExecutionReceiptBase {
  readonly receiptKind: 'effect_attempt';
  readonly status: 'succeeded' | 'partial_failure' | 'failed' | 'timeout' | 'cancelled';
  readonly outcome: AgentExecutionOutcomeFact;
}

export type AgentExecutionReceipt =
  | AgentExecutionAuthorizedReceipt
  | AgentExecutionCancellationReceipt
  | AgentExecutionEffectAttemptReceipt
  | AgentExecutionEventReceipt
  | AgentExecutionReconciliationReceipt
  | AgentExecutionRejectedReceipt
  | AgentExecutionStaleProjectionReceipt
  | AgentExecutionSuccessReceipt
  | AgentExecutionRetryReceipt
  | AgentExecutionTimeoutReceipt;

export interface AgentExecutionTrace {
  readonly version: 1;
  readonly schemaVersion: 1;
  readonly traceId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly commandId: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly receipts: readonly AgentExecutionReceipt[];
  readonly status:
    | 'pending'
    | 'authorized'
    | 'rejected'
    | 'succeeded'
    | 'timeout'
    | 'retrying'
    | 'cancelled'
    | 'reconciled'
    | 'stale_projection'
    | 'partial_failure'
    | 'failed';
  readonly lastReceipt?: AgentExecutionReceipt;
}

export interface AgentExecutionTraceInput {
  readonly version?: number;
  readonly schemaVersion?: number;
  readonly traceId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly commandId: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly receipts: readonly AgentExecutionReceipt[];
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function invalidStringResult<TValue extends string>(value: unknown): BrandedStringParseResult<TValue> {
  return {
    outcome: 'invalid',
    reason: 'expected_non_empty_string',
    value,
  };
}

function cloneJsonCompatible<TValue>(value: TValue): TValue {
  return value === undefined ? value : structuredClone(value);
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function freezeClone<TValue>(value: TValue): TValue {
  return deepFreeze(cloneJsonCompatible(value));
}

function normalizeReceipt<TReceipt extends AgentExecutionReceipt>(receipt: TReceipt): TReceipt {
  return freezeClone({
    ...receipt,
    version: AGENT_EXECUTION_CONTRACT_VERSION,
  } satisfies AgentExecutionReceipt) as TReceipt;
}

function deriveTraceStatus(
  receipts: readonly AgentExecutionReceipt[]
): AgentExecutionTrace['status'] {
  const lastReceipt = receipts[receipts.length - 1];
  if (!lastReceipt) {
    return 'pending';
  }

  switch (lastReceipt.status) {
    case 'authorized':
      return 'authorized';
    case 'rejected':
      return 'rejected';
    case 'succeeded':
      return 'succeeded';
    case 'timeout':
      return 'timeout';
    case 'retrying':
      return 'retrying';
    case 'cancelled':
      return 'cancelled';
    case 'reconciled':
      return 'reconciled';
    case 'stale_projection':
      return 'stale_projection';
    case 'partial_failure':
      return 'partial_failure';
    case 'failed':
      return 'failed';
    case 'observed':
      return 'pending';
  }
}

function isTerminalReceipt(receipt: AgentExecutionReceipt): boolean {
  return (
    receipt.status === 'rejected' ||
    receipt.status === 'succeeded' ||
    receipt.status === 'cancelled' ||
    receipt.status === 'stale_projection'
  );
}

function isPostTerminalAllowed(receipt: AgentExecutionReceipt): boolean {
  return receipt.receiptKind === 'reconciliation' || receipt.receiptKind === 'projection';
}

function findTerminalLineageViolation(
  receipts: readonly AgentExecutionReceipt[]
): AgentExecutionTraceValidationResult {
  let terminalSeen = false;

  for (const receipt of receipts) {
    if (terminalSeen && !isPostTerminalAllowed(receipt)) {
      return {
        ok: false,
        reason: 'invalid_terminal_lineage',
        receiptId: receipt.receiptId,
      };
    }

    if (isTerminalReceipt(receipt)) {
      terminalSeen = true;
    }
  }

  return { ok: true };
}

function normalizeJsonValue(value: JsonValue | undefined): JsonValue | undefined {
  return value === undefined ? undefined : freezeClone(value);
}

function createReceiptIdFromRecord(recordId: string): string {
  return `receipt:${recordId}`;
}

function toJsonValue(value: unknown): JsonValue {
  return redactAgentExecutionValue(value) as JsonValue;
}

export function createAgentExecutionTraceIdempotencyKey(input: {
  readonly traceId: string;
  readonly commandId: string;
  readonly effectId: string;
  readonly effectAttemptId: string;
}): BrandedStringParseResult<AgentExecutionTraceIdempotencyKey> {
  if (!hasNonEmptyString(input.traceId)) {
    return invalidStringResult(input.traceId);
  }
  if (!hasNonEmptyString(input.commandId)) {
    return invalidStringResult(input.commandId);
  }
  if (!hasNonEmptyString(input.effectId)) {
    return invalidStringResult(input.effectId);
  }
  if (!hasNonEmptyString(input.effectAttemptId)) {
    return invalidStringResult(input.effectAttemptId);
  }

  return {
    outcome: 'valid',
    value: [
      'agent-execution',
      'key',
      `trace=${input.traceId}`,
      `command=${input.commandId}`,
      `effect=${input.effectId}`,
      `attempt=${input.effectAttemptId}`,
    ].join(':') as AgentExecutionTraceIdempotencyKey,
  };
}

export function createExecutionAuthorizedReceipt(
  receipt: Omit<AgentExecutionAuthorizedReceipt, 'version' | 'receiptKind' | 'status' | 'admissionStage'>
): AgentExecutionAuthorizedReceipt {
  return normalizeReceipt({
    ...receipt,
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    receiptKind: 'authorization',
    status: 'authorized',
    admissionStage: 'execution-authorized',
    principal: freezeClone(receipt.principal),
    authorization: freezeClone(receipt.authorization),
  });
}

export function createExecutionRejectedReceipt(
  receipt: Omit<AgentExecutionRejectedReceipt, 'version' | 'receiptKind' | 'status'>
): AgentExecutionRejectedReceipt {
  return normalizeReceipt({
    ...receipt,
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    receiptKind: 'rejection',
    status: 'rejected',
    reason: freezeClone(receipt.reason),
  });
}

export function createExecutionSuccessReceipt(
  receipt: Omit<AgentExecutionSuccessReceipt, 'version' | 'receiptKind' | 'status'>
): AgentExecutionSuccessReceipt {
  return normalizeReceipt({
    ...receipt,
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    receiptKind: 'result',
    status: 'succeeded',
    result: freezeClone(receipt.result),
  });
}

export function createExecutionTimeoutReceipt(
  receipt: Omit<AgentExecutionTimeoutReceipt, 'version' | 'receiptKind' | 'status'>
): AgentExecutionTimeoutReceipt {
  return normalizeReceipt({
    ...receipt,
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    receiptKind: 'timeout',
    status: 'timeout',
  });
}

export function createExecutionRetryReceipt(
  receipt: Omit<AgentExecutionRetryReceipt, 'version' | 'receiptKind' | 'status'>
): AgentExecutionRetryReceipt {
  return normalizeReceipt({
    ...receipt,
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    receiptKind: 'retry',
    status: 'retrying',
    retry: freezeClone(receipt.retry),
  });
}

export function createExecutionCancellationReceipt(
  receipt: Omit<AgentExecutionCancellationReceipt, 'version' | 'receiptKind' | 'status'>
): AgentExecutionCancellationReceipt {
  return normalizeReceipt({
    ...receipt,
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    receiptKind: 'cancellation',
    status: 'cancelled',
    cancellation: freezeClone(receipt.cancellation),
  });
}

export function createExecutionReconciliationReceipt(
  receipt: Omit<AgentExecutionReconciliationReceipt, 'version' | 'receiptKind' | 'status'>
): AgentExecutionReconciliationReceipt {
  return normalizeReceipt({
    ...receipt,
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    receiptKind: 'reconciliation',
    status: 'reconciled',
    reconciliation: freezeClone(receipt.reconciliation),
  });
}

export function createExecutionStaleProjectionReceipt(
  receipt: Omit<AgentExecutionStaleProjectionReceipt, 'version' | 'receiptKind' | 'status'>
): AgentExecutionStaleProjectionReceipt {
  return normalizeReceipt({
    ...receipt,
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    receiptKind: 'projection',
    status: 'stale_projection',
    projection: freezeClone(receipt.projection),
  });
}

export function createExecutionTimeoutOrEffectReceipt(
  receipt: AgentExecutionEffectAttemptReceipt
): AgentExecutionEffectAttemptReceipt {
  return normalizeReceipt({
    ...receipt,
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    receiptKind: 'effect_attempt',
    outcome: freezeClone(receipt.outcome),
  });
}

export function sortAgentExecutionReceipts(
  receipts: readonly AgentExecutionReceipt[]
): readonly AgentExecutionReceipt[] {
  return freezeClone(
    [...receipts].sort((left, right) => {
      if (left.sequence !== right.sequence) {
        return left.sequence - right.sequence;
      }

      const timeDelta = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
      if (timeDelta !== 0) {
        return timeDelta;
      }

      return left.receiptId.localeCompare(right.receiptId);
    })
  );
}

export function createAgentExecutionTrace(input: AgentExecutionTraceInput): AgentExecutionTrace {
  const receipts = sortAgentExecutionReceipts(input.receipts);
  return freezeClone({
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    schemaVersion: AGENT_EXECUTION_CONTRACT_VERSION,
    traceId: input.traceId,
    actorId: input.actorId,
    sessionId: input.sessionId,
    commandId: input.commandId,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.causationId ? { causationId: input.causationId } : {}),
    receipts,
    status: deriveTraceStatus(receipts),
    ...(receipts.length > 0 ? { lastReceipt: receipts[receipts.length - 1] } : {}),
  });
}

export function validateAgentExecutionTrace(
  trace: AgentExecutionTrace
): AgentExecutionTraceValidationResult {
  return findTerminalLineageViolation(trace.receipts);
}

export function parseAgentExecutionTrace(input: unknown): AgentExecutionTraceParseResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, reason: 'invalid_receipts', value: input };
  }

  const value = input as Partial<AgentExecutionTrace> & { readonly schemaVersion?: unknown };
  const version = value.schemaVersion ?? value.version;
  if (version !== AGENT_EXECUTION_CONTRACT_VERSION) {
    return { ok: false, reason: 'unsupported_version', value: version };
  }
  if (!hasNonEmptyString(value.traceId)) {
    return { ok: false, reason: 'invalid_trace_id', value: value.traceId };
  }
  if (!hasNonEmptyString(value.actorId)) {
    return { ok: false, reason: 'invalid_actor_id', value: value.actorId };
  }
  if (!hasNonEmptyString(value.sessionId)) {
    return { ok: false, reason: 'invalid_session_id', value: value.sessionId };
  }
  if (!hasNonEmptyString(value.commandId)) {
    return { ok: false, reason: 'invalid_command_id', value: value.commandId };
  }
  if (!Array.isArray(value.receipts)) {
    return { ok: false, reason: 'invalid_receipts', value: value.receipts };
  }

  const trace = createAgentExecutionTrace({
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    traceId: value.traceId,
    actorId: value.actorId,
    sessionId: value.sessionId,
    commandId: value.commandId,
    ...(value.correlationId ? { correlationId: value.correlationId } : {}),
    ...(value.causationId ? { causationId: value.causationId } : {}),
    receipts: value.receipts as readonly AgentExecutionReceipt[],
  });
  const validation = validateAgentExecutionTrace(trace);
  if (!validation.ok) {
    return {
      ok: false,
      reason: validation.reason,
      value: input,
      receiptId: validation.receiptId,
    };
  }

  return {
    ok: true,
    value: trace,
  };
}

export function isAgentExecutionTrace(value: unknown): value is AgentExecutionTrace {
  return parseAgentExecutionTrace(value).ok;
}

function shouldRedactKey(key: string): 'secret' | 'prompt' | null {
  const normalized = key.toLowerCase();
  if (
    normalized.includes('token') ||
    normalized.includes('authorization') ||
    normalized.includes('apikey') ||
    normalized.includes('api_key') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized.includes('credential')
  ) {
    return 'secret';
  }
  if (normalized.includes('prompt')) {
    return 'prompt';
  }
  return null;
}

export function redactAgentExecutionValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactAgentExecutionValue(entry));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const redaction = shouldRedactKey(key);
      result[key] =
        redaction === null ? redactAgentExecutionValue(entry) : `[redacted:${redaction}]`;
    }
    return result;
  }

  return String(value);
}

export function toAgentExecutionReceiptFromEventEnvelope(
  envelope: ActorEventEnvelope,
  options: {
    readonly traceId: string;
    readonly actorId: string;
    readonly sessionId: string;
    readonly commandId: string;
    readonly sequence: number;
  }
): AgentExecutionEventReceipt {
  return normalizeReceipt({
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    receiptId: createReceiptIdFromRecord(envelope.id),
    traceId: options.traceId,
    recordId: envelope.id,
    actorId: options.actorId,
    sessionId: options.sessionId,
    commandId: options.commandId,
    sequence: options.sequence,
    receiptKind: 'event',
    status: 'observed',
    occurredAt: envelope.occurredAt,
    ...(envelope.correlationId ? { correlationId: envelope.correlationId } : {}),
    ...(envelope.causationId ? { causationId: envelope.causationId } : {}),
    event: {
      kind: envelope.kind,
      type: envelope.type,
      payload: toJsonValue(envelope.payload),
    },
  });
}

export function toAgentExecutionReceiptFromEffectRecord(
  record: {
    readonly idempotencyKey: string;
    readonly kind: string;
    readonly recordedAt: string;
    readonly result: Record<string, unknown>;
  },
  options: {
    readonly traceId: string;
    readonly actorId: string;
    readonly sessionId: string;
    readonly commandId: string;
    readonly effectId: string;
    readonly effectAttemptId: string;
    readonly sequence: number;
    readonly receiptId: string;
    readonly recordId: string;
  }
): AgentExecutionEffectAttemptReceipt {
  const outcomeCode =
    record.result.outcome === 'failed'
      ? 'failed'
      : record.result.outcome === 'cancelled'
        ? 'cancelled'
        : 'success';
  const provider =
    typeof record.result.provider === 'string'
      ? record.result.provider
      : typeof (record.result.process as { provider?: unknown } | undefined)?.provider === 'string'
        ? ((record.result.process as { provider: string }).provider ?? undefined)
        : undefined;
  const status: AgentExecutionEffectAttemptReceipt['status'] =
    outcomeCode === 'failed'
      ? 'failed'
      : outcomeCode === 'cancelled'
        ? 'cancelled'
        : 'succeeded';

  return createExecutionTimeoutOrEffectReceipt({
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    receiptId: options.receiptId,
    traceId: options.traceId,
    recordId: options.recordId,
    actorId: options.actorId,
    sessionId: options.sessionId,
    commandId: options.commandId,
    effectId: options.effectId,
    effectAttemptId: options.effectAttemptId,
    sequence: options.sequence,
    receiptKind: 'effect_attempt',
    status,
    occurredAt: record.recordedAt,
    ...(provider ? { provider } : {}),
    idempotencyKey: record.idempotencyKey,
    outcome: {
      code: outcomeCode,
      detail: `Runtime recorded ${record.kind} effect outcome ${String(record.result.outcome)}.`,
    },
  });
}
