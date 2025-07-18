/**
 * @module actor-core/runtime/actors/supervisor
 * @description Basic supervision for actors in the runtime package
 * @author Agent A (Tech Lead) - 2025-07-15
 */

import type { ActorRef } from '../actor-ref.js';
import type { BaseEventObject, SupervisionStrategy } from '../types.js';

/**
 * Supervisor configuration options
 */
export interface SupervisorOptions {
  /**
   * Strategy to apply when supervised actors fail
   */
  strategy: SupervisionStrategy;

  /**
   * Maximum number of restart attempts
   */
  maxRestarts?: number;

  /**
   * Time window for restart attempts (ms)
   */
  restartWindow?: number;

  /**
   * Delay between restart attempts (ms)
   */
  restartDelay?: number;

  /**
   * Hook called before restarting an actor
   */
  onRestart?: (actorRef: ActorRef<BaseEventObject, unknown>, error: Error, attempt: number) => void;

  /**
   * Hook called when supervision fails
   */
  onFailure?: (actorRef: ActorRef<BaseEventObject, unknown>, error: Error) => void;
}

/**
 * Internal tracking for supervised actors
 */
interface SupervisedActor {
  actorRef: ActorRef<BaseEventObject, unknown>;
  restartCount: number;
  restartTimestamps: number[];
  isRestarting: boolean;
}

/**
 * Basic supervisor for actors
 */
export class Supervisor {
  private supervisedActors = new Map<string, SupervisedActor>();
  private readonly options: Required<SupervisorOptions>;

  constructor(options: SupervisorOptions) {
    this.options = {
      strategy: options.strategy,
      maxRestarts: options.maxRestarts ?? 3,
      restartWindow: options.restartWindow ?? 60000, // 1 minute
      restartDelay: options.restartDelay ?? 1000, // 1 second
      onRestart: options.onRestart ?? (() => {}),
      onFailure: options.onFailure ?? (() => {}),
    };
  }

  /**
   * Start supervising an actor
   */
  supervise(actorRef: ActorRef<BaseEventObject, unknown>): void {
    if (this.supervisedActors.has(actorRef.id)) {
      return; // Already supervising
    }

    const supervised: SupervisedActor = {
      actorRef,
      restartCount: 0,
      restartTimestamps: [],
      isRestarting: false,
    };

    this.supervisedActors.set(actorRef.id, supervised);
  }

  /**
   * Stop supervising an actor
   */
  unsupervise(actorId: string): void {
    this.supervisedActors.delete(actorId);
  }

  /**
   * Handle a failure in a supervised actor
   */
  async handleFailure(error: Error, actorRef: ActorRef<BaseEventObject, unknown>): Promise<void> {
    const supervised = this.supervisedActors.get(actorRef.id);
    if (!supervised) {
      return; // Not supervising this actor
    }

    if (supervised.isRestarting) {
      return; // Already handling a restart
    }

    supervised.isRestarting = true;

    try {
      switch (this.options.strategy) {
        case 'restart-on-failure':
          await this.restartActor(supervised, error);
          break;
        case 'stop-on-failure':
          await this.stopActor(supervised, error);
          break;
        case 'escalate':
          await this.escalateFailure(supervised, error);
          break;
        case 'resume':
          await this.resumeActor(supervised, error);
          break;
        default:
          console.warn('Unknown supervision strategy:', this.options.strategy);
          await this.stopActor(supervised, error);
      }
    } finally {
      supervised.isRestarting = false;
    }
  }

  /**
   * Cleanup all supervised actors
   */
  cleanup(): void {
    for (const [actorId, supervised] of this.supervisedActors) {
      try {
        supervised.actorRef.stop();
      } catch (error) {
        console.error(`Error stopping supervised actor ${actorId}:`, error);
      }
    }
    this.supervisedActors.clear();
  }

  /**
   * Get supervision statistics
   */
  getStats(): {
    supervisedCount: number;
    restartCounts: Record<string, number>;
  } {
    const restartCounts: Record<string, number> = {};
    for (const [actorId, supervised] of this.supervisedActors) {
      restartCounts[actorId] = supervised.restartCount;
    }

    return {
      supervisedCount: this.supervisedActors.size,
      restartCounts,
    };
  }

  /**
   * Restart an actor according to the restart strategy
   */
  private async restartActor(supervised: SupervisedActor, error: Error): Promise<void> {
    const now = Date.now();

    // Clean up old restart timestamps outside the window
    supervised.restartTimestamps = supervised.restartTimestamps.filter(
      (timestamp) => now - timestamp < this.options.restartWindow
    );

    // Check if we've exceeded the restart limit
    if (supervised.restartTimestamps.length >= this.options.maxRestarts) {
      console.error(`Actor ${supervised.actorRef.id} exceeded restart limit`);
      this.options.onFailure(supervised.actorRef, error);
      await this.stopActor(supervised, error);
      return;
    }

    // Record this restart attempt
    supervised.restartCount++;
    supervised.restartTimestamps.push(now);

    try {
      // Call restart hook
      this.options.onRestart(supervised.actorRef, error, supervised.restartCount);

      // Stop the actor
      await supervised.actorRef.stop();

      // Wait before restarting
      if (this.options.restartDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.options.restartDelay));
      }

      // Restart the actor
      supervised.actorRef.start();
    } catch (restartError) {
      console.error(`Failed to restart actor ${supervised.actorRef.id}:`, restartError);
      this.options.onFailure(supervised.actorRef, error);
      await this.stopActor(supervised, error);
    }
  }

  /**
   * Stop an actor
   */
  private async stopActor(supervised: SupervisedActor, error: Error): Promise<void> {
    try {
      await supervised.actorRef.stop();
    } catch (stopError) {
      console.error(`Error stopping actor ${supervised.actorRef.id}:`, stopError);
    }

    this.unsupervise(supervised.actorRef.id);
    this.options.onFailure(supervised.actorRef, error);
  }

  /**
   * Resume actor without restart (ignore the error)
   */
  private async resumeActor(supervised: SupervisedActor, error: Error): Promise<void> {
    console.warn(`Resuming actor ${supervised.actorRef.id} after error:`, error.message);

    // Log the error but don't take any action
    this.options.onFailure(supervised.actorRef, error);

    // Actor continues running without interruption
    // This is useful for non-critical errors that can be safely ignored
  }

  /**
   * Escalate failure to parent supervisor
   */
  private async escalateFailure(supervised: SupervisedActor, error: Error): Promise<void> {
    // For now, just log and stop the actor
    console.error(`Escalating failure for actor ${supervised.actorRef.id}:`, error);
    await this.stopActor(supervised, error);
  }
}
