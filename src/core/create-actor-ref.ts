/**
 * @module framework/core/create-actor-ref
 * @description Unified ActorRef factory implementation combining comprehensive interface with observables and supervision
 * @author Agent A (Tech Lead) - 2025-07-10
 */

import type { Actor, AnyStateMachine, EventObject, SnapshotFrom } from 'xstate';
import { createActor } from 'xstate';

// Use my comprehensive ActorRef interface as primary
import type {
  ActorRef,
  ActorRefOptions,
  ActorStatus,
  AskOptions,
  BaseEventObject,
  ResponseEvent,
} from './actors/actor-ref.js';

// Import types from types.js
import type { ActorSnapshot } from './actors/types.js';

import { ActorStoppedError, generateActorId, isResponseEvent } from './actors/actor-ref.js';

// Use Agent B's Observable implementation
import type { Observable } from './observables/observable.js';
import { CustomObservable } from './observables/observable.js';

import { Supervisor } from './actors/supervisor.js';
import type { SupervisionStrategy } from './actors/types.js';
// Use my advanced messaging and supervision
import { RequestResponseManager } from './messaging/request-response.js';

// ========================================================================================
// UNIFIED ACTORREF IMPLEMENTATION
// ========================================================================================

/**
 * Unified ActorRef implementation that combines all the best components:
 * - My comprehensive ActorRef interface
 * - Agent B's CustomObservable system
 * - My advanced RequestResponseManager
 * - My Supervisor with fault tolerance
 * - Proper XState v5 integration
 */
class UnifiedActorRef<
  TEvent extends BaseEventObject = BaseEventObject,
  TEmitted = unknown,
  TSnapshot extends ActorSnapshot = ActorSnapshot,
