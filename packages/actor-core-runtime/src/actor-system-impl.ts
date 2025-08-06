/**
 * @module actor-core/runtime/actor-system-impl
 * @description Production implementation of the ActorSystem interface
 *
 * This module provides:
 * 1. Actor lifecycle management (spawn, stop, restart) using pure actor model
 * 2. Message routing with location transparency
 * 3. Supervision strategies for fault tolerance
 * 4. Directory service with Orleans-style caching
 * 5. Statistics and monitoring capabilities
 * 6. Event broker and discovery services as core system actors
 *
 * The implementation follows pure actor model principles:
 * - All communication via async message passing
 * - No shared state between actors
 * - Location transparency for distributed systems
 * - Fault tolerance through supervision hierarchies
 * - Business message correlation for ask patterns
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
 * const actor = await system.spawn(defineActor({
 *   machine: myMachine,
 *   onMessage: async ({ message, machine, dependencies }) => {
 *     // Pure actor behavior with MessagePlan response
 *     return { type: 'PROCESSED', data: message.payload };
 *   }
 * }));
 *
 * await actor.send({ type: 'HELLO', payload: 'World' });
 * ```
 *
 * @author Agent A (Tech Lead) - Actor-Core Framework
 * @version 1.0.0
 */

import { createMachine } from 'xstate';
// ✅ CONTEXT ISOLATION: Actor context manager for identity boundaries
import * as ActorContextManager from './actor-context-manager.js';
import type { ActorInstance } from './actor-instance.js';
import type { ActorRef } from './actor-ref.js';
import type {
  ActorAddress,
  ActorBehavior,
  ActorDependencies,
  ActorMessage,
  ActorPID,
  ActorStats,
  ActorSystem,
  ClusterState,
  SpawnOptions,
} from './actor-system.js';
import { ContextActor } from './context-actor.js';
import { MachineActor } from './machine-actor.js';
import { StatelessActor } from './stateless-actor.js';
import type { ContextOf, MessageOf } from './type-helpers.js';
import type { ActorSnapshot, JsonValue, Message } from './types.js';

// ✅ Define specific message types for type safety
interface SpawnChildMessage extends ActorMessage {
  type: 'SPAWN_CHILD';
  childId: string;
  childPath: string;
  supervision: string;
}

interface SystemEventMessage extends ActorMessage {
  type: 'EMIT_SYSTEM_EVENT';
  systemEventType: string;
  systemTimestamp: number;
  systemData: unknown;
}

interface ActorFailedMessage extends ActorMessage {
  type: 'ACTOR_FAILED';
  actorId: string;
  actorPath: string;
  error: string;
  directive: string;
}

import { parseActorPath } from './actor-system.js';
import { createGuardianActor } from './actor-system-guardian.js';
import { createSystemEventActor, type SystemEventPayload } from './actors/system-event-actor.js';
// ✅ UNIFIED API DESIGN Phase 2.1: Auto-publishing system for event subscriptions
import { AutoPublishingRegistry } from './auto-publishing.js';
import { type CorrelationManager, createCorrelationManager } from './correlation-manager.js';
import { DistributedActorDirectory } from './distributed-actor-directory.js';
import { Logger } from './logger.js';
import { getMachineFromBehavior } from './machine-registry.js';
import { DeadLetterQueue } from './messaging/dead-letter-queue.js';
import { InterceptorChain } from './messaging/interceptor-chain.js';
import type {
  InterceptorOptions,
  MessageContext,
  MessageInterceptor,
} from './messaging/interceptors.js';
import { createMessageContext } from './messaging/interceptors.js';
import { type BoundedMailbox, createMailbox } from './messaging/mailbox.js';
import { OTPMessagePlanProcessor } from './otp-message-plan-processor.js';
// ✅ PURE ACTOR MODEL: Import pure behavior handler and OTP message plan processor
import { type PureActorBehavior, PureActorBehaviorHandler } from './pure-behavior-handler.js';
// ✅ PURE ACTOR MODEL: Import XState-based timeout management
import { PureXStateTimeoutManager } from './pure-xstate-utilities.js';
import { generateCorrelationId } from './utils/factories.js';

const log = Logger.namespace('ACTOR_SYSTEM');

// Supervision strategy constants
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_WINDOW_MS = 30000; // 30 seconds
const RESTART_BACKOFF_MS = 1000; // 1 second

// Import the fluent builder types
import type { FluentBehaviorBuilder } from './fluent-behavior-builder.js';

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
 * Normalize a behavior to the PureActorBehavior format for internal use
 */
function normalizeBehavior<TMessage, TEmitted>(
  behavior: ActorBehavior<TMessage, TEmitted>
): PureActorBehavior<ActorMessage, ActorMessage> & { context?: unknown } {
  // Convert to pure actor behavior format with proper type handling
  return {
    context: behavior.context,
    onMessage: behavior.onMessage as PureActorBehavior<ActorMessage, ActorMessage>['onMessage'],
    onStart: behavior.onStart as PureActorBehavior<ActorMessage, ActorMessage>['onStart'],
    onStop: behavior.onStop as PureActorBehavior<ActorMessage, ActorMessage>['onStop'],
  };
}

/**
 * Production implementation of ActorSystem
 */
export class ActorSystemImpl implements ActorSystem {
  private actors = new Map<string, PureActorBehavior<ActorMessage, ActorMessage>>();
  private actorInstances = new Map<string, ActorInstance>();
  private actorBehaviorHandlers = new Map<string, PureActorBehaviorHandler>();
  private actorMailboxes = new Map<string, BoundedMailbox>();
  private actorProcessingLoops = new Map<string, boolean>(); // Track active processing loops
  private actorProcessingActive = new Map<string, boolean>(); // Track if loop is currently processing
  private directory: DistributedActorDirectory;
  private subscribers = new Map<string, Set<(message: ActorMessage) => void>>();

  // System event and cluster event actors
  private guardianActorAddress?: ActorAddress;
  private systemEventActorAddress?: ActorAddress;
  private clusterEventActorAddress?: ActorAddress;
  // ✅ PURE ACTOR MODEL: Core system service actors
  private eventBrokerActorAddress?: ActorAddress;
  private discoveryServiceActorAddress?: ActorAddress;

  private running = false;
  private clusterState: ClusterState = {
    nodes: [],
    leader: '',
    status: 'down',
  };
  private actorStats = new Map<string, ActorStats & { startTime: number }>();
  private correlationManager: CorrelationManager;
  private shutdownHandlers = new Set<() => Promise<void>>();
  private actorStarted = new Map<string, boolean>(); // Track whether onStart has been called
  private actorRestartCounts = new Map<string, number>(); // Track restart attempts per actor
  private actorLastRestartTime = new Map<string, number>(); // Track last restart time per actor

  // ✅ PURE ACTOR MODEL: XState timeout manager for system scheduling
  private systemTimeoutManager = new PureXStateTimeoutManager();
  // ✅ PURE ACTOR MODEL: OTP message plan processor for all behaviors
  private messagePlanProcessor: OTPMessagePlanProcessor;

  // Interceptor chains
  private globalInterceptors = new InterceptorChain();
  private actorInterceptors = new WeakMap<ActorPID, InterceptorChain>();
  private messageContexts = new WeakMap<ActorMessage, MessageContext>();

  // Removed callback maps - using pure actor model message passing instead
  private clusterEventCallbacks = new Map<
    string,
    (event: { type: 'node-up' | 'node-down' | 'leader-changed'; node: string }) => void
  >();

  // System event callbacks for subscribeToSystemEvents
  private systemEventCallbacks = new Map<
    string,
    (event: { type: string; [key: string]: unknown }) => void
  >();

  // Dead letter queue
  private deadLetterQueue: DeadLetterQueue;

