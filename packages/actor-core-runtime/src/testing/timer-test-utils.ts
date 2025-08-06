/**
 * @module actor-core/runtime/testing/timer-test-utils
 * @description Test utilities for working with the Timer Actor in tests
 */

import type { ActorRef } from '../actor-ref.js';
import type { ActorSystem } from '../actor-system.js';
import {
  type AdvanceTimeMessage,
  createTestTimerBehavior,
  type ScheduleDelayMessage,
  type ScheduleMessage,
  type TimerActorRef,
} from '../actors/timer-actor.js';
import { Logger } from '../logger.js';
import type { Message } from '../types.js';

const log = Logger.namespace('TIMER_TEST_UTILS');

/**
 * Extended actor system with timer control for tests
 */
export interface TestActorSystem extends ActorSystem {
  /**
   * Advance time and deliver all scheduled messages
   */
  advanceTime(ms: number): Promise<void>;

  /**
   * Get the timer actor reference
   */
  getTimerActor(): TimerActorRef;

  /**
   * Flush messages and advance time until no more scheduled messages
   */
  flushWithTime(maxTime?: number): Promise<void>;
}

/**
 * Set up a timer actor for testing
 */
export async function setupTimerActor(system: ActorSystem): Promise<TimerActorRef> {
  const timerBehavior = createTestTimerBehavior();
  const timerActor = await system.spawn(timerBehavior, {
    id: 'timer-actor',
    // Timer actor should be a system actor
    // Timer actor is a core system actor
  });

  // Create a wrapper with convenience methods without type casting
  const timerRef: TimerActorRef = {
    // Include all ActorRef properties
    address: timerActor.address,
    send: timerActor.send.bind(timerActor),
    ask: timerActor.ask.bind(timerActor),
    stop: timerActor.stop.bind(timerActor),
    isAlive: timerActor.isAlive.bind(timerActor),
    getStats: timerActor.getStats.bind(timerActor),
    getSnapshot: timerActor.getSnapshot.bind(timerActor),

    // Add timer-specific methods
    schedule: async (targetActor: ActorRef<unknown>, message: Message, delay: number) => {
      log.debug('🔧 TimerRef.schedule called:', {
        targetPath: targetActor.address.path,
        messageType: message.type,
        delay,
      });
      const scheduleMsg: ScheduleMessage = {
        type: 'SCHEDULE',
        targetActor,
        message,
        delay,
      };
      log.debug('📤 Sending SCHEDULE message to:', timerActor.address.path);
      await timerActor.send(scheduleMsg);
      log.debug('✅ SCHEDULE message sent');
    },

    delay: async (duration: number, callbackMessage: Message, targetActor: ActorRef<unknown>) => {
      const delayMsg: ScheduleDelayMessage = {
        type: 'SCHEDULE_DELAY',
        duration,
        callbackMessage,
        targetActor,
      };
      await timerActor.send(delayMsg);
    },

    advanceTime: async (ms: number) => {
      log.debug('🔧 TimerRef.advanceTime called with:', ms);
      const advanceMsg: AdvanceTimeMessage = {
        type: 'ADVANCE_TIME',
        by: ms,
      };
      log.debug('📤 Sending ADVANCE_TIME message to:', timerActor.address.path);
      await timerActor.send(advanceMsg);
      log.debug('✅ ADVANCE_TIME message sent');
    },

    getScheduled: async () => {
      const getMsg = {
        type: 'GET_SCHEDULED',
      };
      return await timerActor.ask(getMsg);
    },
  };

  return timerRef;
}

/**
 * Enhance an actor system with timer testing capabilities
 */
export async function withTimerTesting<T extends ActorSystem>(
  system: T
): Promise<T & TestActorSystem> {
  const timerActor = await setupTimerActor(system);

  const testSystem = system as T & TestActorSystem;

  testSystem.advanceTime = async (ms: number) => {
    await timerActor.advanceTime(ms);
    await system.flush();
  };

  testSystem.getTimerActor = () => timerActor;

  testSystem.flushWithTime = async (maxTime = 5000) => {
    let totalTimeAdvanced = 0;

    while (totalTimeAdvanced < maxTime) {
      // Check if there are scheduled messages
      const scheduled = await timerActor.getScheduled();
      if (scheduled.count === 0) {
        // No more scheduled messages, we're done
        break;
      }

      // Find the earliest scheduled message
      const earliestTime = Math.min(...scheduled.scheduled.map((s) => s.timeUntilDelivery));

      // Don't advance more than needed or past maxTime
      const timeToAdvance = Math.min(earliestTime, maxTime - totalTimeAdvanced);

      if (timeToAdvance <= 0) {
        // Safety check - if we can't advance, break to avoid infinite loop
        break;
      }

      // Advance time to the next scheduled message
      await testSystem.advanceTime(timeToAdvance);
      totalTimeAdvanced += timeToAdvance;

      // Process any other messages that may have been triggered
      await system.flush();
    }
  };

  return testSystem;
}

/**
 * Create a delay that integrates with the Timer Actor
 * This is a replacement for createActorDelay that works with time control
 *
 * @param system - The test actor system with timer support
 * @param duration - Duration in milliseconds
 * @returns Promise that resolves after the delay
 */
export async function createTimerDelay(system: TestActorSystem, duration: number): Promise<void> {
  // In test mode, we just need to advance time and flush
  // The timer actor will handle message delivery
  await system.advanceTime(duration);

  // For production mode, we would need a different approach
  // But since this is in testing utils, we assume test mode
}

// Note: Actor behaviors should handle DELAY_COMPLETE messages directly if needed
// The Timer Actor pattern uses pure message passing without behavior modification
