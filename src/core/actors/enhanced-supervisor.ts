/**
 * @module framework/core/actors/enhanced-supervisor
 * @description Enhanced Actor Supervision with Event-Driven Fault Tolerance
 * @author Agent A (Tech Lead) - 2025-07-14
 *
 * This builds on the proven Event Emission System from Phase 1 to provide
 * advanced supervision strategies with event-driven coordination.
 *
 * Key Features:
 * - Event-driven supervision notifications
 * - Configurable fault tolerance strategies
 * - Performance monitoring and metrics
 * - Type-safe supervision events
 * - Integration with existing ActorRef system
 */

import { ActorEventBus } from '../actor-event-bus.js';
import { Logger } from '../dev-mode.js';
import type { ActorRef, BaseEventObject } from './actor-ref.js';
import type { SupervisionStrategy } from './types.js';

// Use scoped logger as recommended in Testing Guide
const log = Logger.namespace('ENHANCED_SUPERVISOR');

/**
 * Enhanced supervision events for event-driven coordination
 */
export interface SupervisionEvent {
  type: 'CHILD_FAILED' | 'CHILD_RESTARTED' | 'CHILD_ESCALATED' | 'SUPERVISION_LIMIT_REACHED';
  childId: string;
  supervisorId: string;
  timestamp: number;
  error?: Error;
  restartCount?: number;
  strategy?: SupervisionStrategy;
  metadata?: {
    failureReason?: string;
    recoveryAction?: string;
    performanceImpact?: number;
  };
}

/**
 * Enhanced supervision configuration
 */
export interface EnhancedSupervisionConfig {
  strategy: SupervisionStrategy;
  maxRestarts: number;
  timeWindow: number; // ms
  escalationThreshold: number;
  enableEvents: boolean;
  performanceTracking: boolean;
  customRecoveryActions?: Map<string, (error: Error) => Promise<void>>;
}

/**
 * Default supervision configuration
 */
export const DEFAULT_SUPERVISION_CONFIG: EnhancedSupervisionConfig = {
  strategy: 'restart-on-failure',
  maxRestarts: 3,
  timeWindow: 60000, // 1 minute
  escalationThreshold: 5,
  enableEvents: true,
  performanceTracking: true,
};

/**
 * Child actor metadata for supervision tracking
 */
interface ChildMetadata {
  actorRef: ActorRef<BaseEventObject, unknown>;
  restartCount: number;
  lastFailure?: Date;
  failures: Array<{ timestamp: Date; error: Error }>;
  performanceMetrics: {
    messageCount: number;
    errorRate: number;
    avgResponseTime: number;
  };
}

/**
 * Enhanced Supervisor with Event-Driven Fault Tolerance
 *
 * Builds on our proven Event Emission System to provide:
 * - Type-safe supervision events
 * - Performance monitoring
 * - Configurable fault tolerance
 * - Event-driven coordination with other actors
 */
export class EnhancedSupervisor<TEmitted = SupervisionEvent> {
  private children = new Map<string, ChildMetadata>();
  private config: EnhancedSupervisionConfig;
  private eventBus: ActorEventBus<TEmitted>;
  private supervisorId: string;
  private startTime: Date;

  constructor(supervisorId: string, config: Partial<EnhancedSupervisionConfig> = {}) {
    this.supervisorId = supervisorId;
    this.config = { ...DEFAULT_SUPERVISION_CONFIG, ...config };
    this.eventBus = new ActorEventBus<TEmitted>();
    this.startTime = new Date();

    log.debug('Enhanced supervisor created', {
      supervisorId: this.supervisorId,
      config: this.config,
    });
  }

  /**
   * Subscribe to supervision events for coordination with other actors
   */
  subscribe(listener: (event: TEmitted) => void): () => void {
    return this.eventBus.subscribe(listener);
  }

  /**
   * Emit supervision events to notify other actors
   */
  private emitSupervisionEvent(event: SupervisionEvent): void {
    if (!this.config.enableEvents) return;

    try {
      this.eventBus.emit(event as TEmitted);
      log.debug('Supervision event emitted', {
        type: event.type,
        childId: event.childId,
      });
    } catch (error) {
      log.error('Failed to emit supervision event:', error);
    }
  }

