/**
 * @module actor-core/runtime/actor-based-timer
 * @description Pure actor-based timer implementation
 */

import type { ActorRef } from '../actor-ref.js';
import type { ActorMessage } from '../actor-system.js';
import { createSchedulerActor, type SchedulerActor } from '../actors/scheduler-actor.js';
import { Logger } from '../logger.js';
import type { RuntimeTimer } from '../runtime-adapter.js';

/**
 * Pure actor-based timer implementation
 */
export class ActorBasedTimer implements RuntimeTimer {
  private scheduler: SchedulerActor;
  private logger = Logger.namespace('ACTOR_TIMER');

  constructor(scheduler?: SchedulerActor, environment = 'unknown') {
    this.scheduler = scheduler || createSchedulerActor();
    this.logger = Logger.namespace(`ACTOR_TIMER_${environment.toUpperCase()}`);
  }

  /**
   * Initialize the timer (starts the scheduler actor)
   */
  initialize(): void {
    this.scheduler.start();
    this.logger.debug('Actor-based timer initialized');
  }

  /**
   * Schedule a message to be sent to a target actor after a delay
   */
  async scheduleMessage(delay: number, target: ActorRef, message: ActorMessage): Promise<string> {
    // Extract actor ID from the target
    // TODO: This needs to be properly implemented once ActorRef has an ID property
    const targetId = this.extractActorId(target);

    this.logger.debug('Scheduling message', { delay, targetId, messageType: message.type });
    return this.scheduler.scheduleOnce(delay, targetId, message);
  }

  /**
   * Schedule a recurring message to be sent to a target actor
   */
  async scheduleRecurringMessage(
    interval: number,
    target: ActorRef,
    message: ActorMessage
  ): Promise<string> {
    // Extract actor ID from the target
    const targetId = this.extractActorId(target);

    this.logger.debug('Scheduling recurring message', {
      interval,
      targetId,
      messageType: message.type,
    });
    return this.scheduler.scheduleRecurring(interval, targetId, message);
  }

  /**
   * Cancel a scheduled message
   */
  async cancelSchedule(scheduleId: string): Promise<void> {
    this.logger.debug('Cancelling schedule', { scheduleId });
    return this.scheduler.cancel(scheduleId);
  }

  /**
   * Get current timestamp
   */
  now(): number {
    return this.scheduler.getTime();
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.scheduler.stop();
    this.logger.debug('Actor-based timer cleaned up');
  }

  /**
   * Extract actor ID from ActorRef
   * TODO: This is a temporary implementation until ActorRef exposes an ID property
   */
  private extractActorId(actor: ActorRef): string {
    // Try to extract ID from the actor reference
    // This is a placeholder implementation
    if ('id' in actor && typeof actor.id === 'string') {
      return actor.id;
    }
    if ('_id' in actor && typeof actor._id === 'string') {
      return actor._id;
    }
    // Fallback to a generated ID
    return `actor-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}
