/**
 * @module actor-core/runtime/actor-system
 * @description Core actor system interfaces and types for pure actor model implementation
 *
 * This module defines the fundamental building blocks of a distributed, location-transparent
 * actor system that follows pure actor model principles:
 *
 * 1. Location Transparency - Actors can be addressed regardless of physical location
 * 2. Message-Only Communication - All interactions use asynchronous message passing
 * 3. Virtual Actor System - Actors exist logically, instantiated on-demand
 * 4. Distributed Actor Directory - Replicated actor registry across cluster nodes
 * 5. Supervision Hierarchy - Fault tolerance through actor supervision
 */

import type { ActorInstance } from './actor-instance.js';
import type { ActorRef } from './actor-ref.js';
import type { UniversalTemplate } from './create-actor.js';
import type { JsonValue, Message } from './types.js';
import { createActorAddress } from './utils/factories.js';

export type { JsonValue } from './types.js';

// ============================================================================
// TYPE-SAFE ACTOR FOUNDATIONS
// ============================================================================

/**
 * Base message map interface that all actors can extend
 * Maps message types to their expected response types
 *
 * ⚠️ CRITICAL: This interface intentionally has NO index signature.
 * Adding `[K: string]: unknown` would break TypeScript immediate type validation
 * by making `keyof MessageMap` return `string` instead of literal string unions.
 *
 * Example:
 * ```typescript
 * interface MyActorMessages extends MessageMap {
 *   'GET_USER': { id: string; name: string };
 *   'UPDATE_USER': { success: boolean };
 * }
 *
 * // With this fix:
 * type ValidKeys = keyof MyActorMessages; // 'GET_USER' | 'UPDATE_USER' ✅
 *
 * // If we had [K: string]: unknown:
 * type BrokenKeys = keyof MyActorMessages; // string ❌
 * ```
 */
export interface MessageMap {
  // Intentionally minimal - no index signature that would break type inference
  // Extending interfaces will define specific message type mappings
  readonly __messageMapBrand?: never; // Phantom type for brand identification
}

// ============================================================================
// EXISTING INTERFACES (Updated for compatibility)
// ============================================================================

// JsonValue type moved to types.ts for consolidation
// Import: import type { JsonValue } from './types.js';

/**
 * Correlation ID for tracking message flows and request-response patterns
 */
export type CorrelationId = string;

/**
 * Actor dependencies injected into behavior handlers
 * Enhanced for pure actor model with machine + dependencies pattern
 */
export interface ActorDependencies {
  readonly actorId: string;
  readonly actor: ActorInstance;
  readonly self: ActorRef<unknown>; // ActorRef to self for scheduling, forwarding, etc.
  readonly emit: (event: ActorMessage) => void;
  readonly send: (to: unknown, message: ActorMessage) => Promise<void>;
  readonly ask: <T>(to: unknown, message: ActorMessage, timeout?: number) => Promise<T>;
  readonly logger: unknown; // Logger - avoiding circular dependency
  readonly actorSystem?: unknown; // Will be properly typed when available
  readonly correlationManager?: unknown; // Will be properly typed when available
}

/**
 * Message Plan - The core DSL type that represents declarative communication intentions
 * Re-exported here to avoid circular dependencies with message-plan.ts
 */
export type MessagePlan<_TDomainEvent = unknown> = unknown; // Will be properly typed with MessagePlan import

/**
 * Actor address that uniquely identifies an actor in the system
 */
export interface ActorAddress {
  readonly id: string;
  readonly type: string;
  readonly node?: string;
  readonly path: string;
}

/**
 * Actor envelope with reserved framework fields
 * Forms the base for all actor messages with flat structure
 *
 * Reserved fields are prefixed with underscore to avoid collisions
 * with user-defined message fields.
 */
export interface ActorEnvelope {
  /** Message type discriminant (required) */
  readonly type: string;

  // Framework reserved fields (all optional)
  /** Timestamp when message was created */
  readonly _timestamp?: number;
  /** Message format version */
  readonly _version?: string;
  /** Correlation ID for request-response patterns */
  readonly _correlationId?: string;
  /** Sender actor address for reply patterns */
  readonly _sender?: ActorAddress;
}

