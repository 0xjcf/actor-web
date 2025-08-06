/**
 * @module actor-core/runtime/virtual-actor-system
 * @description Virtual actor system with Orleans-style caching for location transparency
 */

import type { AnyStateMachine } from 'xstate';
import type { ActorRef } from './actor-ref.js';
import { createActorRef } from './create-actor-ref.js';
import { Logger } from './logger.js';
import { createActorInterval } from './pure-xstate-utilities.js';
import type { ActorRefOptions, BaseEventObject } from './types.js';

// ========================================================================================
// VIRTUAL ACTOR SYSTEM INTERFACES
// ========================================================================================

/**
 * Virtual actor identifier that provides location transparency
 */
export interface VirtualActorId {
  readonly type: string;
  readonly id: string;
  readonly partition?: string;
}

/**
 * Virtual actor entry in the directory
 */
export interface VirtualActorEntry {
  readonly virtualId: VirtualActorId;
  readonly physicalRef: ActorRef<unknown>;
  readonly node: string;
  readonly lastAccessed: number;
  readonly activationCount: number;
  readonly isActive: boolean;
}

/**
 * Actor placement strategy for distributing actors across nodes
 */
export interface ActorPlacementStrategy {
  /**
   * Determine which node should host the actor
   */
  selectNode(virtualId: VirtualActorId, availableNodes: string[]): string;

  /**
   * Check if actor should be migrated to a different node
   */
  shouldMigrate(entry: VirtualActorEntry, nodeMetrics: NodeMetrics): boolean;
}

/**
 * Node metrics for placement decisions
 */
export interface NodeMetrics {
  readonly nodeId: string;
  readonly cpuUsage: number;
  readonly memoryUsage: number;
  readonly actorCount: number;
  readonly networkLatency: number;
  readonly isHealthy: boolean;
}

/**
 * Virtual actor system configuration
 */
export interface VirtualActorSystemConfig {
  readonly nodeId: string;
  readonly cacheSize: number;
  readonly evictionPolicy: 'lru' | 'lfu' | 'ttl';
  readonly maxIdleTime: number;
  readonly placementStrategy: ActorPlacementStrategy;
  readonly enableMigration: boolean;
  readonly healthCheckInterval: number;
}

// ========================================================================================
// ORLEANS-STYLE ACTOR DIRECTORY
// ========================================================================================

/**
 * LRU Cache implementation for actor directory
 */
class LRUCache<K, V> {
  private capacity: number;
  private cache = new Map<K, V>();
  private accessOrder: K[] = [];

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
      this.accessOrder.push(key);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // Update existing
      this.cache.set(key, value);
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
      this.accessOrder.push(key);
    } else {
      // Add new
      if (this.cache.size >= this.capacity) {
        // Evict least recently used
        const lru = this.accessOrder.shift();
        if (lru) {
          this.cache.delete(lru);
        }
      }
      this.cache.set(key, value);
      this.accessOrder.push(key);
    }
  }

  delete(key: K): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
    }
    return deleted;
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  get size(): number {
    return this.cache.size;
  }

  *entries(): IterableIterator<[K, V]> {
    yield* this.cache.entries();
  }
}

/**
 * Orleans-style actor directory with high-performance caching
 */
export class ActorDirectory {
  private cache: LRUCache<string, VirtualActorEntry>;
  private logger = Logger.namespace('ACTOR_DIRECTORY');
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;

  constructor(private config: VirtualActorSystemConfig) {
    this.cache = new LRUCache(config.cacheSize);
  }

  /**
   * Get actor entry with cache optimization
   */
  get(virtualId: VirtualActorId): VirtualActorEntry | undefined {
    const key = this.getKey(virtualId);
    const entry = this.cache.get(key);

    if (entry) {
      this.hitCount++;
      this.logger.debug('Cache hit', { virtualId, hitRate: this.getHitRate() });

      // Update access time
      const updatedEntry: VirtualActorEntry = {
        ...entry,
        lastAccessed: Date.now(),
        activationCount: entry.activationCount + 1,
      };
      this.cache.set(key, updatedEntry);
      return updatedEntry;
    }
    this.missCount++;
    this.logger.debug('Cache miss', { virtualId, hitRate: this.getHitRate() });
    return undefined;
  }

