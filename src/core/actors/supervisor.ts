/**
 * @module framework/core/actors/supervisor
 * @description Supervision strategies and fault tolerance for actors
 * @author Agent A - 2025-01-10
 */

import type { SystemMessage } from '../messaging/message-types.js';
import type { ActorRef } from './actor-ref.js';
import type { SupervisionStrategy } from './types.js';

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
  onRestart?: (actorRef: ActorRef<EventObject, unknown>, error: Error, attempt: number) => void;

  /**
   * Hook called when supervision fails
   */
  onFailure?: (actorRef: ActorRef<EventObject, unknown>, error: Error) => void;
}

/**
 * Supervises actors and handles their failures according to a strategy
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
   * @param actorRef - The actor to supervise
   */
  supervise(actorRef: ActorRef<EventObject, unknown>): void {
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

    // Subscribe to actor lifecycle events
    this.subscribeToActorEvents(actorRef);
  }

  /**
   * Stop supervising an actor
   * @param actorId - The ID of the actor to stop supervising
   */
  unsupervise(actorId: string): void {
    this.supervisedActors.delete(actorId);
  }

  /**
   * Handle a failure in a supervised actor
   * @param error - The error that occurred
   * @param actorRef - The actor that failed
   */
  async handleFailure(error: Error, actorRef: ActorRef<EventObject, unknown>): Promise<void> {
    const supervised = this.supervisedActors.get(actorRef.id);
    if (!supervised || supervised.isRestarting) {
      return;
    }

    supervised.isRestarting = true;

    try {
      switch (this.options.strategy) {
        case 'restart-on-failure':
          await this.handleRestartOnFailure(supervised, error);
          break;

        case 'stop-on-failure':
          await this.handleStopOnFailure(supervised, error);
          break;

        case 'escalate':
          await this.handleEscalate(supervised, error);
          break;

        default:
          // Default to restart
          await this.handleRestartOnFailure(supervised, error);
      }
    } finally {
      supervised.isRestarting = false;
    }
  }

  /**
   * Get supervision statistics
   */
  getStats(): SupervisionStats {
    const actors = Array.from(this.supervisedActors.values()).map((s) => ({
      actorId: s.actorRef.id,
      restartCount: s.restartCount,
      lastRestartTime: s.restartTimestamps[s.restartTimestamps.length - 1] || null,
    }));

    return {
      supervisedCount: actors.length,
      totalRestarts: actors.reduce((sum, a) => sum + a.restartCount, 0),
      actors,
    };
  }

  /**
   * Clean up all supervised actors
   */
  async cleanup(): Promise<void> {
    const stopPromises = Array.from(this.supervisedActors.values()).map((supervised) =>
      supervised.actorRef.stop()
    );
    await Promise.all(stopPromises);
    this.supervisedActors.clear();
  }

  private async handleRestartOnFailure(supervised: SupervisedActor, error: Error): Promise<void> {
    const now = Date.now();

    // Clean up old restart timestamps outside the window
    supervised.restartTimestamps = supervised.restartTimestamps.filter(
      (timestamp) => now - timestamp < this.options.restartWindow
    );

    // Check if we've exceeded max restarts in the window
    if (supervised.restartTimestamps.length >= this.options.maxRestarts) {
      this.options.onFailure(supervised.actorRef, error);
      await supervised.actorRef.stop();
      this.supervisedActors.delete(supervised.actorRef.id);
      return;
    }

    // Record this restart attempt
    supervised.restartTimestamps.push(now);
    supervised.restartCount++;

    // Notify before restart
    this.options.onRestart(supervised.actorRef, error, supervised.restartCount);

    // Wait for restart delay
    if (this.options.restartDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.restartDelay));
    }

    // Restart the actor
    try {
      await supervised.actorRef.restart();
    } catch (restartError) {
      // If restart fails, stop supervising
      this.options.onFailure(supervised.actorRef, restartError as Error);
      this.supervisedActors.delete(supervised.actorRef.id);
    }
  }

  private async handleStopOnFailure(supervised: SupervisedActor, error: Error): Promise<void> {
    this.options.onFailure(supervised.actorRef, error);
    await supervised.actorRef.stop();
    this.supervisedActors.delete(supervised.actorRef.id);
  }

  private async handleEscalate(supervised: SupervisedActor, error: Error): Promise<void> {
    // If actor has a parent, escalate to parent's supervisor
    if (supervised.actorRef.parent) {
      // Emit error event to parent
      const errorMessage: SystemMessage = {
        type: 'actor.error',
        actorId: supervised.actorRef.id,
        error,
      };
      supervised.actorRef.parent.send(errorMessage);
    } else {
      // No parent, fall back to stop
      await this.handleStopOnFailure(supervised, error);
    }
  }

  private subscribeToActorEvents(actorRef: ActorRef<EventObject, unknown>): void {
    // Subscribe to error states
    actorRef
      .observe((snapshot) => snapshot.status)
      .subscribe({
        next: (status) => {
          if (status === 'error') {
            const snapshot = actorRef.getSnapshot();
            if (snapshot.error) {
              this.handleFailure(snapshot.error, actorRef);
            }
          }
        },
      });
  }
}

/**
 * Internal tracking for supervised actors
 */
interface SupervisedActor {
  actorRef: ActorRef<EventObject, unknown>;
  restartCount: number;
  restartTimestamps: number[];
  isRestarting: boolean;
}

/**
 * Statistics about supervised actors
 */
export interface SupervisionStats {
  supervisedCount: number;
  totalRestarts: number;
  actors: Array<{
    actorId: string;
    restartCount: number;
    lastRestartTime: number | null;
  }>;
}

/**
 * Create a supervised actor with a specific strategy
 */
export function createSupervisedActor<TEvent, TEmitted>(
  actorRef: ActorRef<TEvent, TEmitted>,
  strategy: SupervisionStrategy = 'restart-on-failure',
  options?: Partial<SupervisorOptions>
): ActorRef<TEvent, TEmitted> {
  const supervisor = new Supervisor({
    strategy,
    ...options,
  });

  supervisor.supervise(actorRef);

  return actorRef;
}
