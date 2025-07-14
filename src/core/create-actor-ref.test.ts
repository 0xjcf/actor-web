/**
 * Integration Tests for ActorRef Event Emission System - Actor-Web Framework
 *
 * These tests verify the emit() and subscribe() methods work correctly
 * with the unified ActorRef implementation following TESTING-GUIDE.md principles
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assign, setup } from 'xstate';
import { createActorRef } from '@/core/create-actor-ref';
import { Logger } from '@/core/dev-mode';

// Use scoped logger as recommended in Testing Guide
const log = Logger.namespace('ACTOR_REF_EMISSION_TEST');

// Test event types for event emission
interface UserEvent {
  type: 'USER_LOGGED_IN' | 'USER_LOGGED_OUT';
  userId: string;
  timestamp: number;
}

interface SystemEvent {
  type: 'SYSTEM_NOTIFICATION';
  level: 'info' | 'warning' | 'error';
  message: string;
}

// Test machine for actors
interface TestContext {
  count: number;
  lastEvent?: string;
}

type TestEvent = { type: 'INCREMENT' } | { type: 'DECREMENT' } | { type: 'RESET' };

const testMachine = setup({
  types: {
    context: {} as TestContext,
    events: {} as TestEvent,
  },
}).createMachine({
  id: 'testMachine',
  initial: 'active',
  context: {
    count: 0,
  },
  states: {
    active: {
      on: {
        INCREMENT: {
          actions: assign({
            count: ({ context }) => context.count + 1,
            lastEvent: 'INCREMENT',
          }),
        },
        DECREMENT: {
          actions: assign({
            count: ({ context }) => context.count - 1,
            lastEvent: 'DECREMENT',
          }),
        },
        RESET: {
          actions: assign({
            count: 0,
            lastEvent: 'RESET',
          }),
        },
      },
    },
  },
});

describe('ActorRef Event Emission Integration Tests', () => {
  let testActors: Array<ReturnType<typeof createActorRef>> = [];

  beforeEach(() => {
    // Reset test actors array
    testActors = [];
    log.debug('Integration test environment set up');
  });

  afterEach(async () => {
    // Clean up all test actors
    await Promise.all(testActors.map((actor) => actor.stop()));
    testActors = [];
    log.debug('Integration test environment cleaned up');
  });

  describe('Basic Event Emission', () => {
    it('should emit and receive events between actors', async () => {
      // Arrange: Create emitter and subscriber actors
      const emitterActor = createActorRef<TestEvent, UserEvent>(testMachine, {
        id: 'emitter-actor',
      });
      const subscriberActor = createActorRef<TestEvent, SystemEvent>(testMachine, {
        id: 'subscriber-actor',
      });
      testActors.push(emitterActor, subscriberActor);

      const listener = vi.fn();
      const testEvent: UserEvent = {
        type: 'USER_LOGGED_IN',
        userId: 'user-123',
        timestamp: Date.now(),
      };

      // Act: Subscribe and emit
      const unsubscribe = emitterActor.subscribe(listener);
      emitterActor.emit(testEvent);

      // Assert: Event should be received
      expect(listener).toHaveBeenCalledWith(testEvent);
      expect(listener).toHaveBeenCalledTimes(1);

      // Cleanup
      unsubscribe();

      log.debug('Basic emission test completed', { eventType: testEvent.type });
    });

    it('should handle type-safe event emission', async () => {
      // Arrange: Create actor with specific event type
      const systemActor = createActorRef<TestEvent, SystemEvent>(testMachine, {
        id: 'system-actor',
      });
      testActors.push(systemActor);

      const listener = vi.fn();
      const systemEvent: SystemEvent = {
        type: 'SYSTEM_NOTIFICATION',
        level: 'info',
        message: 'System startup complete',
      };

      // Act: Subscribe and emit
      systemActor.subscribe(listener);
      systemActor.emit(systemEvent);

      // Assert: Type-safe event handling
      expect(listener).toHaveBeenCalledWith(systemEvent);

      log.debug('Type-safe emission test completed');
    });
  });

  describe('Multiple Subscribers', () => {
    it('should emit events to multiple subscribers', async () => {
      // Arrange: Create actor and multiple listeners
      const broadcastActor = createActorRef<TestEvent, UserEvent>(testMachine, {
        id: 'broadcast-actor',
      });
      testActors.push(broadcastActor);

      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      const userEvent: UserEvent = {
        type: 'USER_LOGGED_OUT',
        userId: 'user-456',
        timestamp: Date.now(),
      };

      // Act: Subscribe multiple listeners and emit
      broadcastActor.subscribe(listener1);
      broadcastActor.subscribe(listener2);
      broadcastActor.subscribe(listener3);
      broadcastActor.emit(userEvent);

      // Assert: All listeners should receive the event
      expect(listener1).toHaveBeenCalledWith(userEvent);
      expect(listener2).toHaveBeenCalledWith(userEvent);
      expect(listener3).toHaveBeenCalledWith(userEvent);

      log.debug('Multiple subscribers test completed', { subscriberCount: 3 });
    });

    it('should handle unsubscribe during emission', async () => {
      // Arrange: Create actor and listeners
      const actor = createActorRef<TestEvent, UserEvent>(testMachine, {
        id: 'unsubscribe-actor',
      });
      testActors.push(actor);

      const permanentListener = vi.fn();
      let unsubscribeFunction: () => void = () => {};
      const selfUnsubscribingListener = vi.fn(() => {
        // Unsubscribe during emission
        if (unsubscribeFunction) {
          unsubscribeFunction();
        }
      });

      const userEvent: UserEvent = {
        type: 'USER_LOGGED_IN',
        userId: 'user-789',
        timestamp: Date.now(),
      };

      // Act: Subscribe listeners and emit
      actor.subscribe(permanentListener);
      unsubscribeFunction = actor.subscribe(selfUnsubscribingListener);
      actor.emit(userEvent);

      // Emit again to verify unsubscribe worked
      actor.emit(userEvent);

      // Assert: Permanent listener should be called twice, self-unsubscribing once
      expect(permanentListener).toHaveBeenCalledTimes(2);
      expect(selfUnsubscribingListener).toHaveBeenCalledTimes(1);

      log.debug('Unsubscribe during emission test completed');
    });
  });

  describe('Actor Lifecycle Integration', () => {
    it('should clean up event emissions when actor stops', async () => {
      // Arrange: Create actor and listener
      const lifecycleActor = createActorRef<TestEvent, SystemEvent>(testMachine, {
        id: 'lifecycle-actor',
      });
      testActors.push(lifecycleActor);

      const listener = vi.fn();
      const systemEvent: SystemEvent = {
        type: 'SYSTEM_NOTIFICATION',
        level: 'warning',
        message: 'System shutting down',
      };

      // Act: Subscribe, emit, stop, then try to emit again
      lifecycleActor.subscribe(listener);
      lifecycleActor.emit(systemEvent);
      expect(listener).toHaveBeenCalledTimes(1);

      // Stop the actor
      await lifecycleActor.stop();

      // Try to emit after stopping (should throw)
      expect(() => lifecycleActor.emit(systemEvent)).toThrow();

      log.debug('Lifecycle integration test completed');
    });

    it('should clean up event bus on restart', async () => {
      // Arrange: Create actor and listener
      const restartActor = createActorRef<TestEvent, UserEvent>(testMachine, {
        id: 'restart-actor',
      });
      testActors.push(restartActor);

      const oldListener = vi.fn();
      const newListener = vi.fn();

      const userEvent: UserEvent = {
        type: 'USER_LOGGED_IN',
        userId: 'user-restart',
        timestamp: Date.now(),
      };

      // Act: Subscribe, emit, restart, then subscribe new listener
      restartActor.subscribe(oldListener);
      restartActor.emit(userEvent);
      expect(oldListener).toHaveBeenCalledTimes(1);

      // Restart the actor
      await restartActor.restart();

      // Subscribe new listener and emit
      restartActor.subscribe(newListener);
      restartActor.emit(userEvent);

      // Assert: Old listener should not receive new event, new listener should
      expect(oldListener).toHaveBeenCalledTimes(1); // Only the original emission
      expect(newListener).toHaveBeenCalledTimes(1); // Only after restart

      log.debug('Restart cleanup test completed');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle listener errors gracefully', async () => {
      // Arrange: Create actor with error-throwing listener
      const errorActor = createActorRef<TestEvent, SystemEvent>(testMachine, {
        id: 'error-actor',
      });
      testActors.push(errorActor);

      const errorListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      const goodListener = vi.fn();

      const systemEvent: SystemEvent = {
        type: 'SYSTEM_NOTIFICATION',
        level: 'error',
        message: 'Error test',
      };

      // Act: Subscribe both listeners and emit
      errorActor.subscribe(errorListener);
      errorActor.subscribe(goodListener);

      // Should not throw despite error in one listener
      expect(() => errorActor.emit(systemEvent)).not.toThrow();

      // Assert: Both listeners should be called
      expect(errorListener).toHaveBeenCalledWith(systemEvent);
      expect(goodListener).toHaveBeenCalledWith(systemEvent);

      log.debug('Error handling test completed');
    });

    it('should prevent subscription on stopped actor', async () => {
      // Arrange: Create and stop actor
      const stoppedActor = createActorRef<TestEvent, UserEvent>(testMachine, {
        id: 'stopped-actor',
      });
      testActors.push(stoppedActor);

      await stoppedActor.stop();

      // Act & Assert: Should throw when trying to subscribe
      expect(() => {
        stoppedActor.subscribe(() => {});
      }).toThrow();

      log.debug('Stopped actor subscription test completed');
    });
  });

  describe('Performance with Event Emission', () => {
    it('should handle high-frequency event emission', async () => {
      // Arrange: Create actor with listener
      const performanceActor = createActorRef<TestEvent, SystemEvent>(testMachine, {
        id: 'performance-actor',
      });
      testActors.push(performanceActor);

      const listener = vi.fn();
      performanceActor.subscribe(listener);

      const eventCount = 1000;
      const events: SystemEvent[] = [];

      for (let i = 0; i < eventCount; i++) {
        events.push({
          type: 'SYSTEM_NOTIFICATION',
          level: 'info',
          message: `Event ${i}`,
        });
      }

      // Act: Emit many events rapidly
      const startTime = performance.now();
      for (const event of events) {
        performanceActor.emit(event);
      }
      const endTime = performance.now();
      const emissionTime = endTime - startTime;

      // Assert: Should complete quickly and all events received
      expect(listener).toHaveBeenCalledTimes(eventCount);
      expect(emissionTime).toBeLessThan(100); // Should complete in < 100ms

      log.debug('High-frequency emission test completed', {
        eventCount,
        emissionTime: `${emissionTime.toFixed(2)}ms`,
      });
    });
  });
});