/**
 * Standard actor message type that extends envelope with user fields
 * Enables natural TypeScript discriminated unions
 *
 * Example:
 * ```typescript
 * type UserMessage =
 *   | { type: 'GET_USER'; userId: string }
 *   | { type: 'USER_FOUND'; name: string; email: string }
 *   | { type: 'USER_NOT_FOUND'; error: string };
 *
 * // All messages automatically have envelope fields available
 * const msg: UserMessage & ActorEnvelope = {
 *   type: 'GET_USER',
 *   userId: '123',
 *   _correlationId: 'req-456'
 * };
 * ```
 */
export type ActorMessage<T extends { type: string } = { type: string }> = T & ActorEnvelope;

/**
 * Actor spawn options
 */
export interface SpawnOptions {
  readonly id?: string;
  readonly supervised?: boolean;
  readonly persistState?: boolean;
  readonly timeout?: number;
  readonly retries?: number;
}

/**
 * Supervision strategy directives
 */
export enum SupervisionDirective {
  RESTART = 'restart',
  STOP = 'stop',
  ESCALATE = 'escalate',
  RESUME = 'resume',
}

/**
 * Supervision strategy for handling actor failures
 */
export interface SupervisionStrategy {
  onFailure(error: Error, actor: ActorRef): SupervisionDirective;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Unified Actor Behavior Interface (Pure Actor Model)
 *
 * This is the single interface for defining actor behaviors following pure actor principles:
 * - No shared context state (state lives in XState machine only)
 * - Message-only communication via machine and dependencies
 * - Returns MessagePlan for declarative communication intentions
 *
 * @template TMessage - The message type this actor handles
 * @template TEmitted - The domain events this actor can emit
 */
export interface ActorBehavior<TMessage = ActorMessage, TEmitted = ActorMessage> {
  /**
   * Optional type definitions for compile-time validation
   * Inherited from BehaviorActorConfig to support type checking
   */
  readonly types?: {
    readonly message?: TMessage;
    readonly emitted?: TEmitted;
  };

  /**
   * Optional context for context-based actors
   * Used when creating the XState machine for the actor
   */
  readonly context?: JsonValue;

  /**
   * Message handler - pure function that processes messages and returns communication plans
   *
   * @param params.message - The incoming message to process
   * @param params.actor - Actor instance for state access and transitions
   * @param params.dependencies - Injected dependencies (actor system, correlation manager, etc.)
   * @returns MessagePlan describing communication intentions, or void for no action
   */
  readonly onMessage: (params: {
    readonly message: TMessage;
    readonly actor: ActorInstance;
    readonly dependencies: ActorDependencies;
  }) => MessagePlan<TEmitted> | Promise<MessagePlan<TEmitted>> | void | Promise<void>;

  /**
   * Optional lifecycle hook - actor start
   * Called when the actor is first started
   */
  readonly onStart?: (params: {
    readonly actor: ActorInstance;
    readonly dependencies: ActorDependencies;
  }) => MessagePlan<TEmitted> | Promise<MessagePlan<TEmitted>> | void | Promise<void>;

  /**
   * Optional lifecycle hook - actor stop
   * Called when the actor is being stopped
   */
  readonly onStop?: (params: {
    readonly actor: ActorInstance;
    readonly dependencies: ActorDependencies;
  }) => Promise<void> | void;

  /**
   * Supervision strategy for fault tolerance
   */
  readonly supervisionStrategy?: SupervisionStrategy;

