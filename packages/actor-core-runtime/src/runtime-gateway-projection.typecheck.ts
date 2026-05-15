/**
 * @module actor-core/runtime/runtime-gateway-projection.typecheck
 * @description Compile-time checks that the core runtime gateway projection contracts stand on runtime-native types.
 */

import type { ActorAddress, ActorMessage } from './actor-system.js';
import type {
  ActorMessageRecord,
  ActorRuntimeProjection,
  RuntimeGatewayEventEnvelope,
  RuntimeGatewayEventKind,
  RuntimeGatewayEventProjection,
  RuntimeGatewaySnapshotProjection,
  RuntimeGatewayTransitionRecord,
  RuntimeGatewayWorkflowSnapshot,
} from './runtime-gateway-projection.js';
import type { ActorSnapshot } from './types.js';

type IsAssignable<TFrom, TTo> = [TFrom] extends [TTo] ? true : false;
type Assert<TValue extends true> = TValue;

type ExpectedWorkflowSnapshot = {
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
};

type ExpectedEventEnvelope = {
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
  payload: Record<string, unknown>;
};

type WorkflowSnapshotShape = Assert<
  IsAssignable<RuntimeGatewayWorkflowSnapshot, ExpectedWorkflowSnapshot>
>;
type EventEnvelopeShape = Assert<IsAssignable<RuntimeGatewayEventEnvelope, ExpectedEventEnvelope>>;
type SnapshotProjectionAddress = Assert<
  IsAssignable<RuntimeGatewaySnapshotProjection['address'], ActorAddress>
>;
type EventProjectionAddress = Assert<
  IsAssignable<RuntimeGatewayEventProjection['address'], ActorAddress>
>;
type MessageRecordCompatibility = Assert<IsAssignable<ActorMessageRecord, ActorMessage>>;
type RuntimeProjectionSnapshot = Assert<
  IsAssignable<ActorRuntimeProjection['workflowSnapshot'], RuntimeGatewayWorkflowSnapshot>
>;
type TransitionRecordShape = Assert<
  IsAssignable<
    RuntimeGatewayTransitionRecord,
    {
      fromPhase: string;
      toPhase: string;
      fromStatus: string;
      toStatus: string;
    }
  >
>;
type ActorSnapshotStatus = Assert<
  IsAssignable<ActorRuntimeProjection['context'], ActorSnapshot['context'] | unknown>
>;

export type RuntimeGatewayProjectionCompatibility =
  | WorkflowSnapshotShape
  | EventEnvelopeShape
  | SnapshotProjectionAddress
  | EventProjectionAddress
  | MessageRecordCompatibility
  | RuntimeProjectionSnapshot
  | TransitionRecordShape
  | ActorSnapshotStatus;
