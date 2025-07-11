/**
 * Timer Services Factory - XState-based timing utilities
 *
 * Replaces setTimeout, setInterval, and requestAnimationFrame with XState services
 * that provide automatic cleanup, cancellation, and integration with actor lifecycle.
 *
 * Part of Phase 0.7 Reactive Infrastructure
 */

import { type AnyEventObject, fromCallback, fromPromise, setup } from 'xstate';
import { Logger } from './dev-mode.js';
import { NAMESPACES } from './namespace-constants.js';

// ===== TYPE DEFINITIONS =====

export interface DelayOptions {
  /** Delay in milliseconds */
  delay: number;
  /** Optional data to pass with completion event */
  data?: unknown;
}

export interface IntervalOptions {
  /** Interval duration in milliseconds */
  interval: number;
  /** Maximum number of ticks (optional, runs indefinitely if not set) */
  maxTicks?: number;
  /** Whether to emit the first tick immediately */
  immediate?: boolean;
  /** Optional data to pass with each tick */
  data?: unknown;
}

export interface AnimationFrameOptions {
  /** Maximum duration in milliseconds (optional) */
  maxDuration?: number;
  /** Target FPS (defaults to 60) */
  targetFPS?: number;
  /** Optional data to pass with each frame */
  data?: unknown;
}

export interface DebounceOptions {
  /** Debounce delay in milliseconds */
  delay: number;
  /** Maximum wait time before forcing execution */
  maxWait?: number;
}

export interface ThrottleOptions {
  /** Throttle interval in milliseconds */
  interval: number;
  /** Whether to call on leading edge */
  leading?: boolean;
  /** Whether to call on trailing edge */
  trailing?: boolean;
}

// ===== DELAY SERVICE =====