  /**
   * Add a child actor under supervision
   */
  supervise<TChildEvent extends BaseEventObject, TChildEmitted>(
    childRef: ActorRef<TChildEvent, TChildEmitted>
  ): void {
    const childId = childRef.id;

    if (this.children.has(childId)) {
      log.warn('Child actor already under supervision', { childId });
      return;
    }

    const metadata: ChildMetadata = {
      actorRef: childRef as ActorRef<BaseEventObject, unknown>,
      restartCount: 0,
      failures: [],
      performanceMetrics: {
        messageCount: 0,
        errorRate: 0,
        avgResponseTime: 0,
      },
    };

    this.children.set(childId, metadata);

    // Monitor child actor for failures
    this.setupChildMonitoring(childRef);

    log.debug('Child actor added to supervision', {
      supervisorId: this.supervisorId,
      childId,
      strategy: this.config.strategy,
    });
  }

  /**
   * Handle child actor failure with event-driven coordination
   */
  async handleChildFailure(childId: string, error: Error): Promise<void> {
    const metadata = this.children.get(childId);
    if (!metadata) {
      log.warn('Attempted to handle failure for unknown child', { childId });
      return;
    }

    const now = new Date();
    metadata.failures.push({ timestamp: now, error });
    metadata.lastFailure = now;

    log.info('Handling child failure', {
      supervisorId: this.supervisorId,
      childId,
      error: error.message,
      strategy: this.config.strategy,
    });

    // Emit failure event for coordination
    this.emitSupervisionEvent({
      type: 'CHILD_FAILED',
      childId,
      supervisorId: this.supervisorId,
      timestamp: now.getTime(),
      error,
      restartCount: metadata.restartCount,
      strategy: this.config.strategy,
      metadata: {
        failureReason: error.message,
        performanceImpact: this.calculatePerformanceImpact(metadata),
      },
    });

    // Apply supervision strategy
    await this.applySupervisionStrategy(childId, error, metadata);
  }

  /**
   * Apply supervision strategy with event coordination
   */
  private async applySupervisionStrategy(
    childId: string,
    error: Error,
    metadata: ChildMetadata
  ): Promise<void> {
    const recentFailures = this.getRecentFailures(metadata);

    // Check if we've exceeded restart limits
    if (recentFailures.length >= this.config.maxRestarts) {
      await this.escalateFailure(childId, error, metadata);
      return;
    }

    switch (this.config.strategy) {
      case 'restart-on-failure':
        await this.restartChild(childId, metadata);
        break;

      case 'stop-on-failure':
        await this.stopChild(childId, metadata);
        break;

      case 'escalate':
        await this.escalateFailure(childId, error, metadata);
        break;

      default:
        log.error('Unknown supervision strategy', {
          strategy: this.config.strategy,
        });
    }
  }

  /**
   * Restart child actor with event notification
   */
  private async restartChild(childId: string, metadata: ChildMetadata): Promise<void> {
    try {
      await metadata.actorRef.restart();
      metadata.restartCount++;

      log.info('Child actor restarted successfully', {
        supervisorId: this.supervisorId,
        childId,
        restartCount: metadata.restartCount,
      });

      // Emit restart event
      this.emitSupervisionEvent({
        type: 'CHILD_RESTARTED',
        childId,
        supervisorId: this.supervisorId,
        timestamp: Date.now(),
        restartCount: metadata.restartCount,
        strategy: this.config.strategy,
        metadata: {
          recoveryAction: 'restart',
        },
      });
    } catch (restartError) {
      log.error('Failed to restart child actor', {
        childId,
        error: restartError,
      });

      // Escalate if restart fails
      await this.escalateFailure(childId, restartError as Error, metadata);
    }
  }

  /**
   * Stop child actor permanently
   */
  private async stopChild(childId: string, metadata: ChildMetadata): Promise<void> {
    try {
      await metadata.actorRef.stop();
      this.children.delete(childId);

      log.info('Child actor stopped permanently', {
        supervisorId: this.supervisorId,
        childId,
      });
    } catch (stopError) {
      log.error('Failed to stop child actor', {
        childId,
        error: stopError,
      });
    }
  }