  // ✅ UNIFIED API DESIGN Phase 2.1: Auto-publishing registry for event subscriptions
  private autoPublishingRegistry: AutoPublishingRegistry;

  // Test mode flag - when true, messages are processed synchronously
  private testMode = false;

  constructor(private readonly config: ActorSystemConfig) {
    this.directory = new DistributedActorDirectory({
      nodeAddress: config.nodeAddress,
      maxCacheSize: config.directory?.maxCacheSize ?? 10000,
      cacheTtl: config.directory?.cacheTtl ?? 5 * 60 * 1000,
      cleanupInterval: config.directory?.cleanupInterval ?? 60 * 1000,
    });

    // Initialize correlation manager for ask pattern
    this.correlationManager = createCorrelationManager({
      defaultTimeout: config.defaultAskTimeout ?? 5000,
      enableDebugLogging: config.debug ?? false,
    });

    this.deadLetterQueue = new DeadLetterQueue();

    // ✅ UNIFIED API DESIGN Phase 2.1: Initialize auto-publishing registry
    this.autoPublishingRegistry = new AutoPublishingRegistry();

    // ✅ PURE ACTOR MODEL: Initialize OTP message plan processor
    this.messagePlanProcessor = new OTPMessagePlanProcessor();

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
      log.debug('System already running, skipping start');
      return;
    }

    log.info('Starting actor system', {
      nodeAddress: this.config.nodeAddress,
      maxActors: this.config.maxActors ?? 'unlimited',
      timestamp: Date.now(),
    });

    this.clusterState = {
      nodes: [this.config.nodeAddress],
      leader: this.config.nodeAddress,
      status: 'up',
    };

    this.running = true;

    log.debug('Spawning guardian actor');
    // Spawn guardian actor first - it supervises all other actors
    const guardianActor = await createGuardianActor(this);
    this.guardianActorAddress = guardianActor.address;

    log.debug('Guardian actor spawned', {
      guardianPath: this.guardianActorAddress?.path,
      totalActors: this.actors.size,
      totalMailboxes: this.actorMailboxes.size,
      totalProcessingLoops: this.actorProcessingLoops.size,
    });

    // ✅ PURE ACTOR MODEL: Spawn core system actors

    log.debug('Spawning system event actor');
    // Spawn system event actor (updated to use defineActor)
    const systemEventBehavior = createSystemEventActor();
    const systemEventActor = await this.spawn(systemEventBehavior, {
      id: 'system-event-actor',
      supervised: false,
    });
    this.systemEventActorAddress = systemEventActor.address;

    log.debug('System event actor spawned', {
      systemEventPath: this.systemEventActorAddress?.path,
      totalActors: this.actors.size,
      totalMailboxes: this.actorMailboxes.size,
      totalProcessingLoops: this.actorProcessingLoops.size,
    });

    log.debug('Emitting system started event');
    // Emit system started event
    await this.emitSystemEvent({
      eventType: 'started',
      timestamp: Date.now(),
    });

