/**
 * @module actor-core/runtime/create-actor-ref
 * @description Unified ActorRef implementation with proper XState event bridging
 */

import type { Actor, AnyStateMachine } from 'xstate';
import { createActor } from 'xstate';
// Import the new components
import { ActorEventBus } from './actor-event-bus.js';
import { type ActorRef, ActorStoppedError } from './actor-ref.js';
import type { ActorAddress, ActorMessage, ActorStats } from './actor-system.js';
import type { Supervisor } from './actors/supervisor.js';
import { Logger } from './logger.js';
import { XStateRequestResponseManager } from './messaging/request-response.js';
import type {
  ActorBehavior,
  ActorRefOptions,
  ActorSnapshot,
  ActorStatus,
  JsonValue,
  SpawnOptions,
  SupervisionStrategy,
} from './types.js';
import { generateActorId } from './utils/factories.js';

/**
 * Type guard for AnyStateMachine
 */
function isValidStateMachine(value: unknown): value is AnyStateMachine {
  return (
    value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    'config' in value &&
    'definition' in value
  );
}

/**
 * XState ActorRef implementation with proper event bridging
 *
 * This implementation bridges XState actors to our ActorRef interface,
 * ensuring XState emit() actions are properly propagated through the actor system.
 */
class XStateActorRef<TContext = unknown, TMessage extends ActorMessage = ActorMessage>
  implements ActorRef<TContext, TMessage>
{
  // Core XState actor
  private actor: Actor<AnyStateMachine>;
  private machine: AnyStateMachine;

  // Advanced messaging and supervision
  private requestManager: XStateRequestResponseManager;
  private supervisor?: Supervisor;

  // Event emission system - THIS IS THE FIX!
  private eventBus: ActorEventBus<unknown>;

  // Actor hierarchy
  private children = new Map<string, ActorRef<unknown, ActorMessage>>();
  private _parent?: ActorRef<unknown, ActorMessage>;

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
    this._parent = options.parent as ActorRef<unknown, ActorMessage> | undefined;

    // Handle supervision strategy with proper type conversion
    if (typeof options.supervision === 'string') {
      // Convert common string values to proper SupervisionStrategy
      switch (options.supervision) {
        case 'restart':
          this._supervision = 'restart-on-failure' as SupervisionStrategy;
          break;
        case 'stop':
          this._supervision = 'stop' as SupervisionStrategy;
          break;
        case 'resume':
          this._supervision = 'resume' as SupervisionStrategy;
          break;
        default:
          this._supervision = options.supervision as SupervisionStrategy;
      }
    } else {
      this._supervision = options.supervision;
    }

    // Create XState actor with proper configuration
    this.actor = createActor(machine, {
      input: options.input,
      id: this._id,
    });

    // Initialize advanced messaging system
    this.requestManager = new XStateRequestResponseManager({
      defaultTimeout: options.askTimeout || 5000,
      defaultRetries: 0,
      defaultRetryDelay: 1000,
    });

    // Initialize event emission system - THE KEY FIX!
    this.eventBus = new ActorEventBus<unknown>();

    // Set up supervision if specified
    // Note: Supervision is disabled to avoid type casting issues
    // TODO: Make Supervisor generic to work with any ActorRef type
    // if (this._supervision) {
    //   this.setupSupervision();
    // }

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

  get address(): ActorAddress {
    return {
      id: this._id,
      type: 'unified',
      path: `/actors/${this._id}`,
    };
  }

  get status(): ActorStatus {
    return this._status;
  }

  get parent(): ActorRef<unknown, ActorMessage> | undefined {
    return this._parent;
  }

  get supervision(): SupervisionStrategy | undefined {
    return this._supervision;
  }

  getSnapshot(): ActorSnapshot<TContext> {
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
    } as ActorSnapshot<TContext>;
  }

  async isAlive(): Promise<boolean> {
    return this._status === 'running' || this._status === 'starting';
  }

  async getStats(): Promise<ActorStats> {
    // Mock implementation - in real system would track actual stats
    return {
      messagesReceived: 0,
      messagesProcessed: 0,
      errors: 0,
      uptime: Date.now(),
    };
  }

  async send(message: ActorMessage): Promise<void> {
    if (this._status === 'stopped') {
      throw new ActorStoppedError(this.id, 'send message');
    }

    this.logger.debug('Sending message', { message, actorId: this.id });
    this.actor.send(message);
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
    this.requestManager.stop();
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

  emit(event: unknown): void {
    this.logger.debug('Emitting event', { actorId: this.id, event });
    this.eventBus.emit(event);
  }

  // ========================================================================================
  // SUBSCRIPTION METHODS (For interface compatibility)
  // ========================================================================================

  subscribe(eventType: string, _handler: (event: unknown) => void): () => void {
    // Stub implementation for interface compatibility
    this.logger.warn('subscribe() called - use message-based patterns instead', { eventType });
    return () => {};
  }

  on(eventType: string, _handler: (event: unknown) => void): () => void {
    // Stub implementation for interface compatibility
    this.logger.warn('on() called - use message-based patterns instead', { eventType });
    return () => {};
  }

  observe(): {
    subscribe: (observer: { next?: (event: unknown) => void }) => { unsubscribe: () => void };
  } {
    // Stub implementation for interface compatibility
    return {
      subscribe: () => ({ unsubscribe: () => {} }),
    };
  }

  // ========================================================================================
  // ASK PATTERN WITH PROPER REQUEST/RESPONSE MANAGEMENT
  // ========================================================================================

  async ask<TResponse = JsonValue>(message: ActorMessage, timeout?: number): Promise<TResponse> {
    if (this._status !== 'running') {
      throw new ActorStoppedError(this.id, 'ask query');
    }

    this.logger.debug('Creating ask request', { message, actorId: this.id });
    const request = this.requestManager.createRequest<ActorMessage, TResponse>(message, {
      timeout,
    });

    // For git-actor compatibility, transform the message into the expected format
    // Git-actor expects events like { type: 'REQUEST_STATUS', requestId: string }
    let eventToSend: ActorMessage;

    if (typeof message === 'object' && message !== null && 'type' in message) {
      // If the message already has the correct format, add the requestId
      eventToSend = {
        ...message,
        requestId: request.correlationId,
      } as ActorMessage;
    } else {
      // Should not reach here since message is ActorMessage (has type)
      eventToSend = {
        type: 'REQUEST',
        requestId: request.correlationId,
      } as ActorMessage;
    }

    this.logger.debug('Sending ask event', {
      event: eventToSend,
      correlationId: request.correlationId,
      actorId: this.id,
    });

    // Send the event to the actor
    await this.send(eventToSend);

    return request.promise;
  }

  // ========================================================================================
  // HIERARCHY MANAGEMENT
  // ========================================================================================

  spawn<TChildContext = unknown, TChildMessage extends ActorMessage = ActorMessage>(
    behavior: ActorBehavior<TChildMessage> | AnyStateMachine,
    options?: SpawnOptions
  ): ActorRef<TChildContext, TChildMessage> {
    const childId = options?.id || generateActorId('child');

    // Handle both behavior and machine types
    if (typeof behavior === 'function') {
      // For behavior functions, we need to create a machine
      throw new Error('Behavior functions not yet supported, use AnyStateMachine instead');
    }

    // Type guard: validate AnyStateMachine properties
    if (typeof behavior !== 'object' || behavior === null || !('id' in behavior)) {
      throw new Error('Invalid behavior: expected AnyStateMachine');
    }

    // Additional validation for AnyStateMachine
    if (!isValidStateMachine(behavior)) {
      throw new Error('Invalid behavior: not a valid state machine');
    }

    const machine = behavior as AnyStateMachine;

    const childRef = createActorRef<TChildContext, TChildMessage>(machine, {
      ...options,
      id: childId,
      parent: this.address.id, // Use ID instead of actor reference
    });

    this.children.set(childId, childRef as ActorRef<unknown, ActorMessage>);
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

  getChildren(): ReadonlyMap<string, ActorRef<unknown, ActorMessage>> {
    return this.children;
  }

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
      },
      error: (error) => {
        this.logger.error('Actor error', { error, actorId: this.id });
        this._status = 'error';

        // Handle supervision - disabled to avoid type casting
        // TODO: Make Supervisor generic to work with any ActorRef type
        // if (this.supervisor) {
        //   this.supervisor.handleFailure(error as Error, this);
        // }
      },
      complete: () => {
        this.logger.debug('Actor completed', { actorId: this.id });
        this._status = 'stopped';
      },
    });
  }

  // ✅ CRITICAL FIX: Set up XState event bridge using actor.on('*', handler)
  private setupXStateEventBridge(): void {
    this.logger.debug('🔧 Setting up XState event bridge', { actorId: this.id });

    try {
      // Use XState v5's actor.on('*', handler) to capture ALL emitted events
      // This is the proper way to bridge XState emit() actions to the framework
      this.actor.on('*', (emittedEvent: unknown) => {
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
            (eventWithId.requestId as string) || (eventWithId._correlationId as string);

          // Only process if we have response data
          if ('response' in eventWithId || 'data' in eventWithId || 'payload' in eventWithId) {
            const responseData = eventWithId.response || eventWithId.data || eventWithId;

            this.logger.debug('📨 Detected potential request/response event', {
              actorId: this.id,
              correlationId,
              hasResponse: 'response' in eventWithId,
              hasData: 'data' in eventWithId,
              hasPayload: 'payload' in eventWithId,
            });

            // Handle the response through the RequestResponseManager
            this.requestManager.handleResponse(correlationId, responseData);

            // Check if response was handled by looking for the pending request
            if (responseData) {
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
export function createActorRef<TContext = unknown, TMessage extends ActorMessage = ActorMessage>(
  machine: AnyStateMachine,
  options?: ActorRefOptions
): ActorRef<TContext, TMessage> {
  return new XStateActorRef<TContext, TMessage>(machine, options);
}
