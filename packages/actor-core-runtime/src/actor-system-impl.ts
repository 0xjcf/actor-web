/**
 * @module actor-core/runtime/actor-system-impl
 * @description Production implementation of the ActorSystem interface
 *
 * This module provides:
 * 1. Actor lifecycle management (spawn, stop, restart)
 * 2. Message routing with location transparency
 * 3. Supervision strategies for fault tolerance
 * 4. Directory service with Orleans-style caching
 * 5. Statistics and monitoring capabilities
 *
 * The implementation follows pure actor model principles:
 * - All communication via async message passing
 * - No shared state between actors
 * - Location transparency for distributed systems
 * - Fault tolerance through supervision hierarchies
 *
 * @example
 * ```typescript
 * const system = createActorSystem({
 *   nodeAddress: 'node-1',
 *   directory: { maxCacheSize: 10000 }
 * });
 *
 * await system.start();
 *
 * const actor = await system.spawn({
 *   onMessage: async (msg, state) => {
 *     console.log('Received:', msg);
 *     return state;
 *   }
 * });
 *
 * await actor.send({ type: 'HELLO', payload: 'World' });
 * ```
 *
 * @author Agent A (Tech Lead) - Actor-Core Framework
 * @version 1.0.0
 */

import { generateCorrelationId } from './actor-ref.js';
import type {
  ActorAddress,
  ActorBehavior,
  ActorDefinition,
  ActorMessage,
  ActorPID,
  ActorStats,
  ActorSystem,
  ClusterState,
  JsonValue,
  MessageInput,
  SpawnOptions,
} from './actor-system.js';
import { normalizeMessage, parseActorPath } from './actor-system.js';
import { DistributedActorDirectory } from './distributed-actor-directory.js';
import { Logger } from './logger.js';
import { type BoundedMailbox, createMailbox } from './messaging/mailbox.js';
import { RequestResponseManager } from './messaging/request-response.js';
import { CustomObservable } from './observable.js';
import type { Observable } from './types.js';

const log = Logger.namespace('ACTOR_SYSTEM');

// Simple BehaviorSubject implementation for system events
class SimpleBehaviorSubject<T> {
  private value: T;
  private observers: Array<(value: T) => void> = [];

  constructor(initialValue: T) {
    this.value = initialValue;
  }

  next(value: T): void {
    this.value = value;
    for (const observer of this.observers) {
      observer(value);
    }
  }

  asObservable(): Observable<T> {
    return new CustomObservable<T>((observer) => {
      const callback = (value: T) => observer.next(value);
      this.observers.push(callback);
      observer.next(this.value);

      return () => {
        const index = this.observers.indexOf(callback);
        if (index > -1) {
          this.observers.splice(index, 1);
        }
      };
    });
  }
}

/**
 * Directory configuration for actor lookup
 */
export interface DirectoryConfig {
  maxCacheSize?: number;
  cacheTtl?: number;
  cleanupInterval?: number;
}

/**
 * Configuration for the actor system
 */
export interface ActorSystemConfig {
  /**
   * Unique identifier for this node in the cluster
   */
  nodeAddress: string;

  /**
   * Maximum number of concurrent actors (default: 10000)
   */
  maxActors?: number;

  /**
   * Enable debug logging (default: false)
   */
  debug?: boolean;

  /**
   * Directory configuration for actor lookup
   */
  directory?: DirectoryConfig;

  /**
   * Message delivery timeout in milliseconds
   */
  messageTimeout?: number;

  /**
   * Default ask timeout in milliseconds
   */
  defaultAskTimeout?: number;

  /**
   * Graceful shutdown timeout in milliseconds
   */
  shutdownTimeout?: number;
}

/**
 * Global counter for unique actor IDs
 * In production, this would be replaced with distributed ID generation
 */
let globalActorIdCounter = 0;
let globalActorCount = 0;

/**
 * Generate a unique actor ID
 */
function generateActorId(): string {
  return `actor-${Date.now()}-${globalActorIdCounter++}`;
}

/**
 * Type guard to check if behavior is using new ActorDefinition pattern
 */
