/**
 * @module actor-core/runtime/create-actor-ref
 * @description Basic ActorRef factory implementation for the runtime package
 */

import type { Actor, AnyStateMachine } from 'xstate';
import { createActor } from 'xstate';
import { type ActorRef, ActorStoppedError, generateActorId, TimeoutError } from './actor-ref.js';
import { Logger } from './logger.js';
import { CustomObservable } from './observable.js';
import type {
  ActorBehavior,
  ActorRefOptions,
  ActorSnapshot,
  ActorStatus,
  AskOptions,
  BaseEventObject,
  Observable,
  SpawnOptions,
  SupervisionStrategy,
} from './types.js';

/**
 * Basic ActorRef implementation for the runtime package
 */
class BasicActorRef<
  TEvent extends BaseEventObject = BaseEventObject,
  TEmitted = unknown,
  TSnapshot extends ActorSnapshot = ActorSnapshot,
> implements ActorRef<TEvent, TEmitted, TSnapshot>
{
  private actor: Actor<AnyStateMachine>;
  private machine: AnyStateMachine;
  private _id: string;
  private _status: ActorStatus = 'idle';
  private _parent?: ActorRef<BaseEventObject, unknown>;
  private _supervision?: SupervisionStrategy;
  private children = new Map<string, ActorRef<BaseEventObject, unknown>>();
  private eventListeners = new Set<(event: TEmitted) => void>();
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private logger = Logger.namespace('ACTOR_REF');

  constructor(
    machine: AnyStateMachine,
    private options: ActorRefOptions = {}
  ) {
    this.machine = machine;
    this._id = options.id || generateActorId('actor');
    this._parent = options.parent as ActorRef<BaseEventObject, unknown> | undefined;
    this._supervision = options.supervision;

    // Create XState actor
    this.actor = createActor(machine, {
      input: options.input,
      id: this._id,
    });

    // Set up actor lifecycle listeners
    this.actor.subscribe({
      next: (snapshot) => {
        this.logger.debug('State changed', { state: snapshot.value, context: snapshot.context });
      },
      error: (error) => {
        this.logger.error('Actor error', error);
        this._status = 'error';
      },
      complete: () => {
        this.logger.debug('Actor completed');
        this._status = 'stopped';
      },
    });

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
  // MESSAGE PASSING
  // ========================================================================================

  send(event: TEvent): void {
    if (this._status === 'stopped') {
      throw new ActorStoppedError(this._id, 'send');
    }

    this.logger.debug('Sending event', { event: event.type, data: event });
    this.actor.send(event);
  }

  async ask<TQuery, TResponse>(query: TQuery, options?: AskOptions): Promise<TResponse> {
    if (this._status === 'stopped') {
      throw new ActorStoppedError(this._id, 'ask');
    }

    const requestId = generateActorId('req');
    const timeout = options?.timeout || 5000;

    return new Promise<TResponse>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new TimeoutError(timeout, 'ask'));
      }, timeout);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout: timeoutHandle,
      });

      // Send query with request ID
      this.send({
        ...query,
        _requestId: requestId,
      } as unknown as TEvent);
    });
  }

  // ========================================================================================
  // EVENT EMISSION SYSTEM
  // ========================================================================================

  emit(event: TEmitted): void {
    if (this._status === 'stopped') {
      throw new ActorStoppedError(this._id, 'emit');
    }

    this.logger.debug('Emitting event', { event });
    this.eventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        this.logger.error('Error in event listener', error);
      }
    });
  }

  subscribe(listener: (event: TEmitted) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  // ========================================================================================
  // STATE OBSERVATION
  // ========================================================================================

  observe<TSelected>(selector: (snapshot: TSnapshot) => TSelected): Observable<TSelected> {
    return new CustomObservable<TSelected>((observer) => {
      let lastValue: TSelected | undefined;
      let hasEmitted = false;

      const subscription = this.actor.subscribe({
        next: (snapshot) => {
          try {
            const selected = selector(snapshot as unknown as TSnapshot);

            if (!hasEmitted || selected !== lastValue) {
              lastValue = selected;
              hasEmitted = true;
              observer.next(selected);
            }
          } catch (error) {
            observer.error?.(error as Error);
          }
        },
        error: (error) => {
          observer.error?.(error as Error);
        },
        complete: () => {
          observer.complete?.();
        },
      });

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  getSnapshot(): TSnapshot {
    return this.actor.getSnapshot() as unknown as TSnapshot;
  }

  // ========================================================================================
  // ACTOR LIFECYCLE
  // ========================================================================================

  start(): void {
    if (this._status === 'running') {
      return;
    }

    this.logger.debug('Starting actor');
    this._status = 'starting';
    this.actor.start();
    this._status = 'running';
  }

  async stop(): Promise<void> {
    if (this._status === 'stopped') {
      return;
    }

    this.logger.debug('Stopping actor');
    this._status = 'stopping';

    // Stop all children first
    const childStopPromises = Array.from(this.children.values()).map((child) => child.stop());
    await Promise.all(childStopPromises);

    // Clear pending requests
    this.pendingRequests.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new ActorStoppedError(this._id, 'stop'));
    });
    this.pendingRequests.clear();

    // Stop the actor
    this.actor.stop();
    this._status = 'stopped';
  }

  async restart(): Promise<void> {
    this.logger.debug('Restarting actor');
    await this.stop();

    // Recreate the actor
    this.actor = createActor(this.machine, {
      input: this.options.input,
      id: this._id,
    });

    this.start();
  }

  // ========================================================================================
  // ACTOR SUPERVISION (BASIC IMPLEMENTATION)
  // ========================================================================================

  spawn<TChildEvent extends BaseEventObject, TChildEmitted = unknown>(
    behavior: ActorBehavior<TChildEvent> | AnyStateMachine,
    options?: SpawnOptions
  ): ActorRef<TChildEvent, TChildEmitted> {
    const childMachine =
      typeof behavior === 'object' && 'createMachine' in behavior
        ? behavior.createMachine()
        : (behavior as AnyStateMachine);

    const childId = options?.id || generateActorId('child');
    const childRef = new BasicActorRef<TChildEvent, TChildEmitted>(childMachine, {
      ...options,
      id: childId,
      parent: this,
      supervision: options?.supervision || this._supervision,
    });

    this.children.set(childId, childRef);
    return childRef;
  }

  async stopChild(childId: string): Promise<void> {
    const child = this.children.get(childId);
    if (child) {
      await child.stop();
      this.children.delete(childId);
    }
  }

  getChildren(): ReadonlyMap<string, ActorRef<BaseEventObject, unknown>> {
    return new Map(this.children);
  }

  // ========================================================================================
  // UTILITY METHODS
  // ========================================================================================

  matches(statePath: string): boolean {
    const snapshot = this.getSnapshot();
    return snapshot.matches(statePath);
  }

  accepts(eventType: string): boolean {
    const snapshot = this.getSnapshot();
    return snapshot.can(eventType);
  }
}

// ========================================================================================
// FACTORY FUNCTION
// ========================================================================================

/**
 * Create a new ActorRef instance
 *
 * @param machine - XState machine definition
 * @param options - Configuration options
 * @returns ActorRef instance
 */
export function createActorRef<
  TEvent extends BaseEventObject = BaseEventObject,
  TEmitted = unknown,
  TSnapshot extends ActorSnapshot = ActorSnapshot,
>(machine: AnyStateMachine, options?: ActorRefOptions): ActorRef<TEvent, TEmitted, TSnapshot> {
  return new BasicActorRef<TEvent, TEmitted, TSnapshot>(machine, options);
}
