/**
 * @module actor-core/runtime/runtime-projection
 * @description Neutral runtime projection contracts for cross-node snapshot/event
 * replication and gateway projections. These shapes carry only generic actor
 * runtime concepts (state value, status, state label, timestamps, event
 * type/payload) — no workflow/task/command vocabulary. Application layers that
 * need richer semantics map from these on their own side.
 */

import type { ActorAddress, ActorMessage } from './actor-system.js';
import type { ActorSnapshot } from './types.js';

export type ActorProjectionEventKind = 'command' | 'fact' | 'timer';

export interface ActorEventEnvelope<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  kind: ActorProjectionEventKind;
  type: string;
  schemaVersion: 1;
  occurredAt: string;
  sourceActor: string;
  targetActor?: string;
  correlationId?: string;
  causationId?: string;
  payload: TPayload;
}

export interface ActorRuntimeSnapshot {
  actorId: string;
  status: string;
  stateLabel: string;
  createdAt: string;
  updatedAt: string;
  correlationId: string;
  lastEventType: string | null;
}

export interface ActorTransitionRecord {
  fromState: string;
  toState: string;
  fromStatus: string;
  toStatus: string;
}

export interface ActorSnapshotProjection<TContext = unknown> {
  address: ActorAddress;
  snapshot: ActorRuntimeSnapshot;
  value: unknown;
  context: TContext;
}

export interface ActorEventProjection<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  address: ActorAddress;
  envelope: ActorEventEnvelope<TPayload>;
}

export type ActorMessageRecord = ActorMessage<{ type: string } & Record<string, unknown>>;

export interface ActorEventEnvelopeOptions {
  id: string;
  kind: ActorProjectionEventKind;
  occurredAt: string;
  sourceActor: string;
  targetActor?: string;
  correlationId?: string;
  causationId?: string;
}

export interface ActorRuntimeSnapshotInput<TContext = unknown> {
  snapshot: ActorSnapshot<TContext>;
  actorId: string;
  createdAt: string;
  updatedAt: string;
  correlationId: string;
  stateLabel?: string;
  status?: string;
  lastEventType?: string | null;
}

export interface ActorTransitionInput {
  fromSnapshot: Pick<ActorSnapshot, 'value' | 'status'>;
  toSnapshot: Pick<ActorSnapshot, 'value' | 'status'>;
  fromState?: string;
  toState?: string;
  fromStatus?: string;
  toStatus?: string;
}

export interface ActorRuntimeProjection<TContext = unknown> {
  snapshot: ActorRuntimeSnapshot;
  value: unknown;
  context: TContext;
}

const ACTOR_ENVELOPE_FIELDS = new Set([
  'type',
  '_timestamp',
  '_version',
  '_correlationId',
  '_sender',
]);

export function actorEventPayload(message: ActorMessageRecord): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(message)) {
    if (!ACTOR_ENVELOPE_FIELDS.has(key)) {
      payload[key] = value;
    }
  }

  return payload;
}

export function actorMessageToEventEnvelope(
  message: ActorMessageRecord,
  options: ActorEventEnvelopeOptions
): ActorEventEnvelope {
  const envelope: ActorEventEnvelope = {
    id: options.id,
    kind: options.kind,
    type: message.type,
    schemaVersion: 1,
    occurredAt: options.occurredAt,
    sourceActor: options.sourceActor,
    payload: actorEventPayload(message),
  };

  const correlationId = message._correlationId ?? options.correlationId;

  if (options.targetActor !== undefined) {
    envelope.targetActor = options.targetActor;
  }
  if (correlationId !== undefined) {
    envelope.correlationId = correlationId;
  }
  if (options.causationId !== undefined) {
    envelope.causationId = options.causationId;
  }

  return envelope;
}

export function eventEnvelopeToActorMessage(envelope: ActorEventEnvelope): ActorMessageRecord {
  return {
    type: envelope.type,
    ...(envelope.payload ?? {}),
    _timestamp: Date.parse(envelope.occurredAt) || 0,
    _version: String(envelope.schemaVersion),
    ...(envelope.correlationId !== undefined ? { _correlationId: envelope.correlationId } : {}),
  };
}

export function deriveStateLabel(value: unknown): string {
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
    return value.length > 0 ? value.map(deriveStateLabel).join('.') : 'array';
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length === 0) {
      return 'object';
    }

    return entries.map(([key, childValue]) => `${key}.${deriveStateLabel(childValue)}`).join('.');
  }

  return 'unknown';
}

export function actorSnapshotToRuntimeSnapshot<TContext = unknown>(
  input: ActorRuntimeSnapshotInput<TContext>
): ActorRuntimeSnapshot {
  return {
    actorId: input.actorId,
    status: input.status ?? input.snapshot.status,
    stateLabel: input.stateLabel ?? deriveStateLabel(input.snapshot.value),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    correlationId: input.correlationId,
    lastEventType: input.lastEventType ?? null,
  };
}

export function actorSnapshotsToTransitionRecord(
  input: ActorTransitionInput
): ActorTransitionRecord {
  return {
    fromState: input.fromState ?? deriveStateLabel(input.fromSnapshot.value),
    toState: input.toState ?? deriveStateLabel(input.toSnapshot.value),
    fromStatus: input.fromStatus ?? input.fromSnapshot.status,
    toStatus: input.toStatus ?? input.toSnapshot.status,
  };
}

export function actorRuntimeProjectionToActorSnapshot<TContext = unknown>(
  projection: ActorRuntimeProjection<TContext>
): ActorSnapshot<TContext> {
  const value = projection.value;
  const context = projection.context;
  const status = projection.snapshot.status as ActorSnapshot<TContext>['status'];
  const stateLabel = projection.snapshot.stateLabel;

  return {
    value,
    context,
    status,
    matches: (state: string) => state === stateLabel || state === deriveStateLabel(value),
    can: () => status === 'running',
    hasTag: () => false,
    toJSON: () => ({
      value,
      context,
      status,
    }),
  };
}