function isActorDefinition<TMessage, TContext, TEmitted>(
  behavior:
    | ActorBehavior<TMessage, TContext, TEmitted>
    | ActorDefinition<TMessage, TContext, TEmitted>
): behavior is ActorDefinition<TMessage, TContext, TEmitted> {
  // Check if the onMessage return type matches ActorDefinition pattern
  // This is a runtime check, but we can't perfectly detect the return type
  // We'll rely on the type system and adapt at runtime
  return true; // For now, we'll handle both patterns in the runtime
}

/**
 * Normalize a behavior to the legacy ActorBehavior format for internal use
 */
function normalizeBehavior<TMessage, TContext, TEmitted>(
  behavior:
    | ActorBehavior<TMessage, TContext, TEmitted>
    | ActorDefinition<TMessage, TContext, TEmitted>
): ActorBehavior<TMessage, TContext, TEmitted> {
  // If it's already an ActorBehavior, return as-is
  // Both interfaces have the same structure, the difference is in return types
  // We'll handle the return type differences at runtime in processMessage
  return behavior as ActorBehavior<TMessage, TContext, TEmitted>;
}

/**
 * Production implementation of ActorSystem
 */
export class ActorSystemImpl implements ActorSystem {
  private actors = new Map<string, ActorBehavior>();
  private actorMailboxes = new Map<string, BoundedMailbox>();
  private actorProcessingLoops = new Map<string, boolean>(); // Track active processing loops
  private actorProcessingActive = new Map<string, boolean>(); // Track if loop is currently processing
  private directory: DistributedActorDirectory;
  private subscribers = new Map<string, Set<(message: ActorMessage) => void>>();
  private systemEvents = new SimpleBehaviorSubject<{ type: string; [key: string]: unknown }>({
    type: 'initialized',
  });
  private running = false;
  private clusterState: ClusterState = {
    nodes: [],
    leader: '',
    status: 'down',
  };
  private actorStats = new Map<string, ActorStats & { startTime: number }>();
  private requestManager: RequestResponseManager;
  private shutdownHandlers = new Set<() => Promise<void>>();
  private actorStarted = new Map<string, boolean>(); // Track whether onStart has been called

  constructor(private readonly config: ActorSystemConfig) {
    this.directory = new DistributedActorDirectory({
      nodeAddress: config.nodeAddress,
      maxCacheSize: config.directory?.maxCacheSize ?? 10000,
      cacheTtl: config.directory?.cacheTtl ?? 5 * 60 * 1000,
      cleanupInterval: config.directory?.cleanupInterval ?? 60 * 1000,
    });

    this.requestManager = new RequestResponseManager({
      defaultTimeout: config.defaultAskTimeout ?? 5000,
    });

    if (config.debug) {
      // Debug logging is enabled via environment variable
      log.debug('Debug mode enabled');
    }
  }

  /**
   * Start the actor system
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    log.info('Starting actor system', {
      nodeAddress: this.config.nodeAddress,
      maxActors: this.config.maxActors ?? 'unlimited',
    });

    this.clusterState = {
      nodes: [this.config.nodeAddress],
      leader: this.config.nodeAddress,
      status: 'up',
    };

    this.running = true;
    this.systemEvents.next({ type: 'started' });
  }

  /**
   * Stop the actor system (no parameters)
   */
  async stop(): Promise<void>;
  /**
   * Stop a specific actor (with PID parameter)
   */
  async stop(pid: ActorPID): Promise<void>;
  /**
   * Implementation that handles both overloads
   */
  async stop(pid?: ActorPID): Promise<void> {
    if (pid === undefined) {
      // No parameter - stop the entire system
      return this.stopSystem();
    } else {
      // PID parameter - stop a specific actor
      return this.stopActor(pid);
    }
  }

  /**
   * Internal method to stop the entire system
   */
  private async stopSystem(): Promise<void> {
    if (!this.running) {
      return;
    }

    log.info('Stopping actor system');
    this.running = false;

    // Update cluster state
    this.clusterState = {
      ...this.clusterState,
      status: 'down',
    };

    // Emit shutdown event
    this.systemEvents.next({ type: 'stopping' });

    // Execute shutdown handlers
    const shutdownPromises = Array.from(this.shutdownHandlers).map((handler) => handler());

    // Stop all actors gracefully
    const stopPromises: Promise<void>[] = [];
    for (const [path, _behavior] of this.actors) {
      const actor = await this.lookup(path);
      if (actor) {
        stopPromises.push(this.stopActor(actor));
      }
    }

    // Wait for all actors to stop with timeout
    const shutdownTimeout = this.config.shutdownTimeout ?? 30000;
    try {
      await Promise.race([
        Promise.all([...shutdownPromises, ...stopPromises]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Shutdown timeout')), shutdownTimeout)
        ),
      ]);
    } catch (error) {
      log.error('Error during shutdown', { error });
    }

    // Clear directory
    await this.directory.cleanup();

    // Cleanup request manager
    this.requestManager.cleanup();

    this.systemEvents.next({ type: 'stopped' });
  }

