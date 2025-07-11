/**
 * Tests for Timer Services - Actor-SPA Framework
 * Focus: Timing behaviors, lifecycle management, and XState integration
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor, sendTo, setup } from 'xstate';
import {
  createAnimationFrameService,
  createDebounceService,
  createDelayMachine,
  createDelayService,
  createIntervalService,
  createThrottleService,
} from './timer-services.js';

describe('Timer Services', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('Delay Service', () => {
    describe('Basic delay behavior', () => {
      it('completes after specified delay', async () => {
        const delayService = createDelayService();

        const machine = setup({
          actors: { delay: delayService },
        }).createMachine({
          initial: 'waiting',
          states: {
            waiting: {
              invoke: {
                src: 'delay',
                input: { delay: 1000 },
                onDone: 'completed',
              },
            },
            completed: { type: 'final' },
          },
        });

        const actor = createActor(machine);
        actor.start();

        expect(actor.getSnapshot().value).toBe('waiting');

        // Fast-forward time
        vi.advanceTimersByTime(1000);
        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('completed'));
      });

      it('works with different delay durations', async () => {
        const delayService = createDelayService();

        const machine = setup({
          actors: { delay: delayService },
        }).createMachine({
          initial: 'waiting',
          states: {
            waiting: {
              invoke: {
                src: 'delay',
                input: { delay: 500 },
                onDone: 'completed',
              },
            },
            completed: { type: 'final' },
          },
        });

        const actor = createActor(machine);
        actor.start();

        // Should not complete before delay
        vi.advanceTimersByTime(400);
        expect(actor.getSnapshot().value).toBe('waiting');

        // Should complete after delay
        vi.advanceTimersByTime(100);
        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('completed'));
      });
    });

    describe('Convenience delay machine', () => {
      it('creates working delay machine with specified duration', async () => {
        const delayMachine = createDelayMachine(2000);
        const actor = createActor(delayMachine);

        actor.start();
        expect(actor.getSnapshot().value).toBe('waiting');

        vi.advanceTimersByTime(2000);
        await vi.waitFor(() => expect(actor.getSnapshot().value).toBe('completed'));
      });
    });
  });

  describe('Interval Service', () => {
    describe('Basic interval behavior', () => {
      it('emits tick events at specified intervals', () => {
        const intervalService = createIntervalService();
        const tickHandler = vi.fn();

        const machine = setup({
          actors: { interval: intervalService },
        }).createMachine({
          initial: 'polling',
          states: {
            polling: {
              invoke: {
                src: 'interval',
                input: { interval: 1000 },
              },
              on: {
                TICK: { actions: tickHandler },
              },
            },
          },
        });

        const actor = createActor(machine);
        actor.start();

        // Should not have ticked yet
        expect(tickHandler).not.toHaveBeenCalled();

        // After first interval
        vi.advanceTimersByTime(1000);
        expect(tickHandler).toHaveBeenCalledTimes(1);

        // After second interval
        vi.advanceTimersByTime(1000);
        expect(tickHandler).toHaveBeenCalledTimes(2);
      });

      it('includes count and data in tick events', () => {
        const intervalService = createIntervalService();
        const tickHandler = vi.fn();

        const machine = setup({
          actors: { interval: intervalService },
        }).createMachine({
          initial: 'polling',
          states: {
            polling: {
              invoke: {
                src: 'interval',
                input: { interval: 500, data: 'test-data' },
              },
              on: {
                TICK: { actions: tickHandler },
              },
            },
          },
        });

        const actor = createActor(machine);
        actor.start();

        vi.advanceTimersByTime(500);

        expect(tickHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            event: expect.objectContaining({
              type: 'TICK',
              count: 0,
              data: 'test-data',
            }),
          }),
          undefined
        );

        vi.advanceTimersByTime(500);

        expect(tickHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            event: expect.objectContaining({
              type: 'TICK',
              count: 1,
              data: 'test-data',
            }),
          }),
          undefined
        );
      });
    });

    describe('Immediate tick behavior', () => {
      it('emits immediate tick when immediate option is true', () => {
        const intervalService = createIntervalService();
        const tickHandler = vi.fn();

        const machine = setup({
          actors: { interval: intervalService },
        }).createMachine({
          initial: 'polling',
          states: {
            polling: {
              invoke: {
                src: 'interval',
                input: { interval: 1000, immediate: true },
              },
              on: {
                TICK: { actions: tickHandler },
              },
            },
          },
        });

        const actor = createActor(machine);
        actor.start();

        // Should have immediate tick
        expect(tickHandler).toHaveBeenCalledTimes(1);
        expect(tickHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            event: expect.objectContaining({
              type: 'TICK',
              count: 0,
            }),
          }),
          undefined
        );
      });
    });

    describe('Max ticks behavior', () => {
      it('completes after reaching maximum tick count', () => {
        const intervalService = createIntervalService();
        const completeHandler = vi.fn();

        const machine = setup({
          actors: { interval: intervalService },
        }).createMachine({
          initial: 'polling',
          states: {
            polling: {
              invoke: {
                src: 'interval',
                input: { interval: 500, maxTicks: 3 },
              },
              on: {
                COMPLETE: { target: 'finished', actions: completeHandler },
              },
            },
            finished: { type: 'final' },
          },
        });

        const actor = createActor(machine);
        actor.start();

        // Advance through 3 ticks
        vi.advanceTimersByTime(1500); // 3 intervals

        expect(completeHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            event: expect.objectContaining({
              type: 'COMPLETE',
              totalTicks: 3,
            }),
          }),
          undefined
        );
      });

      it('respects max ticks with immediate tick enabled', () => {
        const intervalService = createIntervalService();
        const completeHandler = vi.fn();

        const machine = setup({
          actors: { interval: intervalService },
        }).createMachine({
          initial: 'polling',
          states: {
            polling: {
              invoke: {
                src: 'interval',
                input: { interval: 500, maxTicks: 1, immediate: true },
              },
              on: {
                COMPLETE: { target: 'finished', actions: completeHandler },
              },
            },
            finished: { type: 'final' },
          },
        });

        const actor = createActor(machine);
        actor.start();

        // Should complete immediately since maxTicks=1 and immediate=true
        expect(completeHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            event: expect.objectContaining({
              type: 'COMPLETE',
              totalTicks: 1,
            }),
          }),
          undefined
        );
      });
    });

    describe('Cancellation behavior', () => {
      it('handles stop events correctly', () => {
        const intervalService = createIntervalService();
        const cancelledHandler = vi.fn();

        const machine = setup({
          actors: { interval: intervalService },
        }).createMachine({
          initial: 'polling',
          states: {
            polling: {
              invoke: {
                src: 'interval',
                input: { interval: 1000 },
                id: 'intervalService',
              },
              on: {
                STOP_POLLING: {
                  actions: sendTo('intervalService', { type: 'STOP' }),
                },
                CANCELLED: { target: 'stopped', actions: cancelledHandler },
              },
            },
            stopped: { type: 'final' },
          },
        });

        const actor = createActor(machine);
        actor.start();

        // Send stop event to the interval service
        actor.send({ type: 'STOP_POLLING' });

        expect(cancelledHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            event: expect.objectContaining({
              type: 'CANCELLED',
            }),
          }),
          undefined
        );
      });
    });
  });

  describe('Animation Frame Service', () => {
    beforeEach(() => {
      // Mock requestAnimationFrame
      let frameId = 0;
      globalThis.requestAnimationFrame = vi.fn((callback) => {
        const id = ++frameId;
        setTimeout(() => callback(performance.now()), 16); // ~60fps
        return id;
      });

      globalThis.cancelAnimationFrame = vi.fn();
    });

    describe('Basic animation behavior', () => {
      it('emits frame events at target FPS', async () => {
        const animationService = createAnimationFrameService();
        const frameHandler = vi.fn();

        const machine = setup({
          actors: { animation: animationService },
        }).createMachine({
          initial: 'animating',
          states: {
            animating: {
              invoke: {
                src: 'animation',
                input: { targetFPS: 60 },
              },
              on: {
                FRAME: { actions: frameHandler },
              },
            },
          },
        });

        const actor = createActor(machine);
        actor.start();

        // Advance time to trigger frames
        vi.advanceTimersByTime(32); // Two frames at 60fps
        await vi.waitFor(() => expect(frameHandler).toHaveBeenCalledTimes(2));

        expect(frameHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            event: expect.objectContaining({
              type: 'FRAME',
              frameCount: expect.any(Number),
              elapsed: expect.any(Number),
              deltaTime: expect.any(Number),
            }),
          }),
          undefined
        );
      });

      it('includes custom data in frame events', async () => {
        const animationService = createAnimationFrameService();
        const frameHandler = vi.fn();

        const machine = setup({
          actors: { animation: animationService },
        }).createMachine({
          initial: 'animating',
          states: {
            animating: {
              invoke: {
                src: 'animation',
                input: { targetFPS: 60, data: 'animation-data' },
              },
              on: {
                FRAME: { actions: frameHandler },
              },
            },
          },
        });

        const actor = createActor(machine);
        actor.start();

        vi.advanceTimersByTime(16);
        await vi.waitFor(() => expect(frameHandler).toHaveBeenCalled());

        expect(frameHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            event: expect.objectContaining({
              data: 'animation-data',
            }),
          }),
          undefined
        );
      });
    });

    describe('Duration limiting', () => {
      it('completes animation after max duration', async () => {
        const animationService = createAnimationFrameService();
        const completeHandler = vi.fn();

        const machine = setup({
          actors: { animation: animationService },
        }).createMachine({
          initial: 'animating',
          states: {
            animating: {
              invoke: {
                src: 'animation',
                input: { maxDuration: 100, targetFPS: 60 },
              },
              on: {
                ANIMATION_COMPLETE: { target: 'finished', actions: completeHandler },
              },
            },
            finished: { type: 'final' },
          },
        });

        const actor = createActor(machine);
        actor.start();

        vi.advanceTimersByTime(100);
        await vi.waitFor(() => expect(completeHandler).toHaveBeenCalled());

        expect(completeHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            event: expect.objectContaining({
              type: 'ANIMATION_COMPLETE',
              totalFrames: expect.any(Number),
              totalTime: expect.any(Number),
            }),
          }),
          undefined
        );
      });
    });
  });

  describe('Debounce Service', () => {
    describe('Basic debounce behavior', () => {
      it('executes after delay period with no additional triggers', () => {
        const debounceService = createDebounceService();
        const executeHandler = vi.fn();

        const machine = setup({
          actors: { debounce: debounceService },
        }).createMachine({
          initial: 'idle',
          states: {
            idle: {
              on: {
                INPUT: 'debouncing',
              },
            },
            debouncing: {
              invoke: {
                src: 'debounce',
                input: { delay: 300 },
              },
              on: {
                DEBOUNCE_COMPLETE: { target: 'idle', actions: executeHandler },
              },
            },
          },
        });

        const actor = createActor(machine);
        actor.start();

        // Trigger debounce
        actor.send({ type: 'INPUT' });
        expect(actor.getSnapshot().value).toBe('debouncing');

        // Should not execute before delay
        vi.advanceTimersByTime(250);
        expect(executeHandler).not.toHaveBeenCalled();

        // Should execute after delay
        vi.advanceTimersByTime(50);
        expect(executeHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            event: expect.objectContaining({
              type: 'DEBOUNCE_COMPLETE',
              waitTime: expect.any(Number),
            }),
          }),
          undefined
        );
      });

      it('resets debounce timer on new input', () => {
        const debounceService = createDebounceService();
        const executeHandler = vi.fn();

        const machine = setup({
          actors: { debounce: debounceService },
        }).createMachine({
          initial: 'idle',
          states: {
            idle: {
              on: {
                INPUT: 'debouncing',
              },
            },
            debouncing: {
              invoke: {
                src: 'debounce',
                input: { delay: 300 },
                id: 'debounceService',
              },
              on: {
                INPUT: {
                  actions: sendTo('debounceService', { type: 'RESET' }),
                },
                DEBOUNCE_COMPLETE: { target: 'idle', actions: executeHandler },
              },
            },
          },
        });

        const actor = createActor(machine);
        actor.start();

        // First input
        actor.send({ type: 'INPUT' });

        // Second input before first delay completes
        vi.advanceTimersByTime(200);
        actor.send({ type: 'INPUT' });

        // Should not execute at original time
        vi.advanceTimersByTime(100); // 300ms from first input
        expect(executeHandler).not.toHaveBeenCalled();

        // Should execute after second delay
        vi.advanceTimersByTime(200); // 300ms from second input (200ms + 200ms = 500ms total)
        expect(executeHandler).toHaveBeenCalled();
      });
    });

    describe('Max wait behavior', () => {
      it('executes after max wait time even with continuous inputs', () => {
        const debounceService = createDebounceService();
        const executeHandler = vi.fn();

        const machine = setup({
          actors: { debounce: debounceService },
        }).createMachine({
          initial: 'idle',
          states: {
            idle: {
              on: {
                INPUT: 'debouncing',
              },
            },
            debouncing: {
              invoke: {
                src: 'debounce',
                input: { delay: 300, maxWait: 1000 },
              },
              on: {
                INPUT: { actions: () => {} },
                DEBOUNCE_COMPLETE: { target: 'idle', actions: executeHandler },
              },
            },
          },
        });

        const actor = createActor(machine);
        actor.start();

        // Continuous inputs every 200ms
        actor.send({ type: 'INPUT' });

        for (let i = 0; i < 5; i++) {
          vi.advanceTimersByTime(200);
          actor.send({ type: 'INPUT' });
        }

        // Should execute due to max wait, not debounce delay
        expect(executeHandler).toHaveBeenCalled();
      });
    });
  });

  describe('Throttle Service', () => {
    describe('Basic throttle behavior', () => {
      it('limits execution to specified interval', () => {
        const throttleService = createThrottleService();
        const executeHandler = vi.fn();

        const machine = setup({
          actors: { throttle: throttleService },
        }).createMachine({
          initial: 'ready',
          states: {
            ready: {
              on: {
                TRIGGER: 'throttling',
              },
            },
            throttling: {
              entry: sendTo('throttleService', { type: 'TRIGGER' }),
              invoke: {
                src: 'throttle',
                input: { interval: 100, leading: true, trailing: true },
                id: 'throttleService',
              },
              on: {
                TRIGGER: {
                  actions: sendTo('throttleService', { type: 'TRIGGER' }),
                },
                THROTTLE_EXECUTE: { actions: executeHandler },
                THROTTLE_COMPLETE: 'ready',
              },
            },
          },
        });

        const actor = createActor(machine);
        actor.start();

        // First trigger should execute immediately (leading)
        actor.send({ type: 'TRIGGER' });
        expect(executeHandler).toHaveBeenCalledTimes(1);

        // Rapid triggers within interval should be throttled
        actor.send({ type: 'TRIGGER' });
        actor.send({ type: 'TRIGGER' });
        expect(executeHandler).toHaveBeenCalledTimes(1);

        // Should execute trailing call after interval
        vi.advanceTimersByTime(100);
        expect(executeHandler).toHaveBeenCalledTimes(2);
      });

      it('respects leading and trailing options', () => {
        const throttleService = createThrottleService();
        const executeHandler = vi.fn();

        const machine = setup({
          actors: { throttle: throttleService },
        }).createMachine({
          initial: 'ready',
          states: {
            ready: {
              on: {
                TRIGGER: 'throttling',
              },
            },
            throttling: {
              entry: sendTo('throttleService', { type: 'TRIGGER' }),
              invoke: {
                src: 'throttle',
                input: { interval: 200, leading: false, trailing: true },
                id: 'throttleService',
              },
              on: {
                TRIGGER: {
                  actions: sendTo('throttleService', { type: 'TRIGGER' }),
                },
                THROTTLE_EXECUTE: { actions: executeHandler },
                THROTTLE_COMPLETE: 'ready',
              },
            },
          },
        });

        const actor = createActor(machine);
        actor.start();

        // Should not execute immediately when leading=false
        actor.send({ type: 'TRIGGER' });
        expect(executeHandler).not.toHaveBeenCalled();

        // Should execute after interval (trailing)
        vi.advanceTimersByTime(200);
        expect(executeHandler).toHaveBeenCalledTimes(1);
      });
    });

    describe('Multiple triggers behavior', () => {
      it('handles rapid succession of triggers correctly', async () => {
        const throttleService = createThrottleService();
        const executeHandler = vi.fn();

        const machine = setup({
          actors: { throttle: throttleService },
        }).createMachine({
          initial: 'ready',
          states: {
            ready: {
              on: {
                TRIGGER: 'throttling',
              },
            },
            throttling: {
              entry: sendTo('throttleService', { type: 'TRIGGER' }),
              invoke: {
                src: 'throttle',
                input: { interval: 300, leading: true, trailing: true },
                id: 'throttleService',
              },
              on: {
                TRIGGER: {
                  actions: sendTo('throttleService', { type: 'TRIGGER' }),
                },
                THROTTLE_EXECUTE: { actions: executeHandler },
                THROTTLE_COMPLETE: 'ready',
              },
            },
          },
        });

        const actor = createActor(machine);
        actor.start();

        // Rapid triggers
        actor.send({ type: 'TRIGGER' }); // Leading execution
        expect(executeHandler).toHaveBeenCalledTimes(1);

        // Multiple triggers during throttle window
        vi.advanceTimersByTime(50);
        actor.send({ type: 'TRIGGER' });
        vi.advanceTimersByTime(50);
        actor.send({ type: 'TRIGGER' });
        vi.advanceTimersByTime(50);
        actor.send({ type: 'TRIGGER' });

        // Should only have the leading execution so far
        expect(executeHandler).toHaveBeenCalledTimes(1);

        // Trailing execution after interval
        vi.advanceTimersByTime(150); // Complete the 300ms interval

        // Wait for microtasks to process (for queueMicrotask in throttle service)
        await vi.runAllTimersAsync();

        expect(executeHandler).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Service Integration', () => {
    describe('Cleanup behavior', () => {
      it('cleans up timers when actor is stopped', () => {
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
        const debounceService = createDebounceService();

        const machine = setup({
          actors: { debounce: debounceService },
        }).createMachine({
          initial: 'waiting',
          states: {
            waiting: {
              invoke: {
                src: 'debounce',
                input: { delay: 1000 },
              },
              on: {
                DEBOUNCE_COMPLETE: 'completed',
              },
            },
            completed: { type: 'final' },
          },
        });

        const actor = createActor(machine);
        actor.start();

        // Stop actor before debounce completes
        actor.stop();

        // Verify cleanup occurred
        expect(clearTimeoutSpy).toHaveBeenCalled();
      });
    });

    describe('Error handling', () => {
      it('handles invalid input gracefully', () => {
        const delayService = createDelayService();

        const machine = setup({
          actors: { delay: delayService },
        }).createMachine({
          initial: 'waiting',
          states: {
            waiting: {
              invoke: {
                src: 'delay',
                input: { delay: -1000 }, // Invalid delay
                onDone: 'completed',
                onError: 'error',
              },
            },
            completed: { type: 'final' },
            error: { type: 'final' },
          },
        });

        const actor = createActor(machine);

        // Should not throw when starting with invalid input
        expect(() => actor.start()).not.toThrow();
      });
    });
  });

  describe('Real-world usage patterns', () => {
    it('supports search input debouncing workflow', () => {
      const debounceService = createDebounceService();
      const searchHandler = vi.fn();

      const searchMachine = setup({
        actors: { debounce: debounceService },
      }).createMachine({
        initial: 'idle',
        context: { query: '' },
        states: {
          idle: {
            on: {
              TYPE: {
                target: 'debouncing',
                actions: () => {},
              },
            },
          },
          debouncing: {
            invoke: {
              src: 'debounce',
              input: { delay: 300 },
            },
            on: {
              TYPE: {
                target: 'debouncing',
                actions: () => {},
              },
              DEBOUNCE_COMPLETE: {
                target: 'idle',
                actions: searchHandler,
              },
            },
          },
        },
      });

      const actor = createActor(searchMachine);
      actor.start();

      // Simulate user typing
      actor.send({ type: 'TYPE', query: 'h' });
      actor.send({ type: 'TYPE', query: 'he' });
      actor.send({ type: 'TYPE', query: 'hel' });
      actor.send({ type: 'TYPE', query: 'hell' });
      actor.send({ type: 'TYPE', query: 'hello' });

      // Should not search while typing
      expect(searchHandler).not.toHaveBeenCalled();

      // Should search after debounce period
      vi.advanceTimersByTime(300);
      expect(searchHandler).toHaveBeenCalledTimes(1);
    });

    it('supports auto-save with throttled saves', () => {
      const throttleService = createThrottleService();
      const saveHandler = vi.fn();

      const autoSaveMachine = setup({
        actors: { throttle: throttleService },
      }).createMachine({
        initial: 'editing',
        states: {
          editing: {
            on: {
              CONTENT_CHANGE: 'saving',
            },
          },
          saving: {
            invoke: {
              src: 'throttle',
              input: { interval: 5000, leading: false, trailing: true },
              id: 'throttleService',
            },
            on: {
              CONTENT_CHANGE: {
                actions: sendTo('throttleService', { type: 'TRIGGER' }),
              },
              THROTTLE_EXECUTE: {
                target: 'editing',
                actions: saveHandler,
              },
            },
          },
        },
      });

      const actor = createActor(autoSaveMachine);
      actor.start();

      // Simulate rapid content changes
      for (let i = 0; i < 10; i++) {
        actor.send({ type: 'CONTENT_CHANGE' });
        vi.advanceTimersByTime(500);
      }

      // Should only save once after throttle interval
      expect(saveHandler).toHaveBeenCalledTimes(1);
    });
  });
});
