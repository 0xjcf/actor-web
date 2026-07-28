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

export type AgentExecutionRecheckField =
  | 'command'
  | 'payload'
  | 'principal'
  | 'approval'
  | 'revision'
  | 'idempotency'
  | 'policy';

export interface AgentExecutionPrincipal {
  readonly id: string;
  readonly role?: string;
  readonly [key: string]: JsonValue | undefined;
}

export type AgentExecutionCommandPrincipalKind = 'authenticated' | 'local' | 'system';

export interface AgentExecutionCommandPrincipal extends AgentExecutionPrincipal {
  readonly kind: AgentExecutionCommandPrincipalKind;
}

export interface AgentExecutionApprovalMetadata {
  readonly state?: 'granted' | 'missing' | 'expired';
  readonly expiresAt?: string;
  readonly [key: string]: JsonValue | undefined;
}

export interface AgentExecutionCommandMetadata {
  readonly commandId?: string;
  readonly intentId?: string;
  readonly correlationId?: string;
  readonly revision?: number;
  readonly idempotencyKey?: string;
  readonly capability?: string;
  readonly approval?: AgentExecutionApprovalMetadata;
  readonly policyVersion?: string;
}

export type AgentExecutionCommandKind = 'send' | 'ask';

export interface AgentExecutionAdmissionPolicyContext {
  readonly actorId: string;
  readonly sessionId: string;
  readonly kind: AgentExecutionCommandKind;
  readonly message: {
    readonly type: string;
    readonly [key: string]: unknown;
  };
  readonly principal: AgentExecutionCommandPrincipal;
  readonly metadata: Readonly<AgentExecutionCommandMetadata>;
}

export type AgentExecutionIdempotencyClaimResult =
  | {
      readonly outcome: 'available';
    }
  | {
      readonly outcome: 'duplicate';
      readonly code?: string;
      readonly detail?: string;
    };

export type AgentExecutionIdempotencyClaimPort = (
  context: AgentExecutionAdmissionPolicyContext
) =>
  | AgentExecutionIdempotencyClaimResult
  | Promise<AgentExecutionIdempotencyClaimResult>;

export type AgentExecutionAdmissionPolicyDecision =
  | {
      readonly outcome: 'authorized';
      readonly policy: string;
    }
  | {
      readonly outcome: 'rejected';
      readonly policy: string;
      readonly code: string;
      readonly detail?: string;
    };

export type AgentExecutionAdmissionPolicy = (
  context: AgentExecutionAdmissionPolicyContext
) =>
  | AgentExecutionAdmissionPolicyDecision
  | Promise<AgentExecutionAdmissionPolicyDecision>;

export interface AgentExecutionAdmissionInput {
  readonly actorId: string;
  readonly sessionId: string;
  readonly kind: AgentExecutionCommandKind;
  readonly message: {
    readonly type: string;
    readonly [key: string]: unknown;
  };
  readonly principal: AgentExecutionCommandPrincipal;
  readonly metadata?: AgentExecutionCommandMetadata;
  readonly policy?: AgentExecutionAdmissionPolicy;
  readonly requireExplicitPolicy?: boolean;
  readonly idempotency?: AgentExecutionIdempotencyClaimPort;
  readonly now?: () => Date;
}

export interface AgentExecutionAdmissionDecision {
  readonly principal: AgentExecutionCommandPrincipal;
  readonly metadata: Readonly<Required<Pick<AgentExecutionCommandMetadata, 'commandId'>> & AgentExecutionCommandMetadata>;
  readonly admissionReceipt: AgentExecutionCommandAdmissionReceipt;
  readonly authorizationReceipt?: AgentExecutionAuthorizedReceipt;
  readonly rejectionReceipt?: AgentExecutionRejectedReceipt;
  readonly ok: boolean;
}

export interface AgentExecutionAuthorizationFact {
  readonly policy: string;
  readonly decision: 'approved' | 'denied';
  readonly [key: string]: JsonValue | undefined;
}

