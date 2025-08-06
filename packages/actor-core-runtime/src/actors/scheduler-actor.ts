/**
 * @module actor-core/runtime/actors/scheduler-actor
 * @description Pure actor-based scheduling system replacing native timers
 * @author XState Timer Replacement Implementation
 */

import { type Actor, type AnyStateMachine, createActor, setup } from 'xstate';
import type { ActorRef } from '../actor-ref.js';
import type { ActorMessage } from '../actor-system.js';
import { Logger } from '../logger.js';

// ========================================================================================
// TYPES
// ========================================================================================

/**
 * Schedule types supported by the scheduler
 */
export type ScheduleType = 'SCHEDULE_ONCE' | 'SCHEDULE_RECURRING' | 'CANCEL_SCHEDULE';

/**
 * Schedule request message
 */
export interface ScheduleMessage extends ActorMessage {
  type: ScheduleType;
  delay?: number;
  interval?: number;
  targetId: string;
  message: ActorMessage;
  scheduleId?: string;
}

/**
 * Schedule response message
 */
export interface ScheduleResponse extends ActorMessage {
  type: 'SCHEDULE_CREATED' | 'SCHEDULE_CANCELLED' | 'SCHEDULE_ERROR';
  scheduleId: string;
  error?: string;
}

/**
 * Individual timer state
 */
interface TimerState {
  scheduleId: string;
  targetId: string;
  message: ActorMessage;
  delay?: number;
  interval?: number;
  type: 'once' | 'recurring';
}

/**
 * Scheduler actor context
 */
interface SchedulerContext {
  activeTimers: Map<string, Actor<AnyStateMachine>>;
  scheduleCounter: number;
}

// ========================================================================================
// TIMER ACTOR
// ========================================================================================

/**
 * Creates a timer actor for individual scheduled events
 */
function createTimerMachine(config: TimerState) {
  return setup({
    types: {
      context: {} as TimerState,
      events: {} as { type: 'START' } | { type: 'CANCEL' } | { type: 'TICK' },
    },
    actions: {
      sendScheduledMessage: () => {
        // This action will be handled by the parent scheduler
        // In a real implementation, this would send the scheduled message
      },
    },
  }).createMachine({
    id: `timer-${config.scheduleId}`,
    context: config,
    initial: 'idle',
    states: {
      idle: {
        on: {
          START: 'active',
        },
      },
      active: {
        initial: config.type === 'once' ? 'scheduled' : 'recurring',
        states: {
          scheduled: {
            after: {
              [config.delay || 0]: {
                target: '#completed',
                actions: ['sendScheduledMessage'],
              },
            },
          },
          recurring: {
            after: {
              [config.interval || 1000]: {
                target: 'recurring',
                actions: ['sendScheduledMessage'],
                reenter: true,
              },
            },
          },
        },
        on: {
          CANCEL: 'cancelled',
        },
      },
      completed: {
        id: 'completed',
        type: 'final',
      },
      cancelled: {
        type: 'final',
      },
    },
  });
}

// ========================================================================================
// SCHEDULER ACTOR
// ========================================================================================

/**
 * Main scheduler actor state machine
 */
export const schedulerMachine = setup({
  types: {
    context: {} as SchedulerContext,
    events: {} as ScheduleMessage | { type: 'CLEANUP' },
  },
  actions: {
    createTimer: ({ context, event }, params?: { targetActor: ActorRef<ActorMessage> }) => {
      if (!isScheduleMessage(event)) return;

      const scheduleId = `schedule-${Date.now()}-${context.scheduleCounter++}`;
      const { delay, interval, targetId, message } = event;

      const timerConfig: TimerState = {
        scheduleId,
        targetId,
        message,
        delay,
        interval,
        type: event.type === 'SCHEDULE_ONCE' ? 'once' : 'recurring',
      };

      const timerMachine = createTimerMachine(timerConfig);
      const timerActor = createActor(timerMachine, {
        systemId: scheduleId,
      });

      // Set up timer completion handling
      timerActor.subscribe((state) => {
        if (state.matches('completed') || state.matches('cancelled')) {
          context.activeTimers.delete(scheduleId);
          timerActor.stop();
        }
      });

      // Store timer reference
      context.activeTimers.set(scheduleId, timerActor);

      // Start the timer
      timerActor.start();
      timerActor.send({ type: 'START' });

      // Send response to requester
      if (params?.targetActor) {
        const response: ScheduleResponse = {
          type: 'SCHEDULE_CREATED',
          scheduleId,
        };
        params.targetActor.send(response);
      }
    },

    cancelTimer: ({ context, event }, params?: { targetActor: ActorRef<ActorMessage> }) => {
      if (!isScheduleMessage(event) || event.type !== 'CANCEL_SCHEDULE') return;

      const scheduleId = event.scheduleId;
      if (!scheduleId) {
        if (params?.targetActor) {
          const response: ScheduleResponse = {
            type: 'SCHEDULE_ERROR',
            scheduleId: '',
            error: 'Missing scheduleId for cancellation',
          };
          params.targetActor.send(response);
        }
        return;
      }

      const timer = context.activeTimers.get(scheduleId);
      if (timer) {
        timer.send({ type: 'CANCEL' });
        context.activeTimers.delete(scheduleId);

        if (params?.targetActor) {
          const response: ScheduleResponse = {
            type: 'SCHEDULE_CANCELLED',
            scheduleId,
          };
          params.targetActor.send(response);
        }
      } else if (params?.targetActor) {
        const response: ScheduleResponse = {
          type: 'SCHEDULE_ERROR',
          scheduleId,
          error: 'Schedule not found',
        };
        params.targetActor.send(response);
      }
    },

    cleanupTimers: ({ context }) => {
      // Cancel all active timers
      for (const [, timer] of context.activeTimers) {
        timer.send({ type: 'CANCEL' });
        timer.stop();
      }
      context.activeTimers.clear();
    },
  },
}).createMachine({
  id: 'scheduler',
  context: {
    activeTimers: new Map(),
    scheduleCounter: 0,
  },
  initial: 'running',
  states: {
    running: {
      on: {
        SCHEDULE_ONCE: {
          actions: 'createTimer',
        },
        SCHEDULE_RECURRING: {
          actions: 'createTimer',
        },
        CANCEL_SCHEDULE: {
          actions: 'cancelTimer',
        },
        CLEANUP: {
          actions: 'cleanupTimers',
          target: 'stopped',
        },
      },
    },
    stopped: {
      type: 'final',
    },
  },
});

