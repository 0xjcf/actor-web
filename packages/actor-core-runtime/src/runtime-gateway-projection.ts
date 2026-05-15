import type { ActorAddress, ActorMessage } from './actor-system.js';
import type { ActorSnapshot } from './types.js';

export type RuntimeGatewayEventKind = 'command' | 'fact' | 'timer';

export interface RuntimeGatewayEventEnvelope<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  kind: RuntimeGatewayEventKind;
  type: string;
  schemaVersion: 1;
  occurredAt: string;
  sourceActor: string;
  targetActor?: string;
  workflowId?: string;
  taskId?: string;
  correlationId?: string;
  causationId?: string;
  payload: TPayload;
}

export interface RuntimeGatewayWorkflowSnapshot {
  workflowId: string;
  actorId: string;
  taskId: string;
  taskTitle: string;
  phase: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  branchName: string | null;
  baseBranch: string | null;
  correlationId: string;
  lastEventType: string | null;
  notes: string[];
  artifacts: Record<string, string>;
}

export interface RuntimeGatewayTransitionRecord {
  fromPhase: string;
  toPhase: string;
  fromStatus: string;
  toStatus: string;
}

export interface RuntimeGatewaySnapshotProjection<TContext = unknown> {
  address: ActorAddress;
  workflowSnapshot: RuntimeGatewayWorkflowSnapshot;
  value: unknown;
  context: TContext;
}

export interface RuntimeGatewayEventProjection<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  address: ActorAddress;
  envelope: RuntimeGatewayEventEnvelope<TPayload>;
}

export type ActorMessageRecord = ActorMessage<{ type: string } & Record<string, unknown>>;

export interface ActorMessageToRuntimeGatewayEventEnvelopeOptions {
  id: string;
  kind: RuntimeGatewayEventKind;
  occurredAt: string;
  sourceActor: string;
  targetActor?: string;
  workflowId?: string;
  taskId?: string;
  correlationId?: string;
  causationId?: string;
}

export interface ActorSnapshotToRuntimeGatewayWorkflowSnapshotInput<TContext = unknown> {
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
  workflowSnapshot: RuntimeGatewayWorkflowSnapshot;
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

export function runtimeGatewayEventPayload(message: ActorMessageRecord): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(message)) {
    if (!ACTOR_ENVELOPE_FIELDS.has(key)) {
      payload[key] = value;
    }
  }

  return payload;
}

export function actorMessageToRuntimeGatewayEventEnvelope(
  message: ActorMessageRecord,
  options: ActorMessageToRuntimeGatewayEventEnvelopeOptions
): RuntimeGatewayEventEnvelope {
  const envelope: RuntimeGatewayEventEnvelope = {
    id: options.id,
    kind: options.kind,
    type: message.type,
    schemaVersion: 1,
    occurredAt: options.occurredAt,
    sourceActor: options.sourceActor,
    payload: runtimeGatewayEventPayload(message),
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

export function deriveRuntimeGatewayPhase(value: unknown): string {
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
    return value.length > 0 ? value.map(deriveRuntimeGatewayPhase).join('.') : 'array';
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length === 0) {
      return 'object';
    }

    return entries
      .map(([key, childValue]) => `${key}.${deriveRuntimeGatewayPhase(childValue)}`)
      .join('.');
  }

  return 'unknown';
}

export function actorSnapshotToRuntimeGatewayWorkflowSnapshot<TContext = unknown>(
  input: ActorSnapshotToRuntimeGatewayWorkflowSnapshotInput<TContext>
): RuntimeGatewayWorkflowSnapshot {
  return {
    workflowId: input.workflowId,
    actorId: input.actorId,
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    phase: input.phase ?? deriveRuntimeGatewayPhase(input.snapshot.value),
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

export function actorSnapshotsToRuntimeGatewayTransitionRecord(
  input: ActorSnapshotTransitionInput
): RuntimeGatewayTransitionRecord {
  return {
    fromPhase: input.fromPhase ?? deriveRuntimeGatewayPhase(input.fromSnapshot.value),
    toPhase: input.toPhase ?? deriveRuntimeGatewayPhase(input.toSnapshot.value),
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
    matches: (state: string) => state === phase || state === deriveRuntimeGatewayPhase(value),
    can: () => status === 'running',
    hasTag: () => false,
    toJSON: () => ({
      value,
      context,
      status,
    }),
  };
}
