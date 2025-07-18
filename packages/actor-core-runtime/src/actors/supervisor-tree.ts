/**
 * @module actor-core/runtime/actors/supervisor-tree
 * @description Hierarchical supervisor trees for fault tolerance
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import type { ActorRef } from '../actor-ref.js';
import { Logger } from '../logger.js';
import type { BaseEventObject, SupervisionStrategy } from '../types.js';
import { Supervisor, type SupervisorOptions } from './supervisor.js';

/**
 * Supervisor tree node configuration
 */
export interface SupervisorTreeNode {
  /**
   * Unique identifier for this supervisor node
   */
  id: string;

  /**
   * Supervision strategy for this node
   */
  strategy: SupervisionStrategy;

  /**
   * Child supervisors under this node
   */
  children?: SupervisorTreeNode[];

  /**
   * Supervisor options for this node
   */
  options?: Partial<SupervisorOptions>;

  /**
   * Actors directly supervised by this node
   */
  actors?: string[];
}

/**
 * Supervisor tree configuration
 */
export interface SupervisorTreeConfig {
  /**
   * Root supervisor node
   */
  root: SupervisorTreeNode;

  /**
   * Default supervision options
   */
  defaultOptions?: Partial<SupervisorOptions>;

  /**
   * Global error handler for unhandled failures
   */
  onUnhandledFailure?: (error: Error, actorId: string, supervisorPath: string[]) => void;
}

/**
 * Internal supervisor tree node
 */
class SupervisorTreeNodeInternal {
  private supervisor: Supervisor;
  private children = new Map<string, SupervisorTreeNodeInternal>();
  private parent?: SupervisorTreeNodeInternal;
  private logger: ReturnType<typeof Logger.namespace>;

  constructor(
    public readonly id: string,
    private readonly config: SupervisorTreeNode,
    private readonly tree: SupervisorTree,
    parent?: SupervisorTreeNodeInternal
  ) {
    this.parent = parent;
    this.logger = Logger.namespace(`SUPERVISOR_TREE_${id.toUpperCase()}`);

    // Create supervisor with strategy and options
    const supervisorOptions: SupervisorOptions = {
      strategy: config.strategy,
      ...tree.getDefaultOptions(),
      ...config.options,
      // Override callbacks to handle tree escalation
      onFailure: (actorRef, error) => {
        this.handleFailure(actorRef, error);
      },
      onRestart: (actorRef, error, attempt) => {
        this.logger.debug('Actor restarted', {
          actorId: actorRef.id,
          error: error.message,
          attempt,
        });
        config.options?.onRestart?.(actorRef, error, attempt);
      },
    };

    this.supervisor = new Supervisor(supervisorOptions);

    // Initialize child supervisors
    if (config.children) {
      for (const childConfig of config.children) {
        const child = new SupervisorTreeNodeInternal(childConfig.id, childConfig, tree, this);
        this.children.set(childConfig.id, child);
      }
    }
  }

  /**
   * Get the full path from root to this node
   */
  getPath(): string[] {
    const path: string[] = [];
    let current: SupervisorTreeNodeInternal | undefined = this;

    while (current) {
      path.unshift(current.id);
      current = current.parent;
    }

    return path;
  }

  /**
   * Supervise an actor at this node
   */
  supervise(actorRef: ActorRef<BaseEventObject, unknown>): void {
    this.logger.debug('Supervising actor', {
      actorId: actorRef.id,
      supervisorPath: this.getPath(),
    });
    this.supervisor.supervise(actorRef);
  }

  /**
   * Stop supervising an actor
   */
  unsupervise(actorId: string): void {
    this.supervisor.unsupervise(actorId);
  }

  /**
   * Handle failure - escalate to parent if needed
   */
  private handleFailure(actorRef: ActorRef<BaseEventObject, unknown>, error: Error): void {
    this.logger.warn('Actor failure handled', {
      actorId: actorRef.id,
      error: error.message,
      supervisorPath: this.getPath(),
    });

    if (this.config.strategy === 'escalate' && this.parent) {
      this.logger.debug('Escalating failure to parent', {
        parentId: this.parent.id,
        actorId: actorRef.id,
      });
      this.parent.handleFailure(actorRef, error);
    } else if (this.config.strategy === 'escalate' && !this.parent) {
      // Root supervisor with escalate strategy - call global handler
      this.tree.handleUnhandledFailure(error, actorRef.id, this.getPath());
    }
  }