> implements ActorRef<TEvent, TEmitted, TSnapshot>
{
  // Core XState actor
  private actor: Actor<AnyStateMachine>;
  private machine: AnyStateMachine;

  // Advanced messaging and supervision
  private requestManager: RequestResponseManager;
  private supervisor?: Supervisor;

  // Actor hierarchy
  private children = new Map<string, ActorRef<BaseEventObject, unknown>>();
  private _parent?: ActorRef<BaseEventObject, unknown>;

  // Lifecycle and metadata
  private _id: string;
  private _status: ActorStatus = 'idle';
  private _supervision?: SupervisionStrategy;

  constructor(
    machine: AnyStateMachine,
    private options: ActorRefOptions = {}
  ) {
    this.machine = machine;
    this._id = options.id || generateActorId('actor');
    this._parent = options.parent;
    this._supervision = options.supervision;

    // Create XState actor with proper configuration
    this.actor = createActor(machine, {
      input: options.input,
      id: this._id,
    });

    // Initialize advanced messaging system
    this.requestManager = new RequestResponseManager({
      defaultTimeout: options.askTimeout || 5000,
      defaultRetries: 0,
      defaultRetryDelay: 1000,
    });

    // Set up supervision if specified
    if (this._supervision) {
      this.setupSupervision();
    }

    // Subscribe to lifecycle events
    this.subscribeToLifecycle();

    // Auto-start if enabled (default: true)
    if (options.autoStart !== false) {
      this.start();
    }
  }

  // ========================================================================================
  // IDENTITY & METADATA
  // ========================================================================================

  get id(): string {
    return this._id;
  }

  get status(): ActorStatus {
    return this._status;
  }

  get parent(): ActorRef<BaseEventObject, unknown> | undefined {
    return this._parent;
  }

  get supervision(): SupervisionStrategy | undefined {
    return this._supervision;
  }

  // ========================================================================================
  // MESSAGE PASSING (CORE ACTOR MODEL)
  // ========================================================================================

  send(event: TEvent): void {
    if (this._status === 'stopped') {
      throw new ActorStoppedError(this._id);
    }

    try {
      this.actor.send(event as EventObject);
      this.options.metrics?.onMessage?.(event);
    } catch (error) {
      this.options.metrics?.onError?.(error as Error);
      this.handleError(error as Error);
    }
  }

  async ask<TQuery, TResponse>(query: TQuery, options: AskOptions = {}): Promise<TResponse> {
    if (this._status === 'stopped') {
      throw new ActorStoppedError(this._id);
    }

    try {
      // Create request with correlation and timeout
      const requestContext = this.requestManager.createRequest<TQuery, TResponse>(query, options);

      // Send query event to actor
      this.actor.send(requestContext.queryEvent as EventObject);

      // Wait for response
      return await requestContext.promise;
    } catch (error) {
      this.options.metrics?.onError?.(error as Error);
      throw error;
    }
  }

  // ========================================================================================
  // STATE OBSERVATION (REACTIVE PATTERNS)
  // ========================================================================================

  observe<TSelected>(selector: (snapshot: TSnapshot) => TSelected): Observable<TSelected> {
    return new CustomObservable<TSelected>((observer) => {
      let currentValue: TSelected;

      try {
        // Get initial value
        const initialSnapshot = this.getSnapshot();
        currentValue = selector(initialSnapshot);
        observer.next?.(currentValue);
      } catch (error) {
        observer.error?.(error as Error);
        return;
      }

      // Subscribe to XState actor changes
      const subscription = this.actor.subscribe((xstateSnapshot) => {
        try {
          const actorSnapshot = this.adaptSnapshot(xstateSnapshot);
          const newValue = selector(actorSnapshot);

          // Only emit if value actually changed
          if (newValue !== currentValue) {
            currentValue = newValue;
            observer.next?.(newValue);
            this.options.metrics?.onStateChange?.(actorSnapshot);
          }
        } catch (error) {
          observer.error?.(error as Error);
        }
      });

      // Return cleanup function
      return () => {
        subscription?.unsubscribe();
      };
    });
  }

  getSnapshot(): TSnapshot {
    const xstateSnapshot = this.actor.getSnapshot();
    return this.adaptSnapshot(xstateSnapshot);
  }

  // ========================================================================================
  // ACTOR LIFECYCLE
  // ========================================================================================

  start(): void {
    if (this._status === 'idle' || this._status === 'stopped') {
      try {
        this._status = 'starting';
        this.actor.start();
        this._status = 'running';

        // Start all children
        for (const child of Array.from(this.children.values())) {
          child.start();
        }
      } catch (error) {
        this._status = 'error';
        this.handleError(error as Error);
      }
    }
  }

  async stop(): Promise<void> {
    if (this._status === 'stopped') {
      return;
    }

    try {
      this._status = 'stopping';

      // Stop all children first
      const childStopPromises = Array.from(this.children.values()).map((child) => child.stop());
      await Promise.all(childStopPromises);

      // Cancel pending requests
      this.requestManager.cancelAllRequests('Actor stopping');

      // Stop the XState actor
      this.actor.stop();
      this._status = 'stopped';

      // Cleanup supervisor
      if (this.supervisor) {
        await this.supervisor.cleanup();
      }

      // Clear children
      this.children.clear();
    } catch (error) {
      this._status = 'error';
      this.handleError(error as Error);
      throw error;
    }
  }

  async restart(): Promise<void> {
    const wasRunning = this._status === 'running';

    await this.stop();

    // Recreate XState actor with same configuration
    this.actor = createActor(this.machine, {
      input: this.options.input,
      id: this._id,
    });

    // Re-subscribe to lifecycle
    this.subscribeToLifecycle();

    // Re-setup supervision
    if (this._supervision) {
      this.setupSupervision();
    }

    // Start if was previously running
    if (wasRunning) {
      this.start();
    }

    // Notify metrics
    this.options.metrics?.onRestart?.(1); // TODO: track attempt count properly
  }

  // ========================================================================================
  // ACTOR SUPERVISION (HIERARCHICAL FAULT TOLERANCE)
  // ========================================================================================

  spawn<TChildEvent extends BaseEventObject, TChildEmitted = unknown>(
    behavior: AnyStateMachine,
    options: ActorRefOptions = {}
  ): ActorRef<TChildEvent, TChildEmitted> {
    const childId = options.id || generateActorId(`${this._id}.child`);

    // Create child actor with supervision
    const child = createActorRef<TChildEvent, TChildEmitted>(behavior, {
      ...options,
      id: childId,
      parent: this,
      supervision: options.supervision || this._supervision,
      // If parent is not running, child should not auto-start regardless of options
      autoStart: options.autoStart === false ? false : this._status === 'running',
    });

    // Track child
    this.children.set(childId, child as ActorRef<BaseEventObject, unknown>);

    // Supervise child if we have supervision
    if (this.supervisor) {
      this.supervisor.supervise(child as ActorRef<BaseEventObject, unknown>);
    }

    return child;
  }

  async stopChild(childId: string): Promise<void> {
    const child = this.children.get(childId);
    if (child) {
      await child.stop();
      this.children.delete(childId);

      // Remove from supervision
      if (this.supervisor) {
        this.supervisor.unsupervise(childId);
      }
    }
  }

  getChildren(): ReadonlyMap<string, ActorRef<BaseEventObject, unknown>> {
    return new Map(this.children);
  }

  // ========================================================================================
  // UTILITY METHODS
  // ========================================================================================

  matches(statePath: string): boolean {
    const snapshot = this.actor.getSnapshot();
    return snapshot.matches ? snapshot.matches(statePath) : false;
  }

  accepts(_eventType: string): boolean {
    // Basic implementation - check if machine has transitions for this event
    // In a more sophisticated implementation, this would check current state transitions
    return true; // TODO: Implement proper event acceptance checking
  }

  // ========================================================================================
  // PRIVATE IMPLEMENTATION
  // ========================================================================================

  private adaptSnapshot(xstateSnapshot: SnapshotFrom<AnyStateMachine>): TSnapshot {
    // Map comprehensive ActorStatus to simpler ActorSnapshot status
    const simpleStatus: 'active' | 'stopped' | 'error' =
      this._status === 'running' || this._status === 'starting'
        ? 'active'
        : this._status === 'error'
          ? 'error'
          : 'stopped';

    const baseSnapshot: ActorSnapshot = {
      context: xstateSnapshot.context || {},
      value: xstateSnapshot.value,
      status: simpleStatus,
      error: this._status === 'error' ? new Error('Actor in error state') : undefined,
    };

    return baseSnapshot as TSnapshot;
  }

  private setupSupervision(): void {
    if (!this._supervision) return;

    this.supervisor = new Supervisor({
      strategy: this._supervision,
      maxRestarts: 3,
      restartWindow: 60000, // 1 minute
      restartDelay: 1000, // 1 second
      onRestart: (_actorRef, _error, attempt) => {
        this.options.metrics?.onRestart?.(attempt);
      },
      onFailure: (_actorRef, error) => {
        this.options.metrics?.onError?.(error);
        this.handleError(error);
      },
    });

    // Self-supervise
    this.supervisor.supervise(this as ActorRef<BaseEventObject, unknown>);
  }

  private subscribeToLifecycle(): void {
    this.actor.subscribe((snapshot) => {
      // Handle response messages in actor context
      this.handleResponseMessages(snapshot);

      // Update metrics
      if (this._status === 'running') {
        const actorSnapshot = this.adaptSnapshot(snapshot);
        this.options.metrics?.onStateChange?.(actorSnapshot);
      }
    });
  }

  private handleResponseMessages(snapshot: SnapshotFrom<AnyStateMachine>): void {
    // Check for response messages in context and handle them
    if (snapshot.context && typeof snapshot.context === 'object') {
      const context = snapshot.context as Record<string, unknown>;

      // Look for response messages (this is a convention - actors should put responses here)
      if (context.pendingResponses && Array.isArray(context.pendingResponses)) {
        // Process each response without mutating the context
        for (const response of context.pendingResponses) {
          if (
            response &&
            typeof response === 'object' &&
            isResponseEvent(response as BaseEventObject)
          ) {
            this.requestManager.handleResponse(response as ResponseEvent);
          }
        }

        // NOTE: We don't delete pendingResponses here as that would mutate the context
        // The machine should clear its own pendingResponses in an action if needed
      }
    }
  }

  private handleError(error: Error): void {
    // Update status
    if (this._status !== 'stopped') {
      this._status = 'error';
    }

    // Notify metrics
    this.options.metrics?.onError?.(error);

    // Handle through supervision if available
    if (this.supervisor) {
      this.supervisor.handleFailure(error, this as ActorRef<BaseEventObject, unknown>);
    } else if (this._parent) {
      // Escalate to parent if no supervision
      this._parent.send({
        type: 'actor.child.error',
        actorId: this._id,
        error,
        timestamp: Date.now(),
      } as BaseEventObject);
    } else {
      // Root actor with no supervision - log error
      console.error(`Unhandled error in actor ${this._id}:`, error);
    }
  }
}