export interface AgentExecutionCommandAdmissionFact {
  readonly discovery: 'descriptive_only';
  readonly outcome: 'admitted' | 'rejected';
  readonly rechecked: readonly AgentExecutionRecheckField[];
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

export interface AgentExecutionEffectIntentFact {
  readonly effectType: string;
  readonly irreversible: boolean;
  readonly idempotencyScope: string;
  readonly [key: string]: JsonValue | undefined;
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
  readonly intentId?: string;
  readonly principalId?: string;
  readonly sequence: number;
  readonly attempt?: number;
  readonly revision?: number;
  readonly checkpointId?: string;
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

export interface AgentExecutionCommandAdmissionReceipt extends AgentExecutionReceiptBase {
  readonly receiptKind: 'command_admission';
  readonly status: 'observed';
  readonly admissionStage: AgentExecutionAdmissionStage;
  readonly admission: AgentExecutionCommandAdmissionFact;
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
  readonly checkpointId: string;
  readonly revision: number;
  readonly projection: AgentExecutionStaleProjectionFact;
}

export interface AgentExecutionEffectIntentReceipt extends AgentExecutionReceiptBase {
  readonly receiptKind: 'effect_intent';
  readonly status: 'observed';
  readonly effectId: string;
  readonly attempt: number;
  readonly effect: AgentExecutionEffectIntentFact;
}

export interface AgentExecutionEffectAttemptReceipt extends AgentExecutionReceiptBase {
  readonly receiptKind: 'effect_attempt';
  readonly status: 'succeeded' | 'partial_failure' | 'failed' | 'timeout' | 'cancelled';
  readonly effectId: string;
  readonly attempt: number;
  readonly outcome: AgentExecutionOutcomeFact;
}

export type AgentExecutionReceipt =
  | AgentExecutionCommandAdmissionReceipt
  | AgentExecutionAuthorizedReceipt
  | AgentExecutionCancellationReceipt
  | AgentExecutionEffectIntentReceipt
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
  readonly intentId?: string;
  readonly principalId?: string;
  readonly attempt?: number;
  readonly revision?: number;
  readonly checkpointId?: string;
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
  readonly intentId?: string;
  readonly principalId?: string;
  readonly attempt?: number;
  readonly revision?: number;
  readonly checkpointId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly receipts: readonly AgentExecutionReceipt[];
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function invalidStringResult<TValue extends string>(
  value: unknown
): BrandedStringParseResult<TValue> {
  return {
    outcome: 'invalid',
    reason: 'expected_non_empty_string',
    value,
  };
}

function cloneJsonCompatible<TValue>(value: TValue): TValue {
  return value === undefined ? value : structuredClone(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidIsoTimestamp(value: unknown): value is string {
  return hasNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isJsonSafeValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return Number.isFinite(value as number) || typeof value !== 'number';
  }

  if (Array.isArray(value)) {
    return value.every((entry) => isJsonSafeValue(entry, seen));
  }

  if (typeof value !== 'object') {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }

  seen.add(value);
  const valid = Object.values(value as Record<string, unknown>).every((entry) =>
    isJsonSafeValue(entry, seen)
  );
  seen.delete(value);
  return valid;
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

function hasMatchingOptionalIdentity(
  receiptValue: string | number | undefined,
  traceValue: string | number | undefined
): boolean {
  return receiptValue === undefined || traceValue === undefined || receiptValue === traceValue;
}

function validateReceiptBaseShape(
  receipt: Record<string, unknown>,
  trace: Pick<AgentExecutionTraceInput, 'traceId' | 'actorId' | 'sessionId' | 'commandId'> &
    Partial<
      Pick<
        AgentExecutionTraceInput,
        'intentId' | 'principalId' | 'attempt' | 'revision' | 'checkpointId'
      >
    >
): boolean {
  if (
    !hasNonEmptyString(receipt.receiptId) ||
    !hasNonEmptyString(receipt.recordId) ||
    !hasNonEmptyString(receipt.traceId) ||
    !hasNonEmptyString(receipt.actorId) ||
    !hasNonEmptyString(receipt.sessionId) ||
    !hasNonEmptyString(receipt.commandId) ||
    !hasNonEmptyString(receipt.receiptKind) ||
    !hasNonEmptyString(receipt.status) ||
    !isFiniteNumber(receipt.sequence) ||
    !isValidIsoTimestamp(receipt.occurredAt)
  ) {
    return false;
  }

  if (
    receipt.traceId !== trace.traceId ||
    receipt.actorId !== trace.actorId ||
    receipt.sessionId !== trace.sessionId ||
    receipt.commandId !== trace.commandId
  ) {
    return false;
  }

  if (
    !hasMatchingOptionalIdentity(receipt.intentId as string | undefined, trace.intentId) ||
    !hasMatchingOptionalIdentity(receipt.principalId as string | undefined, trace.principalId) ||
    !hasMatchingOptionalIdentity(receipt.attempt as number | undefined, trace.attempt) ||
    !hasMatchingOptionalIdentity(receipt.revision as number | undefined, trace.revision) ||
    !hasMatchingOptionalIdentity(receipt.checkpointId as string | undefined, trace.checkpointId)
  ) {
    return false;
  }

  if (receipt.intentId !== undefined && !hasNonEmptyString(receipt.intentId)) {
    return false;
  }
  if (receipt.principalId !== undefined && !hasNonEmptyString(receipt.principalId)) {
    return false;
  }
  if (receipt.attempt !== undefined && !isFiniteNumber(receipt.attempt)) {
    return false;
  }
  if (receipt.revision !== undefined && !isFiniteNumber(receipt.revision)) {
    return false;
  }
  if (receipt.checkpointId !== undefined && !hasNonEmptyString(receipt.checkpointId)) {
    return false;
  }

  return true;
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
  receipt: Omit<
    AgentExecutionAuthorizedReceipt,
    'version' | 'receiptKind' | 'status' | 'admissionStage'
  >
): AgentExecutionAuthorizedReceipt {
  return normalizeReceipt({
    ...receipt,
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    receiptKind: 'authorization',
    status: 'authorized',
    admissionStage: 'execution-authorized',
    principalId: receipt.principalId ?? receipt.principal.id,
    principal: freezeClone(receipt.principal),
    authorization: freezeClone(receipt.authorization),
  });
}

export function createExecutionCommandAdmissionReceipt(
  receipt: Omit<AgentExecutionCommandAdmissionReceipt, 'version' | 'receiptKind' | 'status'>
): AgentExecutionCommandAdmissionReceipt {
  return normalizeReceipt({
    ...receipt,
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    receiptKind: 'command_admission',
    status: 'observed',
    admission: freezeClone(receipt.admission),
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

const AGENT_EXECUTION_ADMISSION_RECHECKS: readonly AgentExecutionRecheckField[] = [
  'command',
  'payload',
  'principal',
  'approval',
  'revision',
  'idempotency',
  'policy',
];

function toCommandMetadata(
  input: unknown,
  now: Date
): Required<Pick<AgentExecutionCommandMetadata, 'commandId'>> & AgentExecutionCommandMetadata {
  const metadataInput =
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? (input as AgentExecutionCommandMetadata)
      : undefined;
  return {
    commandId:
      typeof metadataInput?.commandId === 'string' && metadataInput.commandId.trim().length > 0
        ? metadataInput.commandId.trim()
        : `command:${now.toISOString()}`,
    ...('intentId' in (metadataInput ?? {}) ? { intentId: metadataInput?.intentId } : {}),
    ...('correlationId' in (metadataInput ?? {})
      ? { correlationId: metadataInput?.correlationId }
      : {}),
    ...('revision' in (metadataInput ?? {}) ? { revision: metadataInput?.revision } : {}),
    ...('idempotencyKey' in (metadataInput ?? {})
      ? { idempotencyKey: metadataInput?.idempotencyKey }
      : {}),
    ...('capability' in (metadataInput ?? {}) ? { capability: metadataInput?.capability } : {}),
    ...('approval' in (metadataInput ?? {})
      ? { approval: freezeClone(metadataInput?.approval) }
      : {}),
    ...('policyVersion' in (metadataInput ?? {})
      ? { policyVersion: metadataInput?.policyVersion }
      : {}),
  };
}

function invalidAdmissionReason(detail: string, code = 'invalid_command_metadata'): AgentExecutionOutcomeFact {
  return {
    code,
    detail,
  };
}

function validateAdmissionMetadataContainer(input: unknown): AgentExecutionOutcomeFact | null {
  if (input === undefined) {
    return null;
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return invalidAdmissionReason('metadata must be a JSON object when provided.');
  }
  return null;
}

function createFallbackCommandMetadata(
  input: unknown,
  now: Date
): Required<Pick<AgentExecutionCommandMetadata, 'commandId'>> {
  const metadataInput =
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? (input as { commandId?: unknown })
      : undefined;
  return {
    commandId:
      typeof metadataInput?.commandId === 'string' && metadataInput.commandId.trim().length > 0
        ? metadataInput.commandId.trim()
        : `command:${now.toISOString()}`,
  };
}

function validateRawAdmissionMetadata(input: unknown): AgentExecutionOutcomeFact | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }
  const metadataInput = input as Record<string, unknown>;
  if ('commandId' in metadataInput && !hasNonEmptyString(metadataInput.commandId)) {
    return invalidAdmissionReason('commandId must be a non-empty string when provided.');
  }
  if ('idempotencyKey' in metadataInput && !hasNonEmptyString(metadataInput.idempotencyKey)) {
    return invalidAdmissionReason('idempotencyKey must be a non-empty string when provided.');
  }
  if ('approval' in metadataInput) {
    const approvalInput = metadataInput.approval;
    if (typeof approvalInput !== 'object' || approvalInput === null || Array.isArray(approvalInput)) {
      return invalidAdmissionReason('approval must be a JSON-safe object when provided.');
    }
    if (!isJsonSafeValue(approvalInput)) {
      return invalidAdmissionReason('approval must be a JSON-safe object when provided.');
    }
  }
  return null;
}

function resolveAdmissionErrorCode(reasonCode: string): 'forbidden' | 'unauthorized' | 'invalid_frame' {
  if (reasonCode === 'invalid_command_metadata') {
    return 'invalid_frame';
  }
  if (reasonCode === 'missing_principal') {
    return 'unauthorized';
  }
  return 'forbidden';
}

function createAdmissionTraceBase(
  input: AgentExecutionAdmissionInput,
  principal: AgentExecutionCommandPrincipal,
  metadata: Required<Pick<AgentExecutionCommandMetadata, 'commandId'>> & AgentExecutionCommandMetadata,
  occurredAt: string
) {
  const traceId = `trace:${input.sessionId}:${metadata.commandId}`;
  return {
    traceId,
    actorId: input.actorId,
    sessionId: input.sessionId,
    commandId: metadata.commandId,
    ...(metadata.intentId ? { intentId: metadata.intentId } : {}),
    principalId: principal.id,
    ...(metadata.revision !== undefined ? { revision: metadata.revision } : {}),
    ...(metadata.correlationId ? { correlationId: metadata.correlationId } : {}),
    occurredAt,
    ...(metadata.idempotencyKey ? { idempotencyKey: metadata.idempotencyKey } : {}),
  } as const;
}

function validateAdmissionInput(
  rawMetadata: unknown,
  metadata: Required<Pick<AgentExecutionCommandMetadata, 'commandId'>> & AgentExecutionCommandMetadata,
  principal: AgentExecutionCommandPrincipal,
  message: AgentExecutionAdmissionInput['message'],
  now: Date
): AgentExecutionOutcomeFact | null {
  if (!hasNonEmptyString(message.type)) {
    return invalidAdmissionReason('message.type must be a non-empty string.');
  }
  if (!isJsonSafeValue(message)) {
    return invalidAdmissionReason('message must be JSON-safe.');
  }
  if (!hasNonEmptyString(principal.id)) {
    return { code: 'missing_principal', detail: 'Command principal id is required.' };
  }
  if (
    principal.kind !== 'authenticated' &&
    principal.kind !== 'local' &&
    principal.kind !== 'system'
  ) {
    return invalidAdmissionReason('principal.kind must be one of authenticated, local, or system.');
  }
  if (principal.role !== undefined && !hasNonEmptyString(principal.role)) {
    return invalidAdmissionReason('principal.role must be a non-empty string when provided.');
  }
  if (!isJsonSafeValue(principal)) {
    return invalidAdmissionReason('principal must be JSON-safe.');
  }
  if (metadata.intentId !== undefined && !hasNonEmptyString(metadata.intentId)) {
    return invalidAdmissionReason('intentId must be a non-empty string when provided.');
  }
  if (metadata.correlationId !== undefined && !hasNonEmptyString(metadata.correlationId)) {
    return invalidAdmissionReason('correlationId must be a non-empty string when provided.');
  }
  if (metadata.revision !== undefined && (!Number.isInteger(metadata.revision) || metadata.revision < 0)) {
    return invalidAdmissionReason('revision must be a non-negative integer.');
  }
  const metadataInput =
    typeof rawMetadata === 'object' && rawMetadata !== null && !Array.isArray(rawMetadata)
      ? (rawMetadata as Record<string, unknown>)
      : null;
  if (metadata.capability !== undefined && !hasNonEmptyString(metadata.capability)) {
    return invalidAdmissionReason('capability must be a non-empty string when provided.');
  }
  if (metadata.policyVersion !== undefined && !hasNonEmptyString(metadata.policyVersion)) {
    return invalidAdmissionReason('policyVersion must be a non-empty string when provided.');
  }
  if (metadata.approval?.state !== undefined) {
    if (
      metadata.approval.state !== 'granted' &&
      metadata.approval.state !== 'missing' &&
      metadata.approval.state !== 'expired'
    ) {
      return invalidAdmissionReason(
        'approval.state must be granted, missing, or expired when provided.'
      );
    }
  }
  if (metadata.approval !== undefined && !isJsonSafeValue(metadata.approval)) {
    return invalidAdmissionReason('approval must be JSON-safe.');
  }
  if (metadata.approval?.expiresAt) {
    const expiresAt = Date.parse(metadata.approval.expiresAt);
    if (Number.isNaN(expiresAt)) {
      return invalidAdmissionReason('approval.expiresAt must be a valid ISO-8601 timestamp.');
    }
    if (expiresAt <= now.getTime()) {
      return { code: 'approval_expired', detail: 'approval.expiresAt is in the past.' };
    }
  }
  return null;
}

export async function admitAgentExecutionCommand(
  input: AgentExecutionAdmissionInput
): Promise<AgentExecutionAdmissionDecision> {
  const now = (input.now ?? (() => new Date()))();
  const occurredAt = now.toISOString();
  const principal =
    typeof input.principal === 'object' && input.principal !== null && !Array.isArray(input.principal)
      ? (input.principal as AgentExecutionCommandPrincipal)
      : ({
          id: '',
          kind: 'system',
        } as const satisfies AgentExecutionCommandPrincipal);
  const message =
    typeof input.message === 'object' && input.message !== null && !Array.isArray(input.message)
      ? (input.message as AgentExecutionAdmissionInput['message'])
      : ({
          type: '',
        } as const satisfies AgentExecutionAdmissionInput['message']);
  const fallbackMetadata = createFallbackCommandMetadata(input.metadata, now);
  const fallbackBase = createAdmissionTraceBase(input, principal, fallbackMetadata, occurredAt);
  const metadataContainerError = validateAdmissionMetadataContainer(input.metadata);
  if (metadataContainerError) {
    const admissionReceipt = createExecutionCommandAdmissionReceipt({
      receiptId: `${fallbackBase.traceId}:admission:1`,
      recordId: `${fallbackBase.traceId}:record:admission:1`,
      ...fallbackBase,
      sequence: 1,
      admissionStage: 'schema-admitted',
      admission: {
        discovery: 'descriptive_only',
        outcome: 'rejected',
        rechecked: AGENT_EXECUTION_ADMISSION_RECHECKS,
      },
    });
    const rejectionReceipt = createExecutionRejectedReceipt({
      receiptId: `${fallbackBase.traceId}:rejection:2`,
      recordId: `${fallbackBase.traceId}:record:rejection:2`,
      ...fallbackBase,
      sequence: 2,
      admissionStage: 'schema-admitted',
      reason: metadataContainerError,
    });
    return {
      ok: false,
      principal,
      metadata: fallbackMetadata,
      admissionReceipt,
      rejectionReceipt,
    };
  }
  const rawMetadataValidationError = validateRawAdmissionMetadata(input.metadata);
  if (rawMetadataValidationError) {
    const admissionReceipt = createExecutionCommandAdmissionReceipt({
      receiptId: `${fallbackBase.traceId}:admission:1`,
      recordId: `${fallbackBase.traceId}:record:admission:1`,
      ...fallbackBase,
      sequence: 1,
      admissionStage: 'schema-admitted',
      admission: {
        discovery: 'descriptive_only',
        outcome: 'rejected',
        rechecked: AGENT_EXECUTION_ADMISSION_RECHECKS,
      },
    });
    const rejectionReceipt = createExecutionRejectedReceipt({
      receiptId: `${fallbackBase.traceId}:rejection:2`,
      recordId: `${fallbackBase.traceId}:record:rejection:2`,
      ...fallbackBase,
      sequence: 2,
      admissionStage: 'schema-admitted',
      reason: rawMetadataValidationError,
    });
    return {
      ok: false,
      principal,
      metadata: fallbackMetadata,
      admissionReceipt,
      rejectionReceipt,
    };
  }
  const metadata = toCommandMetadata(input.metadata, now);
  const base = createAdmissionTraceBase(input, principal, metadata, occurredAt);
  const validationError = validateAdmissionInput(input.metadata, metadata, principal, message, now);

  if (validationError) {
    const admissionReceipt = createExecutionCommandAdmissionReceipt({
      receiptId: `${base.traceId}:admission:1`,
      recordId: `${base.traceId}:record:admission:1`,
      ...base,
      sequence: 1,
      admissionStage:
        validationError.code === 'invalid_command_metadata' ? 'schema-admitted' : 'execution-authorized',
      admission: {
        discovery: 'descriptive_only',
        outcome: 'rejected',
        rechecked: AGENT_EXECUTION_ADMISSION_RECHECKS,
      },
    });
    const rejectionReceipt = createExecutionRejectedReceipt({
      receiptId: `${base.traceId}:rejection:2`,
      recordId: `${base.traceId}:record:rejection:2`,
      ...base,
      sequence: 2,
      admissionStage: admissionReceipt.admissionStage,
      reason: validationError,
    });
    return {
      ok: false,
      principal,
      metadata,
      admissionReceipt,
      rejectionReceipt,
    };
  }

  try {
    if (input.requireExplicitPolicy && input.policy === undefined) {
      const admissionReceipt = createExecutionCommandAdmissionReceipt({
        receiptId: `${base.traceId}:admission:1`,
        recordId: `${base.traceId}:record:admission:1`,
        ...base,
        sequence: 1,
        admissionStage: 'execution-authorized',
        admission: {
          discovery: 'descriptive_only',
          outcome: 'rejected',
          rechecked: AGENT_EXECUTION_ADMISSION_RECHECKS,
        },
      });
      const rejectionReceipt = createExecutionRejectedReceipt({
        receiptId: `${base.traceId}:rejection:2`,
        recordId: `${base.traceId}:record:rejection:2`,
        ...base,
        sequence: 2,
        admissionStage: 'execution-authorized',
        reason: {
          code: 'missing_policy_adapter',
          detail: 'commandAdmission requires an explicit policy adapter.',
        },
      });
      return {
        ok: false,
        principal,
        metadata,
        admissionReceipt,
        rejectionReceipt,
      };
    }

    const policyContext: AgentExecutionAdmissionPolicyContext = {
      actorId: input.actorId,
      sessionId: input.sessionId,
      kind: input.kind,
      message,
      principal,
      metadata,
    };

    const policyDecision =
      input.policy === undefined
        ? {
            outcome: 'authorized' as const,
            policy: 'legacy-compatibility',
          }
        : await input.policy(policyContext);

    if (policyDecision.outcome === 'rejected') {
      const admissionReceipt = createExecutionCommandAdmissionReceipt({
        receiptId: `${base.traceId}:admission:1`,
        recordId: `${base.traceId}:record:admission:1`,
        ...base,
        sequence: 1,
        admissionStage: 'execution-authorized',
        admission: {
          discovery: 'descriptive_only',
          outcome: 'rejected',
          rechecked: AGENT_EXECUTION_ADMISSION_RECHECKS,
        },
      });
      const rejectionReceipt = createExecutionRejectedReceipt({
        receiptId: `${base.traceId}:rejection:2`,
        recordId: `${base.traceId}:record:rejection:2`,
        ...base,
        sequence: 2,
        admissionStage: 'execution-authorized',
        reason: {
          code: policyDecision.code,
          ...(policyDecision.detail ? { detail: policyDecision.detail } : {}),
        },
      });
      return {
        ok: false,
        principal,
        metadata,
        admissionReceipt,
        rejectionReceipt,
      };
    }

    if (metadata.idempotencyKey !== undefined) {
      if (input.idempotency === undefined) {
        const admissionReceipt = createExecutionCommandAdmissionReceipt({
          receiptId: `${base.traceId}:admission:1`,
          recordId: `${base.traceId}:record:admission:1`,
          ...base,
          sequence: 1,
          admissionStage: 'execution-authorized',
          admission: {
            discovery: 'descriptive_only',
            outcome: 'rejected',
            rechecked: AGENT_EXECUTION_ADMISSION_RECHECKS,
          },
        });
        const rejectionReceipt = createExecutionRejectedReceipt({
          receiptId: `${base.traceId}:rejection:2`,
          recordId: `${base.traceId}:record:rejection:2`,
          ...base,
          sequence: 2,
          admissionStage: 'execution-authorized',
          reason: {
            code: 'missing_idempotency_adapter',
            detail: 'commandAdmission metadata.idempotencyKey requires an explicit idempotency adapter.',
          },
        });
        return {
          ok: false,
          principal,
          metadata,
          admissionReceipt,
          rejectionReceipt,
        };
      }

      let claimResult: AgentExecutionIdempotencyClaimResult;
      try {
        claimResult = await input.idempotency(policyContext);
      } catch (error) {
        const admissionReceipt = createExecutionCommandAdmissionReceipt({
          receiptId: `${base.traceId}:admission:1`,
          recordId: `${base.traceId}:record:admission:1`,
          ...base,
          sequence: 1,
          admissionStage: 'execution-authorized',
          admission: {
            discovery: 'descriptive_only',
            outcome: 'rejected',
            rechecked: AGENT_EXECUTION_ADMISSION_RECHECKS,
          },
        });
        const rejectionReceipt = createExecutionRejectedReceipt({
          receiptId: `${base.traceId}:rejection:2`,
          recordId: `${base.traceId}:record:rejection:2`,
          ...base,
          sequence: 2,
          admissionStage: 'execution-authorized',
          reason: {
            code: 'idempotency_adapter_failure',
            detail: error instanceof Error ? error.message : String(error),
          },
        });
        return {
          ok: false,
          principal,
          metadata,
          admissionReceipt,
          rejectionReceipt,
        };
      }

      if (claimResult.outcome === 'duplicate') {
        const admissionReceipt = createExecutionCommandAdmissionReceipt({
          receiptId: `${base.traceId}:admission:1`,
          recordId: `${base.traceId}:record:admission:1`,
          ...base,
          sequence: 1,
          admissionStage: 'execution-authorized',
          admission: {
            discovery: 'descriptive_only',
            outcome: 'rejected',
            rechecked: AGENT_EXECUTION_ADMISSION_RECHECKS,
          },
        });
        const rejectionReceipt = createExecutionRejectedReceipt({
          receiptId: `${base.traceId}:rejection:2`,
          recordId: `${base.traceId}:record:rejection:2`,
          ...base,
          sequence: 2,
          admissionStage: 'execution-authorized',
          reason: {
            code: claimResult.code ?? 'duplicate_idempotency_key',
            ...(claimResult.detail ? { detail: claimResult.detail } : {}),
          },
        });
        return {
          ok: false,
          principal,
          metadata,
          admissionReceipt,
          rejectionReceipt,
        };
      }
    }

    const admissionReceipt = createExecutionCommandAdmissionReceipt({
      receiptId: `${base.traceId}:admission:1`,
      recordId: `${base.traceId}:record:admission:1`,
      ...base,
      sequence: 1,
      admissionStage: 'execution-authorized',
      admission: {
        discovery: 'descriptive_only',
        outcome: policyDecision.outcome === 'authorized' ? 'admitted' : 'rejected',
        rechecked: AGENT_EXECUTION_ADMISSION_RECHECKS,
      },
    });

    if (policyDecision.outcome === 'authorized') {
      const authorizationReceipt = createExecutionAuthorizedReceipt({
        receiptId: `${base.traceId}:authorization:2`,
        recordId: `${base.traceId}:record:authorization:2`,
        ...base,
        sequence: 2,
        principal,
        authorization: {
          policy: policyDecision.policy,
          decision: 'approved',
        },
      });
      return {
        ok: true,
        principal,
        metadata,
        admissionReceipt,
        authorizationReceipt,
      };
    }

    const rejectionReceipt = createExecutionRejectedReceipt({
      receiptId: `${base.traceId}:rejection:2`,
      recordId: `${base.traceId}:record:rejection:2`,
      ...base,
      sequence: 2,
      admissionStage: 'execution-authorized',
      reason: {
        code: 'policy_adapter_failure',
        detail: 'Admission policy returned an unsupported outcome.',
      },
    });
    return {
      ok: false,
      principal,
      metadata,
      admissionReceipt,
      rejectionReceipt,
    };
  } catch (error) {
    const admissionReceipt = createExecutionCommandAdmissionReceipt({
      receiptId: `${base.traceId}:admission:1`,
      recordId: `${base.traceId}:record:admission:1`,
      ...base,
      sequence: 1,
      admissionStage: 'execution-authorized',
      admission: {
        discovery: 'descriptive_only',
        outcome: 'rejected',
        rechecked: AGENT_EXECUTION_ADMISSION_RECHECKS,
      },
    });
    const rejectionReceipt = createExecutionRejectedReceipt({
      receiptId: `${base.traceId}:rejection:2`,
      recordId: `${base.traceId}:record:rejection:2`,
      ...base,
      sequence: 2,
      admissionStage: 'execution-authorized',
      reason: {
        code: 'policy_adapter_failure',
        detail: error instanceof Error ? error.message : String(error),
      },
    });
    return {
      ok: false,
      principal,
      metadata,
      admissionReceipt,
      rejectionReceipt,
    };
  }
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
    checkpointId: receipt.checkpointId ?? receipt.projection.checkpointId,
    revision: receipt.revision ?? receipt.projection.revision,
    projection: freezeClone(receipt.projection),
  });
}

export function createExecutionEffectIntentReceipt(
  receipt: Omit<AgentExecutionEffectIntentReceipt, 'version' | 'receiptKind' | 'status'>
): AgentExecutionEffectIntentReceipt {
  return normalizeReceipt({
    ...receipt,
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    receiptKind: 'effect_intent',
    status: 'observed',
    effect: freezeClone(receipt.effect),
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

function isKnownReceiptStatus(value: unknown): value is AgentExecutionReceiptStatus {
  return (
    value === 'observed' ||
    value === 'authorized' ||
    value === 'rejected' ||
    value === 'succeeded' ||
    value === 'timeout' ||
    value === 'retrying' ||
    value === 'cancelled' ||
    value === 'reconciled' ||
    value === 'stale_projection' ||
    value === 'partial_failure' ||
    value === 'failed'
  );
}

function isKnownAdmissionStage(value: unknown): value is AgentExecutionAdmissionStage {
  return (
    value === 'schema-admitted' || value === 'domain-accepted' || value === 'execution-authorized'
  );
}

function isRecheckField(value: unknown): value is AgentExecutionRecheckField {
  return (
    value === 'command' ||
    value === 'payload' ||
    value === 'principal' ||
    value === 'approval' ||
    value === 'revision' ||
    value === 'idempotency' ||
    value === 'policy'
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateReceiptShape(
  input: unknown,
  trace: Pick<AgentExecutionTraceInput, 'traceId' | 'actorId' | 'sessionId' | 'commandId'> &
    Partial<
      Pick<
        AgentExecutionTraceInput,
        'intentId' | 'principalId' | 'attempt' | 'revision' | 'checkpointId'
      >
    >
): input is AgentExecutionReceipt {
  if (!isJsonObject(input) || !validateReceiptBaseShape(input, trace)) {
    return false;
  }

  if (!isKnownReceiptStatus(input.status)) {
    return false;
  }

  if (input.effectId !== undefined && !hasNonEmptyString(input.effectId)) {
    return false;
  }
  if (input.effectAttemptId !== undefined && !hasNonEmptyString(input.effectAttemptId)) {
    return false;
  }
  if (input.provider !== undefined && !hasNonEmptyString(input.provider)) {
    return false;
  }
  if (input.idempotencyKey !== undefined && !hasNonEmptyString(input.idempotencyKey)) {
    return false;
  }
  if (input.correlationId !== undefined && !hasNonEmptyString(input.correlationId)) {
    return false;
  }
  if (input.causationId !== undefined && !hasNonEmptyString(input.causationId)) {
    return false;
  }

  switch (input.receiptKind) {
    case 'command_admission':
      return (
        input.status === 'observed' &&
        isKnownAdmissionStage(input.admissionStage) &&
        isJsonObject(input.admission) &&
        input.admission.discovery === 'descriptive_only' &&
        (input.admission.outcome === 'admitted' || input.admission.outcome === 'rejected') &&
        Array.isArray(input.admission.rechecked) &&
        input.admission.rechecked.every(isRecheckField) &&
        isJsonSafeValue(input.admission)
      );
    case 'event':
      return (
        input.status === 'observed' &&
        isJsonObject(input.event) &&
        hasNonEmptyString(input.event.kind) &&
        hasNonEmptyString(input.event.type) &&
        isJsonSafeValue(input.event.payload)
      );
    case 'authorization':
      return (
        input.status === 'authorized' &&
        input.admissionStage === 'execution-authorized' &&
        hasNonEmptyString(input.principalId) &&
        isJsonObject(input.principal) &&
        input.principal.id === input.principalId &&
        isJsonSafeValue(input.principal) &&
        isJsonObject(input.authorization) &&
        hasNonEmptyString(input.authorization.policy) &&
        (input.authorization.decision === 'approved' ||
          input.authorization.decision === 'denied') &&
        isJsonSafeValue(input.authorization)
      );
    case 'rejection':
      return (
        input.status === 'rejected' &&
        isKnownAdmissionStage(input.admissionStage) &&
        isJsonObject(input.reason) &&
        hasNonEmptyString(input.reason.code) &&
        (input.reason.detail === undefined || hasNonEmptyString(input.reason.detail)) &&
        isJsonSafeValue(input.reason)
      );
    case 'result':
      return (
        input.status === 'succeeded' &&
        isJsonObject(input.result) &&
        (input.result.output === undefined || isJsonSafeValue(input.result.output))
      );
    case 'timeout':
      return input.status === 'timeout' && isFiniteNumber(input.timeoutMs);
    case 'retry':
      return (
        input.status === 'retrying' &&
        isJsonObject(input.retry) &&
        isFiniteNumber(input.retry.attempt) &&
        hasNonEmptyString(input.retry.reason) &&
        hasNonEmptyString(input.retry.policy) &&
        input.attempt === input.retry.attempt
      );
    case 'cancellation':
      return (
        input.status === 'cancelled' &&
        isJsonObject(input.cancellation) &&
        hasNonEmptyString(input.cancellation.reason) &&
        hasNonEmptyString(input.cancellation.requestedBy)
      );
    case 'reconciliation':
      return (
        input.status === 'reconciled' &&
        isJsonObject(input.reconciliation) &&
        hasNonEmptyString(input.reconciliation.outcome) &&
        hasNonEmptyString(input.reconciliation.source)
      );
    case 'projection':
      return (
        input.status === 'stale_projection' &&
        hasNonEmptyString(input.checkpointId) &&
        isFiniteNumber(input.revision) &&
        isJsonObject(input.projection) &&
        input.projection.checkpointId === input.checkpointId &&
        input.projection.revision === input.revision &&
        isFiniteNumber(input.projection.expectedRevision)
      );
    case 'effect_intent':
      return (
        input.status === 'observed' &&
        hasNonEmptyString(input.effectId) &&
        isFiniteNumber(input.attempt) &&
        isJsonObject(input.effect) &&
        hasNonEmptyString(input.effect.effectType) &&
        typeof input.effect.irreversible === 'boolean' &&
        hasNonEmptyString(input.effect.idempotencyScope) &&
        isJsonSafeValue(input.effect)
      );
    case 'effect_attempt':
      return (
        (input.status === 'succeeded' ||
          input.status === 'partial_failure' ||
          input.status === 'failed' ||
          input.status === 'timeout' ||
          input.status === 'cancelled') &&
        hasNonEmptyString(input.effectId) &&
        isFiniteNumber(input.attempt) &&
        isJsonObject(input.outcome) &&
        hasNonEmptyString(input.outcome.code) &&
        (input.outcome.detail === undefined || hasNonEmptyString(input.outcome.detail)) &&
        isJsonSafeValue(input.outcome)
      );
    default:
      return false;
  }
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
    ...(input.intentId ? { intentId: input.intentId } : {}),
    ...(input.principalId ? { principalId: input.principalId } : {}),
    ...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
    ...(input.revision !== undefined ? { revision: input.revision } : {}),
    ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
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
  if (value.intentId !== undefined && !hasNonEmptyString(value.intentId)) {
    return { ok: false, reason: 'invalid_receipts', value: value.intentId };
  }
  if (value.principalId !== undefined && !hasNonEmptyString(value.principalId)) {
    return { ok: false, reason: 'invalid_receipts', value: value.principalId };
  }
  if (value.attempt !== undefined && !isFiniteNumber(value.attempt)) {
    return { ok: false, reason: 'invalid_receipts', value: value.attempt };
  }
  if (value.revision !== undefined && !isFiniteNumber(value.revision)) {
    return { ok: false, reason: 'invalid_receipts', value: value.revision };
  }
  if (value.checkpointId !== undefined && !hasNonEmptyString(value.checkpointId)) {
    return { ok: false, reason: 'invalid_receipts', value: value.checkpointId };
  }
  if (!Array.isArray(value.receipts)) {
    return { ok: false, reason: 'invalid_receipts', value: value.receipts };
  }

  const traceIdentity = {
    traceId: value.traceId,
    actorId: value.actorId,
    sessionId: value.sessionId,
    commandId: value.commandId,
    ...(value.intentId ? { intentId: value.intentId } : {}),
    ...(value.principalId ? { principalId: value.principalId } : {}),
    ...(value.attempt !== undefined ? { attempt: value.attempt } : {}),
    ...(value.revision !== undefined ? { revision: value.revision } : {}),
    ...(value.checkpointId ? { checkpointId: value.checkpointId } : {}),
  };
  if (!value.receipts.every((receipt) => validateReceiptShape(receipt, traceIdentity))) {
    return { ok: false, reason: 'invalid_receipts', value: value.receipts };
  }

  let trace: AgentExecutionTrace;
  try {
    trace = createAgentExecutionTrace({
      version: AGENT_EXECUTION_CONTRACT_VERSION,
      traceId: value.traceId,
      actorId: value.actorId,
      sessionId: value.sessionId,
      commandId: value.commandId,
      ...(value.intentId ? { intentId: value.intentId } : {}),
      ...(value.principalId ? { principalId: value.principalId } : {}),
      ...(value.attempt !== undefined ? { attempt: value.attempt } : {}),
      ...(value.revision !== undefined ? { revision: value.revision } : {}),
      ...(value.checkpointId ? { checkpointId: value.checkpointId } : {}),
      ...(value.correlationId ? { correlationId: value.correlationId } : {}),
      ...(value.causationId ? { causationId: value.causationId } : {}),
      receipts: value.receipts as readonly AgentExecutionReceipt[],
    });
  } catch {
    return { ok: false, reason: 'invalid_receipts', value: input };
  }
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
    readonly intentId?: string;
    readonly principalId?: string;
    readonly attempt?: number;
    readonly revision?: number;
    readonly checkpointId?: string;
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
    ...(options.intentId ? { intentId: options.intentId } : {}),
    ...(options.principalId ? { principalId: options.principalId } : {}),
    ...(options.attempt !== undefined ? { attempt: options.attempt } : {}),
    ...(options.revision !== undefined ? { revision: options.revision } : {}),
    ...(options.checkpointId ? { checkpointId: options.checkpointId } : {}),
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
    readonly intentId?: string;
    readonly principalId?: string;
    readonly revision?: number;
    readonly checkpointId?: string;
    readonly effectId: string;
    readonly effectAttemptId: string;
    readonly attempt: number;
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
    outcomeCode === 'failed' ? 'failed' : outcomeCode === 'cancelled' ? 'cancelled' : 'succeeded';

  return createExecutionTimeoutOrEffectReceipt({
    version: AGENT_EXECUTION_CONTRACT_VERSION,
    receiptId: options.receiptId,
    traceId: options.traceId,
    recordId: options.recordId,
    actorId: options.actorId,
    sessionId: options.sessionId,
    commandId: options.commandId,
    ...(options.intentId ? { intentId: options.intentId } : {}),
    ...(options.principalId ? { principalId: options.principalId } : {}),
    ...(options.revision !== undefined ? { revision: options.revision } : {}),
    ...(options.checkpointId ? { checkpointId: options.checkpointId } : {}),
    effectId: options.effectId,
    effectAttemptId: options.effectAttemptId,
    attempt: options.attempt,
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
