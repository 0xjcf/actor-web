/**
 * @module framework/core/actors/hierarchical-actor
 * @description Hierarchical Actor Management with Event Propagation
 * @author Agent A (Tech Lead) - 2025-07-14
 *
 * This builds on the proven Event Emission System and Enhanced Supervisor
 * to provide advanced parent-child relationships with event propagation.
 *
 * Key Features:
 * - Event propagation up/down the hierarchy
 * - Parent-child relationship management
 * - Type-safe hierarchical events
 * - Integration with supervision system
 * - Performance optimized for large hierarchies
 */

import { ActorEventBus } from '../actor-event-bus.js';
import { Logger } from '../dev-mode.js';
import type { ActorRef, BaseEventObject } from './actor-ref.js';
import { EnhancedSupervisor, type SupervisionEvent } from './enhanced-supervisor.js';

// Use scoped logger as recommended in Testing Guide
const log = Logger.namespace('HIERARCHICAL_ACTOR');

/**
 * Hierarchical events for parent-child communication
 */
export interface HierarchicalEvent {
  type: 'CHILD_ADDED' | 'CHILD_REMOVED' | 'PARENT_CHANGED' | 'HIERARCHY_EVENT';
  actorId: string;
  parentId?: string;
  childId?: string;
  timestamp: number;
  propagationDirection: 'up' | 'down' | 'bidirectional';
  originalEvent?: unknown;
  metadata?: {
    hierarchyLevel: number;
    propagationPath: string[];
    eventSource: string;
  };
}

/**
 * Configuration for hierarchical behavior
 */
export interface HierarchicalConfig {
  enableEventPropagation: boolean;
  enableSupervision: boolean;
  maxHierarchyDepth: number;
  propagationTimeoutMs: number;
  autoStartChildren: boolean;
  supervisionStrategy: 'restart-on-failure' | 'stop-on-failure' | 'escalate';
}

/**
 * Default hierarchical configuration
 */
export const DEFAULT_HIERARCHICAL_CONFIG: HierarchicalConfig = {
  enableEventPropagation: true,
  enableSupervision: true,
  maxHierarchyDepth: 10,
  propagationTimeoutMs: 1000,
  autoStartChildren: true,
  supervisionStrategy: 'restart-on-failure',
};

/**
 * Child actor metadata for hierarchy management
 */
interface ChildActorMetadata {
  actorRef: ActorRef<BaseEventObject, unknown>;
  hierarchyLevel: number;
  addedAt: Date;
  eventSubscriptions: Array<() => void>;
  isSupervised: boolean;
}

/**
 * Enhanced Hierarchical Actor with Event Propagation
 *
 * Provides:
 * - Parent-child relationship management
 * - Event propagation up and down the hierarchy
 * - Integration with supervision system
 * - Type-safe hierarchical communication
 */
export class HierarchicalActor {
  private children = new Map<string, ChildActorMetadata>();
  private parent?: HierarchicalActor;
  private eventBus: ActorEventBus<HierarchicalEvent>;
  private supervisor?: EnhancedSupervisor<SupervisionEvent>;
  private config: HierarchicalConfig;
  private actorId: string;
  private hierarchyLevel: number;

  constructor(
    actorId: string,
    config: Partial<HierarchicalConfig> = {},
    parent?: HierarchicalActor
  ) {
    this.actorId = actorId;
    this.config = { ...DEFAULT_HIERARCHICAL_CONFIG, ...config };
    this.parent = parent;
    this.hierarchyLevel = parent ? parent.getHierarchyLevel() + 1 : 0;
    this.eventBus = new ActorEventBus<HierarchicalEvent>();

    // Validate hierarchy depth
    if (this.hierarchyLevel > this.config.maxHierarchyDepth) {
      throw new Error(`Maximum hierarchy depth exceeded: ${this.hierarchyLevel}`);
    }

    // Setup supervision if enabled
    if (this.config.enableSupervision) {
      this.supervisor = new EnhancedSupervisor(`${actorId}-supervisor`, {
        strategy: this.config.supervisionStrategy,
        enableEvents: true,
        performanceTracking: true,
      });

      // Subscribe to supervision events
      this.supervisor.subscribe((event) => {
        this.handleSupervisionEvent(event);
      });
    }

    log.debug('Hierarchical actor created', {
      actorId: this.actorId,
      hierarchyLevel: this.hierarchyLevel,
      hasParent: !!this.parent,
      config: this.config,
    });
  }

  /**
   * Subscribe to hierarchical events
   */
  subscribe(listener: (event: HierarchicalEvent) => void): () => void {
    return this.eventBus.subscribe(listener);
  }