// ========================================================================================
// FACTORY FUNCTIONS
// ========================================================================================

/**
 * Create a new ActorRef instance using the unified implementation
 *
 * @param machine - XState machine definition
 * @param options - Configuration options
 * @returns Fully-featured ActorRef instance
 */
export function createActorRef<
  TEvent extends BaseEventObject = BaseEventObject,
  TEmitted = unknown,
  TSnapshot extends ActorSnapshot = ActorSnapshot,
>(machine: AnyStateMachine, options?: ActorRefOptions): ActorRef<TEvent, TEmitted, TSnapshot> {
  return new UnifiedActorRef<TEvent, TEmitted, TSnapshot>(machine, options);
}

/**
 * Create an application root actor with robust supervision
 *
 * @param machine - Root state machine
 * @param options - Configuration options (parent will be ignored)
 * @returns Root ActorRef with supervision configured
 */
export function createRootActor(
  machine: AnyStateMachine,
  options?: Omit<ActorRefOptions, 'parent'>
): ActorRef<BaseEventObject> {
  return createActorRef<BaseEventObject>(machine, {
    ...options,
    // Root actors get robust supervision by default
    supervision: options?.supervision || 'restart-on-failure',
    // Root actors should not auto-start by default (controlled startup)
    autoStart: options?.autoStart ?? false,
  });
}

