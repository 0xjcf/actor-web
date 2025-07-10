/**
 * @module framework/core/actors/types
 * @description Type definitions for Actor-SPA actor system
 * @author Agent C - [Date]
 */

import type { AnyStateMachine, EventObject } from 'xstate';

// TODO: Agent C will define these types based on Agent A's specifications

export interface ActorRefOptions {
  id?: string;
  parent?: ActorRef<EventObject>;
  supervision?: SupervisionStrategy;
}

export type SupervisionStrategy = 'restart-on-failure' | 'stop-on-failure' | 'escalate';

export interface SpawnOptions extends ActorRefOptions {
  name?: string;
  sync?: boolean;
}

export interface ActorSnapshot<TContext = unknown> {
  context: TContext;
  value: unknown;
  status: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  error?: Error;
}

export interface Mailbox<T> {
  enqueue(message: T): boolean;
  dequeue(): T | undefined;
  size(): number;
  clear(): void;
  isFull(): boolean;
  isEmpty(): boolean;
}

export interface ActorBehavior<_TEvent extends EventObject = EventObject> {
  id: string;
  createMachine(): AnyStateMachine; // [actor-web] TODO: Use properly typed StateMachine when XState v5 types are stable
}

// Placeholder for ActorRef interface - Agent A will define
export interface ActorRef<TEvent extends EventObject = EventObject, _TEmitted = unknown> {
  // TODO: Agent A will define the complete interface
  readonly id: string;
  send(event: TEvent): void;
}
