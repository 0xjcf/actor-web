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

import type { Actor, AnyStateMachine } from 'xstate';
import type { MessageUnion } from './types.js';

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

/**
 * Strict type-safe message input that constrains message types exactly
 * T extends MessageMap - the actor's message-to-response mapping
 * K extends keyof T - ONLY valid message types are allowed
 */
export type TypeSafeMessageInput<T extends MessageMap, K extends keyof T = keyof T> = {
  readonly type: K; // This constrains to ONLY valid message types
  readonly payload?: JsonValue;
  readonly correlationId?: string;
  readonly timestamp?: number;
  readonly version?: string;
};

/**
 * Enhanced TypeSafeActor interface providing IMMEDIATE type validation
 * at call sites when invalid message types are used.
 *
 * ✅ FIXED: Uses discriminated union approach instead of broken conditional types
 *
 * This interface now provides true immediate type validation by using our
 * MessageUnion<T> utility that creates a discriminated union of all valid
 * message objects. TypeScript will show errors immediately when invalid
 * message types are used, not when accessing response properties.
 *
 * @example Valid Usage:
 * ```typescript
 * interface UserMessages extends MessageMap {
 *   'GET_USER': { id: string; name: string };
 *   'UPDATE_USER': { success: boolean };
 * }
 *
 * const actor = asTypeSafeActor<UserMessages>(regularActor);
 *
 * // ✅ Valid - TypeScript accepts this
 * const user = await actor.ask({ type: 'GET_USER' });
 * console.log(user.name); // TypeScript knows this is string
 *
 * // ❌ Invalid - TypeScript shows IMMEDIATE error at call site
 * const invalid = await actor.ask({ type: 'INVALID_TYPE' }); // Error here!
 * ```
 *
 * @template T - MessageMap interface defining valid message types and responses
 */
export interface TypeSafeActor<T extends MessageMap> {
  /**
   * Send a message to the actor (fire-and-forget)
   *
   * Uses discriminated union constraint for immediate type validation.
   * Invalid message types will cause TypeScript errors at the call site.
   *
   * @param message - Valid message object matching MessageUnion<T>
   */
  send(message: MessageUnion<T>): void;

  /**
   * Ask the actor a question and get a typed response
   *
   * Uses discriminated union constraint with mapped return type.
   * - Immediate validation: Invalid message types cause compile errors
   * - Precise returns: Response type is T[MessageType] not Promise<unknown>
   *
   * @param message - Valid message object with specific type
   * @returns Promise resolving to the response type for that message
   */
  ask<K extends keyof T>(message: MessageUnion<T> & { type: K }): Promise<T[K]>;

  /**
   * Start the actor
   */
  start(): void;

  /**
   * Stop the actor
   */
  stop(): Promise<void>;

  /**
   * Subscribe to actor events
   */
  subscribe(eventType: string, handler: (event: ActorMessage) => void): () => void;
}

/**
 * Type-safe actor creation function signature
 */
export type CreateTypeSafeActor<T extends MessageMap> = (...args: unknown[]) => TypeSafeActor<T>;

// ============================================================================
// EXISTING INTERFACES (Updated for compatibility)
// ============================================================================

/**
 * JSON-serializable value type for message payloads
 */
export type JsonValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

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
  readonly machine: unknown; // Actor<AnyStateMachine> - avoiding circular dependency
  readonly emit: (event: unknown) => void;
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
 * Standard actor message interface
 * All communication between actors uses this format
 */
export interface ActorMessage {
  readonly type: string;
  readonly payload: JsonValue | null;
  readonly sender?: ActorAddress;
  readonly correlationId?: string;
  readonly timestamp: number;
  readonly version: string;
}

/**
 * Basic message structure for general actor communication
 * Use StrictMessageInput<T> for type-safe actors with specific message maps
 */