    log.info('Actor system started with core services', {
      guardian: this.guardianActorAddress?.path,
      systemEventActor: this.systemEventActorAddress?.path,
      totalActors: this.actors.size,
      totalMailboxes: this.actorMailboxes.size,
      totalProcessingLoops: this.actorProcessingLoops.size,
      activeProcessing: this.actorProcessingActive.size,
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
    for (const [path, _behavior] of Array.from(this.actors)) {
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

    // Cleanup request manager - handled automatically on system shutdown

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
        // Create default machine and dependencies for onStop
        const defaultMachine = createMachine({
          id: `actor-${path}`,
          initial: 'active',
          states: { active: {} },
        });
        // Create MachineActor wrapper for consistency
        const machineDependencies = {
          emit: (event: ActorMessage) => {
            const address = parseActorPath(path);
            this.emitEventToSubscribers(address, event);
          },
          logger: (msg: string, data?: unknown) => log.debug(msg, data),
          system: this,
        };
        const machineActorInstance = new MachineActor(path, defaultMachine, machineDependencies);
        machineActorInstance.start();

        // Create ActorRef for self reference
        const selfRef = new ActorPIDImpl(address, this) as unknown as ActorRef<unknown>;

        const dependencies: ActorDependencies = {
          actorId: path,
          actor: machineActorInstance,
          self: selfRef,
          emit: (event: unknown) => {
            const eventMessage = this.createEventMessage({ path } as ActorAddress, event);
            // Use existing event emission to subscribers
            const eventKey = `${path}:EMIT:${eventMessage.type}`;
            const eventSubscribers = this.subscribers.get(eventKey);
            if (eventSubscribers) {
              for (const handler of Array.from(eventSubscribers)) {
                handler(eventMessage);
              }
            }
          },
          send: async () => {}, // Simple no-op for onStop
          ask: async <T>() => Promise.resolve({} as T), // Simple no-op for onStop
          logger: Logger.namespace(`ACTOR_${path}`),
          correlationManager: this.correlationManager,
        };

        await behavior.onStop({ actor: machineActorInstance, dependencies });
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

    // ✅ PURE ACTOR MODEL: Clean up actor instance and behavior handler
    const actorInstance = this.actorInstances.get(path);
    if (actorInstance) {
      actorInstance.stop();
      this.actorInstances.delete(path);
    }
    this.actorBehaviorHandlers.delete(path);

    // Remove from local actors
    this.actors.delete(path);
    this.actorStarted.delete(path);

    // Clean up restart tracking
    this.actorRestartCounts.delete(path);
    this.actorLastRestartTime.delete(path);

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
   * Spawn a new actor with proper type inference
   * Clean approach: single generic overload that extracts types
   */
  async spawn<B extends FluentBehaviorBuilder<ActorMessage, unknown, unknown, unknown>>(
    builder: B,
    options?: SpawnOptions
  ): Promise<ActorRef<ContextOf<B>, MessageOf<B>>>;

  async spawn<TMsg extends ActorMessage, TEmitted, TCtx>(
    behavior: ActorBehavior<TMsg, TEmitted> & { context?: TCtx },
    options?: SpawnOptions
  ): Promise<ActorRef<TCtx, TMsg>>;

  async spawn(
    behaviorOrBuilder:
      | FluentBehaviorBuilder<ActorMessage, unknown, unknown, unknown>
      | ActorBehavior,
    options?: SpawnOptions
  ): Promise<ActorRef<unknown, ActorMessage>> {
    if (!this.running) {
      throw new Error('Actor system is not running');
    }

    // Handle FluentBehaviorBuilder or direct ActorBehavior
    let actualBehavior: ActorBehavior;

    if ('build' in behaviorOrBuilder && typeof behaviorOrBuilder.build === 'function') {
      // It's a FluentBehaviorBuilder - build it
      const spec = behaviorOrBuilder.build();
      actualBehavior = {
        context: spec.initialContext as JsonValue | undefined,
        onMessage: spec.handler || (() => {}),
        onStart: spec.startHandler,
        onStop: spec.stopHandler,
      };
    } else {
      // It's already an ActorBehavior
      actualBehavior = behaviorOrBuilder as ActorBehavior;
    }

    const id = options?.id || generateActorId();
    const type = 'actor'; // SpawnOptions doesn't have type field
    const path = `actor://${this.config.nodeAddress}/${type}/${id}`;

    // Check max actors limit
    if (this.config.maxActors && globalActorCount >= this.config.maxActors) {
      throw new Error(`Maximum actor limit reached: ${this.config.maxActors}`);
    }

    const address: ActorAddress = { id, type, path };

    // Store the behavior with type-safe normalization
    const normalizedBehavior = normalizeBehavior(actualBehavior as ActorBehavior<unknown, unknown>);
    this.actors.set(path, normalizedBehavior);

    // ✅ PURE ACTOR MODEL: Create appropriate actor type based on behavior
    const existingMachine = getMachineFromBehavior(
      actualBehavior as ActorBehavior<unknown, unknown>
    );
    let actorInstance: ActorInstance;

    if (existingMachine) {
      log.debug('Using machine from behavior', { actorId: id });
      // Create MachineActor wrapper with dependency injection
      const dependencies = {
        emit: (event: ActorMessage) => {
          const address = parseActorPath(path);
          this.emitEventToSubscribers(address, event);
        },
        logger: (msg: string, data?: unknown) => log.debug(msg, data),
        system: this,
      };
      actorInstance = new MachineActor(id, existingMachine, dependencies);
    } else if (normalizedBehavior.context && Object.keys(normalizedBehavior.context).length > 0) {
      log.debug('Creating context-based actor', {
        actorId: id,
        initialContext: normalizedBehavior.context,
      });
      // Context-based actors use ContextActor for stateful behaviors
      actorInstance = new ContextActor(id, normalizedBehavior.context);
    } else {
      log.debug('Creating stateless actor', {
        actorId: id,
        hasContext: !!normalizedBehavior.context,
        contextKeys: normalizedBehavior.context ? Object.keys(normalizedBehavior.context) : [],
      });
      // Stateless actors for maximum performance with no state
      actorInstance = new StatelessActor(id);
    }

    // Start the actor instance
    actorInstance.start();

    // Store in polymorphic map
    this.actorInstances.set(path, actorInstance);

    // ✅ PURE ACTOR MODEL: Create and store behavior handler for this actor
    const behaviorHandler = new PureActorBehaviorHandler(this.messagePlanProcessor);
    this.actorBehaviorHandlers.set(path, behaviorHandler);

    // Register in directory
    log.debug('Registering actor in directory', {
      actorPath: path,
      nodeAddress: this.config.nodeAddress,
    });
    await this.directory.register(address, this.config.nodeAddress);
    log.debug('Actor registered in directory', {
      actorPath: path,
    });

    // Initialize stats with extended properties
    this.actorStats.set(path, {
      messagesReceived: 0,
      messagesProcessed: 0,
      errors: 0,
      uptime: 0,
      startTime: Date.now(),
    });

    // ✅ UNIFIED API DESIGN Phase 2.1: Analyze behavior for auto-publishing
    this.autoPublishingRegistry.analyzeActorBehavior(
      path,
      normalizedBehavior as ActorBehavior<ActorMessage, unknown>
    );

    // Create mailbox for the actor
    const mailbox = createMailbox.dropping(1000);
    this.actorMailboxes.set(path, mailbox);

    // Initialize onStart tracking
    this.actorStarted.set(path, false);

    // Start message processing loop for this actor
    this.startMessageProcessingLoop(address, normalizedBehavior);

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
      const spawnChildMessage: SpawnChildMessage = {
        type: 'SPAWN_CHILD',
        childId: address.id,
        childPath: address.path,
        supervision: 'resume',
        _timestamp: Date.now(),
        _version: '1.0.0',
      };
      await this.enqueueMessage(this.guardianActorAddress, spawnChildMessage);
    }

    // Create typed ActorRef using ActorPIDImpl which properly sends messages through the system
    // This ensures messages go through the mailbox system instead of instance.send()
    return new ActorPIDImpl(address, this) as unknown as ActorRef<unknown, ActorMessage>;
  }

  /**
   * Lookup an actor by path
   */
  async lookup(path: string): Promise<ActorRef | undefined> {
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

    for (const [path, location] of Array.from(allActors)) {
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

    for (const stats of Array.from(this.actorStats.values())) {
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

    const message: SystemEventMessage = {
      type: 'EMIT_SYSTEM_EVENT',
      systemEventType: event.eventType,
      systemTimestamp: event.timestamp,
      systemData: event.data ?? null,
      _timestamp: Date.now(),
      _version: '1.0.0',
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

    log.debug(
      '🔍 SUBSCRIBE TO SYSTEM EVENTS: systemEventActorAddress:',
      this.systemEventActorAddress
    );

    // Create a unique callback path for this listener
    const callbackPath = `actor://${this.config.nodeAddress}/callback/${generateCorrelationId()}`;

    // Store the callback in a map so we can invoke it when we receive notifications
    if (!this.systemEventCallbacks) {
      this.systemEventCallbacks = new Map<
        string,
        (event: { type: string; [key: string]: unknown }) => void
      >();
    }
    this.systemEventCallbacks.set(callbackPath, listener);

    // Send SUBSCRIBE_TO_SYSTEM_EVENTS message to the system event actor
    const subscribeMessage = {
      type: 'SUBSCRIBE_TO_SYSTEM_EVENTS',
      subscriberPath: callbackPath,
      // Don't filter events - we want all system events
    };

    log.debug('🔍 SUBSCRIBE TO SYSTEM EVENTS: Sending subscription message', {
      subscriberPath: callbackPath,
      systemEventActor: this.systemEventActorAddress.path,
    });

    // Send the subscription message
    this.enqueueMessage(this.systemEventActorAddress, subscribeMessage).catch((err) => {
      log.error('Failed to subscribe to system events', { error: err });
    });

    log.debug('🔍 SUBSCRIBE TO SYSTEM EVENTS: Subscription registered synchronously', {
      callbackPath,
    });

    // Return unsubscribe function
    return () => {
      // Send unsubscribe message if system event actor is still available
      if (this.systemEventActorAddress) {
        const unsubscribeMessage = {
          type: 'UNSUBSCRIBE_FROM_SYSTEM_EVENTS',
          subscriberPath: callbackPath,
        };

        this.enqueueMessage(this.systemEventActorAddress, unsubscribeMessage).catch((err) => {
          log.error('Failed to unsubscribe from system events', { error: err });
        });
      }

      // Remove callback
      if (this.systemEventCallbacks) {
        this.systemEventCallbacks.delete(callbackPath);
      }
    };
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
        if (callback && typeof message === 'object' && message !== null) {
          // Transform cluster event message to callback format
          if ('eventType' in message && 'node' in message) {
            const eventType = String(message.eventType);
            if (['node-up', 'node-down', 'leader-changed'].includes(eventType)) {
              callback({
                type: eventType as 'node-up' | 'node-down' | 'leader-changed',
                node: String(message.node),
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
    log.debug('enqueueMessage called', {
      actorPath: address.path,
      messageType: message.type,
      message,
    });

    // Get or create message context
    let context = this.messageContexts.get(message);
    if (!context) {
      context = createMessageContext({
        correlationId: message._correlationId,
      });
      this.messageContexts.set(message, context);
    }

    // Execute global beforeSend interceptors
    let processedMessage = message;
    if (this.globalInterceptors.size > 0) {
      const result = await this.globalInterceptors.execute(
        message,
        message._sender || null,
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
          message._sender || null,
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

    // Check if this is a callback path (for system event subscriptions)
    if (address.path.includes('/callback/')) {
      log.debug('🔍 ENQUEUE MESSAGE DEBUG: Callback path detected', {
        callbackPath: address.path,
        messageType: processedMessage.type,
      });

      // Handle callback-based delivery
      if (processedMessage.type === 'SYSTEM_EVENT_NOTIFICATION' && this.systemEventCallbacks) {
        const callback = this.systemEventCallbacks.get(address.path);
        if (callback) {
          log.debug('🔍 ENQUEUE MESSAGE DEBUG: Invoking callback', {
            callbackPath: address.path,
            eventType:
              'eventType' in processedMessage ? processedMessage.eventType : processedMessage.type,
          });

          const eventData: {
            type: string;
            eventType?: string;
            timestamp: number;
            [key: string]: unknown;
          } = {
            type:
              'eventType' in processedMessage
                ? String(processedMessage.eventType)
                : processedMessage.type,
            eventType:
              'eventType' in processedMessage
                ? String(processedMessage.eventType)
                : processedMessage.type,
            timestamp:
              'timestamp' in processedMessage
                ? Number(processedMessage.timestamp)
                : processedMessage._timestamp || Date.now(),
          };

          if ('data' in processedMessage && processedMessage.data !== undefined) {
            eventData.data = processedMessage.data;
          }

          // Invoke callback
          callback(eventData);
          return; // Message delivered via callback
        }
      }

      // Callback not found - add to dead letter queue
      log.warn('Callback not found for path', { path: address.path });
      this.deadLetterQueue.add(processedMessage, address.path, 'Callback not found', 1);
      return;
    }

    // First, check if the actor is local or remote
    const location = await this.directory.lookup(address);

    log.debug('Directory lookup result', {
      actorPath: address.path,
      location,
      nodeAddress: this.config.nodeAddress,
    });

    if (!location) {
      log.debug('Actor not found in directory', {
        actorPath: address.path,
      });
      log.error('Actor not found', { path: address.path });
      this.deadLetterQueue.add(processedMessage, address.path, 'Actor not found in directory', 1);
      return;
    }

    // If remote, deliver to remote actor
    if (location !== this.config.nodeAddress) {
      log.debug('🔍 ENQUEUE MESSAGE DEBUG: Delivering to remote actor', {
        actorPath: address.path,
        location,
        nodeAddress: this.config.nodeAddress,
      });
      await this.deliverMessageRemote(location, address, processedMessage);
      return;
    }

    // Local actor - enqueue to mailbox
    const mailbox = this.actorMailboxes.get(address.path);
    log.debug('Local actor mailbox lookup', {
      actorPath: address.path,
      hasMailbox: !!mailbox,
      totalMailboxes: this.actorMailboxes.size,
      allMailboxKeys: Array.from(this.actorMailboxes.keys()),
    });

    if (!mailbox) {
      log.debug('Mailbox not found', {
        actorPath: address.path,
      });
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
        log.debug('🔍 MAILBOX DEBUG: Message enqueued successfully', {
          actorPath: address.path,
          messageType: processedMessage.type,
        });

        // Check if we need to restart the processing loop
        const isProcessing = this.actorProcessingActive.get(address.path) || false;
        const hasLoop = this.actorProcessingLoops.get(address.path) || false;

        log.debug('🔍 MAILBOX DEBUG: Checking processing status', {
          actorPath: address.path,
          isProcessing,
          hasLoop,
          totalActiveActors: this.actorProcessingActive.size,
          totalLoops: this.actorProcessingLoops.size,
        });

        if (hasLoop && !isProcessing) {
          // The loop exists but is idle, wake it up
          const behavior = this.actors.get(address.path);
          log.debug('🔍 MAILBOX DEBUG: Waking up idle processing loop', {
            actorPath: address.path,
            hasBehavior: !!behavior,
          });

          if (behavior) {
            // Double-check to prevent race conditions
            if (
              this.actorProcessingLoops.get(address.path) &&
              !this.actorProcessingActive.get(address.path)
            ) {
              this.actorProcessingActive.set(address.path, true);
              // Use setImmediate to break out of microtask queue and prevent infinite loops
              setImmediate(() => this.processActorMessages(address, behavior));
            }
          }
        }

        // In test mode, process message immediately
        if (this.testMode) {
          const behavior = this.actors.get(address.path);
          if (behavior && !mailbox.isEmpty()) {
            // Process one message synchronously
            const message = mailbox.dequeue();
            if (message) {
              try {
                await this.deliverMessageLocal(address, message);
              } catch (error) {
                log.error('Error processing message in test mode', {
                  actor: address.path,
                  messageType: message.type,
                  error: error instanceof Error ? error.message : 'Unknown error',
                });
                // Apply supervision strategy
                await this.applySupervisionStrategy(address, error);
              }
            }
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
  private startMessageProcessingLoop(
    address: ActorAddress,
    behavior: PureActorBehavior<ActorMessage, ActorMessage>
  ): void {
    // Mark this actor as having an active processing loop
    this.actorProcessingLoops.set(address.path, true);
    // Mark as actively processing immediately to prevent race conditions
    this.actorProcessingActive.set(address.path, true);

    // Use setImmediate to start processing on next event loop iteration
    setImmediate(() => this.processActorMessages(address, behavior));
  }

  /**
   * Process messages from an actor's mailbox
   */
  private async processActorMessages(
    address: ActorAddress,
    behavior: PureActorBehavior<ActorMessage, ActorMessage>
  ): Promise<void> {
    const startTime = Date.now();
    const processId = Math.random().toString(36).substring(7);

    log.debug('processActorMessages called', {
      actorPath: address.path,
      processId,
      timestamp: startTime,
      activeProcessingCount: this.actorProcessingActive.size,
      totalLoops: this.actorProcessingLoops.size,
      isProcessingActive: this.actorProcessingActive.get(address.path),
      hasProcessingLoop: this.actorProcessingLoops.get(address.path),
    });

    const mailbox = this.actorMailboxes.get(address.path);
    if (!mailbox || !this.actorProcessingLoops.get(address.path)) {
      log.debug('Early exit - no mailbox or loop disabled', {
        actorPath: address.path,
        processId,
        hasMailbox: !!mailbox,
        hasProcessingLoop: !!this.actorProcessingLoops.get(address.path),
        exitTime: Date.now() - startTime,
      });
      this.actorProcessingActive.set(address.path, false);
      return;
    }

    // Mark as actively processing
    this.actorProcessingActive.set(address.path, true);

    log.debug('Starting message processing batch', {
      actorPath: address.path,
      processId,
      mailboxSize: mailbox.size(),
      isEmpty: mailbox.isEmpty(),
    });

    // Process all available messages in a batch
    let processed = 0;
    const maxMessages = 100; // Safety limit to prevent infinite processing

    while (
      !mailbox.isEmpty() &&
      this.actorProcessingLoops.get(address.path) &&
      processed < maxMessages
    ) {
      const message = mailbox.dequeue();

      log.debug('Processing message', {
        actorPath: address.path,
        processId,
        messageType: message?.type,
        hasMessage: !!message,
        processed,
        remainingInMailbox: mailbox.size(),
      });

      if (message) {
        try {
          await this.deliverMessageLocal(address, message);
          processed++;
        } catch (error) {
          log.error('Error processing message', {
            actor: address.path,
            processId,
            messageType: message.type,
            error: error instanceof Error ? error.message : 'Unknown error',
            processed,
          });

          // Apply supervision strategy
          await this.applySupervisionStrategy(address, error);
        }
      }
    }

    // Safety check for infinite loop protection
    if (processed >= maxMessages) {
      log.error('Hit message processing limit - possible infinite loop', {
        actorPath: address.path,
        processId,
        processed,
        mailboxSize: mailbox.size(),
      });
      this.actorProcessingActive.set(address.path, false);
      return;
    }

    const hasMoreMessages = !mailbox.isEmpty();
    const shouldContinue = this.actorProcessingLoops.get(address.path);

    log.debug('Batch complete, checking continuation', {
      actorPath: address.path,
      processId,
      processed,
      hasMoreMessages,
      shouldContinue,
      mailboxSize: mailbox.size(),
      duration: Date.now() - startTime,
    });

    // Check if there are more messages (could have arrived while processing)
    if (hasMoreMessages && shouldContinue) {
      log.debug('Scheduling next processing round', {
        actorPath: address.path,
        processId,
        nextProcessId: 'will-be-generated',
      });
      // More messages available, continue processing
      // Use setImmediate to yield control and prevent blocking the event loop
      setImmediate(() => this.processActorMessages(address, behavior));
    } else {
      log.debug('Processing complete, marking idle', {
        actorPath: address.path,
        processId,
        reason: hasMoreMessages ? 'loop disabled' : 'no more messages',
        duration: Date.now() - startTime,
      });
      // No more messages, mark as idle
      this.actorProcessingActive.set(address.path, false);
    }
  }

  /**
   * Ask an actor and wait for response
   * Uses correlation manager for proper response handling
   */
  async askActor<T>(address: ActorAddress, message: ActorMessage, timeout: number): Promise<T> {
    log.debug('🔍 ASK: Starting askActor with correlation manager');

    // Import ask pattern safeguards
    const { createAskTimeout } = await import('./ask-pattern-safeguards.js');

    // Generate correlation ID
    const correlationId = this.correlationManager.generateId();
    log.debug('🔍 ASK: Generated correlationId:', correlationId);

    // Register the request with correlation manager to get a promise
    // Use a much longer timeout for correlation manager so our AskPatternTimeout always wins
    const responsePromise = this.correlationManager.registerRequest<T>(correlationId, timeout * 10);

    // Create timeout promise with helpful error message
    const { promise: timeoutPromise, cancel: cancelTimeout } = createAskTimeout(
      address.path,
      message.type,
      correlationId,
      timeout
    );

    // Send the message with correlation ID
    const messageWithCorrelation: ActorMessage = {
      ...message,
      _correlationId: correlationId,
      _timestamp: message._timestamp || Date.now(),
      _version: message._version || '1.0.0',
    };

    log.debug('🔍 ASK: Sending message with correlation:', {
      messageType: messageWithCorrelation.type,
      correlationId,
      targetAddress: address,
    });

    await this.enqueueMessage(address, messageWithCorrelation);

    log.debug('🔍 ASK: Waiting for response...');

    try {
      // Race between response and timeout
      const response = await Promise.race([responsePromise, timeoutPromise]);
      cancelTimeout(); // Cancel timeout if we got a response
      log.debug('🔍 ASK: Got response:', response);

      // The correlation manager returns the ActorMessage
      // For flat message structure, extract the response data from the message
      if (
        response &&
        typeof response === 'object' &&
        'type' in response &&
        '_timestamp' in response &&
        '_version' in response
      ) {
        // Extract response data from flat message structure
        const message = response as ActorMessage;
        log.debug('🔍 ASK PATTERN DEBUG: Processing response', {
          actorPath: address.path,
          messageType: message.type,
          hasCorrelationId: !!message._correlationId,
          correlationId: message._correlationId,
          message,
        });

        const {
          type: _type,
          _timestamp,
          _version,
          _correlationId,
          _sender,
          ...responseData
        } = message;

        log.debug('🔍 ASK PATTERN DEBUG: Extracted response data', {
          actorPath: address.path,
          responseData,
          responseDataKeys: Object.keys(responseData),
          hasValueField: 'value' in responseData,
        });

        // If response data contains only a 'value' field, return the value directly
        if (Object.keys(responseData).length === 1 && 'value' in responseData) {
          const value = (responseData as { value: T }).value;
          log.debug('🔍 ASK PATTERN DEBUG: Returning value field', {
            actorPath: address.path,
            value,
          });
          return value;
        }

        // If response data contains only a 'payload' field (for arrays), return the payload directly
        if (Object.keys(responseData).length === 1 && 'payload' in responseData) {
          const payload = (responseData as { payload: T }).payload;
          log.debug('🔍 ASK PATTERN DEBUG: Returning payload field', {
            actorPath: address.path,
            payload,
            isArray: Array.isArray(payload),
          });
          return payload;
        }

        // Otherwise return the response data object (excluding envelope fields)
        log.debug('🔍 ASK PATTERN DEBUG: Returning response data object', {
          actorPath: address.path,
          responseData,
        });
        return responseData as T;
      }

      // If response is not an ActorMessage, return it as is
      return response;
    } catch (error) {
      // Cancel timeout if it's still pending
      cancelTimeout();

      // If this is our AskPatternTimeout, clean up the correlation manager
      if (error instanceof Error && error.name === 'AskPatternTimeout') {
        // Cancel the pending request in correlation manager
        this.correlationManager.handleTimeout(correlationId);
      }

      throw error;
    }
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
    log.debug('🔍 CREATE EVENT MESSAGE DEBUG: Creating event message', {
      addressPath: address.path,
      event,
      eventType: typeof event,
      isActorMessage: this.isActorMessage(event),
    });

    // If event is already an ActorMessage, return it
    if (this.isActorMessage(event)) {
      log.debug('🔍 CREATE EVENT MESSAGE DEBUG: Event is already ActorMessage', {
        eventType: event.type,
      });
      return event;
    }

    // Check if event has a type property safely
    let eventType = 'ACTOR_EVENT';
    if (event && typeof event === 'object' && 'type' in event && typeof event.type === 'string') {
      eventType = event.type;
    }

    // Create the event message with proper envelope
    // For type safety, we'll create a message that extends ActorMessage
    const eventMessage = {
      type: eventType,
      _sender: address,
      _timestamp: Date.now(),
      _version: '1.0.0',
      // Add event payload if it's not null/undefined
      ...(event !== null && event !== undefined && { eventPayload: event }),
    } as ActorMessage & { eventPayload?: unknown };

    log.debug('🔍 CREATE EVENT MESSAGE DEBUG: Created event message', {
      eventMessage,
      eventType: eventMessage.type,
    });

    return eventMessage;
  }

  /**
   * Type guard to check if an object is an ActorMessage
   */
  private isActorMessage(obj: unknown): obj is ActorMessage {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'type' in obj &&
      '_timestamp' in obj &&
      '_version' in obj
    );
  }

  /**
   * Deliver message to local actor
   */
  private async deliverMessageLocal(address: ActorAddress, message: ActorMessage): Promise<void> {
    log.debug('🔍 DELIVER LOCAL DEBUG: deliverMessageLocal called', {
      actorPath: address.path,
      messageType: message.type,
    });

    log.debug('Delivering message to local actor', {
      path: address.path,
      messageType: message.type,
    });

    const behavior = this.actors.get(address.path);
    if (!behavior) {
      log.debug('🔍 DELIVER LOCAL DEBUG: Behavior not found', {
        actorPath: address.path,
      });
      throw new Error(`Local actor not found: ${address.path}`);
    }

    // ✅ PURE ACTOR MODEL: Get stored actor instance and behavior handler
    const actorInstance = this.actorInstances.get(address.path);
    const behaviorHandler = this.actorBehaviorHandlers.get(address.path);

    log.debug('🔍 DELIVER LOCAL DEBUG: Actor components lookup', {
      actorPath: address.path,
      hasBehavior: !!behavior,
      hasActorInstance: !!actorInstance,
      hasBehaviorHandler: !!behaviorHandler,
    });

    if (!actorInstance || !behaviorHandler) {
      log.debug('🔍 DELIVER LOCAL DEBUG: Missing components', {
        actorPath: address.path,
        actorInstance: !!actorInstance,
        behaviorHandler: !!behaviorHandler,
      });
      throw new Error(`Actor instance or behavior handler not found: ${address.path}`);
    }

    // ✅ CONTEXT ISOLATION: Establish actor identity boundary
    const actorContext = ActorContextManager.createContext(
      address.path,
      message._correlationId,
      `msg-${Date.now()}`
    );

    return ActorContextManager.safeRun(
      actorContext,
      async () => {
        return this.processMessageWithContext(
          address,
          message,
          behavior,
          actorInstance,
          behaviorHandler
        );
      },
      address.path
    );
  }

  /**
   * Process message within actor context
   */
  private async processMessageWithContext(
    address: ActorAddress,
    message: ActorMessage,
    behavior: PureActorBehavior<ActorMessage, ActorMessage> & { context?: unknown },
    actorInstance: ActorInstance,
    behaviorHandler: PureActorBehaviorHandler
  ): Promise<void> {
    // Get message context
    let context =
      this.messageContexts.get(message) ||
      createMessageContext({
        correlationId: message._correlationId,
      });

    // Execute global beforeReceive interceptors
    let processedMessage = message;
    if (this.globalInterceptors.size > 0) {
      const result = await this.globalInterceptors.execute(
        message,
        message._sender || null,
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
    const actorPid: ActorPID = {
      address,
      stop: async () => this.stopActorInternal(address),
      send: async <T extends { type: string }>(msg: T) => this.enqueueMessage(address, msg),
      ask: async <TResponse = JsonValue>(msg: Message) =>
        this.askActor<TResponse>(address, msg, this.config.defaultAskTimeout ?? 5000),
      isAlive: async () => (await this.directory.lookup(address)) !== undefined,
      getStats: async () => this.getActorStatsInternal(address),
    };

    // Execute actor-specific beforeReceive interceptors
    const actorChain = this.actorInterceptors.get(actorPid);
    if (actorChain && actorChain.size > 0) {
      const result = await actorChain.execute(
        processedMessage,
        processedMessage._sender || null,
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
      // ✅ PURE ACTOR MODEL: Use createActorDependencies method for consistent dependency creation
      const dependencies = this.createActorDependencies(address.path, actorInstance);

      // Call onStart if this is the first time
      if (!this.actorStarted.get(address.path)) {
        log.debug('🔍 PROCESS MESSAGE DEBUG: Calling onStart for first time', {
          actorPath: address.path,
          behaviorType: typeof behavior,
          hasOnStart: behavior && 'onStart' in behavior,
          onStartType: behavior && 'onStart' in behavior ? typeof behavior.onStart : 'N/A',
        });

        log.debug('Calling onStart for actor', { path: address.path });

        await behaviorHandler.handleStart(
          behavior as PureActorBehavior<unknown, ActorMessage>,
          actorInstance,
          dependencies
        );

        log.debug('🔍 PROCESS MESSAGE DEBUG: onStart completed', {
          actorPath: address.path,
        });

        this.actorStarted.set(address.path, true);
      }

      // Update stats
      if (stats) {
        this.actorStats.set(address.path, {
          ...stats,
          messagesReceived: stats.messagesReceived + 1,
        });
      }

      // ✅ PURE ACTOR MODEL: Use behavior handler for message processing
      log.debug('🔍 PROCESS MESSAGE DEBUG: About to call behaviorHandler.handleMessage', {
        actorPath: address.path,
        messageType: processedMessage.type,
        behaviorHandlerType: typeof behaviorHandler,
        hasBehaviorHandler: !!behaviorHandler,
      });

      await behaviorHandler.handleMessage(
        behavior as PureActorBehavior<ActorMessage, ActorMessage>,
        processedMessage,
        actorInstance,
        dependencies
      );

      log.debug('🔍 PROCESS MESSAGE DEBUG: behaviorHandler.handleMessage completed', {
        actorPath: address.path,
        messageType: processedMessage.type,
      });

      // Update processed message stats
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

      // Handle ask pattern responses - handled by MessagePlan processor now
      // No manual correlation needed

      // Notify message subscribers
      this.notifyMessageSubscribers(address, processedMessage);

      // Execute afterProcess interceptors
      if (this.globalInterceptors.size > 0) {
        await this.globalInterceptors.executeAfterProcess(
          processedMessage,
          null, // No direct result from pure actor handler
          address,
          context
        );
      }

      if (actorChain && actorChain.size > 0) {
        await actorChain.executeAfterProcess(processedMessage, null, address, context);
      }
    } catch (error) {
      log.debug('🔍 PROCESS MESSAGE DEBUG: Error in processMessageWithContext', {
        actorPath: address.path,
        messageType: processedMessage.type,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        hasCorrelationId: !!processedMessage._correlationId,
        correlationId: processedMessage._correlationId,
      });

      // If this is an ask pattern request (has correlation ID), reject the promise
      if (processedMessage._correlationId) {
        const err =
          error instanceof Error ? error : new Error('Unknown error in message processing');
        this.correlationManager.handleError(processedMessage._correlationId, err);
      }

      // Handle actor processing errors
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
      await this.executeErrorInterceptors(errorObj, processedMessage, address, context, actorChain);

      throw error;
    }
  }

  /**
   * Emit event to subscribers using auto-publishing registry
   *
   * ✅ PURE ACTOR MODEL: Events are enqueued directly to subscriber mailboxes
   * following Erlang/OTP patterns where Pid ! Message is synchronous enqueue
   */
  private emitEventToSubscribers(address: ActorAddress, eventMessage: ActorMessage): void {
    const publisherId = address.path;

    // ✅ UNIFIED API DESIGN Phase 2.1: Use auto-publishing registry for event distribution
    const subscribers = this.autoPublishingRegistry.getSubscribersForEvent(
      publisherId,
      eventMessage.type
    );

    log.debug('🔍 EMIT EVENT DEBUG: Emitting to subscribers', {
      publisherId,
      eventType: eventMessage.type,
      subscriberCount: subscribers.length,
      subscribers: subscribers.map((s) => s.address.path),
    });

    // ✅ DIRECT MAILBOX ENQUEUE: Send event to each subscriber's mailbox directly
    // This matches Erlang/OTP and Akka patterns where events are just messages
    for (const subscriber of subscribers) {
      log.debug('🔍 EMIT EVENT DEBUG: Direct enqueue to subscriber', {
        publisherId,
        subscriberId: subscriber.address.path,
        eventType: eventMessage.type,
        eventMessage,
      });

      try {
        // Direct enqueue to mailbox - no async boundary
        // This ensures events are available immediately in tests
        // and maintains deterministic ordering with other messages
        this.enqueueMessage(subscriber.address, eventMessage).catch((error) => {
          // Log as dead letter if enqueue fails (e.g., mailbox full)
          log.debug('🔍 EMIT EVENT DEBUG: Event dropped (dead letter)', {
            subscriberId: subscriber.address.path,
            eventType: eventMessage.type,
            reason: error instanceof Error ? error.message : 'Unknown error',
          });

          log.warn('Event dropped - dead letter', {
            publisherId,
            subscriberId: subscriber.address.path,
            eventType: eventMessage.type,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });
      } catch (syncError) {
        // Handle any synchronous errors from enqueue attempt
        log.error('Failed to enqueue event', {
          publisherId,
          subscriberId: subscriber.address.path,
          eventType: eventMessage.type,
          error: syncError instanceof Error ? syncError.message : 'Unknown error',
        });
      }
    }
  }

  /**
   * Notify message subscribers
   */
  private notifyMessageSubscribers(address: ActorAddress, message: ActorMessage): void {
    // Notify subscribers for all message types
    const allKey = `${address.path}:*`;
    const allSubscribers = this.subscribers.get(allKey);
    if (allSubscribers) {
      for (const handler of Array.from(allSubscribers)) {
        handler(message);
      }
    }

    // Notify subscribers for specific message type
    const key = `${address.path}:${message.type}`;
    const subscribers = this.subscribers.get(key);
    if (subscribers) {
      for (const handler of Array.from(subscribers)) {
        handler(message);
      }
    }
  }

  /**
   * Execute error interceptors
   */
  private async executeErrorInterceptors(
    error: Error,
    message: ActorMessage,
    address: ActorAddress,
    context: MessageContext,
    actorChain?: InterceptorChain
  ): Promise<void> {
    // Execute global onError interceptors
    if (this.globalInterceptors.size > 0) {
      try {
        await this.globalInterceptors.executeOnError(error, message, address, context);
      } catch (interceptorError) {
        log.error('Global interceptor onError handler failed', {
          error:
            interceptorError instanceof Error ? interceptorError.message : String(interceptorError),
        });
      }
    }

    // Execute actor-specific onError interceptors
    if (actorChain && actorChain.size > 0) {
      try {
        await actorChain.executeOnError(error, message, address, context);
      } catch (interceptorError) {
        log.error('Actor interceptor onError handler failed', {
          error:
            interceptorError instanceof Error ? interceptorError.message : String(interceptorError),
        });
      }
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

    // Check restart limits to prevent infinite restart loops
    const now = Date.now();
    const currentRestartCount = this.actorRestartCounts.get(address.path) || 0;
    const lastRestartTime = this.actorLastRestartTime.get(address.path) || 0;

    // Reset restart count if enough time has passed
    if (now - lastRestartTime > RESTART_WINDOW_MS) {
      this.actorRestartCounts.set(address.path, 0);
    }

    // Check if we've exceeded restart limits
    if (currentRestartCount >= MAX_RESTART_ATTEMPTS) {
      log.error('Actor exceeded restart limits, stopping permanently', {
        path: address.path,
        restartCount: currentRestartCount,
        maxAttempts: MAX_RESTART_ATTEMPTS,
        error: error instanceof Error ? error.message : String(error),
      });

      // Stop the actor permanently to prevent memory leaks
      await this.stopActor(new ActorPIDImpl(address, this));
      await this.emitSystemEvent({
        eventType: 'actorStopped',
        timestamp: Date.now(),
        data: { address: address.path, reason: 'max-restarts-exceeded' },
      });
      return;
    }

    // ✅ PURE ACTOR MODEL: Default supervision strategy with restart limits
    const supervisionDirective = 'restart' as 'restart' | 'stop' | 'escalate' | 'resume';

    log.warn('Actor failed, applying supervision directive with restart limits', {
      path: address.path,
      directive: supervisionDirective,
      restartCount: currentRestartCount,
      maxAttempts: MAX_RESTART_ATTEMPTS,
      error: error instanceof Error ? error.message : String(error),
    });

    // Apply the directive using if-else to avoid TypeScript switch narrowing issues
    if (supervisionDirective === 'restart') {
      log.warn('Actor failed, applying restart directive', {
        path: address.path,
        restartAttempt: currentRestartCount + 1,
      });
      await this.restartActorWithLimits(address, behavior);
    } else if (supervisionDirective === 'stop') {
      log.error('Actor failed, applying stop directive', { path: address.path });
      await this.stopActor(new ActorPIDImpl(address, this));
      await this.emitSystemEvent({
        eventType: 'actorStopped',
        timestamp: Date.now(),
        data: { address: address.path, reason: 'supervision-stop' },
      });
    } else if (supervisionDirective === 'escalate') {
      log.warn('Actor failed, escalating to guardian', { path: address.path });
      await this.notifyGuardianOfFailure(address, error);
    } else if (supervisionDirective === 'resume') {
      log.warn('Actor failed, applying resume directive', { path: address.path });
      await this.resumeActor(address);
    } else {
      log.error('Unknown supervision directive, defaulting to restart with limits', {
        path: address.path,
        directive: supervisionDirective,
      });
      await this.restartActorWithLimits(address, behavior);
    }
  }

  /**
   * Restart an actor with the same behavior and track restart attempts
   */
  private async restartActorWithLimits(
    address: ActorAddress,
    behavior: PureActorBehavior
  ): Promise<void> {
    const now = Date.now();
    const currentRestartCount = this.actorRestartCounts.get(address.path) || 0;

    // Update restart tracking
    this.actorRestartCounts.set(address.path, currentRestartCount + 1);
    this.actorLastRestartTime.set(address.path, now);

    // Add exponential backoff delay to prevent rapid restart loops
    const backoffDelay = RESTART_BACKOFF_MS * 2 ** currentRestartCount;

    log.info('Restarting actor with backoff delay', {
      path: address.path,
      restartAttempt: currentRestartCount + 1,
      backoffDelayMs: backoffDelay,
    });

    // Wait before restarting to prevent rapid cycling
    await new Promise((resolve) => setTimeout(resolve, backoffDelay));

    try {
      // Stop the current actor
      await this.stopActor(new ActorPIDImpl(address, this));

      // Respawn with the same behavior and ID
      await this.spawn(behavior, { id: address.id });

      await this.emitSystemEvent({
        eventType: 'actorRestarted',
        timestamp: Date.now(),
        data: {
          address: address.path,
          restartAttempt: currentRestartCount + 1,
        },
      });

      log.info('Actor restarted successfully', {
        path: address.path,
        restartAttempt: currentRestartCount + 1,
      });
    } catch (restartError) {
      log.error('Failed to restart actor', {
        path: address.path,
        restartAttempt: currentRestartCount + 1,
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
      await this.restartActorWithLimits(address, behavior);
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
      const actorFailedMessage: ActorFailedMessage = {
        type: 'ACTOR_FAILED',
        actorId: address.id,
        actorPath: address.path,
        error: errorMessage,
        directive: 'escalate',
        _timestamp: Date.now(),
        _version: '1.0.0',
      };
      await this.enqueueMessage(this.guardianActorAddress, actorFailedMessage);

      log.info('Failure escalated to Guardian', { path: address.path });
    } catch (escalationError) {
      log.error('Failed to escalate to Guardian', {
        path: address.path,
        escalationError: escalationError instanceof Error ? escalationError.message : 'Unknown',
      });
    }
  }

  /**
   * Create dependencies for pure actor model
   */
  private createActorDependencies(
    actorId: string,
    actorInstance: ActorInstance
  ): ActorDependencies {
    // Create ActorRef for self reference
    const address = parseActorPath(actorId);
    const selfRef = address
      ? (new ActorPIDImpl(address, this) as unknown as ActorRef<unknown>)
      : undefined;

    return {
      actorId,
      actor: actorInstance,
      self: selfRef || ({} as ActorRef<unknown>), // Provide empty object as fallback
      emit: (event: unknown) => {
        log.debug('🔍 EMIT FUNCTION DEBUG: emit() called', {
          actorId,
          event,
          eventType:
            event && typeof event === 'object' && 'type' in event
              ? (event as { type: unknown }).type
              : undefined,
        });

        const address = parseActorPath(actorId);
        if (address) {
          const eventMessage = this.createEventMessage(address, event);

          log.debug('🔍 EMIT FUNCTION DEBUG: Event message created', {
            actorId,
            eventMessage,
            eventType: eventMessage.type,
          });

          // ✅ UNIFIED API DESIGN Phase 2.1: Track emitted events in auto-publishing registry
          this.autoPublishingRegistry.trackEmittedEvent(actorId, eventMessage.type);

          log.debug('🔍 EMIT FUNCTION DEBUG: Calling emitEventToSubscribers', {
            actorId,
            addressPath: address.path,
            eventType: eventMessage.type,
          });

          this.emitEventToSubscribers(address, eventMessage);
        } else {
          log.debug('🔍 EMIT FUNCTION DEBUG: Failed to parse actor path', {
            actorId,
          });
        }
      },
      send: async (to: unknown, message: ActorMessage) => {
        if (typeof to === 'object' && to !== null && 'send' in to) {
          await (to as { send: (msg: ActorMessage) => Promise<void> }).send(message);
        }
      },
      ask: async <T>(_to: unknown, _message: ActorMessage, _timeout?: number) => {
        return Promise.resolve({} as T);
      },
      logger: Logger.namespace(`ACTOR_${actorId}`),
      correlationManager: this.correlationManager,
    };
  }

  /**
   * Get the Event Broker Actor address
   */
  getEventBrokerAddress(): ActorAddress | undefined {
    return this.eventBrokerActorAddress;
  }

  /**
   * Get the Discovery Service Actor address
   */
  getDiscoveryServiceAddress(): ActorAddress | undefined {
    return this.discoveryServiceActorAddress;
  }

  /**
   * Subscribe to events from a specific actor
   * This is the primary subscription API that matches the interface
   */
  async subscribe<TEventType extends string = string>(
    publisher: ActorRef,
    options: {
      subscriber: ActorRef;
      events?: TEventType[];
    }
  ): Promise<() => Promise<void>> {
    const publisherId = publisher.address.path;
    const subscriberId = options.subscriber.address.path;
    const eventTypes = options.events || [];

    log.debug('🔍 SUBSCRIBE DEBUG: subscribe() called', {
      publisherId,
      subscriberId,
      eventTypes,
      hasPublisher: !!publisher,
      hasSubscriber: !!options.subscriber,
    });

    // Register publisher with auto-publishing registry if not already registered
    const behavior = this.actors.get(publisherId);
    log.debug('🔍 SUBSCRIBE DEBUG: Checking publisher behavior', {
      publisherId,
      hasBehavior: !!behavior,
      behaviorType: behavior ? typeof behavior : 'none',
    });

    if (behavior) {
      this.autoPublishingRegistry.analyzeActorBehavior(publisherId, behavior);
    }

    // Add subscriber to the registry
    log.debug('🔍 SUBSCRIBE DEBUG: Adding subscriber to registry', {
      publisherId,
      subscriberId,
      eventTypes,
    });

    this.autoPublishingRegistry.addSubscriber(
      publisherId,
      subscriberId,
      options.subscriber,
      eventTypes
    );

    log.debug('🔍 SUBSCRIBE DEBUG: Subscription completed', {
      publisherId,
      subscriberId,
      eventTypes: eventTypes.length > 0 ? eventTypes : 'all',
    });

    log.info('Actor subscription created', {
      publisher: publisherId,
      subscriber: subscriberId,
      events: eventTypes.length > 0 ? eventTypes : 'all',
    });

    // Return unsubscribe function
    return async () => {
      this.autoPublishingRegistry.removeSubscriber(publisherId, subscriberId);
      log.debug('Actor subscription removed', { publisherId, subscriberId });
    };
  }

  /**
   * Spawn an event collector actor for testing purposes
   */
  async spawnEventCollector(options: { id: string; autoStart?: boolean }): Promise<ActorRef> {
    // Import EventCollectorActor behavior
    const { createEventCollectorBehavior } = await import('./testing/event-collector.js');

    const behavior = createEventCollectorBehavior();

    return this.spawn(behavior, { id: options.id });
  }

  // ============================================================================
  // TEST SYNCHRONIZATION UTILITIES
  // ============================================================================

  /**
   * Enable synchronous test mode
   */
  enableTestMode(): void {
    this.testMode = true;
    log.info('Test mode enabled - messages will be processed synchronously');
  }

  /**
   * Disable synchronous test mode
   */
  disableTestMode(): void {
    this.testMode = false;
    log.info('Test mode disabled - messages will be processed asynchronously');
  }

  /**
   * Check if test mode is enabled
   */
  isTestMode(): boolean {
    return this.testMode;
  }

  /**
   * Flush all pending messages until system is idle
   */
  async flush(options?: { timeout?: number; maxRounds?: number }): Promise<void> {
    const timeout = options?.timeout ?? 5000;
    const maxRounds = options?.maxRounds ?? 1000;
    const startTime = Date.now();
    let rounds = 0;

    log.debug('Starting flush operation', { timeout, maxRounds });

    while (this.hasQueuedMessages()) {
      // Check timeout
      if (Date.now() - startTime > timeout) {
        const busyActors = this.getBusyActors();
        throw new Error(
          `Flush timeout after ${rounds} rounds. Busy actors: ${busyActors.join(', ')}`
        );
      }

      // Check max rounds
      if (rounds++ > maxRounds) {
        const busyActors = this.getBusyActors();
        throw new Error(
          `Flush exceeded max rounds (${maxRounds}). Possible infinite loop. Busy actors: ${busyActors.join(', ')}`
        );
      }

      // Process one round of messages (one per actor for fairness)
      await this.processOneRoundOfMessages();
    }

    log.debug('Flush completed', { rounds, duration: Date.now() - startTime });
  }

  /**
   * Check if any actor has queued messages
   */
  private hasQueuedMessages(): boolean {
    for (const mailbox of this.actorMailboxes.values()) {
      if (mailbox.size() > 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get list of actors with pending messages
   */
  private getBusyActors(): string[] {
    const busyActors: string[] = [];
    for (const [path, mailbox] of this.actorMailboxes.entries()) {
      if (mailbox.size() > 0) {
        busyActors.push(path);
      }
    }
    return busyActors;
  }

  /**
   * Process one message from each actor's mailbox (round-robin)
   */
  private async processOneRoundOfMessages(): Promise<void> {
    const promises: Promise<void>[] = [];

    // Process one message from each actor
    for (const [path, mailbox] of this.actorMailboxes.entries()) {
      if (mailbox.size() > 0) {
        // Get the actor address
        const address = parseActorPath(path);
        if (address) {
          // Process one message for this actor
          const promise = this.processNextMessage(address);
          promises.push(promise);
        }
      }
    }

    // Wait for all messages in this round to be processed
    await Promise.all(promises);
  }

  /**
   * Process the next message for a specific actor
   */
  private async processNextMessage(address: ActorAddress): Promise<void> {
    const mailbox = this.actorMailboxes.get(address.path);
    if (!mailbox) return;

    const message = await mailbox.dequeue();
    if (!message) return;

    // Process the message
    await this.deliverMessageLocal(address, message);
  }
}

/**
 * Internal implementation of ActorPID
 */
class ActorPIDImpl implements ActorRef {
  constructor(
    public readonly address: ActorAddress,
    private readonly system: ActorSystemImpl
  ) {}

  async send<T extends { type: string }>(message: T): Promise<void> {
    log.debug('🔍 ACTOR PID SEND DEBUG: send() called', {
      actorAddress: this.address.path,
      messageType: message.type,
      message,
    });

    try {
      // Fire and forget - enqueue to mailbox
      await this.system.enqueueMessage(this.address, message);
      log.debug('🔍 ACTOR PID SEND DEBUG: enqueueMessage completed', {
        actorAddress: this.address.path,
        messageType: message.type,
      });
    } catch (error) {
      log.debug('🔍 ACTOR PID SEND DEBUG: enqueueMessage failed', {
        actorAddress: this.address.path,
        messageType: message.type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async ask<TResponse = JsonValue>(
    message: { type: string; [key: string]: unknown },
    timeout?: number
  ): Promise<TResponse> {
    const askTimeout = timeout ?? this.system.getDefaultAskTimeout();
    return this.system.askActor<TResponse>(this.address, message, askTimeout);
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

  // ActorRef additional methods
  getSnapshot(): ActorSnapshot<unknown> {
    // For now, return a minimal snapshot
    // In the future, this should fetch the actual actor state
    return {
      status: 'running',
      context: {},
      value: undefined,
      matches: () => false,
      can: () => false,
      hasTag: () => false,
      toJSON: () => ({ status: 'running', context: {}, value: undefined }),
    };
  }
}

/**
 * Create an actor system with the given configuration
 */
export function createActorSystem(config: ActorSystemConfig): ActorSystem {
  return new ActorSystemImpl(config);
}