  /**
   * Add a child actor to the hierarchy
   */
  addChild<TChildEvent extends BaseEventObject, TChildEmitted>(
    childRef: ActorRef<TChildEvent, TChildEmitted>
  ): void {
    const childId = childRef.id;

    if (this.children.has(childId)) {
      log.warn('Child actor already exists in hierarchy', {
        parentId: this.actorId,
        childId,
      });
      return;
    }

    const metadata: ChildActorMetadata = {
      actorRef: childRef as ActorRef<BaseEventObject, unknown>,
      hierarchyLevel: this.hierarchyLevel + 1,
      addedAt: new Date(),
      eventSubscriptions: [],
      isSupervised: this.config.enableSupervision,
    };

    // Add to supervision if enabled
    if (this.config.enableSupervision && this.supervisor) {
      this.supervisor.supervise(childRef);
      metadata.isSupervised = true;
    }

    // Setup event propagation if enabled
    if (this.config.enableEventPropagation) {
      this.setupChildEventPropagation(childRef, metadata);
    }

    // Start child if auto-start is enabled
    if (this.config.autoStartChildren) {
      try {
        childRef.start();
      } catch (error) {
        log.error('Failed to auto-start child actor', {
          childId,
          error,
        });
      }
    }

    this.children.set(childId, metadata);

    // Emit hierarchy event
    const hierarchicalEvent: HierarchicalEvent = {
      type: 'CHILD_ADDED',
      actorId: this.actorId,
      childId,
      timestamp: Date.now(),
      propagationDirection: 'up',
      metadata: {
        hierarchyLevel: this.hierarchyLevel,
        propagationPath: this.getHierarchyPath(),
        eventSource: this.actorId,
      },
    };

    this.emitHierarchicalEvent(hierarchicalEvent);

    log.debug('Child actor added to hierarchy', {
      parentId: this.actorId,
      childId,
      hierarchyLevel: metadata.hierarchyLevel,
      isSupervised: metadata.isSupervised,
    });
  }

  /**
   * Remove a child actor from the hierarchy
   */
  async removeChild(childId: string): Promise<void> {
    const metadata = this.children.get(childId);
    if (!metadata) {
      log.warn('Attempted to remove non-existent child', {
        parentId: this.actorId,
        childId,
      });
      return;
    }

    try {
      // Cleanup event subscriptions
      for (const unsubscribe of metadata.eventSubscriptions) {
        unsubscribe();
      }

      // Remove from supervision
      if (metadata.isSupervised && this.supervisor) {
        this.supervisor.unsupervise(childId);
      }

      // Stop the child actor
      await metadata.actorRef.stop();

      // Remove from children map
      this.children.delete(childId);

      // Emit hierarchy event
      const hierarchicalEvent: HierarchicalEvent = {
        type: 'CHILD_REMOVED',
        actorId: this.actorId,
        childId,
        timestamp: Date.now(),
        propagationDirection: 'up',
        metadata: {
          hierarchyLevel: this.hierarchyLevel,
          propagationPath: this.getHierarchyPath(),
          eventSource: this.actorId,
        },
      };

      this.emitHierarchicalEvent(hierarchicalEvent);

      log.debug('Child actor removed from hierarchy', {
        parentId: this.actorId,
        childId,
      });
    } catch (error) {
      log.error('Error removing child actor', {
        parentId: this.actorId,
        childId,
        error,
      });
      throw error;
    }
  }

  /**
   * Emit event to parent actor (propagate up)
   */
  emitToParent(event: unknown): void {
    if (!this.parent) {
      log.debug('No parent to emit to', { actorId: this.actorId });
      return;
    }

    try {
      const hierarchicalEvent: HierarchicalEvent = {
        type: 'HIERARCHY_EVENT',
        actorId: this.actorId,
        parentId: this.parent.actorId,
        timestamp: Date.now(),
        propagationDirection: 'up',
        originalEvent: event,
        metadata: {
          hierarchyLevel: this.hierarchyLevel,
          propagationPath: this.getHierarchyPath(),
          eventSource: this.actorId,
        },
      };

      this.parent.receiveFromChild(hierarchicalEvent);

      log.debug('Event propagated to parent', {
        childId: this.actorId,
        parentId: this.parent.actorId,
        eventType: hierarchicalEvent.type,
      });
    } catch (error) {
      log.error('Error propagating event to parent', {
        childId: this.actorId,
        error,
      });
    }
  }