// ========================================================================================
// TYPE GUARDS
// ========================================================================================

/**
 * Type guard for schedule messages
 */
function isScheduleMessage(event: unknown): event is ScheduleMessage {
  return (
    event !== null &&
    typeof event === 'object' &&
    'type' in event &&
    ((event as { type: string }).type === 'SCHEDULE_ONCE' ||
      (event as { type: string }).type === 'SCHEDULE_RECURRING' ||
      (event as { type: string }).type === 'CANCEL_SCHEDULE')
  );
}

// ========================================================================================
// SCHEDULER ACTOR CLASS
// ========================================================================================

/**
 * High-level scheduler actor API
 */
export class SchedulerActor {
  private actor: Actor<typeof schedulerMachine>;
  private logger = Logger.namespace('SCHEDULER_ACTOR');

  constructor() {
    this.actor = createActor(schedulerMachine);
  }

  /**
   * Start the scheduler actor
   */
  start(): void {
    this.actor.start();
    this.logger.info('Scheduler actor started');
  }

  /**
   * Stop the scheduler actor
   */
  async stop(): Promise<void> {
    this.actor.send({ type: 'CLEANUP' });
    this.actor.stop();
    this.logger.info('Scheduler actor stopped');
  }

  /**
   * Send a message to the scheduler
   */
  send(message: ScheduleMessage | { type: 'CLEANUP' }): void {
    this.actor.send(message);
  }

  /**
   * Get the internal XState actor reference
   * This can be used to create an ActorRef wrapper when needed
   */
  getActor(): Actor<typeof schedulerMachine> {
    return this.actor;
  }

  /**
   * Subscribe to scheduler events
   */
  subscribe(_eventType: string, _handler: (event: ActorMessage) => void): () => void {
    // For now, return a no-op unsubscribe
    // This will be properly implemented when integrated with the actor system
    return () => {};
  }

  /**
   * Schedule a one-time event
   */
  scheduleOnce(delay: number, targetId: string, message: ActorMessage): Promise<string> {
    const scheduleId = `schedule-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const scheduleMessage: ScheduleMessage = {
      type: 'SCHEDULE_ONCE',
      delay,
      targetId,
      message,
    };

    this.send(scheduleMessage);

    // Return the schedule ID immediately
    // The actual scheduling is handled by the state machine
    return Promise.resolve(scheduleId);
  }

  /**
   * Schedule a recurring event
   */
  scheduleRecurring(interval: number, targetId: string, message: ActorMessage): Promise<string> {
    const scheduleId = `schedule-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const scheduleMessage: ScheduleMessage = {
      type: 'SCHEDULE_RECURRING',
      interval,
      targetId,
      message,
    };

    this.send(scheduleMessage);

    // Return the schedule ID immediately
    return Promise.resolve(scheduleId);
  }

  /**
   * Cancel a scheduled event
   */
  cancel(scheduleId: string): Promise<void> {
    const cancelMessage: ScheduleMessage = {
      type: 'CANCEL_SCHEDULE',
      scheduleId,
      targetId: '',
      message: { type: 'NOOP' },
    };

    this.send(cancelMessage);

    // Return immediately
    return Promise.resolve();
  }

  /**
   * Get current system time
   */
  getTime(): number {
    return Date.now();
  }
}

// ========================================================================================
// FACTORY FUNCTION
// ========================================================================================

/**
 * Create a new scheduler actor
 */
export function createSchedulerActor(): SchedulerActor {
  return new SchedulerActor();
}
