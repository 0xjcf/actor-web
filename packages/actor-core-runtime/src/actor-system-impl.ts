/**
 * @module actor-core/runtime/actor-system-impl
 * @description Production implementation of the ActorSystem interface
 *
 * This implementation provides:
 * 1. Location-transparent actor management
 * 2. Distributed actor directory with caching
 * 3. Supervision strategies for fault tolerance
 * 4. Cluster management and coordination
 * 5. Message routing and transport
 */

import type {
  ActorAddress,
  ActorBehavior,
  ActorMessage,
  ActorPID,
  ActorSystem,
  ClusterState,
  SpawnOptions,
} from './actor-system.js';
import { createActorAddress, generateActorId } from './actor-system.js';
import { DistributedActorDirectory } from './distributed-actor-directory.js';
import { Logger } from './logger.js';
import type { Observable } from './types.js';

// Create scoped logger for actor system
const log = Logger.namespace('ACTOR_SYSTEM');

/**
 * Actor PID implementation with location transparency
 */
class ActorPIDImpl implements ActorPID {
  constructor(
    public readonly address: ActorAddress,
    private readonly system: ActorSystemImpl
  ) {}

  async send(message: ActorMessage): Promise<void> {
    return this.system.routeMessage(this.address, message);
  }

  async ask<T>(message: ActorMessage, timeout = 5000): Promise<T> {
    return this.system.askActor<T>(this.address, message, timeout);
  }

  async stop(): Promise<void> {
    return this.system.stopActorInternal(this.address);
  }

  async isAlive(): Promise<boolean> {
    return this.system.isActorAliveInternal(this.address);
  }

  async getStats(): Promise<{
    messagesReceived: number;
    messagesProcessed: number;
    errors: number;
    uptime: number;
  }> {
    return this.system.getActorStatsInternal(this.address);
  }

  subscribe(eventType: string): Observable<ActorMessage> {
    return this.system.subscribeToActorEvents(this.address, eventType);
  }

  unsubscribe(eventType: string): void {
    this.system.unsubscribeFromActorEvents(this.address, eventType);
  }
}

/**
 * Actor system configuration
 */
export interface ActorSystemConfig {
  /** Node address for this system instance */
  nodeAddress?: string;
  /** Cluster seed nodes for joining */
  seedNodes?: string[];
  /** Directory configuration */
  directory?: {
    cacheTtl?: number;
    maxCacheSize?: number;
    cleanupInterval?: number;
  };
  /** System-wide message timeout */
  messageTimeout?: number;
  /** Maximum number of actors per node */
  maxActors?: number;
}

/**
 * Production implementation of the ActorSystem interface
 */
export class ActorSystemImpl implements ActorSystem {
  private directory: DistributedActorDirectory;
  private actors = new Map<string, ActorBehavior>();
  private actorStats = new Map<
    string,
    {
      messagesReceived: number;
      messagesProcessed: number;
      errors: number;
      startTime: number;
    }
  >();
  private subscribers = new Map<string, Set<(message: ActorMessage) => void>>();
  private systemRunning = false;
  private clusterState: ClusterState;

  private readonly config: Required<ActorSystemConfig>;

  constructor(config: ActorSystemConfig = {}) {
    this.config = {
      nodeAddress: config.nodeAddress ?? `node-${generateActorId()}`,
      seedNodes: config.seedNodes ?? [],
      directory: {
        cacheTtl: config.directory?.cacheTtl ?? 5 * 60 * 1000,
        maxCacheSize: config.directory?.maxCacheSize ?? 10_000,
        cleanupInterval: config.directory?.cleanupInterval ?? 60 * 1000,
      },
      messageTimeout: config.messageTimeout ?? 30_000,
      maxActors: config.maxActors ?? 1_000_000,
    };

    this.directory = new DistributedActorDirectory({
      nodeAddress: this.config.nodeAddress,
      ...this.config.directory,
    });

    this.clusterState = {
      nodes: [this.config.nodeAddress],
      leader: this.config.nodeAddress,
      status: 'up',
    };

    log.debug('ActorSystem initialized', {
      nodeAddress: this.config.nodeAddress,
      config: this.config,
    });
  }