  /**
   * Emit event to all children (propagate down)
   */
  emitToChildren(event: unknown): void {
    if (this.children.size === 0) {
      log.debug('No children to emit to', { actorId: this.actorId });
      return;
    }

    const hierarchicalEvent: HierarchicalEvent = {
      type: 'HIERARCHY_EVENT',
      actorId: this.actorId,
      timestamp: Date.now(),
      propagationDirection: 'down',
      originalEvent: event,
      metadata: {
        hierarchyLevel: this.hierarchyLevel,
        propagationPath: this.getHierarchyPath(),
        eventSource: this.actorId,
      },
    };

    // Emit to all children with proper type checking
    let successCount = 0;
    for (const [childId, metadata] of this.children) {
      try {
        const childActor = metadata.actorRef as unknown;

        // Type guard for hierarchical receive capability
        if (childActor && typeof childActor === 'object' && 'receiveFromParent' in childActor) {
          const hierarchicalChild = childActor as {
            receiveFromParent: (event: HierarchicalEvent) => void;
          };
          hierarchicalChild.receiveFromParent(hierarchicalEvent);
        }
        // Type guard for emit capability
        else if (childActor && typeof childActor === 'object' && 'emit' in childActor) {
          const emittableChild = childActor as { emit: (event: unknown) => void };
          emittableChild.emit(hierarchicalEvent);
        }
        successCount++;
      } catch (error) {
        log.error('Error propagating event to child', {
          parentId: this.actorId,
          childId,
          error,
        });
      }
    }

    log.debug('Event propagated to children', {
      parentId: this.actorId,
      childCount: this.children.size,
      successCount,
    });
  }

  /**
   * Subscribe to specific child events
   */
  subscribeToChild(childId: string, listener: (event: unknown) => void): (() => void) | null {
    const metadata = this.children.get(childId);
    if (!metadata) {
      log.warn('Cannot subscribe to non-existent child', {
        parentId: this.actorId,
        childId,
      });
      return null;
    }

    // Type guard for subscription capability
    const childActor = metadata.actorRef as unknown;
    if (childActor && typeof childActor === 'object' && 'subscribe' in childActor) {
      const subscribableChild = childActor as {
        subscribe: (listener: (event: unknown) => void) => () => void;
      };
      const unsubscribe = subscribableChild.subscribe(listener);
      metadata.eventSubscriptions.push(unsubscribe);
      return unsubscribe;
    }

    log.warn('Child actor does not support event subscription', {
      parentId: this.actorId,
      childId,
    });
    return null;
  }

  /**
   * Receive event from child (internal method)
   */
  private receiveFromChild(event: HierarchicalEvent): void {
    // Process child event and potentially propagate further up
    this.emitHierarchicalEvent(event);

    // Continue propagation up the hierarchy if configured
    if (this.config.enableEventPropagation && this.parent) {
      this.parent.receiveFromChild(event);
    }
  }

  /**
   * Receive event from parent (internal method)
   */
  private receiveFromParent(event: HierarchicalEvent): void {
    // Process parent event and potentially propagate down
    this.emitHierarchicalEvent(event);

    // Continue propagation down the hierarchy if configured
    if (this.config.enableEventPropagation && event.propagationDirection === 'down') {
      this.emitToChildren(event.originalEvent);
    }
  }

  /**
   * Setup event propagation for a child actor
   */
  private setupChildEventPropagation(
    childRef: ActorRef<BaseEventObject, unknown>,
    metadata: ChildActorMetadata
  ): void {
    // Type guard for subscription capability
    const childActor = childRef as unknown;
    if (childActor && typeof childActor === 'object' && 'subscribe' in childActor) {
      try {
        const subscribableChild = childActor as {
          subscribe: (listener: (event: unknown) => void) => () => void;
        };
        const unsubscribe = subscribableChild.subscribe((event: unknown) => {
          this.handleChildEvent(childRef.id, event);
        });
        metadata.eventSubscriptions.push(unsubscribe);
      } catch (error) {
        log.error('Failed to setup child event propagation', {
          childId: childRef.id,
          error,
        });
      }
    }
  }

  /**
   * Handle events from child actors
   */
  private handleChildEvent(childId: string, event: unknown): void {
    log.debug('Received event from child', {
      parentId: this.actorId,
      childId,
      eventType: typeof event,
    });

    // Create hierarchical event wrapper
    const hierarchicalEvent: HierarchicalEvent = {
      type: 'HIERARCHY_EVENT',
      actorId: this.actorId,
      childId,
      timestamp: Date.now(),
      propagationDirection: 'up',
      originalEvent: event,
      metadata: {
        hierarchyLevel: this.hierarchyLevel,
        propagationPath: this.getHierarchyPath(),
        eventSource: childId,
      },
    };

    // Emit the hierarchical event
    this.emitHierarchicalEvent(hierarchicalEvent);

    // Propagate up if configured
    if (this.config.enableEventPropagation && this.parent) {
      this.parent.receiveFromChild(hierarchicalEvent);
    }
  }

