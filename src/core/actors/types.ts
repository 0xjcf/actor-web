/**
 * @module framework/core/actors/types
 * @description Type definitions for Actor-SPA actor system
 * @author Agent C - [Date]
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
  parent?: BaseActor<EventObject>;
  supervision?: SupervisionStrategy;
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
  createMachine(): AnyStateMachine; // [actor-web] TODO: Use properly typed StateMachine when XState v5 types are stable
}

/**
 * Full ActorRef interface that extends BaseActor with comprehensive framework features
 * This is the complete interface that framework actors should implement
 */
export interface ActorRef<TEvent extends EventObject = EventObject, TEmitted = unknown>
  extends BaseActor<TEvent> {
  /** Parent actor reference (if this is a child actor) */
  readonly parent?: BaseActor<EventObject>;

  /** Supervision strategy applied to this actor */
  readonly supervision?: SupervisionStrategy;

  /** Request/response pattern */
  ask<TResponse>(query: TEvent, options?: { timeout?: number }): Promise<TResponse>;

  /** Event emission for actor-to-actor communication */
  emit(event: TEmitted): void;

  /** Subscribe to events emitted by this actor */
  subscribe(listener: (event: TEmitted) => void): () => void;

  /** Restart this actor */
  restart(): Promise<void>;

  /** Spawn child actors */
  spawn<TChildEvent extends EventObject>(
    behavior: ActorBehavior<TChildEvent>,
    options?: SpawnOptions
  ): ActorRef<TChildEvent>;
}

// ========================================================================================
// TYPE GUARDS AND UTILITIES
// ========================================================================================

/**
 * Type guard to ensure an object implements the BaseActor interface
 */
export function isActor(obj: unknown): obj is BaseActor {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'status' in obj &&
    'send' in obj &&
    'start' in obj &&
    'stop' in obj &&
    'getSnapshot' in obj
  );
}

/**
 * Type constraint helper - use this in generics to ensure T extends BaseActor
 */
export type ActorConstraint<T> = T extends BaseActor ? T : never;