  /**
   * Escalate failure to parent supervisor or external handler
   */
  private async escalateFailure(
    childId: string,
    error: Error,
    metadata: ChildMetadata
  ): Promise<void> {
    log.warn('Escalating child failure - supervision limits exceeded', {
      supervisorId: this.supervisorId,
      childId,
      failureCount: metadata.failures.length,
      maxRestarts: this.config.maxRestarts,
    });

    // Emit escalation event
    this.emitSupervisionEvent({
      type: 'CHILD_ESCALATED',
      childId,
      supervisorId: this.supervisorId,
      timestamp: Date.now(),
      error,
      restartCount: metadata.restartCount,
      strategy: this.config.strategy,
      metadata: {
        failureReason: error.message,
        recoveryAction: 'escalate',
      },
    });

    // Apply custom recovery actions if configured
    const customAction = this.config.customRecoveryActions?.get(error.name);
    if (customAction) {
      try {
        await customAction(error);
        log.info('Custom recovery action executed', {
          childId,
          errorType: error.name,
        });
      } catch (recoveryError) {
        log.error('Custom recovery action failed', {
          childId,
          recoveryError,
        });
      }
    }
  }

  /**
   * Setup monitoring for child actor
   */
  private setupChildMonitoring<TChildEvent extends BaseEventObject, TChildEmitted>(
    childRef: ActorRef<TChildEvent, TChildEmitted>
  ): void {
    if (!this.config.performanceTracking) return;

    const childId = childRef.id;

    // Monitor actor state changes for error detection
    try {
      const _subscription = childRef.observe((snapshot) => {
        const metadata = this.children.get(childId);
        if (!metadata) return;

        // Update performance metrics
        metadata.performanceMetrics.messageCount++;

        // Detect error states
        if (snapshot.status === 'error' && snapshot.error) {
          this.handleChildFailure(childId, snapshot.error);
        }

        return snapshot;
      });

      // Store subscription for cleanup (would be enhanced in real implementation)
      log.debug('Child monitoring setup complete', { childId });
    } catch (error) {
      log.error('Failed to setup child monitoring', { childId, error });
    }
  }

  /**
   * Get recent failures within the configured time window
   */
  private getRecentFailures(metadata: ChildMetadata): Array<{ timestamp: Date; error: Error }> {
    const cutoff = new Date(Date.now() - this.config.timeWindow);
    return metadata.failures.filter((failure) => failure.timestamp > cutoff);
  }

  /**
   * Calculate performance impact of child failure
   */
  private calculatePerformanceImpact(metadata: ChildMetadata): number {
    const { messageCount, errorRate } = metadata.performanceMetrics;
    return messageCount > 0 ? errorRate / messageCount : 0;
  }

  /**
   * Get supervision statistics for monitoring
   */
  getSupervisionStats(): {
    supervisorId: string;
    childCount: number;
    totalRestarts: number;
    totalFailures: number;
    uptime: number;
    children: Array<{
      id: string;
      restartCount: number;
      failureCount: number;
      errorRate: number;
    }>;
  } {
    const now = Date.now();
    const uptime = now - this.startTime.getTime();

    let totalRestarts = 0;
    let totalFailures = 0;

    const children = Array.from(this.children.entries()).map(([id, metadata]) => {
      totalRestarts += metadata.restartCount;
      totalFailures += metadata.failures.length;

      return {
        id,
        restartCount: metadata.restartCount,
        failureCount: metadata.failures.length,
        errorRate: metadata.performanceMetrics.errorRate,
      };
    });

    return {
      supervisorId: this.supervisorId,
      childCount: this.children.size,
      totalRestarts,
      totalFailures,
      uptime,
      children,
    };
  }

  /**
   * Remove child from supervision
   */
  unsupervise(childId: string): void {
    if (this.children.has(childId)) {
      this.children.delete(childId);
      log.debug('Child removed from supervision', {
        supervisorId: this.supervisorId,
        childId,
      });
    }
  }

  /**
   * Cleanup supervisor and all resources
   */
  async cleanup(): Promise<void> {
    log.info('Cleaning up enhanced supervisor', {
      supervisorId: this.supervisorId,
      childCount: this.children.size,
    });

    // Stop all children
    const stopPromises = Array.from(this.children.values()).map((metadata) =>
      metadata.actorRef
        .stop()
        .catch((error) => log.error('Error stopping child during cleanup', { error }))
    );

    await Promise.all(stopPromises);

    // Clean up event bus
    this.eventBus.destroy();

    // Clear children
    this.children.clear();

    log.debug('Enhanced supervisor cleanup complete', {
      supervisorId: this.supervisorId,
    });
  }
}
