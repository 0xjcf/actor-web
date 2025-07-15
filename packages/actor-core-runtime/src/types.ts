/**
 * @module actor-core/runtime/types
 * @description Core type definitions for Actor-Core runtime
 */

import type { AnyStateMachine, EventObject, SnapshotFrom } from 'xstate';

// ========================================================================================
// BASE ACTOR CONTRACT - ALL ACTORS MUST IMPLEMENT
// ========================================================================================

/**
 * Base Actor interface that ALL actors in the framework must implement
 * This ensures consistent behavior and type safety across the entire system
 */
export interface BaseActor<TEvent extends EventObject = EventObject> {
  /** Unique identifier for this actor */
  readonly id: string;

  /** Current lifecycle status */
  readonly status: ActorStatus;

  /** Send a message to this actor */
  send(event: TEvent): void;

  /** Start the actor */
  start(): void;

  /** Stop the actor gracefully */
  stop(): Promise<void> | void;

  /** Get current actor snapshot */
  getSnapshot(): ActorSnapshot;
}

/**
 * Actor lifecycle status
 */
export type ActorStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

// ========================================================================================
// FRAMEWORK-SPECIFIC TYPES
// ========================================================================================

export interface ActorRefOptions {
  id?: string;
  parent?: unknown; // Will be properly typed by the ActorRef implementation
  supervision?: SupervisionStrategy;
  input?: unknown;
  askTimeout?: number;
  autoStart?: boolean;
}

export type SupervisionStrategy = 'restart-on-failure' | 'stop-on-failure' | 'escalate';

export interface SpawnOptions extends ActorRefOptions {
  name?: string;
  sync?: boolean;
}

/**
 * Enhanced ActorSnapshot that preserves XState functionality while adding framework features
 * This allows proper TypeScript inference without type casting
 */
export interface ActorSnapshot<TContext = unknown> {
  context: TContext;
  value: unknown;
  status: ActorStatus;
  error?: Error;

  // XState native methods for proper compatibility
  matches(state: string): boolean;
  can(event: EventObject | string): boolean;
  hasTag(tag: string): boolean;
  toJSON(): object;
}

/**
 * XState-compatible snapshot that extends native XState snapshots with framework features
 * This provides the best of both worlds: XState functionality + framework enhancements
 */
export type FrameworkSnapshot<TMachine extends AnyStateMachine> = SnapshotFrom<TMachine> & {
  status: ActorStatus;
  error?: Error;
};

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
  createMachine(): AnyStateMachine;
}

// ========================================================================================
// MESSAGING TYPES
// ========================================================================================

export interface BaseMessage {
  type: string;
  [key: string]: unknown;
}

export interface BaseEventObject extends EventObject {
  type: string;
}

export interface ResponseEvent extends BaseEventObject {
  type: string;
  _response?: boolean;
  _requestId?: string;
  payload?: unknown;
  error?: Error;
}

export interface AskOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  correlationId?: string;
  metadata?: EventMetadata;
}

export interface EventMetadata {
  correlationId: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface QueryEvent<TParams = unknown> extends BaseEventObject {
  type: 'query';
  request: string;
  params: TParams;
  correlationId: string;
  timeout: number;
  metadata: EventMetadata;
}

// ========================================================================================
// OBSERVABLE TYPES
// ========================================================================================

export interface Observer<T> {
  next: (value: T) => void;
  error?: (error: Error) => void;
  complete?: () => void;
}

export interface Subscription {
  unsubscribe(): void;
}

export interface Observable<T> {
  subscribe(observer: Observer<T>): Subscription;
  subscribe(next: (value: T) => void): Subscription;
}