/**
 * Create an ActorRef with enhanced query/response capabilities
 *
 * @param machine - State machine with query handling
 * @param options - Configuration options
 * @returns ActorRef optimized for request/response patterns
 */
export function createQueryableActorRef<
  TEvent extends BaseEventObject = BaseEventObject,
  TEmitted = unknown,
>(machine: AnyStateMachine, options?: ActorRefOptions): ActorRef<TEvent, TEmitted> {
  return createActorRef<TEvent, TEmitted>(machine, {
    ...options,
    // Longer timeout for query-heavy actors
    askTimeout: options?.askTimeout || 10000,
    // Enhanced error handling for query patterns
    supervision: options?.supervision || 'restart-on-failure',
  });
}

// ========================================================================================
// TYPE EXPORTS
// ========================================================================================

// Re-export all the comprehensive types for consumers
export type {
  ActorRef,
  ActorRefOptions,
  BaseEventObject,
  QueryEvent,
  ResponseEvent,
  AskOptions,
  ActorStatus,
} from './actors/actor-ref.js';

export type { ActorSnapshot, SpawnOptions } from './actors/types.js';

export {
  ActorError,
  ActorStoppedError,
  TimeoutError,
  generateActorId,
  generateCorrelationId,
} from './actors/actor-ref.js';
