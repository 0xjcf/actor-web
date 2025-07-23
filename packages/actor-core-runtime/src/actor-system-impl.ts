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
import { createGuardianActor } from './actor-system-guardian.js';
import {
  createClusterEventActor,
  createSystemEventActor,
  type SystemEventPayload,
} from './actors/system-event-actor.js';
import { DistributedActorDirectory } from './distributed-actor-directory.js';
import { Logger } from './logger.js';
import { DeadLetterQueue } from './messaging/dead-letter-queue.js';
import { InterceptorChain } from './messaging/interceptor-chain.js';
import type {
  InterceptorOptions,
  MessageContext,
  MessageInterceptor,
} from './messaging/interceptors.js';
import { createMessageContext } from './messaging/interceptors.js';
import { type BoundedMailbox, createMailbox } from './messaging/mailbox.js';
import { RequestResponseManager } from './messaging/request-response.js';
// ✅ PURE ACTOR MODEL: Import XState-based timeout management
import { PureXStateTimeoutManager } from './pure-xstate-utilities.js';

const log = Logger.namespace('ACTOR_SYSTEM');

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
 * Normalize a behavior to the legacy ActorBehavior format for internal use
 */
function normalizeBehavior<TMessage, TContext, TEmitted>(
  behavior:
    | ActorBehavior<TMessage, TContext, TEmitted>
    | ActorBehavior<TMessage, TContext, TEmitted>
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

  // System event and cluster event actors
  private guardianActorAddress?: ActorAddress;
  private systemEventActorAddress?: ActorAddress;
  private clusterEventActorAddress?: ActorAddress;

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

  // ✅ PURE ACTOR MODEL: XState timeout manager for system scheduling
  private systemTimeoutManager = new PureXStateTimeoutManager();

  // Interceptor chains
  private globalInterceptors = new InterceptorChain();
  private actorInterceptors = new WeakMap<ActorPID, InterceptorChain>();
  private messageContexts = new WeakMap<ActorMessage, MessageContext>();

  // Removed callback maps - using pure actor model message passing instead
  private clusterEventCallbacks = new Map<
    string,
    (event: { type: 'node-up' | 'node-down' | 'leader-changed'; node: string }) => void
  >();

  // Dead letter queue
  private deadLetterQueue: DeadLetterQueue;

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

    this.deadLetterQueue = new DeadLetterQueue();

    // ✅ PURE ACTOR MODEL: Initialize XState timeout scheduler
    // this.systemScheduler = createActor(timeoutSchedulerMachine);
    // this.systemScheduler.start();

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

    // Spawn guardian actor first - it supervises all other actors
    const guardianActor = await createGuardianActor(this);
    this.guardianActorAddress = guardianActor.address;

    // Spawn system event actor
    const systemEventBehavior = createSystemEventActor();
    const systemEventActor = await this.spawn(systemEventBehavior, {
      id: 'system-event-actor',
      supervised: false,
    });
    this.systemEventActorAddress = systemEventActor.address;

    // Spawn cluster event actor
    const clusterEventBehavior = createClusterEventActor();
    const clusterEventActor = await this.spawn(clusterEventBehavior, {
      id: 'cluster-event-actor',
      supervised: false,
    });
    this.clusterEventActorAddress = clusterEventActor.address;

    // Emit system started event
    await this.emitSystemEvent({
      eventType: 'started',
      timestamp: Date.now(),
    });
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
    }
    // PID parameter - stop a specific actor
    return this.stopActor(pid);
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
    await this.emitSystemEvent({ eventType: 'stopping', timestamp: Date.now() });

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

    // ✅ PURE ACTOR MODEL: Use XState timeout manager for shutdown timeout
    const shutdownTimeout = this.config.shutdownTimeout ?? 30000;

    try {
      await Promise.race([
        Promise.all([...shutdownPromises, ...stopPromises]),
        new Promise<void>((_, reject) => {
          this.systemTimeoutManager.setTimeout(() => {
            reject(new Error('Shutdown timeout'));
          }, shutdownTimeout);
        }),
      ]);
    } catch (error) {
      log.error('Error during shutdown', { error });
    }

    // Stop the system timeout manager
    this.systemTimeoutManager.destroy();

    // Clear directory
    await this.directory.cleanup();

    // Cleanup request manager
    this.requestManager.cleanup();

    await this.emitSystemEvent({ eventType: 'stopped', timestamp: Date.now() });
  }

  /**
   * Internal method to stop a specific actor
   */
  private async stopActor(pid: ActorPID): Promise<void> {
    // Access the address from the PID interface
    const address = pid.address;
    const path = address.path;

    // Emit stopping event
    await this.emitSystemEvent({
      eventType: 'actorStopping',
      timestamp: Date.now(),
      data: { address: address.path },
    });

    // Call onStop if behavior has it
    const behavior = this.actors.get(path);
    if (behavior?.onStop) {
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

    await this.emitSystemEvent({
      eventType: 'actorStopped',
      timestamp: Date.now(),
      data: { address: address.path },
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
    behavior: ActorBehavior<TMessage, TState, TEmitted> | ActorBehavior<TMessage, TState, TEmitted>,
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

    await this.emitSystemEvent({
      eventType: 'actorSpawned',
      timestamp: Date.now(),
      data: { address: address.path },
    });

    // Notify guardian about the new child (if it's not the guardian itself)
    if (this.guardianActorAddress && address.id !== 'guardian') {
      await this.enqueueMessage(this.guardianActorAddress, {
        type: 'SPAWN_CHILD',
        payload: {
          name: address.id,
          address: address.path,
          supervision: 'resume',
        },
        timestamp: Date.now(),
        version: '1.0.0',
      });
    }

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
   * Emit a system event to all subscribers
   */
  private async emitSystemEvent(event: SystemEventPayload): Promise<void> {
    if (!this.systemEventActorAddress) {
      log.warn('System event actor not initialized');
      return;
    }

    const message: ActorMessage = {
      type: 'EMIT_SYSTEM_EVENT',
      payload: {
        eventType: event.eventType,
        timestamp: event.timestamp,
        data: event.data ?? null,
      },
      timestamp: Date.now(),
      version: '1.0.0',
    };

    await this.enqueueMessage(this.systemEventActorAddress, message);
  }

  /**
   * Subscribe to system events
   */
  subscribeToSystemEvents(
    listener: (event: { type: string; [key: string]: unknown }) => void
  ): () => void {
    // In pure actor model, we should create an actor to receive events
    // For now, we'll directly subscribe to the system event actor
    if (!this.systemEventActorAddress) {
      log.warn('System event actor not initialized');
      return () => {};
    }

    // Subscribe directly to all system events from the system event actor
    const unsubscribe = this.subscribeToActor(this.systemEventActorAddress, 'EMIT:*', (message) => {
      // Extract the event type from the message type (e.g., 'EMIT:actorSpawned' -> 'actorSpawned')
      const eventType = message.type.startsWith('EMIT:') ? message.type.substring(5) : message.type;

      listener({
        type: eventType,
        timestamp: message.timestamp || Date.now(),
        ...(message.payload && typeof message.payload === 'object'
          ? (message.payload as Record<string, unknown>)
          : {}),
      });
    });

    return unsubscribe;
  }

  /**
   * Subscribe to cluster events
   */
  subscribeToClusterEvents(
    listener: (event: { type: 'node-up' | 'node-down' | 'leader-changed'; node: string }) => void
  ): () => void {
    // Create a unique ID for this callback
    const callbackId = `callback-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    this.clusterEventCallbacks.set(callbackId, listener);

    // Subscribe to the cluster event actor
    const unsubscribe = this.subscribeToClusterEventActor(callbackId);

    // Emit initial leader-changed event
    listener({
      type: 'leader-changed',
      node: this.config.nodeAddress,
    });

    // Return unsubscribe function
    return () => {
      unsubscribe();
      this.clusterEventCallbacks.delete(callbackId);
    };
  }

  /**
   * Register a global message interceptor
   * Global interceptors apply to all actors in the system
   *
   * @param interceptor - The interceptor implementation
   * @param options - Registration options including priority and filters
   * @returns Interceptor ID for management
   */
  registerGlobalInterceptor(interceptor: MessageInterceptor, options?: InterceptorOptions): string {
    const id = this.globalInterceptors.register(interceptor, options);
    this.globalInterceptors.setScope('global');
    log.debug('Registered global interceptor', { id, priority: options?.priority || 0 });
    return id;
  }

  /**
   * Register an actor-specific message interceptor
   * These run after global interceptors for the specific actor
   *
   * @param actor - The actor PID to register the interceptor for
   * @param interceptor - The interceptor implementation
   * @param options - Registration options
   * @returns Interceptor ID for management
   */
  registerActorInterceptor(
    actor: ActorPID,
    interceptor: MessageInterceptor,
    options?: InterceptorOptions
  ): string {
    let chain = this.actorInterceptors.get(actor);
    if (!chain) {
      chain = new InterceptorChain();
      this.actorInterceptors.set(actor, chain);
    }

    const id = chain.register(interceptor, options);
    chain.setScope('actor');
    log.debug('Registered actor interceptor', {
      actor: actor.address.path,
      id,
      priority: options?.priority || 0,
    });
    return id;
  }

  /**
   * Unregister a global interceptor
   */
  unregisterGlobalInterceptor(id: string): boolean {
    const result = this.globalInterceptors.unregister(id);
    if (result) {
      log.debug('Unregistered global interceptor', { id });
    }
    return result;
  }

  /**
   * Unregister an actor-specific interceptor
   */
  unregisterActorInterceptor(actor: ActorPID, id: string): boolean {
    const chain = this.actorInterceptors.get(actor);
    if (!chain) return false;

    const result = chain.unregister(id);
    if (result) {
      log.debug('Unregistered actor interceptor', { actor: actor.address.path, id });
    }
    return result;
  }

  /**
   * Enable/disable a global interceptor (for circuit breaker)
   */
  setGlobalInterceptorEnabled(id: string, enabled: boolean): boolean {
    return this.globalInterceptors.setEnabled(id, enabled);
  }

  /**
   * Enable/disable an actor-specific interceptor
   */
  setActorInterceptorEnabled(actor: ActorPID, id: string, enabled: boolean): boolean {
    const chain = this.actorInterceptors.get(actor);
    if (!chain) return false;
    return chain.setEnabled(id, enabled);
  }

  /**
   * Get interceptor statistics for monitoring
   */
  getInterceptorStatistics(): {
    global: Map<string, unknown>;
    actors: Map<string, Map<string, unknown>>;
  } {
    const actorStats = new Map<string, Map<string, unknown>>();

    // We can't iterate WeakMap, so we'd need to track actor PIDs separately
    // For now, return what we have
    return {
      global: this.globalInterceptors.getStatistics(),
      actors: actorStats,
    };
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

    this.subscribers.get(key)?.add(handler);

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
   * Subscribe to cluster event actor
   */
  private subscribeToClusterEventActor(callbackId: string): () => void {
    if (!this.clusterEventActorAddress) {
      log.warn('Cluster event actor not initialized');
      return () => {};
    }

    // Subscribe to cluster event notifications
    return this.subscribeToActor(
      this.clusterEventActorAddress,
      'CLUSTER_EVENT_NOTIFICATION',
      (message) => {
        const callback = this.clusterEventCallbacks.get(callbackId);
        if (callback && message.payload && typeof message.payload === 'object') {
          // Transform cluster event payload to callback format
          const payload = message.payload as Record<string, unknown>;
          if ('eventType' in payload && 'node' in payload) {
            const eventType = String(payload.eventType);
            if (['node-up', 'node-down', 'leader-changed'].includes(eventType)) {
              callback({
                type: eventType as 'node-up' | 'node-down' | 'leader-changed',
                node: String(payload.node),
              });
            }
          }
        }
      }
    );
  }

  /**
   * Enqueue a message to an actor's mailbox (fire-and-forget)
   */
  async enqueueMessage(address: ActorAddress, message: ActorMessage): Promise<void> {
    // Get or create message context
    let context = this.messageContexts.get(message);
    if (!context) {
      context = createMessageContext({
        correlationId: message.correlationId,
      });
      this.messageContexts.set(message, context);
    }

    // Execute global beforeSend interceptors
    let processedMessage = message;
    if (this.globalInterceptors.size > 0) {
      const result = await this.globalInterceptors.execute(
        message,
        message.sender || null,
        'send',
        context
      );

      if (!result.continue || !result.message) {
        log.debug('Message filtered by global interceptor', {
          messageType: message.type,
          target: address.path,
        });
        return;
      }

      processedMessage = result.message;
      context = result.context;
    }

    // Execute actor-specific beforeSend interceptors if any
    // We'll need the actual PID later, for now skip actor-specific interceptors in beforeSend
    const actorPid = null;
    if (actorPid) {
      const actorChain = this.actorInterceptors.get(actorPid);
      if (actorChain && actorChain.size > 0) {
        const result = await actorChain.execute(
          processedMessage,
          message.sender || null,
          'send',
          context
        );

        if (!result.continue || !result.message) {
          log.debug('Message filtered by actor interceptor', {
            messageType: message.type,
            target: address.path,
          });
          return;
        }

        processedMessage = result.message;
        context = result.context;
      }
    }

    // Update context for the processed message
    this.messageContexts.set(processedMessage, context);

    // First, check if the actor is local or remote
    const location = await this.directory.lookup(address);

    if (!location) {
      log.error('Actor not found', { path: address.path });
      this.deadLetterQueue.add(processedMessage, address.path, 'Actor not found in directory', 1);
      return;
    }

    // If remote, deliver to remote actor
    if (location !== this.config.nodeAddress) {
      await this.deliverMessageRemote(location, address, processedMessage);
      return;
    }

    // Local actor - enqueue to mailbox
    const mailbox = this.actorMailboxes.get(address.path);
    if (!mailbox) {
      log.error('Mailbox not found for actor', { path: address.path });
      this.deadLetterQueue.add(processedMessage, address.path, 'Mailbox not found for actor', 1);
      return;
    }

    try {
      const enqueued = mailbox.enqueue(processedMessage);
      if (!enqueued && typeof enqueued === 'boolean') {
        log.warn('Message dropped due to full mailbox', {
          actor: address.path,
          messageType: processedMessage.type,
        });
        this.deadLetterQueue.add(
          processedMessage,
          address.path,
          'Message dropped due to full mailbox',
          1
        );
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
            queueMicrotask(() => this.processActorMessages(address, behavior));
          }
        }
      }
    } catch (error) {
      log.error('Failed to enqueue message', {
        actor: address.path,
        messageType: message.type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.deadLetterQueue.add(
        processedMessage,
        address.path,
        `Failed to enqueue message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        1,
        error instanceof Error ? error : undefined
      );
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
    queueMicrotask(() => this.processActorMessages(address, behavior));
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
    let _processed = 0;
    while (!mailbox.isEmpty() && this.actorProcessingLoops.get(address.path)) {
      const message = mailbox.dequeue();
      if (message) {
        try {
          await this.deliverMessageLocal(address, message);
          _processed++;
        } catch (error) {
          log.error('Error processing message', {
            actor: address.path,
            messageType: message.type,
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          // Apply supervision strategy
          await this.applySupervisionStrategy(address, error);
        }
      }
    }

    // Check if there are more messages (could have arrived while processing)
    if (!mailbox.isEmpty() && this.actorProcessingLoops.get(address.path)) {
      // More messages available, continue processing
      queueMicrotask(() => this.processActorMessages(address, behavior));
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

    // ✅ PURE ACTOR MODEL: Create promise with XState timeout manager
    const responsePromise = new Promise<T>((resolve, reject) => {
      // Set up XState timeout
      const timeoutId = this.systemTimeoutManager.setTimeout(() => {
        // Clean up subscription
        unsubscribe();
        reject(new Error(`Ask timeout after ${timeout}ms for actor ${address.path}`));
      }, timeout);

      // Subscribe to response messages from this actor
      const unsubscribe = this.subscribeToActor(address, 'RESPONSE', (responseMsg) => {
        // Check if this is the response we're waiting for
        if (responseMsg.correlationId === correlationId) {
          // Cancel XState timeout
          this.systemTimeoutManager.clearTimeout(timeoutId);

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
   * Get the default ask timeout
   */
  getDefaultAskTimeout(): number {
    return this.config.defaultAskTimeout ?? 5000;
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
    const eventType = (event as { type?: string })?.type || 'ACTOR_EVENT';

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

    // Get message context
    let context =
      this.messageContexts.get(message) ||
      createMessageContext({
        correlationId: message.correlationId,
      });

    // Execute global beforeReceive interceptors
    let processedMessage = message;
    if (this.globalInterceptors.size > 0) {
      const result = await this.globalInterceptors.execute(
        message,
        message.sender || null,
        'receive',
        context
      );

      if (!result.continue || !result.message) {
        log.debug('Message filtered by global interceptor in receive', {
          messageType: message.type,
          actor: address.path,
        });
        return;
      }

      processedMessage = result.message;
      context = result.context;
    }

    // Get actor PID for actor-specific interceptors
    const actorPid = {
      address,
      stop: async () => this.stopActorInternal(address),
      send: async (msg: MessageInput) => this.enqueueMessage(address, normalizeMessage(msg)),
      ask: async (msg: MessageInput) =>
        this.askActor(address, normalizeMessage(msg), this.config.defaultAskTimeout ?? 5000),
      getStats: async () => this.getActorStatsInternal(address),
    } as ActorPID;

    // Execute actor-specific beforeReceive interceptors
    const actorChain = this.actorInterceptors.get(actorPid);
    if (actorChain && actorChain.size > 0) {
      const result = await actorChain.execute(
        processedMessage,
        processedMessage.sender || null,
        'receive',
        context
      );

      if (!result.continue || !result.message) {
        log.debug('Message filtered by actor interceptor in receive', {
          messageType: processedMessage.type,
          actor: address.path,
        });
        return;
      }

      processedMessage = result.message;
      context = result.context;
    }

    const stats = this.actorStats.get(address.path);

    try {
      // Call onStart if this is the first time and behavior has it
      if (!this.actorStarted.get(address.path) && behavior.onStart) {
        log.debug('Calling onStart for actor', { path: address.path });
        const startResult = await behavior.onStart({ context: behavior.context || {} });

        // Handle both plain context and context with events (same as onMessage)
        let newContext: unknown;
        let emittedEvents: unknown[] = [];

        if (startResult && typeof startResult === 'object' && 'context' in startResult) {
          // Actor returned context + events
          newContext = startResult.context;
          const resultWithEmit = startResult as { context: unknown; emit?: unknown };
          if (resultWithEmit.emit !== undefined) {
            // Handle both single event and array of events
            emittedEvents = Array.isArray(resultWithEmit.emit)
              ? resultWithEmit.emit
              : [resultWithEmit.emit];
          }
        } else {
          // Actor returned just context (backward compatibility)
          newContext = startResult;
        }

        behavior.context = newContext;
        this.actorStarted.set(address.path, true);

        // Process emitted events from onStart
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
          }
        }
      }

      // Update stats
      if (stats) {
        // Update stats (we store extended stats with startTime)
        this.actorStats.set(address.path, {
          ...stats,
          messagesReceived: stats.messagesReceived + 1,
        });
      }

      const result = await behavior.onMessage({
        message: processedMessage,
        context: behavior.context,
      });

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
          handler(processedMessage);
        }
      }

      // Notify subscribers for specific message type
      const key = `${address.path}:${message.type}`;
      const subscribers = this.subscribers.get(key);
      if (subscribers) {
        for (const handler of subscribers) {
          handler(processedMessage);
        }
      }

      // Execute afterProcess interceptors
      if (this.globalInterceptors.size > 0) {
        await this.globalInterceptors.executeAfterProcess(
          processedMessage,
          result,
          address,
          context
        );
      }

      if (actorChain && actorChain.size > 0) {
        await actorChain.executeAfterProcess(processedMessage, result, address, context);
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

      // Execute onError interceptors
      const errorObj = error instanceof Error ? error : new Error(String(error));

      // Execute global onError interceptors
      if (this.globalInterceptors.size > 0) {
        try {
          await this.globalInterceptors.executeOnError(
            errorObj,
            processedMessage,
            address,
            context
          );
        } catch (interceptorError) {
          log.error('Global interceptor onError handler failed', {
            error:
              interceptorError instanceof Error
                ? interceptorError.message
                : String(interceptorError),
          });
        }
      }

      // Execute actor-specific onError interceptors
      if (actorChain && actorChain.size > 0) {
        try {
          await actorChain.executeOnError(errorObj, processedMessage, address, context);
        } catch (interceptorError) {
          log.error('Actor interceptor onError handler failed', {
            error:
              interceptorError instanceof Error
                ? interceptorError.message
                : String(interceptorError),
          });
        }
      }

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

  /**
   * Apply supervision strategy to an actor based on an error.
   * This method is called when a message processing fails.
   * It determines the appropriate supervision directive and handles it.
   */
  private async applySupervisionStrategy(address: ActorAddress, error: unknown): Promise<void> {
    const behavior = this.actors.get(address.path);
    if (!behavior) {
      log.error('Behavior not found for actor', { path: address.path });
      return;
    }

    // Default to RESTART if no supervision strategy is defined
    let directive = 'restart';

    if (behavior.supervisionStrategy) {
      const actorPID = new ActorPIDImpl(address, this);
      const errorObj = error instanceof Error ? error : new Error(String(error));

      try {
        const supervisionDirective = behavior.supervisionStrategy.onFailure(errorObj, actorPID);

        // Map SupervisionDirective to our action types
        switch (supervisionDirective) {
          case 'restart':
            directive = 'restart';
            break;
          case 'stop':
            directive = 'stop';
            break;
          case 'escalate':
            directive = 'escalate';
            break;
          case 'resume':
            directive = 'resume';
            break;
          default:
            directive = 'restart'; // fallback
        }
      } catch (strategyError) {
        log.error('Error in supervision strategy', {
          path: address.path,
          strategyError: strategyError instanceof Error ? strategyError.message : 'Unknown',
        });
        directive = 'restart'; // fallback
      }
    }

    // Apply the directive
    switch (directive) {
      case 'restart':
        log.warn('Actor failed, applying restart directive', { path: address.path });
        await this.restartActor(address, behavior);
        break;

      case 'stop':
        log.error('Actor failed, applying stop directive', { path: address.path });
        await this.stopActor(new ActorPIDImpl(address, this));
        await this.emitSystemEvent({
          eventType: 'actorStopped',
          timestamp: Date.now(),
          data: { address: address.path, reason: 'supervision-stop' },
        });
        break;

      case 'escalate':
        log.warn('Actor failed, escalating to guardian', { path: address.path });
        await this.notifyGuardianOfFailure(address, error);
        break;

      case 'resume':
        log.warn('Actor failed, applying resume directive', { path: address.path });
        await this.resumeActor(address);
        break;

      default:
        log.error('Unknown supervision directive, defaulting to restart', {
          path: address.path,
          directive,
        });
        await this.restartActor(address, behavior);
    }
  }

  /**
   * Restart an actor with the same behavior
   */
  private async restartActor(address: ActorAddress, behavior: ActorBehavior): Promise<void> {
    try {
      // Stop the current actor
      await this.stopActor(new ActorPIDImpl(address, this));

      // Respawn with the same behavior and ID
      await this.spawn(behavior, { id: address.id });

      await this.emitSystemEvent({
        eventType: 'actorRestarted',
        timestamp: Date.now(),
        data: { address: address.path },
      });

      log.info('Actor restarted successfully', { path: address.path });
    } catch (restartError) {
      log.error('Failed to restart actor', {
        path: address.path,
        error: restartError instanceof Error ? restartError.message : 'Unknown',
      });
      // Escalate restart failure
      await this.notifyGuardianOfFailure(address, restartError);
    }
  }

  /**
   * Resume an actor by reactivating its message processing loop
   */
  private async resumeActor(address: ActorAddress): Promise<void> {
    const behavior = this.actors.get(address.path);
    if (!behavior) {
      log.error('Cannot resume actor, behavior not found', { path: address.path });
      return;
    }

    const isProcessing = this.actorProcessingActive.get(address.path) || false;
    const hasLoop = this.actorProcessingLoops.get(address.path) || false;

    if (hasLoop && !isProcessing) {
      // The loop exists but is idle, wake it up
      this.actorProcessingActive.set(address.path, true);
      queueMicrotask(() => this.processActorMessages(address, behavior));
      log.info('Actor processing loop resumed', { path: address.path });
    } else {
      log.warn('Actor processing loop already active or missing, restarting actor', {
        path: address.path,
        isProcessing,
        hasLoop,
      });
      // If can't resume, restart instead
      await this.restartActor(address, behavior);
    }
  }

  /**
   * Notify the Guardian actor of a failure that needs escalation
   */
  private async notifyGuardianOfFailure(address: ActorAddress, error: unknown): Promise<void> {
    if (!this.guardianActorAddress) {
      log.error('Cannot escalate failure, Guardian not available', { path: address.path });
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    try {
      await this.enqueueMessage(this.guardianActorAddress, {
        type: 'ACTOR_FAILED',
        payload: {
          actorId: address.id,
          actorPath: address.path,
          error: errorMessage,
          directive: 'escalate',
        },
        timestamp: Date.now(),
        version: '1.0.0',
      });

      log.info('Failure escalated to Guardian', { path: address.path });
    } catch (escalationError) {
      log.error('Failed to escalate to Guardian', {
        path: address.path,
        escalationError: escalationError instanceof Error ? escalationError.message : 'Unknown',
      });
    }
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
    const askTimeout = timeout ?? this.system.getDefaultAskTimeout();
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

  subscribe(eventType: string, listener: (event: ActorMessage) => void): () => void {
    // Subscribe to specific event types emitted by this actor
    return this.system.subscribeToActor(this.address, eventType, listener);
  }
}

/**
 * Create an actor system with the given configuration
 */
export function createActorSystem(config: ActorSystemConfig): ActorSystem {
  return new ActorSystemImpl(config);
}
