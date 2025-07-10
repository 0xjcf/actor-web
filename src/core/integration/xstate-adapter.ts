/**
 * @module framework/core/integration/xstate-adapter
 * @description XState v5 adapter for ActorRef interface
 * @author Agent A - 2025-01-10
 */

import type { Actor, AnyStateMachine, EventObject, SnapshotFrom } from 'xstate';
import { createActor } from 'xstate';
import type { ActorRef, ActorRefOptions, TimeoutError } from '../actors/actor-ref.js';
import type { Observable } from '../observables/observable.js';
import type { SupervisionStrategy } from '../actors/types.js';
import { CustomObservable } from '../observables/observable.js';
import { RequestResponseManager } from '../messaging/request-response.js';
import { Supervisor } from '../actors/supervisor.js';

/**
 * Adapts an XState v5 actor to the ActorRef interface
 * Provides pure message-passing abstraction over XState's imperative API
 */
export class XStateActorRefAdapter<
  TMachine extends AnyStateMachine,
  TEvent extends EventObject = EventObject,
  TSnapshot = SnapshotFrom<TMachine>
> implements ActorRef<TEvent, any, TSnapshot> {
  private actor: Actor<TMachine>;
  private requestManager: RequestResponseManager;
  private supervisor?: Supervisor;
  private children = new Map<string, ActorRef>();
  private _status: 'active' | 'stopped' | 'error' = 'stopped';

  constructor(
    machine: TMachine,
    private options: ActorRefOptions = {}
  ) {
    // Create XState actor
    this.actor = createActor(machine, {
      id: options.id,
      input: options.input,
      parent: options.parent ? this.adaptParent(options.parent) : undefined,
    });

    // Initialize request/response manager
    this.requestManager = new RequestResponseManager(options.askTimeout);

    // Set up supervision if specified
    if (options.supervision) {
      this.setupSupervision(options.supervision);
    }

    // Subscribe to actor lifecycle
    this.subscribeToLifecycle();
  }

  get id(): string {
    return this.actor.id;
  }

  get status(): 'active' | 'stopped' | 'error' {
    return this._status;
  }

  get parent(): ActorRef<EventObject, unknown> | undefined {
    return this.options.parent;
  }

  get supervision(): SupervisionStrategy | undefined {
    return this.options.supervision;
  }

  send(event: TEvent): void {
    if (this._status === 'stopped') {
      console.warn(`Cannot send event to stopped actor ${this.id}`);
      return;
    }

    try {
      this.actor.send(event);
      this.options.metrics?.onMessage?.(event);
    } catch (error) {
      this.options.metrics?.onError?.(error as Error);
      throw error;
    }
  }

  async ask<TQuery, TResponse>(query: TQuery): Promise<TResponse> {
    if (this._status === 'stopped') {
      throw new Error(`Cannot query stopped actor ${this.id}`);
    }

    const { envelope, promise } = this.requestManager.createRequest<TQuery, TResponse>(
      query,
      this.options.askTimeout
    );

    // Send query as event
    this.send({
      type: 'actor.query',
      ...envelope,
    } as any);

    return promise;
  }

  observe<TSelected>(selector: (snapshot: TSnapshot) => TSelected): Observable<TSelected> {
    return new CustomObservable<TSelected>((observer) => {
      // Get initial value
      const initialValue = selector(this.actor.getSnapshot() as TSnapshot);
      observer.next(initialValue);

      // Subscribe to changes
      const subscription = this.actor.subscribe((snapshot) => {
        try {
          const selected = selector(snapshot as TSnapshot);
          observer.next(selected);
          this.options.metrics?.onStateChange?.(snapshot);
        } catch (error) {
          observer.error(error as Error);
        }
      });

      // Return cleanup function
      return () => {
        subscription.unsubscribe();
      };
    });
  }

  spawn<TChildEvent extends EventObject>(
    behavior: AnyStateMachine,
    options?: { id?: string; supervision?: SupervisionStrategy }
  ): ActorRef<TChildEvent> {
    const childId = options?.id || `${this.id}.child-${this.children.size}`;
    
    // Create child actor ref
    const childRef = new XStateActorRefAdapter(behavior, {
      id: childId,
      parent: this as any,
      supervision: options?.supervision || this.supervision,
    });

    // Track child
    this.children.set(childId, childRef as any);

    // Start child if we're running
    if (this._status === 'active') {
      childRef.start();
    }

    return childRef as any;
  }

  start(): void {
    if (this._status === 'active') {
      return;
    }

    try {
      this.actor.start();
      this._status = 'active';

      // Start all children
      for (const child of this.children.values()) {
        child.start();
      }
    } catch (error) {
      this._status = 'error';
      this.handleError(error as Error);
    }
  }

  async stop(): Promise<void> {
    if (this._status === 'stopped') {
      return;
    }

    try {
      // Stop all children first
      await Promise.all(
        Array.from(this.children.values()).map(child => child.stop())
      );

      // Stop self
      this.actor.stop();
      this._status = 'stopped';

      // Cleanup
      this.requestManager.cleanup();
      this.children.clear();
    } catch (error) {
      this._status = 'error';
      this.handleError(error as Error);
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    
    // Reset status
    this._status = 'stopped';
    
    // Recreate actor with same config
    this.actor = createActor(this.actor.machine as TMachine, {
      id: this.id,
      input: this.options.input,
      parent: this.options.parent ? this.adaptParent(this.options.parent) : undefined,
    });

    this.start();
  }

  getSnapshot(): TSnapshot {
    return this.actor.getSnapshot() as TSnapshot;
  }

  // Private helper methods

  private setupSupervision(strategy: SupervisionStrategy): void {
    this.supervisor = new Supervisor({
      strategy: strategy,
      maxRestarts: 3,
      restartWindow: 60000,
      onRestart: (actorRef, error, attempt) => {
        console.log(`Restarting actor ${actorRef.id} (attempt ${attempt}) after error:`, error);
      },
      onFailure: (actorRef, error) => {
        console.error(`Actor ${actorRef.id} failed permanently:`, error);
        this._status = 'error';
      },
    });

    // Supervise this actor
    this.supervisor.supervise(this as any);
  }

  private subscribeToLifecycle(): void {
    this.actor.subscribe((snapshot) => {
      // Handle query responses
      if (snapshot.event?.type === 'actor.response') {
        const response = snapshot.event as any;
        this.requestManager.handleResponse(response);
      }

      // Update status based on snapshot
      if (snapshot.status === 'error') {
        this._status = 'error';
        this.handleError(snapshot.error);
      }
    });
  }

  private handleError(error: Error): void {
    this.options.metrics?.onError?.(error);

    // Notify supervisor if present
    if (this.supervisor) {
      this.supervisor.handleFailure(error, this as any);
    }

    // Escalate to parent if configured
    if (this.parent && this.supervision === 'escalate') {
      this.parent.send({
        type: 'actor.child.error',
        childId: this.id,
        error: error.message,
      } as any);
    }
  }

  private adaptParent(parent: ActorRef): Actor<AnyStateMachine> | undefined {
    // If parent is already an XState actor, use it directly
    if ('subscribe' in parent && 'send' in parent) {
      return parent as any;
    }

    // Otherwise, create a proxy actor
    return {
      id: parent.id,
      send: (event) => parent.send(event),
      getSnapshot: () => parent.getSnapshot(),
      subscribe: (observer) => {
        const subscription = parent.observe(s => s).subscribe({
          next: (snapshot) => observer.next?.(snapshot),
          error: (error) => observer.error?.(error),
          complete: () => observer.complete?.(),
        });
        return subscription;
      },
    } as any;
  }
}

/**
 * Create an ActorRef from an XState machine
 */
export function createActorRef<TMachine extends AnyStateMachine>(
  machine: TMachine,
  options?: ActorRefOptions
): ActorRef<EventObject, any, SnapshotFrom<TMachine>> {
  return new XStateActorRefAdapter(machine, options);
}

/**
 * Create a root actor with built-in supervision
 */
export function createRootActor<TMachine extends AnyStateMachine>(
  machine: TMachine,
  options?: Omit<ActorRefOptions, 'parent'>
): ActorRef<EventObject, any, SnapshotFrom<TMachine>> {
  return createActorRef(machine, {
    ...options,
    supervision: 'restart-on-failure',
  });
} 