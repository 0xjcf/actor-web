/**
 * ActorRef Factory Implementation
 *
 * Creates ActorRef instances that wrap XState actors with pure message-based communication.
 * Implements the complete actor reference interface with supervision and lifecycle management.
 */

import type { Actor, AnyStateMachine, SnapshotFrom } from 'xstate';
import { createActor } from 'xstate';
import {
  type ActorRef,
  type ActorRefOptions,
  ActorStoppedError,
  type BaseMessage,
  generateId,
  type Observable,
  type ResponseMessage,
} from './actor-ref.js';
import { createQuery, RequestResponseManager } from './request-response.js';

// ============================================================================
// ACTORREF IMPLEMENTATION
// ============================================================================

/**
 * Implementation of the ActorRef interface
 */
class ActorRefImpl<TEvent extends BaseMessage = BaseMessage, TResponse = unknown>
  implements ActorRef<TEvent, TResponse>
{
  private actor: Actor<AnyStateMachine>;
  private requestManager = new RequestResponseManager();
  private children = new Map<string, ActorRef<BaseMessage>>();
  private observers = new Set<(snapshot: SnapshotFrom<AnyStateMachine>) => void>();
  private _id: string;
  private _parent?: ActorRef<BaseMessage>;
  private _supervisionStrategy?: ActorRef['supervisionStrategy'];

  constructor(
    private machine: AnyStateMachine,
    private options: ActorRefOptions = {}
  ) {
    this._id = options.id || generateId();
    this._parent = options.parent;
    this._supervisionStrategy = options.supervisionStrategy;

    // Create the underlying XState actor
    this.actor = createActor(machine, {
      input: options.input,
      id: this._id,
    });

    // Setup message handling
    this.setupMessageHandling();

    // Auto-start if specified
    if (options.autoStart !== false) {
      this.start();
    }
  }

  // -------------------------------------------------------------------------
  // CORE MESSAGING
  // -------------------------------------------------------------------------

  send(event: TEvent): void {
    if (this.status === 'stopped') {
      throw new ActorStoppedError(this._id);
    }
    this.actor.send(event);
  }

  async ask<T = TResponse>(query: TEvent): Promise<T> {
    if (this.status === 'stopped') {
      throw new ActorStoppedError(this._id);
    }

    // Create query with response ID
    const queryMessage = createQuery(
      query.type,
      query,
      5000 // Default 5s timeout
    );

    // Send query to actor
    this.actor.send(queryMessage);

    // Wait for response
    return this.requestManager.createRequest<T>(queryMessage);
  }

  // -------------------------------------------------------------------------
  // STATE OBSERVATION
  // -------------------------------------------------------------------------

  observe<TState>(
    selector: (snapshot: SnapshotFrom<AnyStateMachine>) => TState
  ): Observable<TState> {
    let currentValue: TState;

    return {
      subscribe: (observer: (value: TState) => void) => {
        // Get initial value
        currentValue = selector(this.actor.getSnapshot());
        observer(currentValue);

        // Subscribe to changes
        const handler = (snapshot: SnapshotFrom<AnyStateMachine>) => {
          const newValue = selector(snapshot);
          if (newValue !== currentValue) {
            currentValue = newValue;
            observer(newValue);
          }
        };

        this.observers.add(handler);
        this.actor.subscribe(handler);

        return {
          unsubscribe: () => {
            this.observers.delete(handler);
            // Note: XState actors don't have unsubscribe, they clean up automatically
          },
        };
      },
    };
  }

  getSnapshot(): SnapshotFrom<AnyStateMachine> {
    return this.actor.getSnapshot();
  }

  // -------------------------------------------------------------------------
  // LIFECYCLE MANAGEMENT
  // -------------------------------------------------------------------------

  start(): void {
    if (this.status === 'idle' || this.status === 'stopped') {
      this.actor.start();
    }
  }

  stop(): void {
    if (this.status === 'running') {
      // Stop all children first
      for (const child of this.children.values()) {
        child.stop();
      }

      // Clean up request manager
      this.requestManager.cleanup();

      // Stop the actor
      this.actor.stop();
    }
  }

  restart(): void {
    this.stop();

    // Recreate the actor
    this.actor = createActor(this.machine, {
      input: this.options.input,
      id: this._id,
    });

    this.setupMessageHandling();
    this.start();
  }

  matches(statePath: string): boolean {
    return this.actor.getSnapshot().matches(statePath);
  }

  // -------------------------------------------------------------------------
  // ACTOR SUPERVISION
  // -------------------------------------------------------------------------

  spawn<TChild extends BaseMessage = BaseMessage>(
    machine: AnyStateMachine,
    id?: string
  ): ActorRef<TChild> {
    const childId = id || generateId();

    const child = createActorRef<TChild>(machine, {
      id: childId,
      parent: this as ActorRef<BaseMessage>,
      supervisionStrategy: this._supervisionStrategy,
      autoStart: true,
    });

    this.children.set(childId, child as ActorRef<BaseMessage>);
    return child;
  }

  kill(childId: string): void {
    const child = this.children.get(childId);
    if (child) {
      child.stop();
      this.children.delete(childId);
    }
  }

  getChildren(): Map<string, ActorRef> {
    return new Map(this.children);
  }

  // -------------------------------------------------------------------------
  // METADATA
  // -------------------------------------------------------------------------

  get id(): string {
    return this._id;
  }

  get status(): ActorRef['status'] {
    const snapshot = this.actor.getSnapshot();

    if (!snapshot) return 'idle';

    // Map XState status to our status
    switch (snapshot.status) {
      case 'active':
        return 'running';
      case 'stopped':
        return 'stopped';
      case 'error':
        return 'error';
      default:
        return 'idle';
    }
  }

  get parent(): ActorRef | undefined {
    return this._parent;
  }

  get supervisionStrategy(): ActorRef['supervisionStrategy'] {
    return this._supervisionStrategy;
  }

  // -------------------------------------------------------------------------
  // PRIVATE METHODS
  // -------------------------------------------------------------------------

  private setupMessageHandling(): void {
    // Subscribe to actor state changes to handle responses and events
    this.actor.subscribe((snapshot) => {
      // Handle response messages if they exist in the context
      if (
        snapshot.context &&
        typeof snapshot.context === 'object' &&
        'responses' in snapshot.context
      ) {
        const context = snapshot.context as Record<string, unknown>;
        const responses = context.responses;
        if (Array.isArray(responses)) {
          responses.forEach((response) => {
            if (response && typeof response === 'object' && 'responseId' in response) {
              this.requestManager.handleResponse(response as ResponseMessage);
            }
          });
        }
      }

      // Notify all observers of state changes
      this.observers.forEach((observer) => observer(snapshot));
    });
  }

  private handleChildFailure(childId: string, error: Error): void {
    if (!this._supervisionStrategy) {
      // No supervision strategy - just remove failed child
      this.children.delete(childId);
      return;
    }

    const action = this._supervisionStrategy.onChildFailure(childId, error);

    switch (action) {
      case 'restart': {
        const child = this.children.get(childId);
        if (child) {
          child.restart();
        }
        break;
      }

      case 'stop':
        this.kill(childId);
        break;

      case 'escalate':
        // Escalate to parent
        if (this._parent) {
          this._parent.send({
            type: 'CHILD_FAILED',
            childId: this._id,
            error,
          } as BaseMessage);
        } else {
          // No parent - log the error
          console.error('Actor supervision escalated with no parent:', error);
        }
        break;
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ActorRef instance
 */
export function createActorRef<TEvent extends BaseMessage = BaseMessage, TResponse = unknown>(
  machine: AnyStateMachine,
  options?: ActorRefOptions
): ActorRef<TEvent, TResponse> {
  return new ActorRefImpl<TEvent, TResponse>(machine, options);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create an ActorRef with standard query handlers
 */
export function createQueryableActorRef<
  TEvent extends BaseMessage = BaseMessage,
  TResponse = unknown,
>(machine: AnyStateMachine, options?: ActorRefOptions): ActorRef<TEvent, TResponse> {
  // TODO: Enhance machine with standard query handlers
  // This would integrate with the createQueryAction from request-response.ts
  return createActorRef<TEvent, TResponse>(machine, options);
}

/**
 * Create an application root actor with supervision
 */
export function createRootActor(
  machine: AnyStateMachine,
  options?: Omit<ActorRefOptions, 'parent'>
): ActorRef<BaseMessage> {
  return createActorRef<BaseMessage>(machine, {
    ...options,
    supervisionStrategy: {
      onChildFailure: (childId, error) => {
        console.error(`Root actor child ${childId} failed:`, error);
        return 'restart'; // Always try to restart failed children
      },
      maxRestarts: 3,
      restartWindow: 60000, // 1 minute
    },
  });
}
