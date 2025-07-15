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

import type { Observable } from './types.js';

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * JSON-serializable value type for message payloads
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

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
 * Serializable message for actor communication
 */
export interface ActorMessage {
  readonly type: string;
  readonly payload: JsonValue;
  readonly sender?: ActorAddress;
  readonly correlationId?: string;
  readonly timestamp: number;
  readonly version: string;
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
 * Actor behavior definition
 */
export interface ActorBehavior<TMessage = ActorMessage, TState = unknown> {
  initialState?: TState;
  onMessage(message: TMessage, state: TState): Promise<TState>;
  onStart?(state: TState): Promise<TState>;
  onStop?(state: TState): Promise<void>;
  supervisionStrategy?: SupervisionStrategy;
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
  send(message: ActorMessage): Promise<void>;

  /**
   * Ask the actor a question and wait for a response
   */
  ask<T = JsonValue>(message: ActorMessage, timeout?: number): Promise<T>;

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
   * Subscribe to actor events
   */
  subscribe(eventType: string): Observable<ActorMessage>;

  /**
   * Unsubscribe from actor events
   */
  unsubscribe(eventType: string): void;
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
   * Spawn a new actor with the given behavior
   */
  spawn<T>(behavior: ActorBehavior<T>, options?: SpawnOptions): Promise<ActorPID>;

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
   */
  subscribeToClusterEvents(): Observable<{
    type: 'node-up' | 'node-down' | 'leader-changed';
    node: string;
  }>;

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
   */
  subscribeToChanges(): Observable<{
    type: 'registered' | 'unregistered' | 'updated';
    address: ActorAddress;
    location?: string;
  }>;
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
   */
  subscribe(): Observable<{ source: string; message: ActorMessage }>;

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
  const random = Math.random().toString(36).substr(2, 9);
  return `${prefix}-${timestamp}-${random}`;
}
