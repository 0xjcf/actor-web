/**
 * @module framework/core/actors/actor-ref
 * @description Core ActorRef interface and implementation for Actor-SPA framework
 * @author Agent A (Tech Lead) - 2025-07-10
 */

import type { AnyStateMachine, EventObject } from 'xstate';
import type { Observable } from '../observables/observable.js';
import type { ActorBehavior, ActorSnapshot, SpawnOptions, SupervisionStrategy } from './types.js';

// ========================================================================================
// CORE EVENT TYPES
// ========================================================================================

/**
 * Base event constraint for all actor communication
 */
export interface BaseEventObject extends EventObject {
  type: string;
  timestamp?: number;
  metadata?: EventMetadata;
}

/**
 * Event metadata for tracing and correlation
 */
export interface EventMetadata {
  correlationId?: string;
  causationId?: string;
  source?: string;
  userId?: string;
  sessionId?: string;
  [key: string]: unknown;
}

/**
 * Query event for request/response pattern
 */
export interface QueryEvent<TParams = unknown> extends BaseEventObject {
  type: 'query';
  request: string;
  params?: TParams;
  correlationId: string;
  timeout?: number;
}

/**
 * Response event for query results
 */
export interface ResponseEvent<TResult = unknown> extends BaseEventObject {
  type: 'response';
  correlationId: string;
  result?: TResult;
  error?: Error;
}

/**
 * System events for actor lifecycle management
 */
export interface SystemEvent extends BaseEventObject {
  type: `actor.${string}`;
  actorId: string;
}

// ========================================================================================
// SUPERVISION TYPES
// ========================================================================================

/**
 * Actions that can be taken by a supervisor
 */
export type SupervisionAction = 'restart' | 'stop' | 'escalate' | 'ignore';

// ========================================================================================
// ACTOR REFERENCE INTERFACE
// ========================================================================================

/**
 * Core ActorRef interface for the Actor-SPA framework.
 *
 * This interface provides a pure actor reference abstraction that enforces
 * message-only communication while hiding internal actor state.
 *
 * @template TEvent - The event types this actor can receive
 * @template TEmitted - The types of events this actor can emit
 * @template TSnapshot - The snapshot type for this actor's state
 */
export interface ActorRef<
  TEvent extends BaseEventObject = BaseEventObject,
  _TEmitted = unknown, // [actor-web] TODO: Implement event emission system for actors
  TSnapshot extends ActorSnapshot = ActorSnapshot,
> {
  // ========================================================================================
  // IDENTITY & METADATA
  // ========================================================================================

  /**
   * Unique identifier for this actor
   */
  readonly id: string;

  /**
   * Current lifecycle status
   */
  readonly status: ActorStatus;

  /**
   * Parent actor reference (if this is a child actor)
   */
  readonly parent?: ActorRef<BaseEventObject, unknown>;

  /**
   * Supervision strategy applied to this actor
   */
  readonly supervision?: SupervisionStrategy;

  // ========================================================================================
  // MESSAGE PASSING (CORE ACTOR MODEL)
  // ========================================================================================

  /**
   * Send a fire-and-forget message to this actor
   * @param event - The event to send
   * @throws {ActorStoppedError} if actor is stopped
   */
  send(event: TEvent): void;

  /**
   * Send a query and wait for a response (request/response pattern)
   * @param query - The query to send
   * @param options - Timeout and retry options
   * @returns Promise resolving to the response
   * @throws {TimeoutError} if response not received within timeout
   * @throws {ActorStoppedError} if actor is stopped
   */
  ask<TQuery, TResponse>(query: TQuery, options?: AskOptions): Promise<TResponse>;

  // ========================================================================================
  // STATE OBSERVATION (REACTIVE PATTERNS)
  // ========================================================================================

  /**
   * Observe state changes with a selector function
   * @param selector - Function to select specific state slice
   * @returns Observable of selected state changes
   */
  observe<TSelected>(selector: (snapshot: TSnapshot) => TSelected): Observable<TSelected>;

  /**
   * Get the current snapshot of this actor's state (one-time read)
   * @returns Current actor snapshot
   */
  getSnapshot(): TSnapshot;

  // ========================================================================================
  // ACTOR LIFECYCLE
  // ========================================================================================

  /**
   * Start the actor if not already running
   * @throws {ActorError} if actor cannot be started
   */
  start(): void;

  /**
   * Stop this actor gracefully and cleanup all resources
   * @returns Promise that resolves when actor is fully stopped
   */
  stop(): Promise<void>;

  /**
   * Restart this actor with the same configuration
   * @returns Promise that resolves when actor is restarted
   */
  restart(): Promise<void>;

  // ========================================================================================
  // ACTOR SUPERVISION (HIERARCHICAL FAULT TOLERANCE)
  // ========================================================================================

  /**
   * Spawn a child actor under this actor's supervision
   * @param behavior - The behavior/machine for the child actor
   * @param options - Options for spawning including supervision strategy
   * @returns Reference to the spawned child actor
   */
  spawn<TChildEvent extends BaseEventObject, TChildEmitted = unknown>(
    behavior: ActorBehavior<TChildEvent> | AnyStateMachine,
    options?: SpawnOptions
  ): ActorRef<TChildEvent, TChildEmitted>;

  /**
   * Stop a specific child actor
   * @param childId - ID of the child actor to stop
   * @returns Promise that resolves when child is stopped
   */
  stopChild(childId: string): Promise<void>;

  /**
   * Get all child actor references
   * @returns ReadonlyMap of child IDs to actor references
   */
  getChildren(): ReadonlyMap<string, ActorRef<BaseEventObject, unknown>>;

  // ========================================================================================
  // UTILITY METHODS
  // ========================================================================================

  /**
   * Check if this actor matches a specific state pattern
   * @param statePath - State path to check (e.g., 'loading.submitting')
   * @returns true if actor is in the specified state
   */
  matches(statePath: string): boolean;

  /**
   * Check if this actor can receive a specific event type
   * @param eventType - Event type to check
   * @returns true if actor accepts this event type
   */
  accepts(eventType: string): boolean;
}