/**
 * Create a delay service for state machines
 * Replaces setTimeout with XState promise service
 *
 * @example
 * ```typescript
 * const delayService = createDelayService();
 *
 * const machine = setup({
 *   actors: { delay: delayService }
 * }).createMachine({
 *   states: {
 *     waiting: {
 *       invoke: {
 *         src: 'delay',
 *         input: { duration: 1000, data: { reason: 'cooldown' } }
 *       },
 *       on: {
 *         DELAY_COMPLETE: 'ready'
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createDelayService = () => {
  return fromPromise<{ type: 'DELAY_COMPLETE'; data: unknown }, DelayOptions>(async ({ input }) => {
    const { delay, data } = input;

    const log = Logger.namespace(NAMESPACES.TIMER.DELAY);
    log.debug('Service created', { delay, data });

    await new Promise((resolve) => setTimeout(resolve, delay));

    log.debug('Delay complete', { delay, data });
    return { type: 'DELAY_COMPLETE', data: data || null };
  });
};

// ===== INTERVAL SERVICE =====

/**
 * Create an interval service for state machines
 * Replaces setInterval with XState callback service
 *
 * @example
 * ```typescript
 * const intervalService = createIntervalService();
 *
 * const machine = setup({
 *   actors: { interval: intervalService }
 * }).createMachine({
 *   states: {
 *     polling: {
 *       invoke: {
 *         src: 'interval',
 *         input: { interval: 1000, maxTicks: 10 }
 *       },
 *       on: {
 *         TICK: { actions: 'handleTick' },
 *         COMPLETE: 'finished'
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createIntervalService = () => {
  return fromCallback<AnyEventObject, IntervalOptions>(({ sendBack, input, receive }) => {
    let tickCount = 0;
    const { interval, immediate, maxTicks, data } = input;

    const log = Logger.namespace(NAMESPACES.TIMER.INTERVAL);
    log.debug('Service created', { interval, immediate, maxTicks, data });

    // Send immediate tick if requested
    if (immediate) {
      log.debug('Sending immediate tick', { tickCount });
      sendBack({
        type: 'TICK',
        count: tickCount++,
        data: data || null,
      });

      // Check if we've reached max ticks
      if (maxTicks && tickCount >= maxTicks) {
        log.debug('Max ticks reached on immediate', { tickCount, maxTicks });
        sendBack({ type: 'COMPLETE', totalTicks: tickCount });
        return;
      }
    }

    log.debug('Starting interval', { interval });
    const intervalId = setInterval(() => {
      log.debug('Interval tick', { tickCount, maxTicks });
      sendBack({
        type: 'TICK',
        count: tickCount++,
        data: data || null,
      });

      // Check if we've reached max ticks
      if (maxTicks && tickCount >= maxTicks) {
        log.debug('Max ticks reached, stopping', { tickCount, maxTicks });
        clearInterval(intervalId);
        sendBack({ type: 'COMPLETE', totalTicks: tickCount });
      }
    }, interval);

    // Handle stop events
    receive((event) => {
      log.debug('Received event', { type: event.type });
      if (event.type === 'STOP' || event.type === 'CANCEL') {
        log.debug('Stopping interval', { tickCount });
        clearInterval(intervalId);
        sendBack({ type: 'CANCELLED', totalTicks: tickCount });
      }
    });

    // Cleanup function
    return () => {
      log.debug('Cleanup called', { tickCount });
      clearInterval(intervalId);
    };
  });
};

// ===== ANIMATION FRAME SERVICE =====

/**
 * Create animation frame service for state machines
 * Replaces requestAnimationFrame loops with XState service
 *
 * @example
 * ```typescript
 * const animationService = createAnimationFrameService();
 *
 * const machine = setup({
 *   actors: { animation: animationService }
 * }).createMachine({
 *   states: {
 *     animating: {
 *       invoke: {
 *         src: 'animation',
 *         input: { maxDuration: 5000, targetFPS: 60 }
 *       },
 *       on: {
 *         FRAME: { actions: 'updateAnimation' },
 *         ANIMATION_COMPLETE: 'finished'
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createAnimationFrameService = () => {
  return fromCallback<AnyEventObject, AnimationFrameOptions>(({ sendBack, input, receive }) => {
    const { maxDuration, targetFPS = 60, data } = input;
    const frameInterval = 1000 / targetFPS;

    let startTime: number;
    let lastFrameTime = 0;
    let frameCount = 0;
    let rafId: number;
    let stopped = false;

    const log = Logger.namespace(NAMESPACES.TIMER.ANIMATION_FRAME);
    log.debug('Service created', { maxDuration, targetFPS, frameInterval });

    const animate = (currentTime: number) => {
      if (stopped) {
        log.debug('Animation stopped, exiting');
        return;
      }

      if (!startTime) {
        startTime = currentTime;
        log.debug('Animation started', { startTime });
      }

      const elapsed = currentTime - startTime;
      const deltaTime = currentTime - lastFrameTime;

      // Throttle to target FPS
      if (deltaTime >= frameInterval) {
        frameCount++;
        log.debug('Frame rendered', { frameCount, elapsed, deltaTime });

        sendBack({
          type: 'FRAME',
          frameCount,
          elapsed,
          deltaTime,
          currentTime,
          data: data || null,
        });

        lastFrameTime = currentTime;
      }

      // Check if we've reached max duration
      if (maxDuration && elapsed >= maxDuration) {
        log.debug('Max duration reached', {
          elapsed,
          maxDuration,
          frameCount,
        });
        sendBack({
          type: 'ANIMATION_COMPLETE',
          totalFrames: frameCount,
          totalTime: elapsed,
        });
        return;
      }

      rafId = requestAnimationFrame(animate);
    };

    // Start animation
    log.debug('Starting animation loop');
    rafId = requestAnimationFrame(animate);

    // Handle stop events
    receive((event) => {
      log.debug('Received event', { type: event.type });
      if (event.type === 'STOP' || event.type === 'CANCEL') {
        log.debug('Stopping animation', { frameCount });
        stopped = true;
        cancelAnimationFrame(rafId);
        sendBack({
          type: 'ANIMATION_CANCELLED',
          totalFrames: frameCount,
          totalTime: performance.now() - (startTime || 0),
        });
      }
    });

    // Cleanup function
    return () => {
      log.debug('Cleanup called', { frameCount, stopped });
      stopped = true;
      cancelAnimationFrame(rafId);
    };
  });
};

// ===== DEBOUNCE SERVICE =====

/**
 * Create a debounce service for state machines
 * Debounces events and only executes after a period of inactivity
 *
 * @example
 * ```typescript
 * const debounceService = createDebounceService();
 *
 * const machine = setup({
 *   actors: { debounce: debounceService }
 * }).createMachine({
 *   states: {
 *     idle: {
 *       on: {
 *         INPUT: 'debouncing'
 *       }
 *     },
 *     debouncing: {
 *       invoke: {
 *         src: 'debounce',
 *         input: { delay: 300 }
 *       },
 *       on: {
 *         INPUT: 'debouncing', // Reset debounce
 *         DEBOUNCE_COMPLETE: { target: 'idle', actions: 'executeAction' }
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createDebounceService = () => {
  return fromCallback<AnyEventObject, DebounceOptions>(({ sendBack, input, receive }) => {
    const { delay, maxWait } = input;
    let timeoutId: ReturnType<typeof setTimeout>;
    let maxWaitTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let startTime = Date.now();

    const log = Logger.namespace(NAMESPACES.TIMER.DEBOUNCE);
    log.debug('Service created', { delay, maxWait });

    const execute = () => {
      const waitTime = Date.now() - startTime;
      log.debug('Executing', { waitTime });
      if (maxWaitTimeoutId) {
        clearTimeout(maxWaitTimeoutId);
      }
      sendBack({ type: 'DEBOUNCE_COMPLETE', waitTime });
    };

    const scheduleExecution = () => {
      clearTimeout(timeoutId);
      log.debug('Scheduling execution', { delay });
      timeoutId = setTimeout(execute, delay);
    };

    // Initial schedule
    scheduleExecution();

    // Set max wait timeout if specified
    if (maxWait) {
      log.debug('Setting max wait timeout', { maxWait });
      maxWaitTimeoutId = setTimeout(execute, maxWait);
    }

    // Handle reset events
    receive((event) => {
      log.debug('Received event', { type: event.type });
      if (event.type === 'RESET') {
        startTime = Date.now();
        log.debug('Resetting debounce timer', { startTime });
        scheduleExecution();

        // Reset max wait timeout
        if (maxWait) {
          if (maxWaitTimeoutId) clearTimeout(maxWaitTimeoutId);
          maxWaitTimeoutId = setTimeout(execute, maxWait);
          log.debug('Reset max wait timeout', { maxWait });
        }
      } else if (event.type === 'CANCEL') {
        log.debug('Cancelling debounce');
        clearTimeout(timeoutId);
        if (maxWaitTimeoutId) clearTimeout(maxWaitTimeoutId);
        sendBack({ type: 'DEBOUNCE_CANCELLED' });
      }
    });

    // Cleanup function
    return () => {
      log.debug('Cleanup called');
      clearTimeout(timeoutId);
      if (maxWaitTimeoutId) clearTimeout(maxWaitTimeoutId);
    };
  });
};

// ===== THROTTLE SERVICE =====

/**
 * Create a throttle service for state machines
 * Limits execution to at most once per specified interval
 *
 * @example
 * ```typescript
 * const throttleService = createThrottleService();
 *
 * const machine = setup({
 *   actors: { throttle: throttleService }
 * }).createMachine({
 *   states: {
 *     ready: {
 *       on: {
 *         TRIGGER: 'throttling'
 *       }
 *     },
 *     throttling: {
 *       invoke: {
 *         src: 'throttle',
 *         input: { interval: 100, leading: true, trailing: true }
 *       },
 *       on: {
 *         TRIGGER: 'throttling', // Continue throttling
 *         THROTTLE_EXECUTE: { actions: 'executeAction' },
 *         THROTTLE_COMPLETE: 'ready'
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createThrottleService = () => {
  return fromCallback<AnyEventObject, ThrottleOptions>(({ sendBack, input, receive }) => {
    const { interval, leading = true, trailing = true } = input;
    let lastExecutionTime = 0;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let pendingExecution = false;

    const log = Logger.namespace(NAMESPACES.TIMER.THROTTLE);
    log.debug('Service created', { interval, leading, trailing });

    const execute = () => {
      lastExecutionTime = performance.now();
      pendingExecution = false;
      log.debug('Executing', { lastExecutionTime, pendingExecution });
      log.debug('Sending THROTTLE_EXECUTE');
      sendBack({ type: 'THROTTLE_EXECUTE' });
    };

    const scheduleTrailingExecution = () => {
      if (trailing && !timeoutId && pendingExecution) {
        const timeToWait = interval - (performance.now() - lastExecutionTime);
        log.debug('Scheduling trailing execution', { timeToWait, interval });
        timeoutId = setTimeout(
          () => {
            timeoutId = undefined;
            log.debug('Trailing timeout fired', { pendingExecution });
            if (pendingExecution) {
              execute();
              // Defer THROTTLE_COMPLETE to let THROTTLE_EXECUTE action process first
              log.debug('Deferring THROTTLE_COMPLETE to avoid race condition');
              queueMicrotask(() => {
                log.debug('Sending deferred THROTTLE_COMPLETE');
                sendBack({ type: 'THROTTLE_COMPLETE' });
              });
            }
          },
          Math.max(0, timeToWait)
        );
      } else {
        log.debug('Not scheduling trailing', {
          trailing,
          hasTimeout: !!timeoutId,
          pendingExecution,
        });
      }
    };

    // Handle trigger events
    receive((event) => {
      log.debug('Received event', { type: event.type });
      if (event.type === 'TRIGGER') {
        const now = performance.now();
        const timeSinceLastExecution = now - lastExecutionTime;

        log.debug('Processing TRIGGER', {
          now,
          lastExecutionTime,
          timeSinceLastExecution,
          interval,
          canExecute: timeSinceLastExecution >= interval || lastExecutionTime === 0,
        });

        if (timeSinceLastExecution >= interval || lastExecutionTime === 0) {
          // Can execute immediately (leading edge or first execution)
          if (leading) {
            log.debug('Executing immediately (leading=true)');
            execute();
          } else {
            // If leading is false, mark pending for trailing execution
            log.debug('Marking pending for trailing (leading=false)');
            pendingExecution = true;
          }
          scheduleTrailingExecution();
        } else {
          // Mark that we have a pending execution
          log.debug('Marking pending execution (within throttle window)');
          pendingExecution = true;
          scheduleTrailingExecution();
        }
      } else if (event.type === 'CANCEL') {
        log.debug('Cancelling throttle');
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        pendingExecution = false;
        sendBack({ type: 'THROTTLE_CANCELLED' });
      }
    });

    // Cleanup function
    return () => {
      log.debug('Cleanup called');
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  });
};

// ===== CONVENIENCE MACHINE CREATORS =====

/**
 * Create a simple delay machine that transitions after a specified time
 *
 * @example
 * ```typescript
 * const delayMachine = createDelayMachine(1000);
 * const actor = createActor(delayMachine);
 * actor.subscribe(state => {
 *   if (state.matches('completed')) {
 *     console.log('Delay completed!');
 *   }
 * });
 * actor.start();
 * ```
 */
