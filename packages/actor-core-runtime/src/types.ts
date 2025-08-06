/**
 * @module actor-core/runtime/types
 * @description Core type definitions for the Actor-Web Framework
 */

import type { AnyStateMachine, EventObject, SnapshotFrom } from 'xstate';
import type { UniversalTemplate } from './create-actor.js';

// Re-export for cleaner imports elsewhere

// ========================================================================================
// BASE ACTOR CONTRACT - ALL ACTORS MUST IMPLEMENT
// ========================================================================================

/**
 * Base Actor interface that ALL actors in the framework must implement
 * This ensures consistent behavior and type safety across the entire system
 */
export interface BaseActor<_TEvent extends EventObject = EventObject> {
  /** Unique identifier for this actor */
  readonly id: string;

  /** Current lifecycle status */
  readonly status: ActorStatus;

  /** Send a message to this actor - accepts any message with a type field */
  send<T extends { type: string }>(event: T): void;

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
  parent?: string;
  supervision?: SupervisionStrategy | 'resume' | 'restart' | 'stop';
  /**
   * Optional template extracted from behavior definition (Phase 2.1 Task 2.2)
   * Used for cross-platform rendering and component integration
   */
  template?: UniversalTemplate | ((context: unknown) => string) | string;
  /**
   * Whether to auto-start the actor (default: true)
   * Used by createActorRef for lifecycle control
   */
  autoStart?: boolean;
  /**
   * Default timeout for ask pattern requests (ms)
   * Used by createActorRef for request-response operations
   */
  askTimeout?: number;
  /**
   * Initial input for XState machines
   * Used by createActorRef when creating XState actors
   */
  input?: unknown;
}

export type SupervisionStrategy = 'restart-on-failure' | 'stop-on-failure' | 'escalate' | 'resume';

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

/**
 * Flexible message type that supports any properties beyond the required type field.
 * This is the standard message format for the actor system, allowing maximum flexibility
 * while maintaining type safety through the discriminant type field.
 */
export interface Message {
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

// ========================================================================================
// JSON TYPE UTILITIES
// ========================================================================================

/**
 * JSON-serializable value type for message payloads.
 * Ensures all message data can be safely serialized across actor boundaries.
 */
export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;

/**
 * JSON-serializable object type
 */
export type JsonObject = { [key: string]: JsonValue };

/**
 * JSON-serializable array type
 */
export type JsonArray = JsonValue[];
