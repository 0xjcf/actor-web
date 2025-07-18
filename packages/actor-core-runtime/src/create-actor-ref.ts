/**
 * @module actor-core/runtime/create-actor-ref
 * @description Unified ActorRef implementation with proper XState event bridging
 */

import type { Actor, AnyStateMachine } from 'xstate';
import { createActor } from 'xstate';
// Import the new components
import { ActorEventBus } from './actor-event-bus.js';
import { type ActorRef, ActorStoppedError, generateActorId } from './actor-ref.js';
import { Supervisor } from './actors/supervisor.js';
import { Logger } from './logger.js';
import { RequestResponseManager } from './messaging/request-response.js';
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
 * Unified ActorRef implementation with proper event bridging
 *
 * This implementation fixes the fundamental design flaw where XState emit()
 * actions were not properly bridged to the ActorRef event system.
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

  // Event emission system - THIS IS THE FIX!
  private eventBus: ActorEventBus<TEmitted>;

  // Actor hierarchy
  private children = new Map<string, ActorRef<BaseEventObject, unknown>>();
  private _parent?: ActorRef<BaseEventObject, unknown>;

  // Lifecycle and metadata
  private _id: string;
  private _status: ActorStatus = 'idle';
  private _supervision?: SupervisionStrategy;
  private logger = Logger.namespace('ACTOR_REF');

  constructor(
    machine: AnyStateMachine,
    private options: ActorRefOptions = {}
  ) {
    this.machine = machine;
    this._id = options.id || generateActorId('actor');
    this._parent = options.parent as ActorRef<BaseEventObject, unknown> | undefined;
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

    // Initialize event emission system - THE KEY FIX!
    this.eventBus = new ActorEventBus<TEmitted>();

    // Set up supervision if specified
    if (this._supervision) {
      this.setupSupervision();
    }

    // Subscribe to lifecycle events - INCLUDING XState EVENT BRIDGING!
    this.subscribeToLifecycle();

    // 🚨 CRITICAL FIX: Set up XState event bridge using actor.on('*', handler)
    this.setupXStateEventBridge();
  }

  // ========================================================================================
  // ACTORREF INTERFACE IMPLEMENTATION
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

  getSnapshot(): TSnapshot {
    // Safe conversion from XState snapshot to framework snapshot
    const xstateSnapshot = this.actor.getSnapshot();
    return {
      value: xstateSnapshot.value,
      context: xstateSnapshot.context,
      status: this._status,
      error: xstateSnapshot.error,
      matches: xstateSnapshot.matches.bind(xstateSnapshot),
      can: xstateSnapshot.can.bind(xstateSnapshot),
      hasTag: xstateSnapshot.hasTag.bind(xstateSnapshot),
      toJSON: xstateSnapshot.toJSON.bind(xstateSnapshot),
    } as unknown as TSnapshot;
  }

  send(event: TEvent): void {
    if (this._status === 'stopped') {
      throw new ActorStoppedError(this.id, 'send message');
    }

    this.logger.debug('Sending event', { event, actorId: this.id });
    this.actor.send(event);
  }

  start(): void {
    if (this._status !== 'idle') {
      this.logger.warn('Actor already started', { actorId: this.id, status: this._status });
      return;
    }

    this._status = 'starting';
    this.logger.debug('Starting actor', { actorId: this.id });
    this.actor.start();
    this._status = 'running';
  }

  async stop(): Promise<void> {
    if (this._status === 'stopped') {
      return Promise.resolve();
    }

    this._status = 'stopping';
    this.logger.debug('Stopping actor', { actorId: this.id });

    // Stop all children first
    const childStopPromises = Array.from(this.children.values()).map((child) => child.stop());

    // Cleanup advanced features
    this.requestManager.cleanup();
    this.eventBus.destroy();
    if (this.supervisor) {
      this.supervisor.cleanup();
    }

    this.actor.stop();
    this._status = 'stopped';

    return Promise.all(childStopPromises).then(() => {});
  }

  async restart(): Promise<void> {
    this.logger.debug('Restarting actor', { actorId: this.id });
    await this.stop();

    // Recreate the actor
    this.actor = createActor(this.machine, {
      input: this.options.input,
      id: this._id,
    });

    // Re-setup all systems
    this.subscribeToLifecycle();
    this.setupXStateEventBridge();

    this.start();
  }

  // ========================================================================================
  // EVENT SYSTEM - THE MAIN FIX!
  // ========================================================================================

  emit(event: TEmitted): void {
    if (this._status === 'stopped') {
      throw new ActorStoppedError(this.id, 'emit event');
    }

    this.logger.debug('Emitting event', { event, actorId: this.id });
    this.eventBus.emit(event);
  }

  subscribe(listener: (event: TEmitted) => void): () => void {
    this.logger.debug('Adding event subscriber', { actorId: this.id });
    return this.eventBus.subscribe(listener);
  }

  on(listener: (event: TEmitted) => void): () => void {
    this.logger.debug('Adding event listener', { actorId: this.id });
    return this.eventBus.subscribe(listener);
  }

  // ========================================================================================
  // ASK PATTERN WITH PROPER REQUEST/RESPONSE MANAGEMENT
  // ========================================================================================

  async ask<TQuery, TResponse>(query: TQuery, options?: AskOptions): Promise<TResponse> {
    if (this._status !== 'running') {
      throw new ActorStoppedError(this.id, 'ask query');
    }

    this.logger.debug('Creating ask request', { query, actorId: this.id });
    const request = this.requestManager.createRequest<TQuery, TResponse>(query, options);

    // For git-actor compatibility, transform the query into the expected format
    // Git-actor expects events like { type: 'REQUEST_STATUS', requestId: string }
    let eventToSend: TEvent;

    if (typeof query === 'object' && query !== null && 'type' in query) {
      // If the query already has the correct format, add the requestId
      eventToSend = {
        ...query,
        requestId: request.correlationId,
      } as unknown as TEvent;
    } else {
      // Otherwise, wrap it in the expected format
      eventToSend = {
        type: 'REQUEST',
        requestId: request.correlationId,
        payload: query,
      } as unknown as TEvent;
    }

    this.logger.debug('Sending ask event', {
      event: eventToSend,
      correlationId: request.correlationId,
      actorId: this.id,
    });

    // Send the event to the actor
    this.send(eventToSend);

    return request.promise;
  }

  // ========================================================================================
  // OBSERVABLES SUPPORT
  // ========================================================================================

  observe<TObserved>(selector: (snapshot: TSnapshot) => TObserved): Observable<TObserved> {
    return new CustomObservable<TObserved>((observer) => {
      const unsubscribe = this.actor.subscribe({
        next: (snapshot) => {
          try {
            // Convert XState snapshot to framework snapshot
            const frameworkSnapshot = this.convertSnapshot(snapshot);
            const selected = selector(frameworkSnapshot);
            observer.next(selected);
          } catch (error) {
            observer.error?.(error as Error);
          }
        },
        error: (error) => observer.error?.(error as Error),
        complete: () => observer.complete?.(),
      });

      return () => unsubscribe.unsubscribe();
    });
  }

  // ========================================================================================
  // HIERARCHY MANAGEMENT
  // ========================================================================================

  spawn<TChildEvent extends BaseEventObject, TChildEmitted = unknown>(
    behavior: ActorBehavior<TChildEvent> | AnyStateMachine,
    options?: SpawnOptions
  ): ActorRef<TChildEvent, TChildEmitted> {
    const childId = options?.id || generateActorId('child');

    // Handle both behavior and machine types
    if (typeof behavior === 'function') {
      // For behavior functions, we need to create a machine
      throw new Error('Behavior functions not yet supported, use AnyStateMachine instead');
    }
    const machine = behavior as AnyStateMachine;

    const childRef = createActorRef<TChildEvent, TChildEmitted>(machine, {
      ...options,
      id: childId,
      parent: this,
    });

    this.children.set(childId, childRef as ActorRef<BaseEventObject, unknown>);
    this.logger.debug('Spawned child actor', { childId, parentId: this.id });

    return childRef;
  }

  async stopChild(childId: string): Promise<void> {
    const child = this.children.get(childId);
    if (child) {
      await child.stop();
      this.children.delete(childId);
      this.logger.debug('Stopped child actor', { childId, parentId: this.id });
    }
  }

  getChildren(): ReadonlyMap<string, ActorRef<BaseEventObject, unknown>> {
    return this.children;
  }

  // ========================================================================================
  // UTILITY METHODS
  // ========================================================================================

  matches(statePath: string): boolean {
    const snapshot = this.actor.getSnapshot();
    return snapshot.matches(statePath);
  }

  accepts(eventType: string): boolean {
    const snapshot = this.actor.getSnapshot();
    // Check if the actor can handle this event type in its current state
    return snapshot.can({ type: eventType });
  }

  // ========================================================================================
  // SUPERVISION SETUP
  // ========================================================================================

  private setupSupervision(): void {
    if (!this._supervision) return;

    this.supervisor = new Supervisor({
      strategy: this._supervision,
      onRestart: (actorRef, error, attempt) => {
        this.logger.warn('Actor restart', { actorId: actorRef.id, error, attempt });
      },
      onFailure: (actorRef, error) => {
        this.logger.error('Actor supervision failure', { actorId: actorRef.id, error });
      },
    });

    this.supervisor.supervise(this as ActorRef<BaseEventObject, unknown>);
  }

  // ========================================================================================
  // LIFECYCLE SUBSCRIPTION - THE CRITICAL FIX!
  // ========================================================================================

  private subscribeToLifecycle(): void {
    this.actor.subscribe({
      next: (snapshot) => {
        this.logger.debug('State changed', {
          state: snapshot.value,
          context: this.summarizeContext(snapshot.context),
          actorId: this.id,
        });

        // Handle response messages for ask pattern
        this.handleResponseMessages(snapshot);
      },
      error: (error) => {
        this.logger.error('Actor error', { error, actorId: this.id });
        this._status = 'error';

        // Handle supervision
        if (this.supervisor) {
          this.supervisor.handleFailure(error as Error, this as ActorRef<BaseEventObject, unknown>);
        }
      },
      complete: () => {
        this.logger.debug('Actor completed', { actorId: this.id });
        this._status = 'stopped';
      },
    });
  }

  private handleResponseMessages(_snapshot: ReturnType<typeof this.actor.getSnapshot>): void {
    // Handle ask pattern responses - this method is now deprecated
    // Response handling is done through the XState event bridge (setupXStateEventBridge)
    // which captures emitted events including GIT_REQUEST_RESPONSE events
  }

  // ✅ CRITICAL FIX: Set up XState event bridge using actor.on('*', handler)
  private setupXStateEventBridge(): void {
    this.logger.debug('🔧 Setting up XState event bridge', { actorId: this.id });

    try {
      // Use XState v5's actor.on('*', handler) to capture ALL emitted events
      // This is the proper way to bridge XState emit() actions to the framework
      this.actor.on('*', (emittedEvent: TEmitted) => {
        this.logger.debug('🎯 XState event captured and forwarding to ActorEventBus', {
          actorId: this.id,
          event: emittedEvent,
          eventType:
            typeof emittedEvent === 'object' && emittedEvent !== null && 'type' in emittedEvent
              ? String((emittedEvent as { type: unknown }).type)
              : 'unknown',
        });

        // Forward the XState emitted event to the framework's ActorEventBus
        this.eventBus.emit(emittedEvent);

        // Handle ask pattern responses - generic approach
        // Check if this event has the structure of a response (requestId/correlationId field)
        if (
          typeof emittedEvent === 'object' &&
          emittedEvent !== null &&
          ('requestId' in emittedEvent || 'correlationId' in emittedEvent)
        ) {
          // Type-safe event handling
          const eventWithId = emittedEvent as Record<string, unknown>;

          // Extract correlation ID (support both requestId and correlationId fields)
          const correlationId =
            (eventWithId.requestId as string) || (eventWithId.correlationId as string);

          // Only process if we have response data
          if ('response' in eventWithId || 'data' in eventWithId || 'payload' in eventWithId) {
            const responseData = eventWithId.response || eventWithId.data || eventWithId.payload;

            this.logger.debug('📨 Detected potential request/response event', {
              actorId: this.id,
              correlationId,
              hasResponse: 'response' in eventWithId,
              hasData: 'data' in eventWithId,
              hasPayload: 'payload' in eventWithId,
            });

            // Handle the response through the RequestResponseManager
            const handled = this.requestManager.handleResponse(correlationId, responseData);

            if (handled) {
              this.logger.debug('✅ Request/response correlation successful', {
                actorId: this.id,
                correlationId,
              });
            }
          }
        }

        this.logger.debug('✅ Event forwarded to ActorEventBus', { actorId: this.id });
      });

      this.logger.debug('✅ XState event bridge established', { actorId: this.id });
    } catch (error) {
      this.logger.error('❌ Failed to set up XState event bridge', { actorId: this.id, error });
    }
  }

  // ========================================================================================
  // HELPER METHODS
  // ========================================================================================

  private convertSnapshot(snapshot: ReturnType<typeof this.actor.getSnapshot>): TSnapshot {
    return {
      value: snapshot.value,
      context: snapshot.context,
      status: this._status,
      error: snapshot.error,
      matches: snapshot.matches.bind(snapshot),
      can: snapshot.can.bind(snapshot),
      hasTag: snapshot.hasTag.bind(snapshot),
      toJSON: snapshot.toJSON.bind(snapshot),
    } as unknown as TSnapshot;
  }

  private summarizeContext(context: unknown): Record<string, unknown> {
    if (typeof context === 'object' && context !== null) {
      const ctx = context as Record<string, unknown>;
      const relevant: Record<string, unknown> = {};

      // Only include relevant fields that CLI users care about
      const relevantFields = [
        'currentBranch',
        'isGitRepo',
        'uncommittedChanges',
        'lastOperation',
        'lastError',
        'agentType',
        'integrationStatus',
        'changedFiles',
      ];

      for (const field of relevantFields) {
        if (ctx[field] !== undefined) {
          let value = ctx[field];
          // Format arrays more readably
          if (Array.isArray(value)) {
            value = value.length > 0 ? `[${value.length} items]` : '[]';
          }
          relevant[field] = value;
        }
      }

      return relevant;
    }
    return {};
  }
}

// ========================================================================================
// FACTORY FUNCTION
// ========================================================================================

/**
 * Create a new ActorRef instance using the unified implementation
 */
export function createActorRef<
  TEvent extends BaseEventObject = BaseEventObject,
  TEmitted = unknown,
  TSnapshot extends ActorSnapshot = ActorSnapshot,
>(machine: AnyStateMachine, options?: ActorRefOptions): ActorRef<TEvent, TEmitted, TSnapshot> {
  return new UnifiedActorRef<TEvent, TEmitted, TSnapshot>(machine, options);
}