export const createDelayMachine = (delay: number) => {
  return setup({
    actors: {
      delay: createDelayService(),
    },
  }).createMachine({
    id: 'delay',
    initial: 'waiting',
    states: {
      waiting: {
        invoke: {
          src: 'delay',
          input: { delay },
          onDone: 'completed',
        },
      },
      completed: {
        type: 'final',
      },
    },
  });
};

/**
 * Create a simple interval machine that emits ticks
 *
 * @example
 * ```typescript
 * const intervalMachine = createIntervalMachine(1000, 5);
 * const actor = createActor(intervalMachine);
 * actor.subscribe(state => {
 *   console.log('Current tick:', state.context.tickCount);
 * });
 * actor.start();
 * ```
 */
export const createIntervalMachine = (interval: number, maxTicks?: number) => {
  return setup({
    types: {
      context: {} as { tickCount: number },
    },
    actors: {
      interval: createIntervalService(),
    },
  }).createMachine({
    id: 'interval',
    initial: 'running',
    context: {
      tickCount: 0,
    },
    states: {
      running: {
        invoke: {
          src: 'interval',
          input: { interval, maxTicks },
        },
        on: {
          TICK: {
            actions: ({ context }) => {
              context.tickCount++;
            },
          },
          COMPLETE: 'finished',
        },
      },
      finished: {
        type: 'final',
      },
    },
  });
};

// ===== EXPORT ALL SERVICES =====

/**
 * Pre-configured timer services for common use cases
 */
export const TimerServices = {
  delay: createDelayService(),
  interval: createIntervalService(),
  animationFrame: createAnimationFrameService(),
  debounce: createDebounceService(),
  throttle: createThrottleService(),
} as const;

/**
 * Machine factories for quick timer setups
 */
export const TimerMachines = {
  delay: createDelayMachine,
  interval: createIntervalMachine,
} as const;

// ===== DEFAULT EXPORT =====

export default TimerServices;
