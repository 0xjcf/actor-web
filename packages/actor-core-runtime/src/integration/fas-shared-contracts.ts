/**
 * @module actor-core/runtime/integration/fas-shared-contracts
 * @description Structural bridge from Actor-Web runtime shapes to FAS shared contracts.
 *
 * FAS owns workflow policy, evidence, and audited command meaning. Actor-Web owns
 * actor topology, message delivery, and actor-level projections. This module keeps
 * the bridge deterministic by requiring callers to supply IDs and timestamps.
 */

import type {
  ActorAddress as FranchiseActorAddress,
  ArtifactReference as FranchiseArtifactReference,
  CommandExecutionRecord as FranchiseCommandExecutionRecord,
  CorrelationContext as FranchiseCorrelationContext,
  EventEnvelope as FranchiseEventEnvelope,
  MessageKind as FranchiseMessageKind,
  WorkflowSnapshot as FranchiseWorkflowSnapshot,
  WorkflowTransitionRecord as FranchiseWorkflowTransitionRecord,
} from '@franchise/shared-contracts';
import type { ActorAddress, ActorMessage } from '../actor-system.js';
import type { ActorSnapshot } from '../types.js';

export type FasMessageKind = FranchiseMessageKind;
export type FasArtifactReference = FranchiseArtifactReference;
export type FasActorAddress = FranchiseActorAddress;
export type FasCorrelationContext = FranchiseCorrelationContext;
export type FasEventEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> =
  FranchiseEventEnvelope<TPayload>;
export type FasWorkflowSnapshot = FranchiseWorkflowSnapshot;
export type FasWorkflowTransitionRecord = FranchiseWorkflowTransitionRecord;
export type FasCommandExecutionRecord = FranchiseCommandExecutionRecord;
export type FasCommandExecutionStatus = FranchiseCommandExecutionRecord['status'];

export type ActorMessageRecord = ActorMessage<{ type: string } & Record<string, unknown>>;

export interface ActorWebToFasEventEnvelopeOptions {
  id: string;
  kind: FasMessageKind;
  occurredAt: string;
  sourceActor: string;
  targetActor?: string;
  workflowId?: string;
  taskId?: string;
  correlationId?: string;
  causationId?: string;
}

export interface ActorSnapshotToFasWorkflowSnapshotInput<TContext = unknown> {
  snapshot: ActorSnapshot<TContext>;
  workflowId: string;
  actorId: string;
  taskId: string;
  taskTitle: string;
  createdAt: string;
  updatedAt: string;
  correlationId: string;
  phase?: string;
  status?: string;
  branchName?: string | null;
  baseBranch?: string | null;
  lastEventType?: string | null;
  notes?: readonly string[];
  artifacts?: Readonly<Record<string, string>>;
}

export interface ActorSnapshotTransitionInput {
  fromSnapshot: Pick<ActorSnapshot, 'value' | 'status'>;
  toSnapshot: Pick<ActorSnapshot, 'value' | 'status'>;
  fromPhase?: string;
  toPhase?: string;
  fromStatus?: string;
  toStatus?: string;
}

export interface ActorRuntimeProjection<TContext = unknown> {
  workflowSnapshot: FasWorkflowSnapshot;
  value: unknown;
  context: TContext;
}

export interface ActorWebCommandExecutionInput {
  commandType: string;
  requestedAt: string;
  status: FasCommandExecutionStatus;
  actor: ActorAddress | FasActorAddress;
  correlationId: string;
  causationId?: string;
  completedAt?: string | null;
  workflowId?: string;
  taskId?: string;
  artifacts?: readonly FasArtifactReference[];
  details?: Record<string, unknown>;
}

const ACTOR_ENVELOPE_FIELDS = new Set([
  'type',
  '_timestamp',
  '_version',
  '_correlationId',
  '_sender',
]);

export function actorMessagePayload(message: ActorMessageRecord): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(message)) {
    if (!ACTOR_ENVELOPE_FIELDS.has(key)) {
      payload[key] = value;
    }
  }

  return payload;
}