  /**
   * Add or update actor entry
   */
  set(entry: VirtualActorEntry): void {
    const key = this.getKey(entry.virtualId);
    const existing = this.cache.get(key);

    if (!existing) {
      this.logger.debug('Adding new actor to directory', { virtualId: entry.virtualId });
    }

    this.cache.set(key, entry);
  }

  /**
   * Remove actor from directory
   */
  delete(virtualId: VirtualActorId): boolean {
    const key = this.getKey(virtualId);
    const deleted = this.cache.delete(key);

    if (deleted) {
      this.evictionCount++;
      this.logger.debug('Removed actor from directory', { virtualId });
    }

    return deleted;
  }

  /**
   * Get all entries for a node
   */
  getByNode(nodeId: string): VirtualActorEntry[] {
    const entries: VirtualActorEntry[] = [];
    for (const [, entry] of this.cache.entries()) {
      if (entry.node === nodeId) {
        entries.push(entry);
      }
    }
    return entries;
  }

  /**
   * Get all entries for an actor type
   */
  getByType(actorType: string): VirtualActorEntry[] {
    const entries: VirtualActorEntry[] = [];
    for (const [, entry] of this.cache.entries()) {
      if (entry.virtualId.type === actorType) {
        entries.push(entry);
      }
    }
    return entries;
  }

  /**
   * Clean up inactive actors
   */
  cleanup(): void {
    const now = Date.now();
    const toRemove: VirtualActorId[] = [];

    for (const [, entry] of this.cache.entries()) {
      if (now - entry.lastAccessed > this.config.maxIdleTime) {
        toRemove.push(entry.virtualId);
      }
    }

    for (const virtualId of toRemove) {
      this.delete(virtualId);
    }

    if (toRemove.length > 0) {
      this.logger.debug('Cleaned up inactive actors', { count: toRemove.length });
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.hitCount + this.missCount;
    return {
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: total > 0 ? (this.hitCount / total) * 100 : 0,
      evictionCount: this.evictionCount,
      cacheSize: this.cache.size,
      maxCacheSize: this.config.cacheSize,
    };
  }

  /**
   * Get all entries in the cache
   */
  getAllEntries(): VirtualActorEntry[] {
    const entries: VirtualActorEntry[] = [];
    for (const [, entry] of this.cache.entries()) {
      entries.push(entry);
    }
    return entries;
  }

  private getKey(virtualId: VirtualActorId): string {
    return `${virtualId.type}:${virtualId.id}${virtualId.partition ? `:${virtualId.partition}` : ''}`;
  }

  private getHitRate(): number {
    const total = this.hitCount + this.missCount;
    return total > 0 ? (this.hitCount / total) * 100 : 0;
  }
}

// ========================================================================================
// PLACEMENT STRATEGIES
// ========================================================================================

/**
 * Round-robin placement strategy
 */
export class RoundRobinPlacementStrategy implements ActorPlacementStrategy {
  private currentIndex = 0;

  selectNode(_virtualId: VirtualActorId, availableNodes: string[]): string {
    if (availableNodes.length === 0) {
      throw new Error('No available nodes for actor placement');
    }

    const node = availableNodes[this.currentIndex % availableNodes.length];
    this.currentIndex++;
    return node;
  }

  shouldMigrate(_entry: VirtualActorEntry, nodeMetrics: NodeMetrics): boolean {
    // Simple strategy: migrate if node is unhealthy or overloaded
    return !nodeMetrics.isHealthy || nodeMetrics.cpuUsage > 80 || nodeMetrics.memoryUsage > 80;
  }
}

/**
 * Consistent hashing placement strategy
 */
export class ConsistentHashPlacementStrategy implements ActorPlacementStrategy {
  selectNode(virtualId: VirtualActorId, availableNodes: string[]): string {
    if (availableNodes.length === 0) {
      throw new Error('No available nodes for actor placement');
    }

    // Simple hash function (in production, use proper consistent hashing)
    const key = `${virtualId.type}:${virtualId.id}`;
    const hash = this.hash(key);
    const index = Math.abs(hash) % availableNodes.length;
    return availableNodes[index];
  }