  /**
   * Handle supervision events
   */
  private handleSupervisionEvent(event: SupervisionEvent): void {
    log.debug('Received supervision event', {
      actorId: this.actorId,
      supervisionEvent: event.type,
      childId: event.childId,
    });

    // Convert supervision event to hierarchical event
    const hierarchicalEvent: HierarchicalEvent = {
      type: 'HIERARCHY_EVENT',
      actorId: this.actorId,
      childId: event.childId,
      timestamp: event.timestamp,
      propagationDirection: 'up',
      originalEvent: event,
      metadata: {
        hierarchyLevel: this.hierarchyLevel,
        propagationPath: this.getHierarchyPath(),
        eventSource: event.supervisorId,
      },
    };

    // Emit hierarchical event
    this.emitHierarchicalEvent(hierarchicalEvent);

    // Propagate supervision events up the hierarchy
    if (this.parent) {
      this.emitToParent(event);
    }
  }

  /**
   * Emit hierarchical event
   */
  private emitHierarchicalEvent(event: HierarchicalEvent): void {
    try {
      this.eventBus.emit(event);
    } catch (error) {
      log.error('Failed to emit hierarchical event', {
        actorId: this.actorId,
        error,
      });
    }
  }

  /**
   * Get hierarchy path from root to this actor
   */
  private getHierarchyPath(): string[] {
    const path: string[] = [];
    let current: HierarchicalActor | undefined = this;

    while (current) {
      path.unshift(current.actorId);
      current = current.parent;
    }

    return path;
  }

  /**
   * Get all children actor references
   */
  getChildren(): ReadonlyMap<string, ActorRef<BaseEventObject, unknown>> {
    const childrenMap = new Map<string, ActorRef<BaseEventObject, unknown>>();
    for (const [id, metadata] of this.children) {
      childrenMap.set(id, metadata.actorRef);
    }
    return childrenMap;
  }

  /**
   * Get hierarchy statistics
   */
  getHierarchyStats(): {
    actorId: string;
    hierarchyLevel: number;
    childCount: number;
    hasParent: boolean;
    hierarchyPath: string[];
    supervisionEnabled: boolean;
    eventPropagationEnabled: boolean;
    children: Array<{
      id: string;
      hierarchyLevel: number;
      addedAt: Date;
      isSupervised: boolean;
    }>;
  } {
    return {
      actorId: this.actorId,
      hierarchyLevel: this.hierarchyLevel,
      childCount: this.children.size,
      hasParent: !!this.parent,
      hierarchyPath: this.getHierarchyPath(),
      supervisionEnabled: this.config.enableSupervision,
      eventPropagationEnabled: this.config.enableEventPropagation,
      children: Array.from(this.children.entries()).map(([id, metadata]) => ({
        id,
        hierarchyLevel: metadata.hierarchyLevel,
        addedAt: metadata.addedAt,
        isSupervised: metadata.isSupervised,
      })),
    };
  }

  /**
   * Get current hierarchy level
   */
  getHierarchyLevel(): number {
    return this.hierarchyLevel;
  }

  /**
   * Get parent actor
   */
  getParent(): HierarchicalActor | undefined {
    return this.parent;
  }

  /**
   * Set parent actor (used for reparenting)
   */
  setParent(newParent: HierarchicalActor | undefined): void {
    const oldParent = this.parent;
    this.parent = newParent;
    this.hierarchyLevel = newParent ? newParent.getHierarchyLevel() + 1 : 0;

    // Emit hierarchy change event
    const hierarchicalEvent: HierarchicalEvent = {
      type: 'PARENT_CHANGED',
      actorId: this.actorId,
      parentId: newParent?.actorId,
      timestamp: Date.now(),
      propagationDirection: 'bidirectional',
      metadata: {
        hierarchyLevel: this.hierarchyLevel,
        propagationPath: this.getHierarchyPath(),
        eventSource: this.actorId,
      },
    };

    this.emitHierarchicalEvent(hierarchicalEvent);

    log.debug('Parent changed for hierarchical actor', {
      actorId: this.actorId,
      oldParent: oldParent?.actorId,
      newParent: newParent?.actorId,
      newHierarchyLevel: this.hierarchyLevel,
    });
  }

  /**
   * Cleanup hierarchical actor and all resources
   */
  async cleanup(): Promise<void> {
    log.info('Cleaning up hierarchical actor', {
      actorId: this.actorId,
      childCount: this.children.size,
    });

    // Remove all children
    const childIds = Array.from(this.children.keys());
    await Promise.all(childIds.map((childId) => this.removeChild(childId)));

    // Cleanup supervisor
    if (this.supervisor) {
      await this.supervisor.cleanup();
    }

    // Clean up event bus
    this.eventBus.destroy();

    // Clear parent reference
    this.parent = undefined;

    log.debug('Hierarchical actor cleanup complete', {
      actorId: this.actorId,
    });
  }
}