  /**
   * Optional universal template for cross-platform rendering
   * Used for component actors and template-based rendering
   * Phase 2.1: Templates are extracted from behavior definitions, not options
   */
  readonly template?: UniversalTemplate | ((context: unknown) => string) | string;
}

/**
 * Cluster state information
 */
export interface ClusterState {
  readonly nodes: string[];
  readonly leader?: string;
  readonly status: 'joining' | 'up' | 'leaving' | 'down';
}

/**
 * Actor statistics
 */
export interface ActorStats {
  readonly messagesReceived: number;
  readonly messagesProcessed: number;
  readonly errors: number;
  readonly uptime: number;
}

// ============================================================================
// ACTOR PID - INTERNAL LOCATION TRANSPARENT ACTOR REFERENCE
// ============================================================================

/**
 * Location-transparent actor reference (Process ID) - INTERNAL USE ONLY
 *
 * @internal Use ActorRef instead for all public-facing APIs
 *
 * This is the low-level core abstraction that enables location transparency.
 * An ActorPID works the same way whether the actor is local or remote, following the
 * principle that actors communicate only through message passing.
 *
 * ⚠️ WARNING: This interface is for internal framework use only. All public APIs
 * should use ActorRef (from actor-ref.ts) which extends this interface
 * with additional type safety and methods.
 *
 * Why ActorPID is internal:
 * - ActorPID is the low-level "socket" for message routing
 * - ActorRef provides the typed, user-friendly interface
 * - This separation allows internal optimizations without breaking public APIs
 *
 * If you're using ActorPID in application code, refactor to use ActorRef instead.
 */
export interface ActorPID {
  readonly address: ActorAddress;

  /**
   * Send a message to the actor (fire-and-forget)
   * Accepts any message that has at least a 'type' field
   * @param message - Message with a type field and any additional properties
   */
  send<T extends { type: string }>(message: T): Promise<void>;

  /**
   * Ask the actor a question and wait for a response
   * Accepts any message that has at least a 'type' field
   * @param message - Message with a type field and any additional properties
   * @param timeout - Optional timeout in milliseconds
   */
  ask<TResponse = JsonValue>(message: Message, timeout?: number): Promise<TResponse>;

  /**
   * Stop the actor
   */
  stop(): Promise<void>;

  /**
   * Check if the actor is alive
   */
  isAlive(): Promise<boolean>;

  /**
   * Get actor statistics
   */
  getStats(): Promise<ActorStats>;
}

// ============================================================================
// ACTOR SYSTEM - DISTRIBUTED ACTOR RUNTIME
// ============================================================================

/**
 * Distributed actor system
 *
 * This is the main entry point for the actor system. It provides methods to
 * spawn, lookup, and manage actors across a distributed cluster.
 */
export interface ActorSystem {
  /**
   * Spawn a new actor with the given behavior or definition
   * Accepts ActorBehavior or fluent builder (auto-builds internally)
   */
  spawn<TMessage extends ActorMessage = ActorMessage, TEmitted = ActorMessage, TContext = unknown>(
    behavior: ActorBehavior<TMessage, TEmitted> | { build(): ActorBehavior<TMessage, TEmitted> },
    options?: SpawnOptions
  ): Promise<ActorRef<TContext, TMessage>>;

  /**
   * Look up an actor by its path
   */
  lookup(path: string): Promise<ActorRef | undefined>;

  /**
   * Stop an actor
   */
  stop(ref: ActorRef): Promise<void>;
  /**
   * Stop the actor system
   */
  stop(): Promise<void>;

  /**
   * List all actors in the system
   */
  listActors(): Promise<ActorAddress[]>;

  /**
   * Get system statistics
   */
  getSystemStats(): Promise<{
    totalActors: number;
    messagesPerSecond: number;
    uptime: number;
    clusterState: ClusterState;
  }>;

  // ============================================================================
  // SUBSCRIPTION UTILITIES - Pure Actor Pattern
  // ============================================================================

