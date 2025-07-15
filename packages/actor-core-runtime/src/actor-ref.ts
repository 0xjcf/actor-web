/**
 * @module actor-core/runtime/actor-ref
 * @description Core ActorRef interface for the Actor-Core runtime
 */

import type { AnyStateMachine } from 'xstate';
import type {
  ActorBehavior,
  ActorSnapshot,
  ActorStatus,
  AskOptions,
  BaseEventObject,
  Observable,
  SpawnOptions,
  SupervisionStrategy,
} from './types.js';

// ========================================================================================
// ACTOR REFERENCE INTERFACE
// ========================================================================================

/**
 * Core ActorRef interface for the Actor-Core runtime.
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
  TEmitted = unknown,
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
  // EVENT EMISSION SYSTEM (ACTOR-TO-ACTOR COMMUNICATION)
  // ========================================================================================

  /**
   * Emit an event to all subscribers of this actor
   * @param event - The event to emit
   * @throws {ActorStoppedError} if actor is stopped
   */
  emit(event: TEmitted): void;

  /**
   * Subscribe to events emitted by this actor
   * @param listener - Function to call when events are emitted
   * @returns Unsubscribe function to stop receiving events
   */
  subscribe(listener: (event: TEmitted) => void): () => void;

  /**
   * Subscribe to events emitted by this actor (alias for subscribe)
   * @param listener - Function to call when events are emitted
   * @returns Unsubscribe function to stop receiving events
   */
  on(listener: (event: TEmitted) => void): () => void;

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
// SUPPORTING TYPES AND ERRORS
// ========================================================================================

/**
 * Error thrown when attempting to interact with a stopped actor
 */
export class ActorStoppedError extends Error {
  constructor(actorId: string, operation: string) {
    super(`Cannot ${operation} on stopped actor: ${actorId}`);
    this.name = 'ActorStoppedError';
  }
}

/**
 * Error thrown when an actor operation times out
 */
export class TimeoutError extends Error {
  constructor(timeout: number, operation: string) {
    super(`${operation} timed out after ${timeout}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Generate a unique actor ID
 */
export function generateActorId(prefix = 'actor'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a unique correlation ID for request/response tracking
 */
export function generateCorrelationId(): string {
  return `corr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if an event is a response event
 */
export function isResponseEvent(event: BaseEventObject): boolean {
  return '_response' in event && event._response === true;
}

/**
 * Factory function type for creating ActorRef instances
 */
export type CreateActorRefFunction = <
  TEvent extends BaseEventObject = BaseEventObject,
  TResponse = unknown,
>(
  machine: AnyStateMachine,
  options?: import('./types.js').ActorRefOptions
) => ActorRef<TEvent, TResponse>;
