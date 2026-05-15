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
import type { ActorAddress } from '../actor-system.js';
import {
  type ActorMessageRecord,
  type ActorMessageToRuntimeGatewayEventEnvelopeOptions,
  type ActorRuntimeProjection,
  type ActorSnapshotToRuntimeGatewayWorkflowSnapshotInput,
  type ActorSnapshotTransitionInput,
  actorMessageToRuntimeGatewayEventEnvelope,
  actorRuntimeProjectionToActorSnapshot as actorRuntimeGatewayProjectionToActorSnapshot,
  actorSnapshotsToRuntimeGatewayTransitionRecord,
  actorSnapshotToRuntimeGatewayWorkflowSnapshot,
  deriveRuntimeGatewayPhase,
  type RuntimeGatewayEventEnvelope,
  type RuntimeGatewayEventKind,
  type RuntimeGatewayTransitionRecord,
  type RuntimeGatewayWorkflowSnapshot,
  runtimeGatewayEventPayload,
} from '../runtime-gateway-projection.js';
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
export type ActorWebToFasEventEnvelopeOptions = ActorMessageToRuntimeGatewayEventEnvelopeOptions;
export type ActorSnapshotToFasWorkflowSnapshotInput<TContext = unknown> =
  ActorSnapshotToRuntimeGatewayWorkflowSnapshotInput<TContext>;
export type {
  ActorMessageRecord,
  ActorRuntimeProjection,
  ActorSnapshotTransitionInput,
  RuntimeGatewayEventEnvelope,
  RuntimeGatewayEventKind,
  RuntimeGatewayTransitionRecord,
  RuntimeGatewayWorkflowSnapshot,
};

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

export function actorMessagePayload(message: ActorMessageRecord): Record<string, unknown> {
  return runtimeGatewayEventPayload(message);
}

export function actorMessageToFasEventEnvelope(
  message: ActorMessageRecord,
  options: ActorWebToFasEventEnvelopeOptions
): FasEventEnvelope {
  return actorMessageToRuntimeGatewayEventEnvelope(message, options) as FasEventEnvelope;
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
  return deriveRuntimeGatewayPhase(value);
}

export function actorSnapshotToFasWorkflowSnapshot<TContext = unknown>(
  input: ActorSnapshotToFasWorkflowSnapshotInput<TContext>
): FasWorkflowSnapshot {
  return actorSnapshotToRuntimeGatewayWorkflowSnapshot(input) as FasWorkflowSnapshot;
}

export function actorSnapshotsToFasTransitionRecord(
  input: ActorSnapshotTransitionInput
): FasWorkflowTransitionRecord {
  return actorSnapshotsToRuntimeGatewayTransitionRecord(input) as FasWorkflowTransitionRecord;
}

export function actorRuntimeProjectionToActorSnapshot<TContext = unknown>(
  projection: ActorRuntimeProjection<TContext>
): ActorSnapshot<TContext> {
  return actorRuntimeGatewayProjectionToActorSnapshot(projection);
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
