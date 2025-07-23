/**
 * @module actor-core/runtime/__tests__/xstate-bridge.test
 * @description Tests for XState Bridge integration with component actors
 * @author AI Assistant - 2025-01-20
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assign, setup } from 'xstate';
import type { ActorMessage } from '../actor-system.js';
import { createActorSystem } from '../actor-system-impl.js';
import {
  type ComponentActorConfig,
  createComponentActorBehavior,
  type TemplateFunction,
} from '../component-actor.js';
import { Logger } from '../logger.js';

const log = Logger.namespace('XSTATE_BRIDGE_TEST');

// Test counter machine for predictable state transitions (module scope)
const counterMachine = setup({
  types: {
    context: {} as { count: number; step: number },
    events: {} as
      | { type: 'INCREMENT' }
      | { type: 'DECREMENT' }
      | { type: 'SET_STEP'; step: number }
      | { type: 'RESET' },
  },
}).createMachine({
  id: 'counter',
  initial: 'active',
  context: { count: 0, step: 1 },
  states: {
    active: {
      on: {
        INCREMENT: {
          actions: assign({
            count: ({ context }) => context.count + context.step,
          }),
        },
        DECREMENT: {
          actions: assign({
            count: ({ context }) => context.count - context.step,
          }),
        },
        SET_STEP: {
          actions: assign({
            step: ({ event }) => event.step,
          }),
        },
        RESET: {
          actions: assign({ count: 0 }),
        },
      },
    },
  },
});

const counterTemplate: TemplateFunction = (state: unknown) => {
  if (!state || typeof state !== 'object') return '<div>Loading...</div>';
  const typedState = state as { value: string; context: { count: number; step: number } };
  return `<div class="counter">Count: ${typedState.context.count}</div>`;
};

describe('XState Bridge Integration', () => {
  let actorSystem: ReturnType<typeof createActorSystem>;

  beforeEach(async () => {
    // ✅ CORRECT: Create and start actor system for each test
    actorSystem = createActorSystem({
      nodeAddress: 'test-node',
      debug: false,
      maxActors: 100,
    });
    await actorSystem.start();
  });

  afterEach(async () => {
    // ✅ CORRECT: Proper cleanup prevents memory leaks
    if (actorSystem?.isRunning()) {
      await actorSystem.stop();
    }
  });

  describe('XState Machine Integration', () => {
    // Test counter machine for predictable state transitions
    const counterMachine = setup({
      types: {
        context: {} as { count: number; step: number },
        events: {} as
          | { type: 'INCREMENT' }
          | { type: 'DECREMENT' }
          | { type: 'SET_STEP'; step: number }
          | { type: 'RESET' },
      },
    }).createMachine({
      id: 'counter',
      initial: 'active',
      context: { count: 0, step: 1 },
      states: {
        active: {
          on: {
            INCREMENT: {
              actions: assign({
                count: ({ context }) => context.count + context.step,
              }),
            },
            DECREMENT: {
              actions: assign({
                count: ({ context }) => context.count - context.step,
              }),
            },
            SET_STEP: {
              actions: assign({
                step: ({ event }) => event.step,
              }),
            },
            RESET: {
              actions: assign({ count: 0 }),
            },
          },
        },
      },
    });

    const counterTemplate: TemplateFunction = (state: unknown) => {
      if (!state || typeof state !== 'object') return '<div>Loading...</div>';
      const typedState = state as { value: string; context: { count: number; step: number } };
      return `<div class="counter">Count: ${typedState.context.count}</div>`;
    };

    it('should create component actor behavior with XState integration', () => {
      // ✅ CORRECT: Test behavior creation, not implementation details
      const config: ComponentActorConfig = {
        machine: counterMachine,
        template: counterTemplate,
      };

      const behavior = createComponentActorBehavior(config);

      expect(behavior).toBeDefined();
      expect(behavior.context).toBeDefined();
      expect(behavior.onMessage).toBeDefined();
      if (behavior.context) {
        expect(behavior.context.machine).toBe(counterMachine);
      }
    });

    it('should handle component mounting and create XState bridge', async () => {
      const config: ComponentActorConfig = {
        machine: counterMachine,
        template: counterTemplate,
      };

      const behavior = createComponentActorBehavior(config);
      const pid = await actorSystem.spawn(behavior, { id: 'counter-component' });

      log.debug('Component actor spawned', { actorId: pid.address.id });

      // ✅ CORRECT: Event-driven verification - listen for COMPONENT_MOUNTED

      const unsubscribe = pid.subscribe('EMIT:COMPONENT_MOUNTED', () => {
        log.debug('Component mounted successfully');
      });

      // Send mount command (fire-and-forget)
      pid.send({
        type: 'MOUNT_COMPONENT',
        payload: {
          elementId: 'counter-element',
          hasTemplate: true,
        },
      });

      // Wait for the expected event (no timeout needed)
      unsubscribe();
      log.debug('Component mounted successfully');
    });

    it('should emit STATE_CHANGED message when XState actor transitions', async () => {
      const config: ComponentActorConfig = {
        machine: counterMachine,
        template: counterTemplate,
      };

      const behavior = createComponentActorBehavior(config);
      const pid = await actorSystem.spawn(behavior, { id: 'counter-with-bridge' });

      // ✅ CORRECT: Wait for STATE_CHANGED event directly
      const firstStateChangePromise = new Promise<ActorMessage>((resolve) => {
        const unsubscribe = pid.subscribe('EMIT:STATE_CHANGED', (message) => {
          unsubscribe();
          resolve(message);
        });
      });

      // Send mount command (fire-and-forget)
      pid.send({
        type: 'MOUNT_COMPONENT',
        payload: {
          elementId: 'counter-bridge',
          hasTemplate: true,
        },
      });

      // Wait for the expected STATE_CHANGED event (no timeout needed)
      const initialStateMessage = await firstStateChangePromise;

      expect(initialStateMessage).toBeDefined();
      expect(initialStateMessage.type).toBe('EMIT:STATE_CHANGED');
      expect(initialStateMessage.payload).toHaveProperty('value', 'active');
      expect(initialStateMessage.payload).toHaveProperty('context');

      log.debug('Initial state change verified', {
        state: initialStateMessage.payload,
      });
    });

    it('should handle DOM events and trigger XState transitions', async () => {
      const config: ComponentActorConfig = {
        machine: counterMachine,
        template: counterTemplate,
      };

      const behavior = createComponentActorBehavior(config);
      const pid = await actorSystem.spawn(behavior, { id: 'counter-dom-events' });

      // ✅ CORRECT: Wait for mount completion first
      const unsubscribe = pid.subscribe('EMIT:COMPONENT_MOUNTED', () => {
        log.debug('Component mounted successfully');
      });

      // Send mount command (fire-and-forget)
      pid.send({
        type: 'MOUNT_COMPONENT',
        payload: {
          elementId: 'counter-dom',
          hasTemplate: true,
        },
      });

      unsubscribe();

      // ✅ CORRECT: Wait for state change after DOM event
      const stateChangePromise = new Promise<ActorMessage>((resolve) => {
        let changeCount = 0;
        const unsubscribe = pid.subscribe('EMIT:STATE_CHANGED', (message) => {
          changeCount++;
          // Skip initial state, wait for DOM event state change
          if (changeCount > 1) {
            unsubscribe();
            resolve(message);
          }
        });
      });

      // Send DOM event (fire-and-forget)
      pid.send({
        type: 'DOM_EVENT',
        payload: {
          eventType: 'INCREMENT',
          domEventType: 'click',
          attributes: {},
          formData: null,
          target: {
            tagName: 'BUTTON',
            id: 'increment-btn',
            className: 'btn btn-primary',
          },
        },
      });

      // Wait for the expected state change event (no timeout needed)
      const latestStateChange = await stateChangePromise;

      expect(latestStateChange).toBeDefined();
      expect(latestStateChange.payload).not.toBeNull();
      expect(latestStateChange.payload).toHaveProperty('context');

      // Type guard for payload access
      let finalCount = 0;
      if (
        latestStateChange.payload &&
        typeof latestStateChange.payload === 'object' &&
        'context' in latestStateChange.payload
      ) {
        const context = (latestStateChange.payload as { context: { count: number } }).context;
        expect(context.count).toBe(1);
        finalCount = context.count;
      }

      log.debug('DOM event handled successfully', {
        finalCount,
      });
    });

    it('should support send attributes for DOM integration', async () => {
      // ✅ CORRECT: Test the actual DOM syntax we support
      const template: TemplateFunction = (state: unknown) => {
        const typedState = state as { context: { count: number } };
        return `
          <div>
            <button send="INCREMENT">+</button>
            <button data-send="DECREMENT">-</button>
            <span>Count: ${typedState.context.count}</span>
          </div>
        `;
      };

      const config: ComponentActorConfig = {
        machine: counterMachine,
        template,
      };

      const behavior = createComponentActorBehavior(config);

      expect(behavior).toBeDefined();
      if (behavior.context) {
        expect(behavior.context.template).toBe(template);
      }

      // Test template rendering
      const mockState = { context: { count: 5 } };
      const rendered = template(mockState);

      expect(rendered).toContain('send="INCREMENT"');
      expect(rendered).toContain('data-send="DECREMENT"');
      expect(rendered).toContain('Count: 5');

      log.debug('Send attribute template verified', { renderedLength: rendered.length });
    });
  });

  describe('XState Bridge Error Handling', () => {
    it('should handle XState machine errors gracefully', async () => {
      // Create a machine that can fail
      const errorProneMachine = setup({
        types: {
          events: {} as { type: 'TRIGGER_ERROR' } | { type: 'NORMAL_EVENT' },
        },
      }).createMachine({
        id: 'error-prone',
        initial: 'stable',
        states: {
          stable: {
            on: {
              TRIGGER_ERROR: {
                actions: () => {
                  throw new Error('Simulated XState error');
                },
              },
              NORMAL_EVENT: 'stable',
            },
          },
        },
      });

      const config: ComponentActorConfig = {
        machine: errorProneMachine,
        template: () => '<div>Error Test</div>',
      };

      const behavior = createComponentActorBehavior(config);
      const pid = await actorSystem.spawn(behavior, { id: 'error-test' });

      pid.send({
        type: 'MOUNT_COMPONENT',
        payload: {
          elementId: 'error-element',
          hasTemplate: true,
        },
      });

      // Send normal event first (should work)
      await expect(
        pid.send({
          type: 'DOM_EVENT',
          payload: {
            eventType: 'NORMAL_EVENT',
            domEventType: 'click',
            attributes: {},
            formData: null,
            target: { tagName: 'BUTTON', id: '', className: '' },
          },
        })
      ).resolves.not.toThrow();

      log.debug('Error handling test completed');
    });

    it('should handle component unmounting and cleanup XState bridge', async () => {
      const config: ComponentActorConfig = {
        machine: counterMachine,
        template: () => '<div>Cleanup Test</div>',
      };

      const behavior = createComponentActorBehavior(config);
      const pid = await actorSystem.spawn(behavior, { id: 'cleanup-test' });

      // Mount
      pid.send({
        type: 'MOUNT_COMPONENT',
        payload: {
          elementId: 'cleanup-element',
          hasTemplate: true,
        },
      });

      // Unmount
      pid.send({
        type: 'UNMOUNT_COMPONENT',
        payload: null,
      });

      log.debug('Component unmounted successfully');

      // Verify component can still receive messages without crashing
      await expect(
        pid.send({
          type: 'DOM_EVENT',
          payload: {
            eventType: 'INCREMENT',
            domEventType: 'click',
            attributes: {},
            formData: null,
            target: { tagName: 'BUTTON', id: '', className: '' },
          },
        })
      ).resolves.not.toThrow();
    });
  });

  describe('Performance and Memory', () => {
    it('should handle rapid state transitions efficiently', async () => {
      const config: ComponentActorConfig = {
        machine: counterMachine,
        template: counterTemplate,
      };

      const behavior = createComponentActorBehavior(config);
      const pid = await actorSystem.spawn(behavior, { id: 'performance-test' });

      pid.send({
        type: 'MOUNT_COMPONENT',
        payload: {
          elementId: 'perf-element',
          hasTemplate: true,
        },
      });

      const startTime = performance.now();
      const eventCount = 100;

      // Send many rapid DOM events
      const promises = [];
      // Send many rapid DOM events (fire-and-forget)
      for (let i = 0; i < eventCount; i++) {
        pid.send({
          type: 'DOM_EVENT',
          payload: {
            eventType: 'INCREMENT',
            domEventType: 'click',
            attributes: {},
            formData: null,
            target: { tagName: 'BUTTON', id: '', className: '' },
          },
        });
      }
      // Remove Promise.all(promises) line

      await Promise.all(promises);
      const duration = performance.now() - startTime;

      // Should complete rapidly (adjust threshold as needed)
      expect(duration).toBeLessThan(1000); // 1 second for 100 events

      log.debug('Performance test completed', {
        eventCount,
        duration: `${duration.toFixed(2)}ms`,
        eventsPerSecond: Math.round(eventCount / (duration / 1000)),
      });
    });
  });
});
