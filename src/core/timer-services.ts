/**
 * Timer Services Factory - XState-based timing utilities
 *
 * Replaces setTimeout, setInterval, and requestAnimationFrame with XState services
 * that provide automatic cleanup, cancellation, and integration with actor lifecycle.
 *
 * Part of Phase 0.7 Reactive Infrastructure
 */

import type { AnyEventObject } from 'xstate';
import { fromCallback, fromPromise, setup } from 'xstate';

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
 * Replaces setTimeout with XState delay
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
 *         input: { delay: 1000 },
 *         onDone: 'completed'
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createDelayService = () => {
  return fromPromise<void, DelayOptions>(async ({ input }) => {
    return new Promise<void>((resolve) => {
      setTimeout(() => resolve(), input.delay);
    });
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

    // Send immediate tick if requested
    if (immediate) {
      sendBack({
        type: 'TICK',
        count: tickCount++,
        data: data || null,
      });

      // Check if we've reached max ticks
      if (maxTicks && tickCount >= maxTicks) {
        sendBack({ type: 'COMPLETE', totalTicks: tickCount });
        return;
      }
    }

    const intervalId = setInterval(() => {
      sendBack({
        type: 'TICK',
        count: tickCount++,
        data: data || null,
      });

      // Check if we've reached max ticks
      if (maxTicks && tickCount >= maxTicks) {
        clearInterval(intervalId);
        sendBack({ type: 'COMPLETE', totalTicks: tickCount });
      }
    }, interval);

    // Handle stop events
    receive((event) => {
      if (event.type === 'STOP' || event.type === 'CANCEL') {
        clearInterval(intervalId);
        sendBack({ type: 'CANCELLED', totalTicks: tickCount });
      }
    });

    // Cleanup function
    return () => {
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

    const animate = (currentTime: number) => {
      if (stopped) return;

      if (!startTime) {
        startTime = currentTime;
      }

      const elapsed = currentTime - startTime;
      const deltaTime = currentTime - lastFrameTime;

      // Throttle to target FPS
      if (deltaTime >= frameInterval) {
        frameCount++;

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
    rafId = requestAnimationFrame(animate);

    // Handle stop events
    receive((event) => {
      if (event.type === 'STOP' || event.type === 'CANCEL') {
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

    const execute = () => {
      if (maxWaitTimeoutId) {
        clearTimeout(maxWaitTimeoutId);
      }
      sendBack({ type: 'DEBOUNCE_COMPLETE', waitTime: Date.now() - startTime });
    };

    const scheduleExecution = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(execute, delay);
    };

    // Initial schedule
    scheduleExecution();

    // Set max wait timeout if specified
    if (maxWait) {
      maxWaitTimeoutId = setTimeout(execute, maxWait);
    }

    // Handle reset events
    receive((event) => {
      if (event.type === 'RESET') {
        startTime = Date.now();
        scheduleExecution();

        // Reset max wait timeout
        if (maxWait) {
          if (maxWaitTimeoutId) clearTimeout(maxWaitTimeoutId);
          maxWaitTimeoutId = setTimeout(execute, maxWait);
        }
      } else if (event.type === 'CANCEL') {
        clearTimeout(timeoutId);
        if (maxWaitTimeoutId) clearTimeout(maxWaitTimeoutId);
        sendBack({ type: 'DEBOUNCE_CANCELLED' });
      }
    });

    // Cleanup function
    return () => {
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

    const execute = () => {
      lastExecutionTime = Date.now();
      pendingExecution = false;
      sendBack({ type: 'THROTTLE_EXECUTE' });
    };

    const scheduleTrailingExecution = () => {
      if (trailing && !timeoutId) {
        const timeToWait = interval - (Date.now() - lastExecutionTime);
        timeoutId = setTimeout(
          () => {
            timeoutId = undefined;
            if (pendingExecution) {
              execute();
              sendBack({ type: 'THROTTLE_COMPLETE' });
            }
          },
          Math.max(0, timeToWait)
        );
      }
    };

    // Handle trigger events
    receive((event) => {
      if (event.type === 'TRIGGER') {
        const now = Date.now();
        const timeSinceLastExecution = now - lastExecutionTime;

        if (timeSinceLastExecution >= interval) {
          // Can execute immediately
          if (leading) {
            execute();
          }
          scheduleTrailingExecution();
        } else {
          // Mark that we have a pending execution
          pendingExecution = true;
          scheduleTrailingExecution();
        }
      } else if (event.type === 'CANCEL') {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        pendingExecution = false;
        sendBack({ type: 'THROTTLE_CANCELLED' });
      }
    });

    // Initial leading execution if configured
    if (leading) {
      execute();
    }

    // Cleanup function
    return () => {
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
