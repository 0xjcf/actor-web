/**
 * @module framework/core/actors/actor-ref
 * @description Core ActorRef interface and base implementation for Actor-SPA framework
 * @author Agent A - 2025-01-10
 */

import type { EventObject, StateMachine } from 'xstate';
import type { Observable } from '../observables/observable.js';
import type { ActorBehavior, ActorSnapshot, SpawnOptions, SupervisionStrategy } from './types.js';

/**
 * Core ActorRef interface for the Actor-SPA framework.
 *
 * This interface provides a minimal yet functional reference abstraction
 * that hides internal actor state while providing message-passing capabilities.
 *
 * @template TEvent - The event types this actor can receive
 * @template TEmitted - The types of events this actor can emit
 * @template TSnapshot - The snapshot type for this actor's state
 */
export interface ActorRef<
  TEvent extends EventObject = EventObject,
  _TEmitted = unknown,
  TSnapshot extends ActorSnapshot = ActorSnapshot,
> {
  /**
   * Unique identifier for this actor
   */
  readonly id: string;

  /**
   * Send an event to this actor (fire-and-forget)
   * @param event - The event to send
   */
  send(event: TEvent): void;

  /**
   * Send a query and wait for a response (request/response pattern)
   * @param query - The query to send
   * @returns Promise resolving to the response
   * @throws {TimeoutError} if response not received within timeout
   */
  ask<TQuery, TResponse>(query: TQuery): Promise<TResponse>;

  /**
   * Observe state changes with a selector
   * @param selector - Function to select specific state slice
   * @returns Observable of selected state changes
   */
  observe<TSelected>(selector: (snapshot: TSnapshot) => TSelected): Observable<TSelected>;

  /**
   * Spawn a child actor
   * @param behavior - The behavior/machine for the child actor
   * @param options - Options for spawning including supervision strategy
   * @returns Reference to the spawned child actor
   */
  spawn<TChildEvent extends EventObject, TChildEmitted = unknown>(
    behavior: ActorBehavior<TChildEvent> | StateMachine<unknown, unknown, TChildEvent>,
    options?: SpawnOptions
  ): ActorRef<TChildEvent, TChildEmitted>;

  /**
   * Start the actor if not already started
   */
  start(): void;

  /**
   * Stop this actor and cleanup resources
   * @returns Promise that resolves when actor is fully stopped
   */
  stop(): Promise<void>;

  /**
   * Restart this actor with the same configuration
   * @returns Promise that resolves when actor is restarted
   */
  restart(): Promise<void>;

  /**
   * Get the current snapshot of this actor's state
   * @returns Current actor snapshot
   */
  getSnapshot(): TSnapshot;

  /**
   * Check if this actor is currently active
   */
  readonly status: 'active' | 'stopped' | 'error';

  /**
   * Parent actor reference if this is a child actor
   */
  readonly parent?: ActorRef<EventObject, unknown>;

  /**
   * Supervision strategy for this actor
   */
  readonly supervision?: SupervisionStrategy;
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
  parent?: ActorRef<EventObject, unknown>;

  /**
   * Supervision strategy
   */
  supervision?: SupervisionStrategy;

  /**
   * Default timeout for ask operations (ms)
   */
  askTimeout?: number;

  /**
   * Metrics hooks for performance monitoring
   */
  metrics?: {
    onMessage?: (event: EventObject) => void;
    onDrop?: (event: EventObject) => void;
    onError?: (error: Error) => void;
    onStateChange?: (snapshot: ActorSnapshot) => void;
  };
}

/**
 * Error thrown when an ask operation times out
 */
export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeout: number
  ) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when an actor operation fails
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