  /**
   * Find a child supervisor by ID (recursive)
   */
  findChild(id: string): SupervisorTreeNodeInternal | undefined {
    if (this.id === id) {
      return this;
    }

    for (const child of this.children.values()) {
      const found = child.findChild(id);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  /**
   * Get all supervised actors in this subtree
   */
  getSupervisedActors(): string[] {
    const actors: string[] = [];

    // Get actors from this supervisor
    // Note: This would need to be implemented in the base Supervisor class
    // For now, we'll leave this as a placeholder

    // Get actors from children
    for (const child of this.children.values()) {
      actors.push(...child.getSupervisedActors());
    }

    return actors;
  }

  /**
   * Cleanup this node and all children
   */
  cleanup(): void {
    this.logger.debug('Cleaning up supervisor tree node', { id: this.id });

    // Cleanup children first
    for (const child of this.children.values()) {
      child.cleanup();
    }

    // Cleanup our supervisor
    this.supervisor.cleanup();
  }

  /**
   * Get tree statistics
   */
  getStats(): {
    nodeId: string;
    supervisedActors: number;
    children: Array<ReturnType<SupervisorTreeNodeInternal['getStats']>>;
  } {
    return {
      nodeId: this.id,
      supervisedActors: this.getSupervisedActors().length,
      children: Array.from(this.children.values()).map((child) => child.getStats()),
    };
  }
}

/**
 * Supervisor tree for hierarchical fault tolerance
 */
export class SupervisorTree {
  private root: SupervisorTreeNodeInternal;
  private defaultOptions: Partial<SupervisorOptions>;
  private logger = Logger.namespace('SUPERVISOR_TREE');

  constructor(private config: SupervisorTreeConfig) {
    this.defaultOptions = config.defaultOptions || {};
    this.root = new SupervisorTreeNodeInternal(config.root.id, config.root, this);

    this.logger.info('Supervisor tree initialized', {
      rootId: config.root.id,
      structure: this.getStructure(),
    });
  }

  /**
   * Get default options for supervisors
   */
  getDefaultOptions(): Partial<SupervisorOptions> {
    return this.defaultOptions;
  }

  /**
   * Handle unhandled failures
   */
  handleUnhandledFailure(error: Error, actorId: string, supervisorPath: string[]): void {
    this.logger.error('Unhandled failure in supervisor tree', {
      error: error.message,
      actorId,
      supervisorPath,
    });

    if (this.config.onUnhandledFailure) {
      this.config.onUnhandledFailure(error, actorId, supervisorPath);
    } else {
      // Default behavior: log and continue
      console.error('Unhandled supervisor tree failure:', {
        error: error.message,
        actorId,
        supervisorPath,
      });
    }
  }

  /**
   * Supervise an actor under a specific supervisor node
   */
  supervise(actorRef: ActorRef<BaseEventObject, unknown>, supervisorId: string): void {
    const supervisor = this.root.findChild(supervisorId);
    if (!supervisor) {
      throw new Error(`Supervisor not found: ${supervisorId}`);
    }

    supervisor.supervise(actorRef);
  }

  /**
   * Stop supervising an actor
   */
  unsupervise(actorId: string, supervisorId: string): void {
    const supervisor = this.root.findChild(supervisorId);
    if (!supervisor) {
      throw new Error(`Supervisor not found: ${supervisorId}`);
    }

    supervisor.unsupervise(actorId);
  }

  /**
   * Get the tree structure
   */
  getStructure(): object {
    return this.root.getStats();
  }

  /**
   * Cleanup the entire tree
   */
  cleanup(): void {
    this.logger.info('Cleaning up supervisor tree');
    this.root.cleanup();
  }

  /**
   * Get tree statistics
   */
  getStats(): {
    totalNodes: number;
    totalSupervisedActors: number;
    structure: ReturnType<SupervisorTreeNodeInternal['getStats']>;
  } {
    const structure = this.root.getStats();

    const countNodes = (node: ReturnType<SupervisorTreeNodeInternal['getStats']>): number => {
      return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
    };

    const countActors = (node: ReturnType<SupervisorTreeNodeInternal['getStats']>): number => {
      return (
        node.supervisedActors + node.children.reduce((sum, child) => sum + countActors(child), 0)
      );
    };

    return {
      totalNodes: countNodes(structure),
      totalSupervisedActors: countActors(structure),
      structure,
    };
  }
}

/**
 * Create a supervisor tree from configuration
 */
export function createSupervisorTree(config: SupervisorTreeConfig): SupervisorTree {
  return new SupervisorTree(config);
}

/**
 * Predefined supervisor tree patterns
 */
export const SupervisorTreePatterns = {
  /**
   * Simple one-for-one pattern - single supervisor manages multiple actors
   */
  oneForOne: (
    supervisorId: string,
    strategy: SupervisionStrategy = 'restart-on-failure'
  ): SupervisorTreeNode => ({
    id: supervisorId,
    strategy,
    children: [],
  }),

  /**
   * One-for-all pattern - if one actor fails, restart all actors
   */
  oneForAll: (supervisorId: string): SupervisorTreeNode => ({
    id: supervisorId,
    strategy: 'restart-on-failure',
    options: {
      // Custom logic would be needed here to restart all actors
      // This is a simplified version
    },
  }),

  /**
   * Rest-for-one pattern - if one actor fails, restart it and all actors started after it
   */
  restForOne: (supervisorId: string): SupervisorTreeNode => ({
    id: supervisorId,
    strategy: 'restart-on-failure',
    options: {
      // Custom logic would be needed here
    },
  }),

  /**
   * Hierarchical pattern - multiple layers of supervision
   */
  hierarchical: (
    rootId: string,
    layers: Array<{ id: string; strategy: SupervisionStrategy; children?: SupervisorTreeNode[] }>
  ): SupervisorTreeNode => ({
    id: rootId,
    strategy: 'escalate',
    children: layers.map((layer) => ({
      id: layer.id,
      strategy: layer.strategy,
      children: layer.children || [],
    })),
  }),
};