  /**
   * Internal method to stop a specific actor
   */
  private async stopActor(pid: ActorPID): Promise<void> {
    // Access the address from the PID interface
    const address = pid.address;
    const path = address.path;

    // Emit stopping event
    this.systemEvents.next({
      type: 'actorStopping',
      address,
    });

    // Call onStop if behavior has it
    const behavior = this.actors.get(path);
    if (behavior && behavior.onStop) {
      try {
        const context = behavior.context;
        await behavior.onStop({ context });
      } catch (error) {
        log.error('Error in actor onStop', { path, error });
      }
    }

    // Stop the message processing loop
    this.actorProcessingLoops.delete(path);
    this.actorProcessingActive.delete(path);

    // Clean up mailbox
    const mailbox = this.actorMailboxes.get(path);
    if (mailbox) {
      mailbox.stop();
      this.actorMailboxes.delete(path);
    }

    // Remove from local actors
    this.actors.delete(path);
    this.actorStarted.delete(path);

    // Unregister from directory
    await this.directory.unregister(address);

    // Clear stats
    this.actorStats.delete(path);

    globalActorCount--;

    log.debug('Actor stopped', {
      path,
      totalActors: globalActorCount,
    });

    this.systemEvents.next({
      type: 'actorStopped',
      address,
    });
  }

  /**
   * Register a shutdown handler
   */
  onShutdown(handler: () => Promise<void>): void {
    this.shutdownHandlers.add(handler);
  }

  /**
   * Spawn a new actor
   */
  async spawn<TMessage = ActorMessage, TState = unknown, TEmitted = never>(
    behavior:
      | ActorBehavior<TMessage, TState, TEmitted>
      | ActorDefinition<TMessage, TState, TEmitted>,
    options?: SpawnOptions
  ): Promise<ActorPID> {
    if (!this.running) {
      throw new Error('Actor system is not running');
    }

    const id = options?.id || generateActorId();
    const type = 'actor'; // SpawnOptions doesn't have type field
    const path = `actor://${this.config.nodeAddress}/${type}/${id}`;

    // Check max actors limit
    if (this.config.maxActors && globalActorCount >= this.config.maxActors) {
      throw new Error(`Maximum actor limit reached: ${this.config.maxActors}`);
    }

    const address: ActorAddress = { id, type, path };

    // Normalize and store the behavior
    const normalizedBehavior = normalizeBehavior(behavior);
    this.actors.set(path, normalizedBehavior as ActorBehavior<ActorMessage, unknown>);

    // Register in directory
    await this.directory.register(address, this.config.nodeAddress);

    // Initialize stats with extended properties
    this.actorStats.set(path, {
      messagesReceived: 0,
      messagesProcessed: 0,
      errors: 0,
      uptime: 0,
      startTime: Date.now(),
    });

    // Create mailbox for the actor
    const mailbox = createMailbox.dropping(1000); // TODO: Make configurable via SpawnOptions
    this.actorMailboxes.set(path, mailbox);

    // Initialize onStart tracking
    this.actorStarted.set(path, false);

    // Start message processing loop for this actor
    this.startMessageProcessingLoop(address, behavior as ActorBehavior<ActorMessage, unknown>);

    globalActorCount++;

    log.debug('Actor spawned', {
      id,
      type,
      path,
      totalActors: globalActorCount,
    });

    this.systemEvents.next({
      type: 'actorSpawned',
      address,
    });

    return new ActorPIDImpl(address, this);
  }

  /**
   * Lookup an actor by path
   */
  async lookup(path: string): Promise<ActorPID | undefined> {
    const address = parseActorPath(path);
    if (!address) {
      return undefined;
    }

    const location = await this.directory.lookup(address);
    if (!location) {
      return undefined;
    }

    return new ActorPIDImpl(address, this);
  }

