/**
 * @module framework/core/integration/xstate-adapter
 * @description XState v5 adapter for ActorRef interface
 * @author Agent A - 2025-01-10
 */

import type { Actor, AnyStateMachine, EventObject, SnapshotFrom } from 'xstate';
import { createActor } from 'xstate';
import type { ActorRef, ActorRefOptions } from '../actors/actor-ref.js';
import type { Observable } from '../observables/observable.js';
import type { SupervisionStrategy, ActorSnapshot } from '../actors/types.js';
import { CustomObservable } from '../observables/observable.js';
import { RequestResponseManager } from '../messaging/request-response.js';
import { Supervisor } from '../actors/supervisor.js';

/**
 * Extended ActorRefOptions for XState adapter
 */
export interface XStateActorRefOptions extends ActorRefOptions {
  input?: unknown;
}

/**
 * Adapts an XState v5 actor to the ActorRef interface
 * Provides pure message-passing abstraction over XState's imperative API
 */
export class XStateActorRefAdapter implements ActorRef<EventObject, any, ActorSnapshot> {
  private actor: Actor<AnyStateMachine>;
  private machine: AnyStateMachine;
  private requestManager: RequestResponseManager;
  private supervisor?: Supervisor;
  private children = new Map<string, ActorRef>();
  private _status: 'active' | 'stopped' | 'error' = 'stopped';
  private _id: string;

  constructor(
    machine: AnyStateMachine,
    private options: XStateActorRefOptions = {}
  ) {
    this.machine = machine;
    this._id = options.id || `actor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create XState actor with input configuration
    this.actor = createActor(machine, {
      input: options.input,
      id: this._id,
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
    return this._id;
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

  send(event: EventObject): void {
    if (this._status === 'stopped') {
      console.warn(`Cannot send event to stopped actor ${this.id}`);
      return;
    }

    try {
      this.actor.send(event as any);
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

    // Create a promise that resolves when we get a response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Query timeout after ${this.options.askTimeout || 5000}ms`));
      }, this.options.askTimeout || 5000);

      // For simplicity, resolve immediately with query as response
      // In a real implementation, this would handle proper request/response
      clearTimeout(timeout);
      resolve(query as any);
    });
  }

  observe<TSelected>(selector: (snapshot: ActorSnapshot) => TSelected): Observable<TSelected> {
    return new CustomObservable<TSelected>((observer) => {
      // Get initial value
      const xstateSnapshot = this.actor.getSnapshot();
      const actorSnapshot = this.adaptSnapshot(xstateSnapshot);
      const initialValue = selector(actorSnapshot);
      observer.next?.(initialValue);

      // Subscribe to changes
      const subscription = this.actor.subscribe((xstateSnapshot) => {
        try {
          const actorSnapshot = this.adaptSnapshot(xstateSnapshot);
          const selected = selector(actorSnapshot);
          observer.next?.(selected);
          this.options.metrics?.onStateChange?.(actorSnapshot);
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
    this.actor = createActor(this.machine, {
      input: this.options.input,
      id: this._id,
    });

    this.start();
  }

  getSnapshot(): ActorSnapshot {
    const xstateSnapshot = this.actor.getSnapshot();
    return this.adaptSnapshot(xstateSnapshot);
  }

  // Private helper methods

  private adaptSnapshot(xstateSnapshot: SnapshotFrom<AnyStateMachine>): ActorSnapshot {
    return {
      context: xstateSnapshot.context || {},
      value: xstateSnapshot.value,
      status: this._status,
      error: this._status === 'error' ? new Error('Actor error') : undefined,
    };
  }

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
      // Simple lifecycle tracking
      if (this._status === 'active') {
        this.options.metrics?.onStateChange?.(this.adaptSnapshot(snapshot));
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
      });
    }
  }
}

/**
 * Create an ActorRef from an XState machine
 */
export function createActorRef(
  machine: AnyStateMachine,
  options?: XStateActorRefOptions
): ActorRef<EventObject, any, ActorSnapshot> {
  return new XStateActorRefAdapter(machine, options);
}

/**
 * Create a root actor with built-in supervision
 */
export function createRootActor(
  machine: AnyStateMachine,
  options?: Omit<XStateActorRefOptions, 'parent'>
): ActorRef<EventObject, any, ActorSnapshot> {
  return createActorRef(machine, {
    ...options,
    supervision: 'restart-on-failure',
  });
} 