/**
 * Behavior Tests for Actor Event Bus - Actor-Web Framework
 *
 * These tests focus on testing the actual ActorEventBus framework API
 * following TESTING-GUIDE.md principles: behavior over implementation
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorEventBus } from '@/core/actor-event-bus';
import { Logger } from '@/core/dev-mode';

// Use scoped logger as recommended in Testing Guide
const log = Logger.namespace('ACTOR_EVENT_BUS_TEST');

// Test event types for type safety
interface TestEvent {
  id: string;
  message: string;
  timestamp: number;
}

interface AnotherEventType {
  action: 'start' | 'stop' | 'pause';
  data?: unknown;
}

describe('Actor Event Bus - Framework API', () => {
  let eventBus: ActorEventBus<TestEvent>;

  beforeEach(() => {
    // ✅ CORRECT: Test the real framework API, not mocks
    eventBus = new ActorEventBus<TestEvent>();
    log.debug('Test environment set up');
  });

  afterEach(() => {
    // Clean up event bus to prevent memory leaks
    if (!eventBus.destroyed) {
      eventBus.destroy();
    }
    log.debug('Test environment cleaned up');
  });

  describe('Event Emission', () => {
    it('should emit events to subscribers', () => {
      // Arrange: Create event listener
      const listener = vi.fn();
      const testEvent: TestEvent = {
        id: 'test-1',
        message: 'Hello from actor',
        timestamp: Date.now(),
      };

      // Act: Subscribe and emit
      eventBus.subscribe(listener);
      eventBus.emit(testEvent);

      // Assert: Listener should be called with event
      expect(listener).toHaveBeenCalledWith(testEvent);
      expect(listener).toHaveBeenCalledTimes(1);

      log.debug('Event emission test completed', { eventId: testEvent.id });
    });

    it('should emit events to multiple subscribers', () => {
      // Arrange: Create multiple listeners
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();
      const testEvent: TestEvent = {
        id: 'test-multi',
        message: 'Multi-subscriber test',
        timestamp: Date.now(),
      };

      // Act: Subscribe multiple listeners and emit
      eventBus.subscribe(listener1);
      eventBus.subscribe(listener2);
      eventBus.subscribe(listener3);
      eventBus.emit(testEvent);

      // Assert: All listeners should be called
      expect(listener1).toHaveBeenCalledWith(testEvent);
      expect(listener2).toHaveBeenCalledWith(testEvent);
      expect(listener3).toHaveBeenCalledWith(testEvent);
      expect(eventBus.subscriberCount).toBe(3);

      log.debug('Multi-subscriber test completed', { subscriberCount: 3 });
    });

    it('should handle events with different types', () => {
      // Arrange: Create event bus for different type
      const anotherEventBus = new ActorEventBus<AnotherEventType>();
      const listener = vi.fn();
      const testEvent: AnotherEventType = {
        action: 'start',
        data: { config: 'test' },
      };

      // Act: Subscribe and emit
      anotherEventBus.subscribe(listener);
      anotherEventBus.emit(testEvent);

      // Assert: Type-safe event handling
      expect(listener).toHaveBeenCalledWith(testEvent);

      // Cleanup
      anotherEventBus.destroy();

      log.debug('Type safety test completed');
    });
  });

  describe('Event Subscription', () => {
    it('should return unsubscribe function', () => {
      // Arrange: Create listener
      const listener = vi.fn();
      const testEvent: TestEvent = {
        id: 'unsubscribe-test',
        message: 'Test unsubscribe',
        timestamp: Date.now(),
      };

      // Act: Subscribe and get unsubscribe function
      const unsubscribe = eventBus.subscribe(listener);

      // Emit before unsubscribe
      eventBus.emit(testEvent);
      expect(listener).toHaveBeenCalledTimes(1);

      // Unsubscribe and emit again
      unsubscribe();
      eventBus.emit(testEvent);

      // Assert: Should not receive second event
      expect(listener).toHaveBeenCalledTimes(1);
      expect(eventBus.subscriberCount).toBe(0);

      log.debug('Unsubscribe test completed');
    });

    it('should handle multiple unsubscribes safely', () => {
      // Arrange: Create listener
      const listener = vi.fn();

      // Act: Subscribe and unsubscribe multiple times
      const unsubscribe = eventBus.subscribe(listener);
      unsubscribe();
      unsubscribe(); // Should not throw

      // Assert: Should be safe to call multiple times
      expect(eventBus.subscriberCount).toBe(0);

      log.debug('Multiple unsubscribe test completed');
    });

    it('should track subscriber count correctly', () => {
      // Arrange: Create listeners
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      // Act: Subscribe and track count
      expect(eventBus.subscriberCount).toBe(0);
      expect(eventBus.hasSubscribers).toBe(false);

      const unsubscribe1 = eventBus.subscribe(listener1);
      expect(eventBus.subscriberCount).toBe(1);
      expect(eventBus.hasSubscribers).toBe(true);

      const unsubscribe2 = eventBus.subscribe(listener2);
      expect(eventBus.subscriberCount).toBe(2);

      unsubscribe1();
      expect(eventBus.subscriberCount).toBe(1);

      unsubscribe2();
      expect(eventBus.subscriberCount).toBe(0);
      expect(eventBus.hasSubscribers).toBe(false);

      log.debug('Subscriber count test completed');
    });
  });

  describe('Error Handling', () => {
    it('should handle listener errors gracefully', () => {
      // Arrange: Create error-throwing listener
      const errorListener = vi.fn(() => {
        throw new Error('Test listener error');
      });
      const goodListener = vi.fn();
      const testEvent: TestEvent = {
        id: 'error-test',
        message: 'Error handling test',
        timestamp: Date.now(),
      };

      // Act: Subscribe both listeners and emit
      eventBus.subscribe(errorListener);
      eventBus.subscribe(goodListener);

      // Should not throw
      expect(() => eventBus.emit(testEvent)).not.toThrow();

      // Assert: Good listener should still receive event
      expect(errorListener).toHaveBeenCalledWith(testEvent);
      expect(goodListener).toHaveBeenCalledWith(testEvent);

      log.debug('Error handling test completed');
    });

    it('should prevent operations on destroyed event bus', () => {
      // Arrange: Create listener
      const listener = vi.fn();
      const testEvent: TestEvent = {
        id: 'destroyed-test',
        message: 'Destroyed bus test',
        timestamp: Date.now(),
      };

      // Act: Destroy and try operations
      eventBus.destroy();

      // Should not throw but should not work
      const unsubscribe = eventBus.subscribe(listener);
      eventBus.emit(testEvent);

      // Assert: Operations should be safe but ineffective
      expect(listener).not.toHaveBeenCalled();
      expect(eventBus.destroyed).toBe(true);
      expect(eventBus.subscriberCount).toBe(0);
      expect(typeof unsubscribe).toBe('function'); // Should return no-op function

      log.debug('Destroyed bus test completed');
    });
  });

  describe('Lifecycle Management', () => {
    it('should destroy event bus and cleanup all subscribers', () => {
      // Arrange: Create listeners
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      eventBus.subscribe(listener1);
      eventBus.subscribe(listener2);
      expect(eventBus.subscriberCount).toBe(2);

      // Act: Destroy event bus
      eventBus.destroy();

      // Assert: All subscribers should be cleared
      expect(eventBus.subscriberCount).toBe(0);
      expect(eventBus.destroyed).toBe(true);
      expect(eventBus.hasSubscribers).toBe(false);

      log.debug('Destroy lifecycle test completed');
    });

    it('should handle multiple destroy calls safely', () => {
      // Act: Destroy multiple times
      eventBus.destroy();
      expect(() => eventBus.destroy()).not.toThrow();

      // Assert: Should remain destroyed
      expect(eventBus.destroyed).toBe(true);

      log.debug('Multiple destroy test completed');
    });
  });

  describe('Performance and Concurrency', () => {
    it('should handle concurrent modifications during emission', () => {
      // Arrange: Create listeners that modify subscriber list
      const listeners: Array<() => void> = [];
      let emittedCount = 0;

      const createModifyingListener = () => () => {
        emittedCount++;
        // Add a new listener during emission
        if (emittedCount === 1) {
          eventBus.subscribe(() => {
            emittedCount++;
          });
        }
      };

      // Act: Subscribe listeners and emit
      for (let i = 0; i < 3; i++) {
        const listener = createModifyingListener();
        listeners.push(listener);
        eventBus.subscribe(listener);
      }

      const testEvent: TestEvent = {
        id: 'concurrent-test',
        message: 'Concurrent modification test',
        timestamp: Date.now(),
      };

      // Should not throw despite concurrent modification
      expect(() => eventBus.emit(testEvent)).not.toThrow();

      // Assert: Should handle concurrent modifications safely
      expect(emittedCount).toBeGreaterThan(0);

      log.debug('Concurrent modification test completed', { emittedCount });
    });

    it('should maintain performance with many subscribers', () => {
      // Arrange: Create many listeners
      const listenerCount = 1000;
      const listeners: Array<() => void> = [];

      for (let i = 0; i < listenerCount; i++) {
        const listener = vi.fn();
        listeners.push(listener);
        eventBus.subscribe(listener);
      }

      const testEvent: TestEvent = {
        id: 'performance-test',
        message: 'Performance test with many subscribers',
        timestamp: Date.now(),
      };

      // Act: Measure emission time
      const startTime = performance.now();
      eventBus.emit(testEvent);
      const endTime = performance.now();
      const emissionTime = endTime - startTime;

      // Assert: Should complete in reasonable time (< 100ms for 1000 subscribers)
      expect(emissionTime).toBeLessThan(100);
      expect(eventBus.subscriberCount).toBe(listenerCount);

      log.debug('Performance test completed', {
        listenerCount,
        emissionTime: `${emissionTime.toFixed(2)}ms`,
      });
    });
  });
});