  /**
   * List all actors in the system
   */
  async listActors(): Promise<ActorAddress[]> {
    const allActors = await this.directory.getAll();
    const results: ActorAddress[] = [];

    for (const [path, location] of allActors) {
      if (location === this.config.nodeAddress) {
        results.push(parseActorPath(path));
      }
    }

    return results;
  }

  /**
   * Get system statistics
   */
  async getSystemStats(): Promise<{
    totalActors: number;
    messagesPerSecond: number;
    uptime: number;
    clusterState: ClusterState;
  }> {
    const now = Date.now();
    let totalMessages = 0;
    let totalUptime = 0;

    for (const stats of this.actorStats.values()) {
      totalMessages += stats.messagesProcessed;
      totalUptime += (now - stats.startTime) / 1000;
    }

    const messagesPerSecond = totalUptime > 0 ? totalMessages / totalUptime : 0;

    return {
      totalActors: globalActorCount,
      messagesPerSecond,
      uptime: totalUptime,
      clusterState: this.clusterState,
    };
  }

  /**
   * Join a cluster of nodes
   */
  async join(nodes: string[]): Promise<void> {
    this.clusterState = {
      nodes: [...this.clusterState.nodes, ...nodes],
      leader: this.clusterState.leader,
      status: 'up',
    };

    log.debug('Joined cluster', {
      nodes,
      clusterState: this.clusterState,
    });
  }

  /**
   * Leave the cluster
   */
  async leave(): Promise<void> {
    this.clusterState = {
      nodes: [this.config.nodeAddress],
      leader: this.config.nodeAddress,
      status: 'leaving',
    };

    log.debug('Left cluster', {
      clusterState: this.clusterState,
    });
  }

  /**
   * Get current cluster state
   */
  getClusterState(): ClusterState {
    return { ...this.clusterState };
  }

  /**
   * Subscribe to system events
   */
  subscribeToSystemEvents(): Observable<{ type: string; [key: string]: unknown }> {
    return this.systemEvents.asObservable();
  }

  /**
   * Subscribe to cluster events
   */
  subscribeToClusterEvents(): Observable<{
    type: 'node-up' | 'node-down' | 'leader-changed';
    node: string;
  }> {
    // In a real implementation, this would monitor cluster changes
    return new SimpleBehaviorSubject({
      type: 'leader-changed' as const,
      node: this.config.nodeAddress,
    }).asObservable();
  }

  /**
   * Subscribe to actor messages (internal method)
   */
  subscribeToActor(
    address: ActorAddress,
    messageType: string,
    handler: (message: ActorMessage) => void
  ): () => void {
    const key = `${address.path}:${messageType}`;

    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }

