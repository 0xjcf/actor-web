/**
 * @module actor-core/runtime/actors/backoff-supervisor
 * @description Supervisor with exponential backoff for failing actors
 * @author Actor-Web Framework Team
 */

import type { ActorRef } from '../actor-ref.js';
import type { ActorMessage } from '../actor-system.js';
import { Logger } from '../logger.js';
// ✅ PURE ACTOR MODEL: Import XState-based delay function
import { createActorDelay } from '../pure-xstate-utilities.js';
import type { BaseEventObject } from '../types.js';
import { Supervisor, type SupervisorOptions } from './supervisor.js';

const logger = Logger.namespace('BACKOFF_SUPERVISOR');

/**
 * Backoff strategy types
 */
export type BackoffStrategy = 'exponential' | 'linear' | 'fibonacci';

/**
 * Backoff supervisor configuration
 */
export interface BackoffSupervisorOptions extends SupervisorOptions {
  /**
   * Backoff strategy to use
   */
  backoffStrategy?: BackoffStrategy;

  /**
   * Initial delay in milliseconds
   */
  initialDelay?: number;

  /**
   * Maximum delay in milliseconds
   */
  maxDelay?: number;

  /**
   * Multiplier for exponential backoff
   */
  multiplier?: number;

  /**
   * Add jitter to prevent thundering herd
   */
  jitter?: boolean;
}

/**
 * Tracking for backoff state
 */
interface BackoffState {
  attempt: number;
  currentDelay: number;
  fibPrev: number;
  fibCurrent: number;
}

/**
 * Supervisor with backoff strategies for failing actors
 */
export class BackoffSupervisor extends Supervisor {
  private readonly backoffOptions: Required<BackoffSupervisorOptions>;
  private readonly backoffStates = new Map<string, BackoffState>();

  constructor(options: BackoffSupervisorOptions) {
    // Pass through base options
    super(options);

    // Set backoff-specific options
    this.backoffOptions = {
      ...options,
      backoffStrategy: options.backoffStrategy ?? 'exponential',
      initialDelay: options.initialDelay ?? 1000,
      maxDelay: options.maxDelay ?? 60000,
      multiplier: options.multiplier ?? 2,
      jitter: options.jitter ?? true,
    } as Required<BackoffSupervisorOptions>;
  }

  /**
   * Override to add backoff delay calculation
   */
  async handleFailure(
    error: Error,
    actorRef: ActorRef<BaseEventObject, ActorMessage>
  ): Promise<void> {
    const actorId = actorRef.address.id;
    // Get or create backoff state
    let state = this.backoffStates.get(actorId);
    if (!state) {
      state = {
        attempt: 0,
        currentDelay: this.backoffOptions.initialDelay,
        fibPrev: 0,
        fibCurrent: this.backoffOptions.initialDelay,
      };
      this.backoffStates.set(actorId, state);
    }

    // Increment attempt
    state.attempt++;

    // Calculate delay based on strategy
    const delay = this.calculateDelay(state);

    logger.debug('Applying backoff delay', {
      actorId,
      attempt: state.attempt,
      delay,
      strategy: this.backoffOptions.backoffStrategy,
    });

    // ✅ PURE ACTOR MODEL: Wait for backoff delay using XState instead of setTimeout
    await createActorDelay(delay);

    // Call parent handler
    await super.handleFailure(error, actorRef);
  }

  /**
   * Calculate backoff delay based on strategy
   */
  private calculateDelay(state: BackoffState): number {
    let baseDelay: number;

    switch (this.backoffOptions.backoffStrategy) {
      case 'exponential':
        baseDelay = Math.min(
          this.backoffOptions.initialDelay * this.backoffOptions.multiplier ** (state.attempt - 1),
          this.backoffOptions.maxDelay
        );
        break;

      case 'linear':
        baseDelay = Math.min(
          this.backoffOptions.initialDelay * state.attempt,
          this.backoffOptions.maxDelay
        );
        break;

      case 'fibonacci': {
        // Calculate next Fibonacci number
        const next = state.fibPrev + state.fibCurrent;
        state.fibPrev = state.fibCurrent;
        state.fibCurrent = next;
        baseDelay = Math.min(next, this.backoffOptions.maxDelay);
        break;
      }

      default:
        baseDelay = this.backoffOptions.initialDelay;
    }

    // Update current delay
    state.currentDelay = baseDelay;

    // Add jitter if enabled
    if (this.backoffOptions.jitter) {
      // Add random jitter between -25% and +25%
      const jitterRange = baseDelay * 0.25;
      const jitter = (Math.random() - 0.5) * 2 * jitterRange;
      return Math.max(0, baseDelay + jitter);
    }

    return baseDelay;
  }

  /**
   * Reset backoff state for an actor
   */
  resetBackoff(actorId: string): void {
    this.backoffStates.delete(actorId);
    logger.debug('Backoff state reset', { actorId });
  }

  /**
   * Override supervise to reset backoff on success
   */
  supervise(actorRef: ActorRef<BaseEventObject, ActorMessage>): void {
    super.supervise(actorRef);

    // Reset backoff state when actor is supervised
    this.resetBackoff(actorRef.address.id);
  }

  /**
   * Override unsupervise to clean up backoff state
   */
  unsupervise(actorId: string): void {
    super.unsupervise(actorId);

    // Clean up backoff state
    this.backoffStates.delete(actorId);
  }

  /**
   * Get backoff statistics
   */
  getBackoffStats(): Record<
    string,
    {
      attempt: number;
      currentDelay: number;
      strategy: BackoffStrategy;
    }
  > {
    const stats: Record<
      string,
      {
        attempt: number;
        currentDelay: number;
        strategy: BackoffStrategy;
      }
    > = {};

    for (const [actorId, state] of this.backoffStates) {
      stats[actorId] = {
        attempt: state.attempt,
        currentDelay: state.currentDelay,
        strategy: this.backoffOptions.backoffStrategy,
      };
    }

    return stats;
  }

  /**
   * Override cleanup to clear backoff states
   */
  cleanup(): void {
    super.cleanup();
    this.backoffStates.clear();
  }
}