  /**
   * Subscribe an actor to events from a publisher actor using pure actor messaging
   *
   * This maintains pure actor model compliance by sending SUBSCRIBE messages internally.
   * Despite the name "subscribe", this is purely message-based communication.
   *
   * @param publisher - The actor that emits events
   * @param options - Subscription configuration
   * @param options.subscriber - The actor that should receive events
   * @param options.events - Optional array of event types to subscribe to (defaults to all)
   * @returns Promise that resolves to an unsubscribe function
   *
   * @example
   * ```typescript
   * const counter = await system.spawn(counterBehavior);
   * const logger = await system.spawn(loggerBehavior);
   *
   * // Subscribe logger to counter events
   * const unsubscribe = await system.subscribe(counter, {
   *   subscriber: logger,
   *   events: ['COUNT_INCREMENTED', 'COUNT_DECREMENTED']
   * });
   *
   * // Later: unsubscribe
   * await unsubscribe();
   * ```
   */
  subscribe<TEventType extends string = string>(
    publisher: ActorRef,
    options: {
      subscriber: ActorRef;
      events?: TEventType[];
    }
  ): Promise<() => Promise<void>>;

  /**
   * Spawn an event collector actor for testing purposes
   *
   * Event collectors use pure actor patterns to collect events via message passing.
   * They respond to control messages (GET_EVENTS, CLEAR_EVENTS, START/STOP_COLLECTING)
   * and collect all other messages as events.
   *
   * @param options - Collector configuration
   * @param options.id - Optional ID for the collector actor
   * @param options.autoStart - Whether to start collecting immediately (default: true)
   * @returns Promise resolving to the collector actor PID
   *
   * @example
   * ```typescript
   * const collector = await system.spawnEventCollector({ id: 'test-collector' });
   *
   * // Subscribe collector to events
   * await system.subscribe(publisher, { subscriber: collector });
   *
   * // Get collected events using ask pattern
   * const result = await collector.ask({ type: 'GET_EVENTS' });
   * log.debug('Collected events:', result.events);
   * ```
   */
  spawnEventCollector(options?: { id?: string; autoStart?: boolean }): Promise<ActorRef>;

  // ============================================================================
  // TEST SYNCHRONIZATION UTILITIES
  // ============================================================================

  /**
   * Enable synchronous test mode where messages are processed immediately
   * Similar to Akka's CallingThreadDispatcher
   *
   * When enabled:
   * - Messages are processed synchronously in the calling thread
   * - No setImmediate delays between enqueue and processing
   * - Makes tests deterministic without timing dependencies
   *
   * @example
   * ```typescript
   * system.enableTestMode();
   * await counter.send({ type: 'INCREMENT' });
   * // Message is already processed, no need to wait
   * const state = await counter.ask({ type: 'GET_STATE' });
   * ```
   */
  enableTestMode(): void;

  /**
   * Disable synchronous test mode and return to normal async processing
   */
  disableTestMode(): void;

  /**
   * Check if test mode is currently enabled
   */
  isTestMode(): boolean;

  /**
   * Flush all pending messages in all mailboxes until system is idle
   * Useful for test synchronization when not using test mode
   *
   * Processes messages round-robin across all actors to maintain fairness.
   * Includes safeguards against infinite loops from self-sending actors.
   *
   * @param options Configuration for flush operation
   * @param options.timeout Maximum time to wait for idle state (default: 5000ms)
   * @param options.maxRounds Maximum processing rounds to prevent infinite loops (default: 1000)
   * @returns Promise that resolves when all messages are processed
   * @throws Error if timeout is exceeded or max rounds is reached
   *
   * @example
   * ```typescript
   * await counter.send({ type: 'INCREMENT' });
   * await system.flush(); // Wait for all messages to be processed
   * const events = await collector.ask({ type: 'GET_EVENTS' });
   * ```
   */
  flush(options?: { timeout?: number; maxRounds?: number }): Promise<void>;

  // ============================================================================
  // CLUSTER OPERATIONS
  // ============================================================================

  /**
   * Join a cluster of nodes
   */
  join(nodes: string[]): Promise<void>;

  /**
   * Leave the cluster
   */
  leave(): Promise<void>;

  /**
   * Get current cluster state
   */
  getClusterState(): ClusterState;

  /**
   * Subscribe to cluster events
   * @param listener - Function to call when cluster events occur
   * @returns Unsubscribe function to stop receiving events
   */
  subscribeToClusterEvents(
    listener: (event: { type: 'node-up' | 'node-down' | 'leader-changed'; node: string }) => void
  ): () => void;

