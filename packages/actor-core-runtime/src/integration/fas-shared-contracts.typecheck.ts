/**
 * @module actor-core/runtime/integration/fas-shared-contracts.typecheck
 * @description Compile-time compatibility checks against real FAS shared contracts.
 */

import type {
  CommandExecutionRecord,
  EventEnvelope,
  WorkflowSnapshot,
  WorkflowTransitionRecord,
} from '@franchise/shared-contracts';
import type {
  FasCommandExecutionRecord,
  FasEventEnvelope,
  FasWorkflowSnapshot,
  FasWorkflowTransitionRecord,
} from './fas-shared-contracts.js';

type IsAssignable<TFrom, TTo> = [TFrom] extends [TTo] ? true : false;
type Assert<TValue extends true> = TValue;

type EventEnvelopeIsCompatible = Assert<IsAssignable<FasEventEnvelope, EventEnvelope>>;
type WorkflowSnapshotIsCompatible = Assert<IsAssignable<FasWorkflowSnapshot, WorkflowSnapshot>>;
type WorkflowTransitionRecordIsCompatible = Assert<
  IsAssignable<FasWorkflowTransitionRecord, WorkflowTransitionRecord>
>;
type CommandExecutionRecordIsCompatible = Assert<
  IsAssignable<FasCommandExecutionRecord, CommandExecutionRecord>
>;

export type FasSharedContractCompatibility =
  | EventEnvelopeIsCompatible
  | WorkflowSnapshotIsCompatible
  | WorkflowTransitionRecordIsCompatible
  | CommandExecutionRecordIsCompatible;