  shouldMigrate(_entry: VirtualActorEntry, nodeMetrics: NodeMetrics): boolean {
    // More conservative migration policy
    return !nodeMetrics.isHealthy;
  }

  private hash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }
}

/**
 * Load-aware placement strategy
 */
export class LoadAwarePlacementStrategy implements ActorPlacementStrategy {
  selectNode(_virtualId: VirtualActorId, availableNodes: string[]): string {
    if (availableNodes.length === 0) {
      throw new Error('No available nodes for actor placement');
    }

    // In a real implementation, this would select the least loaded node
    // For now, return the first available node
    return availableNodes[0];
  }

  shouldMigrate(_entry: VirtualActorEntry, nodeMetrics: NodeMetrics): boolean {
    // Migrate if node is overloaded
    return (
      !nodeMetrics.isHealthy ||
      nodeMetrics.cpuUsage > 70 ||
      nodeMetrics.memoryUsage > 70 ||
      nodeMetrics.actorCount > 1000
    );
  }
}

// ========================================================================================
// VIRTUAL ACTOR SYSTEM
// ========================================================================================

/**
 * Virtual actor system providing location transparency
 */
export class VirtualActorSystem {
  private directory: ActorDirectory;
  private machines = new Map<string, AnyStateMachine>();
  private logger = Logger.namespace('VIRTUAL_ACTOR_SYSTEM');
  private cleanupStopFn: (() => void) | null = null; // XState interval stop function
  private availableNodes: string[] = [];

  constructor(private config: VirtualActorSystemConfig) {
    this.directory = new ActorDirectory(config);
    this.availableNodes = [config.nodeId]; // Start with current node

    // Set up periodic cleanup using pure XState
    // ✅ PURE ACTOR MODEL: Use XState interval instead of setInterval
    this.cleanupStopFn = createActorInterval(() => {
      this.directory.cleanup();
    }, config.healthCheckInterval);
  }

  /**
   * Register an actor type with its state machine
   */
  registerActorType(actorType: string, machine: AnyStateMachine): void {
    this.machines.set(actorType, machine);
    this.logger.debug('Registered actor type', { actorType });
  }

  /**
   * Get or create a virtual actor proxy
   */
  getActor<TEvent extends BaseEventObject = BaseEventObject>(
    actorType: string,
    actorId: string,
    partition?: string
  ): ActorRef<TEvent> {
    const virtualId: VirtualActorId = { type: actorType, id: actorId, partition };

    // Check directory first
    const entry = this.directory.get(virtualId);

    if (entry?.isActive) {
      this.logger.debug('Using cached actor', { virtualId });
      return entry.physicalRef as ActorRef<TEvent>;
    }

    // Need to activate the actor
    return this.activateActor<TEvent>(virtualId);
  }

  /**
   * Activate an actor on the selected node
   */
  private activateActor<TEvent extends BaseEventObject>(
    virtualId: VirtualActorId
  ): ActorRef<TEvent> {
    const machine = this.machines.get(virtualId.type);
    if (!machine) {
      throw new Error(`Actor type not registered: ${virtualId.type}`);
    }

    // Select node for placement
    const selectedNode = this.config.placementStrategy.selectNode(virtualId, this.availableNodes);

    // Create physical actor reference
    const options: ActorRefOptions = {
      id: `${virtualId.type}-${virtualId.id}`,
      // Additional options for virtual actors
    };

    const physicalRef = createActorRef(machine, options);

    // Create directory entry
    const entry: VirtualActorEntry = {
      virtualId,
      physicalRef,
      node: selectedNode,
      lastAccessed: Date.now(),
      activationCount: 1,
      isActive: true,
    };

    this.directory.set(entry);

    this.logger.debug('Activated virtual actor', {
      virtualId,
      node: selectedNode,
      stats: this.directory.getStats(),
    });

    return physicalRef as ActorRef<TEvent>;
  }

  /**
   * Deactivate an actor
   */
  async deactivateActor(virtualId: VirtualActorId): Promise<void> {
    const entry = this.directory.get(virtualId);
    if (!entry) {
      return;
    }

    await entry.physicalRef.stop();
    this.directory.delete(virtualId);

    this.logger.debug('Deactivated virtual actor', { virtualId });
  }