  /**
   * Register a shutdown handler to be called when the system stops
   */
  onShutdown(handler: () => Promise<void>): void;

  /**
   * Subscribe to system lifecycle events
   * @param listener - Function to call when system events occur
   * @returns Unsubscribe function to stop receiving events
   */
  subscribeToSystemEvents(listener: (event: Message) => void): () => void;

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Start the actor system
   */
  start(): Promise<void>;

  /**
   * Check if the system is running
   */
  isRunning(): boolean;
}

// ============================================================================
// ACTOR DIRECTORY - DISTRIBUTED ACTOR REGISTRY
// ============================================================================

/**
 * Distributed actor directory for actor discovery and routing
 */
export interface ActorDirectory {
  /**
   * Register an actor in the directory
   */
  register(address: ActorAddress, location: string): Promise<void>;

  /**
   * Unregister an actor from the directory
   */
  unregister(address: ActorAddress): Promise<void>;

  /**
   * Lookup an actor's location
   */
  lookup(address: ActorAddress): Promise<string | undefined>;

  /**
   * List all actors of a given type
   */
  listByType(type: string): Promise<ActorAddress[]>;

  /**
   * Get all registered actors
   * Returns a Map with string keys (actor paths) instead of ActorAddress objects
   * to avoid reference comparison issues
   */
  getAll(): Promise<Map<string, string>>;

  /**
   * Subscribe to directory changes
   * @param listener - Function to call when directory changes occur
   * @returns Unsubscribe function to stop receiving events
   */
  subscribeToChanges(
    listener: (event: {
      type: 'registered' | 'unregistered' | 'updated';
      address: ActorAddress;
      location?: string;
    }) => void
  ): () => void;
}

// ============================================================================
// MESSAGE TRANSPORT - NETWORK COMMUNICATION
// ============================================================================

/**
 * Message transport for network communication between nodes
 */
export interface MessageTransport {
  /**
   * Send a message to a remote node
   */
  send(destination: string, message: ActorMessage): Promise<void>;

  /**
   * Subscribe to incoming messages
   * @param listener - Function to call when messages are received
   * @returns Unsubscribe function to stop receiving messages
   */
  subscribe(listener: (event: { source: string; message: ActorMessage }) => void): () => void;

  /**
   * Connect to a remote node
   */
  connect(address: string): Promise<void>;

  /**
   * Disconnect from a remote node
   */
  disconnect(address: string): Promise<void>;

  /**
   * Get connected nodes
   */
  getConnectedNodes(): string[];

  /**
   * Check if connected to a node
   */
  isConnected(address: string): boolean;
}

// ============================================================================
// ACTOR SUPERVISOR - FAULT TOLERANCE
// ============================================================================

/**
 * Actor supervisor for fault tolerance
 */
export interface ActorSupervisor {
  /**
   * Supervise an actor
   */
  supervise(ref: ActorRef, strategy: SupervisionStrategy): void;

  /**
   * Handle actor failure
   */
  onActorFailure(ref: ActorRef, error: Error): Promise<void>;

  /**
   * Get supervision tree
   */
  getSupervisionTree(): Promise<
    {
      supervisor: ActorRef;
      children: ActorRef[];
    }[]
  >;

  /**
   * Stop supervision of an actor
   */
  stopSupervision(ref: ActorRef): void;
}

// ============================================================================
// UTILITIES
// ============================================================================

// createActorMessage moved to utils/factories.ts

// createActorAddress moved to utils/factories.ts

/**
 * Parse an actor path into an address
 */
export function parseActorPath(path: string): ActorAddress {
  const match = path.match(/^actor:\/\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid actor path: ${path}`);
  }

  const [, node, type, id] = match;
  return createActorAddress(id, type, node === 'local' ? undefined : node);
}

/**
 * Check if an address is local
 */
export function isLocalAddress(address: ActorAddress): boolean {
  return !address.node || address.node === 'local';
}

// generateActorId moved to utils/factories.ts