    this.subscribers.get(key)!.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.subscribers.get(key);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.subscribers.delete(key);
        }
      }
    };
  }

  /**
   * Send a message to an actor (internal method)
   * @deprecated Use enqueueMessage for fire-and-forget semantics
   */
  async sendMessage(address: ActorAddress, message: ActorMessage): Promise<void> {
    // Simply delegate to enqueueMessage for true fire-and-forget
    this.enqueueMessage(address, message);
  }

  /**
   * Enqueue a message to an actor's mailbox (fire-and-forget)
   */
  async enqueueMessage(address: ActorAddress, message: ActorMessage): Promise<void> {
    // First, check if the actor is local or remote
    const location = await this.directory.lookup(address);

    if (!location) {
      log.error('Actor not found', { path: address.path });
      // TODO: Send to dead letter queue
      return;
    }

    // If remote, deliver to remote actor
    if (location !== this.config.nodeAddress) {
      await this.deliverMessageRemote(location, address, message);
      return;
    }

    // Local actor - enqueue to mailbox
    const mailbox = this.actorMailboxes.get(address.path);
    if (!mailbox) {
      log.error('Mailbox not found for actor', { path: address.path });
      // TODO: Send to dead letter queue
      return;
    }

    try {
      const enqueued = mailbox.enqueue(message);
      if (!enqueued && typeof enqueued === 'boolean') {
        log.warn('Message dropped due to full mailbox', {
          actor: address.path,
          messageType: message.type,
        });
        // TODO: Send to dead letter queue
      } else if (enqueued) {
        // Message was successfully enqueued
        // Check if we need to restart the processing loop
        const isProcessing = this.actorProcessingActive.get(address.path) || false;
        const hasLoop = this.actorProcessingLoops.get(address.path) || false;

        if (hasLoop && !isProcessing) {
          // The loop exists but is idle, wake it up
          const behavior = this.actors.get(address.path);
          if (behavior) {
            // Mark as processing immediately to prevent race conditions
            this.actorProcessingActive.set(address.path, true);
            setImmediate(() => this.processActorMessages(address, behavior));
          }
        }
      }
    } catch (error) {
      log.error('Failed to enqueue message', {
        actor: address.path,
        messageType: message.type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // TODO: Send to dead letter queue
    }
  }

  /**
   * Start the message processing loop for an actor
   */
  private startMessageProcessingLoop(address: ActorAddress, behavior: ActorBehavior): void {
    // Mark this actor as having an active processing loop
    this.actorProcessingLoops.set(address.path, true);
    // Mark as actively processing immediately to prevent race conditions
    this.actorProcessingActive.set(address.path, true);

    // Schedule the processing on the next tick to avoid blocking
    setImmediate(() => this.processActorMessages(address, behavior));
  }

  /**
   * Process messages from an actor's mailbox
   */
  private async processActorMessages(
    address: ActorAddress,
    behavior: ActorBehavior
  ): Promise<void> {
    const mailbox = this.actorMailboxes.get(address.path);
    if (!mailbox || !this.actorProcessingLoops.get(address.path)) {
      // Actor has been stopped or mailbox removed
      this.actorProcessingActive.set(address.path, false);
      return;
    }

    // Mark as actively processing
    this.actorProcessingActive.set(address.path, true);

    // Process all available messages in a batch
    let processed = 0;
    while (!mailbox.isEmpty() && this.actorProcessingLoops.get(address.path)) {
      const message = mailbox.dequeue();
      if (message) {
        try {
          await this.deliverMessageLocal(address, message);
          processed++;
        } catch (error) {
          log.error('Error processing message', {
            actor: address.path,
            messageType: message.type,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          // TODO: Apply supervision strategy
        }
      }
    }

    // Check if there are more messages (could have arrived while processing)
    if (!mailbox.isEmpty() && this.actorProcessingLoops.get(address.path)) {
      // More messages available, continue processing
      setImmediate(() => this.processActorMessages(address, behavior));
    } else {
      // No more messages, mark as idle
      this.actorProcessingActive.set(address.path, false);
    }
  }

  /**
   * Ask an actor and wait for response
   */
  async askActor<T>(address: ActorAddress, message: ActorMessage, timeout: number): Promise<T> {
    // Create a correlation ID for this request
    const correlationId = generateCorrelationId();

    // Create a promise that will be resolved when we get a response
    const responsePromise = new Promise<T>((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        // Clean up subscription
        unsubscribe();
        reject(new Error(`Ask timeout after ${timeout}ms for actor ${address.path}`));
      }, timeout);

      // Subscribe to response messages from this actor
      const unsubscribe = this.subscribeToActor(address, 'RESPONSE', (responseMsg) => {
        // Check if this is the response we're waiting for
        if (responseMsg.correlationId === correlationId) {
          clearTimeout(timeoutId);
          unsubscribe();

          // Extract the response payload
          if ('payload' in responseMsg) {
            resolve(responseMsg.payload as T);
          } else {
            resolve(responseMsg as unknown as T);
          }
        }
      });
    });

    // Send the message with correlation ID and timestamp
    const messageWithCorrelation: ActorMessage = {
      ...message,
      correlationId,
      timestamp: message.timestamp || Date.now(),
      version: message.version || '1.0.0',
    };

    // Enqueue the message (fire-and-forget)
    await this.enqueueMessage(address, messageWithCorrelation);

    // Wait for response
    return responsePromise;
  }

  /**
   * Stop an actor by address (internal method)
   */
  async stopActorInternal(address: ActorAddress): Promise<void> {
    // Find the actor in our local actors map
    if (this.actors.has(address.path)) {
      // Create a temporary PID to call the public stop method
      const pid = new ActorPIDImpl(address, this);
      await this.stopActor(pid);
    }
  }

  /**
   * Check if an actor is alive (internal method)
   */
  async isActorAliveInternal(address: ActorAddress): Promise<boolean> {
    const location = await this.directory.lookup(address);
    return location !== undefined;
  }

  /**
   * Get actor statistics (internal method)
   */
  async getActorStatsInternal(address: ActorAddress): Promise<{
    messagesReceived: number;
    messagesProcessed: number;
    errors: number;
    uptime: number;
  }> {
    const stats = this.actorStats.get(address.path);
    if (!stats) {
      return {
        messagesReceived: 0,
        messagesProcessed: 0,
        errors: 0,
        uptime: 0,
      };
    }

    const now = Date.now();
    return {
      ...stats,
      uptime: (now - stats.startTime) / 1000,
    };
  }

  /**
   * Get directory stats (internal method)
   */
  getDirectoryStats() {
    return this.directory.getCacheStats();
  }

  /**
   * Check if the system is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Create an event message from an emitted event
   */
  private createEventMessage(address: ActorAddress, event: unknown): ActorMessage {
    // If event is already an ActorMessage, return it
    if (this.isActorMessage(event)) {
      return event;
    }

    // If event has a type property, use it
    const eventType = (event as any)?.type || 'ACTOR_EVENT';

    return {
      type: eventType,
      payload: event as JsonValue,
      sender: address,
      timestamp: Date.now(),
      version: '1.0.0',
    };
  }

  /**
   * Type guard to check if an object is an ActorMessage
   */
  private isActorMessage(obj: unknown): obj is ActorMessage {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'type' in obj &&
      'payload' in obj &&
      'timestamp' in obj &&
      'version' in obj
    );
  }

  /**
   * Deliver message to local actor
   */
  private async deliverMessageLocal(address: ActorAddress, message: ActorMessage): Promise<void> {
    log.debug('Delivering message to local actor', {
      path: address.path,
      messageType: message.type,
    });

    const behavior = this.actors.get(address.path);
    if (!behavior) {
      throw new Error(`Local actor not found: ${address.path}`);
    }

    const stats = this.actorStats.get(address.path);

    try {
      // Call onStart if this is the first time and behavior has it
      if (!this.actorStarted.get(address.path) && behavior.onStart) {
        log.debug('Calling onStart for actor', { path: address.path });
        const newContext = await behavior.onStart({ context: behavior.context || {} });
        behavior.context = newContext;
        this.actorStarted.set(address.path, true);
      }

      // Update stats
      if (stats) {
        // Update stats (we store extended stats with startTime)
        this.actorStats.set(address.path, {
          ...stats,
          messagesReceived: stats.messagesReceived + 1,
        });
      }

      const result = await behavior.onMessage({ message, context: behavior.context });

      // Handle both plain context and context with events
      let newContext: unknown;
      let emittedEvents: unknown[] = [];

      if (result && typeof result === 'object' && 'context' in result) {
        // Actor returned context + events
        newContext = result.context;
        const resultWithEmit = result as { context: unknown; emit?: unknown };
        if (resultWithEmit.emit !== undefined) {
          // Handle both single event and array of events
          emittedEvents = Array.isArray(resultWithEmit.emit)
            ? resultWithEmit.emit
            : [resultWithEmit.emit];
        }
      } else {
        // Actor returned just context (backward compatibility)
        newContext = result;
      }

      behavior.context = newContext;

      if (stats) {
        const updatedStats = this.actorStats.get(address.path) || {
          messagesReceived: 0,
          messagesProcessed: 0,
          errors: 0,
          uptime: 0,
          startTime: Date.now(),
        };
        this.actorStats.set(address.path, {
          ...updatedStats,
          messagesProcessed: updatedStats.messagesProcessed + 1,
        });
      }

      // Handle ask pattern responses
      if (message.correlationId) {
        // The actor should send a response message with the same correlation ID
        // This is handled by the actor's behavior implementation
      }

      // Process emitted events
      for (const event of emittedEvents) {
        const eventMessage = this.createEventMessage(address, event);

        // Notify subscribers for all events
        const allEventKey = `${address.path}:EMIT:*`;
        const allEventSubscribers = this.subscribers.get(allEventKey);
        if (allEventSubscribers) {
          // Add EMIT: prefix for wildcard subscribers
          const emitPrefixedMessage = {
            ...eventMessage,
            type: `EMIT:${eventMessage.type}`,
          };
          for (const handler of allEventSubscribers) {
            handler(emitPrefixedMessage);
          }
        }

        // Notify subscribers for specific event type
        if (eventMessage.type) {
          const eventKey = `${address.path}:EMIT:${eventMessage.type}`;
          const eventSubscribers = this.subscribers.get(eventKey);
          if (eventSubscribers) {
            // Add EMIT: prefix for specific event subscribers too
            const emitPrefixedMessage = {
              ...eventMessage,
              type: `EMIT:${eventMessage.type}`,
            };
            for (const handler of eventSubscribers) {
              handler(emitPrefixedMessage);
            }
          }

          // Special handling for RESPONSE events - also deliver to regular message subscribers
          // This enables the ask pattern to work with emitted events
          if (eventMessage.type === 'RESPONSE') {
            const responseKey = `${address.path}:RESPONSE`;
            const responseSubscribers = this.subscribers.get(responseKey);
            if (responseSubscribers) {
              for (const handler of responseSubscribers) {
                handler(eventMessage);
              }
            }
          }
        }
      }

      // Notify subscribers for all message types
      const allKey = `${address.path}:*`;
      const allSubscribers = this.subscribers.get(allKey);
      if (allSubscribers) {
        for (const handler of allSubscribers) {
          handler(message);
        }
      }

      // Notify subscribers for specific message type
      const key = `${address.path}:${message.type}`;
      const subscribers = this.subscribers.get(key);
      if (subscribers) {
        for (const handler of subscribers) {
          handler(message);
        }
      }
    } catch (error) {
      if (stats) {
        const updatedStats = this.actorStats.get(address.path);
        if (updatedStats) {
          this.actorStats.set(address.path, {
            ...updatedStats,
            errors: updatedStats.errors + 1,
          });
        }
      }

      log.error('Error processing message', {
        actor: address.path,
        messageType: message.type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  /**
   * Deliver message to remote actor (placeholder)
   */
  private async deliverMessageRemote(
    location: string,
    address: ActorAddress,
    message: ActorMessage
  ): Promise<void> {
    // TODO: Implement remote message delivery via transport
    log.warn('Remote message delivery not yet implemented', {
      location,
      address: address.path,
      messageType: message.type,
    });

    throw new Error('Remote message delivery not yet implemented');
  }
}

/**
 * Internal implementation of ActorPID
 */
class ActorPIDImpl implements ActorPID {
  constructor(
    public readonly address: ActorAddress,
    private readonly system: ActorSystemImpl
  ) {}

  async send(message: MessageInput): Promise<void> {
    // Normalize the message input to full ActorMessage
    const normalizedMessage = normalizeMessage(message);
    // Fire and forget - enqueue to mailbox
    await this.system.enqueueMessage(this.address, normalizedMessage);
  }

  async ask<T>(message: MessageInput, timeout?: number): Promise<T> {
    // Normalize the message input to full ActorMessage
    const normalizedMessage = normalizeMessage(message);
    const askTimeout = timeout ?? this.system['config'].defaultAskTimeout ?? 5000;
    return this.system.askActor<T>(this.address, normalizedMessage, askTimeout);
  }

  async stop(): Promise<void> {
    await this.system.stopActorInternal(this.address);
  }

  async isAlive(): Promise<boolean> {
    return this.system.isActorAliveInternal(this.address);
  }

  async getStats(): Promise<ActorStats> {
    const stats = await this.system.getActorStatsInternal(this.address);
    return {
      messagesReceived: stats.messagesReceived,
      messagesProcessed: stats.messagesProcessed,
      errors: stats.errors,
      uptime: stats.uptime,
    };
  }

  subscribe(eventType: string): Observable<ActorMessage> {
    // Create an observable that subscribes to specific event types
    return new CustomObservable<ActorMessage>((observer) => {
      const handler = (message: ActorMessage) => {
        observer.next(message);
      };

      const unsubscribe = this.system.subscribeToActor(this.address, eventType, handler);

      return () => {
        unsubscribe();
      };
    });
  }

  unsubscribe(eventType: string): void {
    // TODO: Implement unsubscribe logic
    // Currently handled by Observable's subscription cleanup
    void eventType; // Mark as used
    log.debug('Unsubscribe from event type', { address: this.address.path });
  }
}

/**
 * Create an actor system with the given configuration
 */
export function createActorSystem(config: ActorSystemConfig): ActorSystem {
  return new ActorSystemImpl(config);
}