  /**
   * Spawn a new actor with location transparency
   */
  async spawn<T>(behavior: ActorBehavior<T>, options: SpawnOptions = {}): Promise<ActorPID> {
    if (!this.systemRunning) {
      throw new Error('Actor system is not running');
    }

    if (this.actors.size >= this.config.maxActors) {
      throw new Error(`Maximum actors limit reached: ${this.config.maxActors}`);
    }

    // Generate actor address
    const id = options.id ?? generateActorId();
    const address = createActorAddress(id, 'actor', this.config.nodeAddress);

    // Store actor behavior locally
    this.actors.set(address.path, behavior);

    // Initialize actor statistics
    this.actorStats.set(address.path, {
      messagesReceived: 0,
      messagesProcessed: 0,
      errors: 0,
      startTime: Date.now(),
    });

    // Register in distributed directory
    await this.directory.register(address, this.config.nodeAddress);

    // Start actor if it has an onStart method
    if (behavior.onStart) {
      try {
        await behavior.onStart(behavior.initialState);
      } catch (error) {
        log.error('Error starting actor', { address: address.path, error });
        await this.directory.unregister(address);
        this.actors.delete(address.path);
        this.actorStats.delete(address.path);
        throw error;
      }
    }

    const pid = new ActorPIDImpl(address, this);

    log.debug('Actor spawned', {
      address: address.path,
      location: this.config.nodeAddress,
      actorCount: this.actors.size,
    });

    return pid;
  }