  /**
   * Add a node to the cluster
   */
  addNode(nodeId: string): void {
    if (!this.availableNodes.includes(nodeId)) {
      this.availableNodes.push(nodeId);
      this.logger.debug('Added node to cluster', { nodeId, nodeCount: this.availableNodes.length });
    }
  }

  /**
   * Remove a node from the cluster
   */
  removeNode(nodeId: string): void {
    this.availableNodes = this.availableNodes.filter((id) => id !== nodeId);

    // Handle actors on the removed node
    const affectedActors = this.directory.getByNode(nodeId);
    for (const entry of affectedActors) {
      if (this.availableNodes.length > 0) {
        // Migrate to another node
        this.migrateActor(entry, this.availableNodes[0]);
      } else {
        // No nodes available, deactivate
        this.deactivateActor(entry.virtualId);
      }
    }

    this.logger.debug('Removed node from cluster', {
      nodeId,
      affectedActors: affectedActors.length,
      nodeCount: this.availableNodes.length,
    });
  }

  /**
   * Migrate an actor to a different node
   */
  private migrateActor(entry: VirtualActorEntry, targetNode: string): void {
    // In a real implementation, this would involve:
    // 1. Serializing actor state
    // 2. Stopping actor on source node
    // 3. Creating actor on target node
    // 4. Restoring actor state
    // 5. Updating directory

    const migratedEntry: VirtualActorEntry = {
      ...entry,
      node: targetNode,
      lastAccessed: Date.now(),
    };

    this.directory.set(migratedEntry);

    this.logger.debug('Migrated actor', {
      virtualId: entry.virtualId,
      fromNode: entry.node,
      toNode: targetNode,
    });
  }

  /**
   * Get system statistics
   */
  getStats() {
    const directoryStats = this.directory.getStats();
    const nodeStats = this.availableNodes.map((nodeId) => ({
      nodeId,
      actorCount: this.directory.getByNode(nodeId).length,
    }));

    return {
      directory: directoryStats,
      nodes: nodeStats,
      totalNodes: this.availableNodes.length,
      registeredActorTypes: this.machines.size,
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.cleanupStopFn) {
      this.cleanupStopFn();
      this.cleanupStopFn = null;
    }

    // Deactivate all actors
    const allEntries = this.directory.getAllEntries();
    for (const entry of allEntries) {
      await this.deactivateActor(entry.virtualId);
    }

    this.logger.debug('Virtual actor system cleaned up');
  }
}

// ========================================================================================
// FACTORY FUNCTIONS
// ========================================================================================

/**
 * Create a virtual actor system with default configuration
 */
export function createVirtualActorSystem(
  nodeId = 'node-1',
  overrides: Partial<VirtualActorSystemConfig> = {}
): VirtualActorSystem {
  const config: VirtualActorSystemConfig = {
    nodeId,
    cacheSize: 1000,
    evictionPolicy: 'lru',
    maxIdleTime: 5 * 60 * 1000, // 5 minutes
    placementStrategy: new RoundRobinPlacementStrategy(),
    enableMigration: true,
    healthCheckInterval: 30 * 1000, // 30 seconds
    ...overrides,
  };

  return new VirtualActorSystem(config);
}

/**
 * Create a virtual actor system with consistent hashing
 */
export function createConsistentHashVirtualActorSystem(
  nodeId = 'node-1',
  overrides: Partial<VirtualActorSystemConfig> = {}
): VirtualActorSystem {
  return createVirtualActorSystem(nodeId, {
    placementStrategy: new ConsistentHashPlacementStrategy(),
    ...overrides,
  });
}

/**
 * Create a virtual actor system with load-aware placement
 */
export function createLoadAwareVirtualActorSystem(
  nodeId = 'node-1',
  overrides: Partial<VirtualActorSystemConfig> = {}
): VirtualActorSystem {
  return createVirtualActorSystem(nodeId, {
    placementStrategy: new LoadAwarePlacementStrategy(),
    cacheSize: 2000, // Larger cache for load-aware systems
    ...overrides,
  });
}