// ========================================================================================
// SUPPORTING TYPES
// ========================================================================================

/**
 * Actor lifecycle status
 */
export type ActorStatus =
  | 'idle' // Not started
  | 'starting' // In process of starting
  | 'running' // Active and processing messages
  | 'stopping' // In process of stopping
  | 'stopped' // Stopped and cleaned up
  | 'error'; // Failed with unrecoverable error

/**
 * Options for the ask operation
 */
export interface AskOptions {
  /**
   * Timeout in milliseconds (default: 5000)
   */
  timeout?: number;

  /**
   * Number of retry attempts (default: 0)
   */
  retries?: number;

  /**
   * Delay between retries in milliseconds (default: 1000)
   */
  retryDelay?: number;

  /**
   * Correlation ID for tracing (auto-generated if not provided)
   */
  correlationId?: string;

  /**
   * Metadata to include with the request
   */
  metadata?: EventMetadata;
}

/**
 * Options for creating an ActorRef
 */
export interface ActorRefOptions {
  /**
   * Unique identifier for the actor (auto-generated if not provided)
   */
  id?: string;

  /**
   * Parent actor reference
   */
  parent?: ActorRef<BaseEventObject, unknown>;

  /**
   * Supervision strategy for this actor
   */
  supervision?: SupervisionStrategy;

  /**
   * Default timeout for ask operations (ms)
   */
  askTimeout?: number;

  /**
   * Whether to start the actor immediately (default: true)
   */
  autoStart?: boolean;

  /**
   * Initial input data for the actor
   */
  input?: unknown;

  /**
   * Performance monitoring hooks
   */
  metrics?: ActorMetrics;
}

/**
 * Performance monitoring hooks
 */
export interface ActorMetrics {
  /**
   * Called when a message is sent to the actor
   */
  onMessage?: (event: BaseEventObject) => void;

  /**
   * Called when a message is dropped due to mailbox overflow
   */
  onDrop?: (event: BaseEventObject) => void;

  /**
   * Called when the actor encounters an error
   */
  onError?: (error: Error) => void;

  /**
   * Called when the actor's state changes
   */
  onStateChange?: (snapshot: ActorSnapshot) => void;

  /**
   * Called when the actor is restarted
   */
  onRestart?: (attempt: number) => void;
}

// ========================================================================================
// ERROR TYPES
// ========================================================================================

/**
 * Base class for actor-related errors
 */
export class ActorError extends Error {
  constructor(
    message: string,
    public readonly actorId: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ActorError';
  }
}

/**
 * Error thrown when an ask operation times out
 */
export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeout: number,
    public readonly correlationId?: string
  ) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when trying to communicate with a stopped actor
 */
export class ActorStoppedError extends ActorError {
  constructor(actorId: string) {
    super(`Cannot communicate with stopped actor: ${actorId}`, actorId);
    this.name = 'ActorStoppedError';
  }
}

/**
 * Error thrown when actor supervision fails
 */
export class SupervisionError extends ActorError {
  constructor(actorId: string, action: SupervisionAction, cause: Error) {
    super(`Supervision action '${action}' failed for actor: ${actorId}`, actorId, cause);
    this.name = 'SupervisionError';
  }
}

/**
 * Error thrown when actor spawning fails
 */
export class SpawnError extends ActorError {
  constructor(parentId: string, childId: string, cause: Error) {
    super(`Failed to spawn child actor '${childId}' from parent '${parentId}'`, parentId, cause);
    this.name = 'SpawnError';
  }
}

// ========================================================================================
// UTILITY FUNCTIONS
// ========================================================================================

/**
 * Type guard to check if an event is a query
 */
export function isQueryEvent(event: BaseEventObject): event is QueryEvent {
  return event.type === 'query' && 'correlationId' in event;
}

/**
 * Type guard to check if an event is a response
 */
export function isResponseEvent(event: BaseEventObject): event is ResponseEvent {
  return event.type === 'response' && 'correlationId' in event;
}

/**
 * Type guard to check if an event is a system event
 */
export function isSystemEvent(event: BaseEventObject): event is SystemEvent {
  return event.type.startsWith('actor.');
}

/**
 * Generate a unique correlation ID for request/response operations
 */
export function generateCorrelationId(): string {
  // UUID v4 implementation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a unique actor ID
 */
export function generateActorId(prefix = 'actor'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Validate an actor ID format
 */
export function isValidActorId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && /^[a-zA-Z0-9\-_]+$/.test(id);
}

/**
 * Create event metadata with common fields
 */
export function createEventMetadata(options: Partial<EventMetadata> = {}): EventMetadata {
  return {
    timestamp: Date.now(),
    correlationId: generateCorrelationId(),
    ...options,
  };
}