export interface BasicMessage {
  readonly type: string;
  readonly payload?: JsonValue;
  readonly correlationId?: string;
  readonly timestamp?: number;
  readonly version?: string;
}

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
  onFailure(error: Error, actor: ActorPID): SupervisionDirective;
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
   * Message handler - pure function that processes messages and returns communication plans
   *
   * @param params.message - The incoming message to process
   * @param params.machine - XState machine actor for state access and transitions
   * @param params.dependencies - Injected dependencies (actor system, correlation manager, etc.)
   * @returns MessagePlan describing communication intentions, or void for no action
   */
  readonly onMessage: (params: {
    readonly message: TMessage;
    readonly machine: Actor<AnyStateMachine>;
    readonly dependencies: ActorDependencies;
  }) => MessagePlan<TEmitted> | Promise<MessagePlan<TEmitted>> | void | Promise<void>;

  /**
   * Optional lifecycle hook - actor start
   * Called when the actor is first started
   */
  readonly onStart?: (params: {
    readonly machine: Actor<AnyStateMachine>;
    readonly dependencies: ActorDependencies;
  }) => MessagePlan<TEmitted> | Promise<MessagePlan<TEmitted>> | void | Promise<void>;

  /**
   * Optional lifecycle hook - actor stop
   * Called when the actor is being stopped
   */
  readonly onStop?: (params: {
    readonly machine: Actor<AnyStateMachine>;
    readonly dependencies: ActorDependencies;
  }) => Promise<void> | void;

  /**
   * Supervision strategy for fault tolerance
   */
  readonly supervisionStrategy?: SupervisionStrategy;
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
// ACTOR PID - LOCATION TRANSPARENT ACTOR REFERENCE
// ============================================================================

/**
 * Location-transparent actor reference (Process ID)
 *
 * This is the core abstraction that enables location transparency. An ActorPID
 * works the same way whether the actor is local or remote, following the
 * principle that actors communicate only through message passing.
 */
export interface ActorPID {
  readonly address: ActorAddress;

  /**
   * Send a message to the actor (fire-and-forget)
   */
  send(message: BasicMessage): Promise<void>;

  /**
   * Ask the actor a question and wait for a response
   */
  ask<T = JsonValue>(message: BasicMessage, timeout?: number): Promise<T>;

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

  /**
   * Subscribe to specific event types emitted by this actor
   * @param eventType - The event type to subscribe to (supports wildcards like 'user.*')
   * @param listener - Function to call when matching events are emitted
   * @returns Unsubscribe function to stop receiving events
   */
  subscribe(eventType: string, listener: (event: ActorMessage) => void): () => void;
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
   */
  spawn<TMessage = ActorMessage, TEmitted = ActorMessage>(
    behavior: ActorBehavior<TMessage, TEmitted>,
    options?: SpawnOptions
  ): Promise<ActorPID>;

  /**
   * Look up an actor by its path
   */
  lookup(path: string): Promise<ActorPID | undefined>;

  /**
   * Stop an actor
   */
  stop(pid: ActorPID): Promise<void>;
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
  subscribeToSystemEvents(
    listener: (event: { type: string; [key: string]: unknown }) => void
  ): () => void;

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
  supervise(pid: ActorPID, strategy: SupervisionStrategy): void;

  /**
   * Handle actor failure
   */
  onActorFailure(pid: ActorPID, error: Error): Promise<void>;

  /**
   * Get supervision tree
   */
  getSupervisionTree(): Promise<
    {
      supervisor: ActorPID;
      children: ActorPID[];
    }[]
  >;

  /**
   * Stop supervision of an actor
   */
  stopSupervision(pid: ActorPID): void;
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Create an actor message
 */
export function createActorMessage(
  type: string,
  payload: JsonValue,
  sender?: ActorAddress,
  correlationId?: string
): ActorMessage {
  return {
    type,
    payload,
    sender,
    correlationId,
    timestamp: Date.now(),
    version: '1.0.0',
  };
}

/**
 * Convert BasicMessage to ActorMessage with defaults
 */
export function normalizeMessage(input: BasicMessage): ActorMessage {
  return {
    type: input.type,
    payload: input.payload ?? null,
    correlationId: input.correlationId,
    timestamp: input.timestamp ?? Date.now(),
    version: input.version ?? '1.0.0',
  };
}

/**
 * Create an actor address
 */
export function createActorAddress(id: string, type: string, node?: string): ActorAddress {
  const path = node ? `actor://${node}/${type}/${id}` : `actor://local/${type}/${id}`;
  return {
    id,
    type,
    node,
    path,
  };
}

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

/**
 * Generate a unique actor ID
 */
export function generateActorId(prefix = 'actor'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 11);
  return `${prefix}-${timestamp}-${random}`;
}
