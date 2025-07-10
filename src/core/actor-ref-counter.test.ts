/**
 * Counter Test for Pure Actor Model
 *
 * Tests the basic functionality of the ActorRef implementation
 * using a simple counter state machine.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { assign, setup } from 'xstate';
import type { ActorRef, BaseEventObject } from './create-actor-ref.js';
import { createActorRef } from './create-actor-ref.js';

// ============================================================================
// COUNTER MACHINE DEFINITION
// ============================================================================

interface CounterContext {
  count: number;
  increment: number;
}

type CounterEvent =
  | { type: 'INCREMENT' }
  | { type: 'DECREMENT' }
  | { type: 'SET'; value: number }
  | { type: 'RESET' }
  | BaseEventObject; // Include BaseEventObject for query support

const counterMachine = setup({
  types: {
    context: {} as CounterContext,
    events: {} as CounterEvent,
  },
}).createMachine({
  id: 'counter',
  initial: 'active',

  context: {
    count: 0,
    increment: 1,
  },

  states: {
    active: {
      on: {
        INCREMENT: {
          actions: assign({
            count: ({ context }) => context.count + context.increment,
          }),
        },

        DECREMENT: {
          actions: assign({
            count: ({ context }) => context.count - context.increment,
          }),
        },

        SET: {
          actions: assign({
            count: ({ event }) => (event as { type: 'SET'; value: number }).value,
          }),
        },

        RESET: {
          actions: assign({
            count: 0,
          }),
        },
      },
    },
  },
});

// ============================================================================
// TESTS
// ============================================================================

describe('Pure Actor Model - Counter Test', () => {
  let counterActor: ActorRef<CounterEvent, CounterContext>;

  beforeEach(() => {
    counterActor = createActorRef<CounterEvent, CounterContext>(counterMachine, {
      autoStart: true,
    });
  });

  // -------------------------------------------------------------------------
  // BASIC MESSAGING TESTS
  // -------------------------------------------------------------------------

  describe('Basic Messaging', () => {
    it('should handle increment events', () => {
      // Initial state
      expect((counterActor.getSnapshot().context as CounterContext).count).toBe(0);

      // Send increment event
      counterActor.send({ type: 'INCREMENT' });

      // Check updated state
      expect((counterActor.getSnapshot().context as CounterContext).count).toBe(1);
    });

    it('should handle decrement events', () => {
      // Set initial value
      counterActor.send({ type: 'SET', value: 5 });
      expect((counterActor.getSnapshot().context as CounterContext).count).toBe(5);

      // Send decrement event
      counterActor.send({ type: 'DECREMENT' });

      // Check updated state
      expect((counterActor.getSnapshot().context as CounterContext).count).toBe(4);
    });

    it('should handle set events', () => {
      counterActor.send({ type: 'SET', value: 42 });
      expect((counterActor.getSnapshot().context as CounterContext).count).toBe(42);
    });

    it('should handle reset events', () => {
      counterActor.send({ type: 'SET', value: 100 });
      counterActor.send({ type: 'RESET' });
      expect((counterActor.getSnapshot().context as CounterContext).count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // STATE OBSERVATION TESTS
  // -------------------------------------------------------------------------

  describe('State Observation', () => {
    it('should observe state changes reactively', () => {
      return new Promise<void>((resolve) => {
        let observationCount = 0;

        const observable = counterActor.observe((snapshot) => (snapshot.context as CounterContext).count);

        const subscription = observable.subscribe((count) => {
          observationCount++;

          if (observationCount === 1) {
            // Initial value
            expect(count).toBe(0);
            counterActor.send({ type: 'INCREMENT' });
          } else if (observationCount === 2) {
            // After increment
            expect(count).toBe(1);
            counterActor.send({ type: 'SET', value: 10 });
          } else if (observationCount === 3) {
            // After set
            expect(count).toBe(10);
            subscription.unsubscribe();
            resolve();
          }
        });
      });
    });

    it('should provide current snapshot', () => {
      counterActor.send({ type: 'SET', value: 99 });

      const snapshot = counterActor.getSnapshot();
      expect((snapshot.context as CounterContext).count).toBe(99);
      expect(counterActor.matches('active')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // LIFECYCLE TESTS
  // -------------------------------------------------------------------------

  describe('Lifecycle Management', () => {
    it('should start, stop, and restart actors', () => {
      expect(counterActor.status).toBe('running');

      // Stop the actor
      counterActor.stop();
      expect(counterActor.status).toBe('stopped');

      // Should throw when trying to send to stopped actor
      expect(() => {
        counterActor.send({ type: 'INCREMENT' });
      }).toThrow('Cannot communicate with stopped actor');

      // Restart the actor
      counterActor.restart();
      expect(counterActor.status).toBe('running');

      // Should work after restart
      counterActor.send({ type: 'SET', value: 5 });
      expect((counterActor.getSnapshot().context as CounterContext).count).toBe(5);
    });

    it('should check state matches', () => {
      expect(counterActor.matches('active')).toBe(true);
      expect(counterActor.matches('inactive')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // ACTOR SUPERVISION TESTS
  // -------------------------------------------------------------------------

  describe('Actor Supervision', () => {
    it('should spawn and manage child actors', () => {
      // Spawn a child counter
      const child = counterActor.spawn(counterMachine, { id: 'child-counter' });

      expect(child.id).toBe('child-counter');
      expect(child.parent).toBe(counterActor);
      expect(child.status).toBe('running');

      // Check children are tracked
      const children = counterActor.getChildren();
      expect(children.size).toBe(1);
      expect(children.has('child-counter')).toBe(true);

      // Child should work independently
      child.send({ type: 'SET', value: 100 } as CounterEvent);
      expect((child.getSnapshot().context as CounterContext).count).toBe(100);
      expect((counterActor.getSnapshot().context as CounterContext).count).toBe(0);
    });

    it('should kill child actors', () => {
      const child = counterActor.spawn(counterMachine, { id: 'test-child' });
      expect(counterActor.getChildren().size).toBe(1);

      // Kill the child
      counterActor.stopChild('test-child');

      expect(counterActor.getChildren().size).toBe(0);
      expect(child.status).toBe('stopped');
    });

    it('should stop all children when parent stops', () => {
      const child1 = counterActor.spawn(counterMachine, { id: 'child1' });
      const child2 = counterActor.spawn(counterMachine, { id: 'child2' });

      expect(child1.status).toBe('running');
      expect(child2.status).toBe('running');

      // Stop parent
      counterActor.stop();

      // Children should be stopped too
      expect(child1.status).toBe('stopped');
      expect(child2.status).toBe('stopped');
    });
  });

  // -------------------------------------------------------------------------
  // METADATA TESTS
  // -------------------------------------------------------------------------

  describe('Metadata', () => {
    it('should have unique IDs', () => {
      const actor1 = createActorRef(counterMachine);
      const actor2 = createActorRef(counterMachine);

      expect(actor1.id).toBeDefined();
      expect(actor2.id).toBeDefined();
      expect(actor1.id).not.toBe(actor2.id);
    });

    it('should accept custom IDs', () => {
      const actor = createActorRef(counterMachine, { id: 'custom-counter' });
      expect(actor.id).toBe('custom-counter');
    });

    it('should track parent-child relationships', () => {
      const parent = createActorRef(counterMachine, { id: 'parent' });
      const child = parent.spawn(counterMachine, { id: 'child' });

      expect(child.parent).toBe(parent);
      expect(parent.parent).toBeUndefined();
    });
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Pure Actor Model - Integration Tests', () => {
  it('should create a simple actor hierarchy', () => {
    // Create root actor
    const root = createActorRef(counterMachine, {
      id: 'root',
      supervision: 'restart-on-failure',
    });

    // Create multiple children
    const counter1 = root.spawn(counterMachine, { id: 'counter1' });
    const counter2 = root.spawn(counterMachine, { id: 'counter2' });

    // Each counter works independently
    counter1.send({ type: 'SET', value: 10 } as CounterEvent);
    counter2.send({ type: 'SET', value: 20 } as CounterEvent);

    expect((counter1.getSnapshot().context as CounterContext).count).toBe(10);
    expect((counter2.getSnapshot().context as CounterContext).count).toBe(20);
    expect((root.getSnapshot().context as CounterContext).count).toBe(0);

    // Root manages both children
    expect(root.getChildren().size).toBe(2);

    // Cleanup
    root.stop();
    expect(counter1.status).toBe('stopped');
    expect(counter2.status).toBe('stopped');
  });

  it('should demonstrate message-only communication pattern', () => {
    const actor = createActorRef(counterMachine);

    // Pure message-based interaction - no direct state access
    actor.send({ type: 'INCREMENT' });
    actor.send({ type: 'INCREMENT' });
    actor.send({ type: 'SET', value: 100 } as CounterEvent);

    // State observation through reactive patterns
    const currentCount = (actor.getSnapshot().context as CounterContext).count;
    expect(currentCount).toBe(100);

    // This demonstrates the pure actor model:
    // 1. Messages are sent via send()
    // 2. State is observed via getSnapshot() or observe()
    // 3. No direct property access to actor internals
  });
});