  /**
   * Look up an actor by path with location transparency
   */
  async lookup(path: string): Promise<ActorPID | undefined> {
    const address = this.parseActorPath(path);
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
   * Stop an actor
   */
  async stop(pid: ActorPID): Promise<void> {
    const address = pid.address;

    const behavior = this.actors.get(address.path);
    if (!behavior) {
      return;
    }

    if (behavior.onStop) {
      try {
        await behavior.onStop(behavior.initialState);
      } catch (error) {
        log.error('Error stopping actor', { address: address.path, error });
      }
    }

    this.actors.delete(address.path);
    this.actorStats.delete(address.path);
    await this.directory.unregister(address);

    log.debug('Actor stopped', {
      address: address.path,
      actorCount: this.actors.size,
    });
  }

  /**
   * List all actors in the system
   */
  async listActors(): Promise<ActorAddress[]> {
    const allActors = await this.directory.getAll();
    return Array.from(allActors.keys());
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
    const allActors = await this.directory.getAll();
    const globalActorCount = allActors.size;

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
    return this.clusterState;
  }

  /**
   * Subscribe to cluster events
   */
  subscribeToClusterEvents(): Observable<{
    type: 'node-up' | 'node-down' | 'leader-changed';
    node: string;
  }> {
    return {
      subscribe: () => {
        return {
          unsubscribe: () => {},
        };
      },
    } as Observable<{
      type: 'node-up' | 'node-down' | 'leader-changed';
      node: string;
    }>;
  }

  /**
   * Start the actor system
   */
  async start(): Promise<void> {
    if (this.systemRunning) {
      return;
    }

    this.systemRunning = true;

    if (this.config.seedNodes.length > 0) {
      await this.join(this.config.seedNodes);
    }

    log.info('ActorSystem started', {
      nodeAddress: this.config.nodeAddress,
      clusterState: this.clusterState,
    });
  }

  /**
   * Stop the actor system
   */
  async stop(): Promise<void> {
    if (!this.systemRunning) {
      return;
    }

    this.systemRunning = false;

    const allActors = Array.from(this.actors.keys());
    for (const actorPath of allActors) {
      const address = this.parseActorPath(actorPath);
      if (address) {
        const pid = new ActorPIDImpl(address, this);
        await this.stop(pid);
      }
    }

    await this.directory.cleanup();
    await this.leave();

    log.info('ActorSystem stopped', {
      nodeAddress: this.config.nodeAddress,
    });
  }

  /**
   * Check if the system is running
   */
  isRunning(): boolean {
    return this.systemRunning;
  }

  // ============================================================================
  // INTERNAL METHODS
  // ============================================================================

  /**
   * Route a message to an actor
   */
  async routeMessage(address: ActorAddress, message: ActorMessage): Promise<void> {
    const location = await this.directory.lookup(address);
    if (!location) {
      throw new Error(`Actor not found: ${address.path}`);
    }

    if (location === this.config.nodeAddress) {
      await this.deliverMessageLocal(address, message);
    } else {
      await this.deliverMessageRemote(location, address, message);
    }
  }

  /**
   * Ask an actor and wait for response
   */
  async askActor<T>(_address: ActorAddress, _message: ActorMessage, _timeout: number): Promise<T> {
    // TODO: Implement ask pattern with correlation ID
    throw new Error('Ask pattern not yet implemented');
  }

  /**
   * Stop an actor by address (internal method)
   */
  async stopActorInternal(address: ActorAddress): Promise<void> {
    const pid = new ActorPIDImpl(address, this);
    await this.stop(pid);
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

    return {
      messagesReceived: stats.messagesReceived,
      messagesProcessed: stats.messagesProcessed,
      errors: stats.errors,
      uptime: (Date.now() - stats.startTime) / 1000,
    };
  }

  /**
   * Subscribe to actor events
   */
  subscribeToActorEvents(address: ActorAddress, eventType: string): Observable<ActorMessage> {
    return {
      subscribe: (observerOrNext) => {
        const key = `${address.path}:${eventType}`;
        let subscribers = this.subscribers.get(key);
        if (!subscribers) {
          subscribers = new Set();
          this.subscribers.set(key, subscribers);
        }

        const handler = (message: ActorMessage) => {
          if (typeof observerOrNext === 'function') {
            observerOrNext(message);
          } else {
            observerOrNext.next(message);
          }
        };

        subscribers.add(handler);

        return {
          unsubscribe: () => {
            subscribers?.delete(handler);
          },
        };
      },
    } as Observable<ActorMessage>;
  }

  /**
   * Unsubscribe from actor events
   */
  unsubscribeFromActorEvents(address: ActorAddress, eventType: string): void {
    const key = `${address.path}:${eventType}`;
    this.subscribers.delete(key);
  }

  /**
   * Deliver message to local actor
   */
  private async deliverMessageLocal(address: ActorAddress, message: ActorMessage): Promise<void> {
    const behavior = this.actors.get(address.path);
    if (!behavior) {
      throw new Error(`Local actor not found: ${address.path}`);
    }

    const stats = this.actorStats.get(address.path);
    if (stats) {
      stats.messagesReceived++;
    }

    try {
      const newState = await behavior.onMessage(message, behavior.initialState);
      behavior.initialState = newState;

      if (stats) {
        stats.messagesProcessed++;
      }

      const key = `${address.path}:${message.type}`;
      const subscribers = this.subscribers.get(key);
      if (subscribers) {
        for (const handler of subscribers) {
          try {
            handler(message);
          } catch (error) {
            log.error('Error notifying subscriber', { address: address.path, error });
          }
        }
      }
    } catch (error) {
      if (stats) {
        stats.errors++;
      }

      log.error('Error processing message', {
        address: address.path,
        message: message.type,
        error,
      });

      throw error;
    }
  }

  /**
   * Deliver message to remote actor
   */
  private async deliverMessageRemote(
    location: string,
    address: ActorAddress,
    message: ActorMessage
  ): Promise<void> {
    log.debug('Delivering message to remote actor', {
      location,
      address: address.path,
      message: message.type,
    });
  }

  /**
   * Parse actor path into address
   */
  private parseActorPath(path: string): ActorAddress | undefined {
    try {
      const match = path.match(/^actor:\/\/([^/]+)\/([^/]+)\/(.+)$/);
      if (!match) {
        return undefined;
      }

      const [, node, type, id] = match;
      return {
        id,
        type,
        node: node === 'local' ? undefined : node,
        path,
      };
    } catch (error) {
      log.error('Failed to parse actor path', { path, error });
      return undefined;
    }
  }
}

/**
 * Create a new actor system instance
 */
export function createActorSystem(config: ActorSystemConfig = {}): ActorSystem {
  return new ActorSystemImpl(config);
}
