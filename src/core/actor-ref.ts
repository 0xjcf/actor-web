/**
 * Pure Actor Model - ActorRef Interface
 *
 * Core interface for actor-based communication in the Actor-SPA framework.
 * Enables message-only communication, query-response patterns, and actor supervision.
 */

import type { AnyStateMachine, SnapshotFrom } from 'xstate';

// Simple Observable interface (avoiding rxjs dependency)
export interface Observable<T> {
  subscribe(observer: (value: T) => void): { unsubscribe(): void };
}

// ============================================================================
// CORE ACTOR TYPES
// ============================================================================

/**
 * Status of an actor's lifecycle
 */
export type ActorStatus = 'idle' | 'running' | 'stopped' | 'error';

/**
 * Base message interface for all actor communication
 */
export interface BaseMessage {
  type: string;
  timestamp?: number;
  source?: string;
  target?: string;
}

/**
 * Query message for request-response pattern
 */
export interface QueryMessage extends BaseMessage {
  responseId: string;
  timeout?: number;
}

/**
 * Response message for query results
 */
export interface ResponseMessage extends BaseMessage {
  responseId: string;
  data: unknown;
  error?: Error;
}

/**
 * Event message for fire-and-forget communication
 */
export interface EventMessage extends BaseMessage {
  payload?: unknown;
}

/**
 * Actor supervision strategy for handling child failures
 */
export interface SupervisionStrategy {
  onChildFailure(childId: string, error: Error): 'restart' | 'stop' | 'escalate';
  maxRestarts?: number;
  restartWindow?: number;
}

// ============================================================================
// ACTOR REFERENCE INTERFACE
// ============================================================================

/**
 * ActorRef - Pure actor reference for message-based communication
 *
 * This interface provides the core abstraction for interacting with actors
 * using pure message passing, avoiding direct state access.
 */
export interface ActorRef<TEvent = BaseMessage, TResponse = unknown> {
  // -------------------------------------------------------------------------
  // CORE MESSAGING
  // -------------------------------------------------------------------------

  /**
   * Send a fire-and-forget message to the actor
   * @param event - Event to send to the actor
   */
  send(event: TEvent): void;

  /**
   * Send a query and wait for a response (request-response pattern)
   * @param query - Query message to send
   * @returns Promise that resolves with the actor's response
   */
  ask<T = TResponse>(query: TEvent): Promise<T>;

  // -------------------------------------------------------------------------
  // STATE OBSERVATION
  // -------------------------------------------------------------------------

  /**
   * Observe actor state changes reactively
   * @param selector - Function to select specific state slice
   * @returns Observable stream of selected state changes
   */
  observe<TState>(
    selector: (snapshot: SnapshotFrom<AnyStateMachine>) => TState
  ): Observable<TState>;

  /**
   * Get current snapshot of actor state (one-time read)
   * @returns Current state snapshot
   */
  getSnapshot(): SnapshotFrom<AnyStateMachine>;

  // -------------------------------------------------------------------------
  // LIFECYCLE MANAGEMENT
  // -------------------------------------------------------------------------

  /**
   * Start the actor (if not already running)
   */
  start(): void;

  /**
   * Stop the actor gracefully
   */
  stop(): void;

  /**
   * Restart the actor (stop then start)
   */
  restart(): void;

  /**
   * Check if actor matches a specific state
   * @param statePath - State path to check (e.g., 'loading.submitting')
   */
  matches(statePath: string): boolean;

  // -------------------------------------------------------------------------
  // ACTOR SUPERVISION
  // -------------------------------------------------------------------------

  /**
   * Spawn a child actor under this actor's supervision
   * @param machine - State machine for the child actor
   * @param id - Optional ID for the child actor
   * @returns Reference to the spawned child actor
   */
  spawn<TChild = BaseMessage>(machine: AnyStateMachine, id?: string): ActorRef<TChild>;

  /**
   * Terminate a child actor
   * @param childId - ID of the child actor to terminate
   */
  kill(childId: string): void;

  /**
   * Get all child actor references
   * @returns Map of child IDs to actor references
   */
  getChildren(): Map<string, ActorRef>;

  // -------------------------------------------------------------------------
  // METADATA
  // -------------------------------------------------------------------------

  /**
   * Unique identifier for this actor
   */
  readonly id: string;

  /**
   * Current lifecycle status of the actor
   */
  readonly status: ActorStatus;

  /**
   * Reference to parent actor (if this is a child)
   */
  readonly parent?: ActorRef;

  /**
   * Actor supervision strategy
   */
  readonly supervisionStrategy?: SupervisionStrategy;
}

// ============================================================================
// ACTOR FACTORY INTERFACE
// ============================================================================

/**
 * Options for creating an ActorRef
 */
export interface ActorRefOptions {
  id?: string;
  parent?: ActorRef;
  supervisionStrategy?: SupervisionStrategy;
  autoStart?: boolean;
  input?: unknown;
}

/**
 * Factory function type for creating ActorRef instances
 */
export type CreateActorRefFunction = <TEvent = BaseMessage, TResponse = unknown>(
  machine: AnyStateMachine,
  options?: ActorRefOptions
) => ActorRef<TEvent, TResponse>;

// ============================================================================
// MESSAGE PROTOCOL HELPERS
// ============================================================================

/**
 * Type guard to check if a message is a query
 */
export function isQueryMessage(message: BaseMessage): message is QueryMessage {
  return 'responseId' in message && typeof message.responseId === 'string';
}

/**
 * Type guard to check if a message is a response
 */
export function isResponseMessage(message: BaseMessage): message is ResponseMessage {
  return message.type === 'RESPONSE' && 'responseId' in message;
}

/**
 * Type guard to check if a message is an event
 */
export function isEventMessage(message: BaseMessage): message is EventMessage {
  return !isQueryMessage(message) && !isResponseMessage(message);
}

/**
 * Generate a unique ID for messages or actors
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// ACTOR ERROR TYPES
// ============================================================================

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
 * Error thrown when an actor query times out
 */
export class ActorTimeoutError extends ActorError {
  constructor(actorId: string, timeout: number) {
    super(`Actor query timed out after ${timeout}ms`, actorId);
    this.name = 'ActorTimeoutError';
  }
}

/**
 * Error thrown when trying to communicate with a stopped actor
 */
export class ActorStoppedError extends ActorError {
  constructor(actorId: string) {
    super('Cannot communicate with stopped actor', actorId);
    this.name = 'ActorStoppedError';
  }
}

/**
 * Error thrown when a child actor fails and supervision strategy escalates
 */
export class ActorSupervisionError extends ActorError {
  constructor(parentId: string, childId: string, cause: Error) {
    super(`Child actor ${childId} failed and supervision escalated`, parentId, cause);
    this.name = 'ActorSupervisionError';
  }
}