export function actorMessageToFasEventEnvelope(
  message: ActorMessageRecord,
  options: ActorWebToFasEventEnvelopeOptions
): FasEventEnvelope {
  const envelope: FasEventEnvelope = {
    id: options.id,
    kind: options.kind,
    type: message.type,
    schemaVersion: 1,
    occurredAt: options.occurredAt,
    sourceActor: options.sourceActor,
    payload: actorMessagePayload(message),
  };

  const correlationId = message._correlationId ?? options.correlationId;

  if (options.targetActor !== undefined) {
    envelope.targetActor = options.targetActor;
  }
  if (options.workflowId !== undefined) {
    envelope.workflowId = options.workflowId;
  }
  if (options.taskId !== undefined) {
    envelope.taskId = options.taskId;
  }
  if (correlationId !== undefined) {
    envelope.correlationId = correlationId;
  }
  if (options.causationId !== undefined) {
    envelope.causationId = options.causationId;
  }

  return envelope;
}

export function fasEventEnvelopeToActorMessage(envelope: FasEventEnvelope): ActorMessageRecord {
  return {
    type: envelope.type,
    ...(envelope.payload ?? {}),
    _timestamp: Date.parse(envelope.occurredAt) || 0,
    _version: String(envelope.schemaVersion),
    ...(envelope.correlationId !== undefined ? { _correlationId: envelope.correlationId } : {}),
  };
}

export function actorSnapshotPhase(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value === null || value === undefined) {
    return 'unknown';
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(actorSnapshotPhase).join('.') : 'array';
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length === 0) {
      return 'object';
    }

    return entries.map(([key, childValue]) => `${key}.${actorSnapshotPhase(childValue)}`).join('.');
  }

  return 'unknown';
}

export function actorSnapshotToFasWorkflowSnapshot<TContext = unknown>(
  input: ActorSnapshotToFasWorkflowSnapshotInput<TContext>
): FasWorkflowSnapshot {
  return {
    workflowId: input.workflowId,
    actorId: input.actorId,
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    phase: input.phase ?? actorSnapshotPhase(input.snapshot.value),
    status: input.status ?? input.snapshot.status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    branchName: input.branchName ?? null,
    baseBranch: input.baseBranch ?? null,
    correlationId: input.correlationId,
    lastEventType: input.lastEventType ?? null,
    notes: [...(input.notes ?? [])],
    artifacts: { ...(input.artifacts ?? {}) },
  };
}

export function actorSnapshotsToFasTransitionRecord(
  input: ActorSnapshotTransitionInput
): FasWorkflowTransitionRecord {
  return {
    fromPhase: input.fromPhase ?? actorSnapshotPhase(input.fromSnapshot.value),
    toPhase: input.toPhase ?? actorSnapshotPhase(input.toSnapshot.value),
    fromStatus: input.fromStatus ?? input.fromSnapshot.status,
    toStatus: input.toStatus ?? input.toSnapshot.status,
  };
}

export function actorRuntimeProjectionToActorSnapshot<TContext = unknown>(
  projection: ActorRuntimeProjection<TContext>
): ActorSnapshot<TContext> {
  const value = projection.value;
  const context = projection.context;
  const status = projection.workflowSnapshot.status as ActorSnapshot<TContext>['status'];
  const phase = projection.workflowSnapshot.phase;

  return {
    value,
    context,
    status,
    matches: (state: string) => state === phase || state === actorSnapshotPhase(value),
    can: () => status === 'running',
    hasTag: () => false,
    toJSON: () => ({
      value,
      context,
      status,
    }),
  };
}

export function actorAddressToFasActorAddress(
  address: ActorAddress | FasActorAddress
): FasActorAddress {
  const fasAddress: FasActorAddress = { id: address.id };
  const kind = 'type' in address ? address.type : address.kind;

  if (kind !== undefined) {
    fasAddress.kind = kind;
  }

  return fasAddress;
}

export function actorCommandExecutionToFasRecord(
  input: ActorWebCommandExecutionInput
): FasCommandExecutionRecord {
  const record: FasCommandExecutionRecord = {
    commandType: input.commandType,
    requestedAt: input.requestedAt,
    status: input.status,
    actor: actorAddressToFasActorAddress(input.actor),
    correlationId: input.correlationId,
  };

  if (input.causationId !== undefined) {
    record.causationId = input.causationId;
  }
  if (input.completedAt !== undefined) {
    record.completedAt = input.completedAt;
  }
  if (input.workflowId !== undefined) {
    record.workflowId = input.workflowId;
  }
  if (input.taskId !== undefined) {
    record.taskId = input.taskId;
  }
  if (input.artifacts !== undefined) {
    record.artifacts = input.artifacts.map((artifact) => ({ ...artifact }));
  }
  if (input.details !== undefined) {
    record.details = { ...input.details };
  }

  return record;
}
