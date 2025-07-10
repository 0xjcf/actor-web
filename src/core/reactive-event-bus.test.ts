/**
 * Behavior Tests for Global Event Bus - Actor-SPA Framework
 *
 * These tests focus on the behavior of a simple global event communication system
 * from a user perspective, following TESTING-GUIDE.md principles
 */

import {
  type MockGlobalEventBus,
  type TestEnvironment,
  createTestEnvironment,
  setupGlobalMocks,
} from '@/framework/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Global Event Bus Behavior', () => {
  let testEnv: TestEnvironment;
  let eventBus: MockGlobalEventBus;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    eventBus = setupGlobalMocks();
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  describe('Event Communication', () => {
    it('allows components to communicate via events', () => {
      // Behavior: Components should be able to send and receive messages
      const handler = vi.fn();

      // Component A subscribes to user events
      eventBus.on('user-login', handler);

      // Component B emits a user event
      eventBus.emit('user-login', { userId: '123', username: 'john' });

      // Component A should receive the event
      expect(handler).toHaveBeenCalledWith({ userId: '123', username: 'john' });
    });

    it('supports multiple components listening to the same event', () => {
      // Behavior: Multiple components can react to the same system event
      const headerHandler = vi.fn();
      const sidebarHandler = vi.fn();
      const dashboardHandler = vi.fn();

      // Multiple components subscribe to theme changes
      eventBus.on('theme-changed', headerHandler);
      eventBus.on('theme-changed', sidebarHandler);
      eventBus.on('theme-changed', dashboardHandler);

      // System emits theme change
      eventBus.emit('theme-changed', { theme: 'dark' });

      // All components should update
      expect(headerHandler).toHaveBeenCalledWith({ theme: 'dark' });
      expect(sidebarHandler).toHaveBeenCalledWith({ theme: 'dark' });
      expect(dashboardHandler).toHaveBeenCalledWith({ theme: 'dark' });
    });

    it('isolates different event types', () => {
      // Behavior: Events should not interfere with each other
      const loginHandler = vi.fn();
      const logoutHandler = vi.fn();

      eventBus.on('user-login', loginHandler);
      eventBus.on('user-logout', logoutHandler);

      // Only trigger login
      eventBus.emit('user-login', { user: 'alice' });

      expect(loginHandler).toHaveBeenCalledWith({ user: 'alice' });
      expect(logoutHandler).not.toHaveBeenCalled();
    });
  });

  describe('Data Integrity', () => {
    it('preserves event data without modification', () => {
      // Behavior: Event data should pass through unchanged
      const handler = vi.fn();
      const complexData = {
        user: { id: 1, name: 'Alice', preferences: { theme: 'dark' } },
        actions: ['read', 'write'],
        timestamp: Date.now(),
      };

      eventBus.on('data-event', handler);
      eventBus.emit('data-event', complexData);

      expect(handler).toHaveBeenCalledWith(complexData);
      expect(handler.mock.calls[0][0]).toBe(complexData); // Same reference
    });

    it('handles different data types correctly', () => {
      // Behavior: Should work with various data types
      const handler = vi.fn();
      eventBus.on('flexible-event', handler);

      // Test different data types
      eventBus.emit('flexible-event', 'string');
      expect(handler).toHaveBeenLastCalledWith('string');

      eventBus.emit('flexible-event', 42);
      expect(handler).toHaveBeenLastCalledWith(42);

      eventBus.emit('flexible-event', true);
      expect(handler).toHaveBeenLastCalledWith(true);

      eventBus.emit('flexible-event', null);
      expect(handler).toHaveBeenLastCalledWith(null);

      eventBus.emit('flexible-event', [1, 2, 3]);
      expect(handler).toHaveBeenLastCalledWith([1, 2, 3]);
    });
  });

  describe('Component Lifecycle', () => {
    it('allows components to unsubscribe when unmounting', () => {
      // Behavior: Components should clean up their subscriptions
      const handler = vi.fn();

      // Component subscribes
      eventBus.on('update', handler);

      // Verify it receives events
      eventBus.emit('update', { version: 1 });
      expect(handler).toHaveBeenCalledTimes(1);

      // Component unsubscribes (simulated by clearing)
      eventBus.clear();

      // Should not receive new events
      eventBus.emit('update', { version: 2 });
      expect(handler).toHaveBeenCalledTimes(1); // Still only called once
    });

    it('handles multiple subscribers safely', () => {
      // Behavior: System should handle many components efficiently
      const handlers = Array.from({ length: 50 }, () => vi.fn());

      // All components subscribe
      handlers.forEach((handler, _index) => {
        eventBus.on('broadcast', handler);
      });

      // Single broadcast
      eventBus.emit('broadcast', { message: 'Hello everyone!' });

      // All components should receive it
      handlers.forEach((handler) => {
        expect(handler).toHaveBeenCalledWith({ message: 'Hello everyone!' });
      });
    });
  });

  describe('Error Handling', () => {
    it('gracefully handles invalid events', () => {
      // Behavior: System should be robust to edge cases
      const handler = vi.fn();
      eventBus.on('test', handler);

      // Should not crash with undefined data
      expect(() => {
        eventBus.emit('test', undefined);
      }).not.toThrow();

      expect(handler).toHaveBeenCalledWith(undefined);
    });

    it('continues working if a handler throws an error', () => {
      // Behavior: One broken component shouldn't break others
      const workingHandler = vi.fn();
      const brokenHandler = vi.fn(() => {
        throw new Error('Component error');
      });
      const anotherWorkingHandler = vi.fn();

      eventBus.on('error-test', workingHandler);
      eventBus.on('error-test', brokenHandler);
      eventBus.on('error-test', anotherWorkingHandler);

      // Should not crash the whole system
      expect(() => {
        eventBus.emit('error-test', 'data');
      }).not.toThrow();

      // Working handlers should still be called
      expect(workingHandler).toHaveBeenCalledWith('data');
      expect(anotherWorkingHandler).toHaveBeenCalledWith('data');
    });
  });

  describe('Real-world Use Cases', () => {
    it('supports form validation communication', () => {
      // Behavior: Form components can communicate validation state
      const formHandler = vi.fn();
      const submitButtonHandler = vi.fn();

      eventBus.on('field-validation', formHandler);
      eventBus.on('field-validation', submitButtonHandler);

      // Field validation fails
      eventBus.emit('field-validation', {
        field: 'email',
        valid: false,
        error: 'Invalid email format',
      });

      expect(formHandler).toHaveBeenCalledWith({
        field: 'email',
        valid: false,
        error: 'Invalid email format',
      });
      expect(submitButtonHandler).toHaveBeenCalledWith({
        field: 'email',
        valid: false,
        error: 'Invalid email format',
      });
    });

    it('supports navigation state updates', () => {
      // Behavior: Navigation changes can notify multiple components
      const headerHandler = vi.fn();
      const breadcrumbHandler = vi.fn();
      const sidebarHandler = vi.fn();

      eventBus.on('route-changed', headerHandler);
      eventBus.on('route-changed', breadcrumbHandler);
      eventBus.on('route-changed', sidebarHandler);

      // Router emits navigation change
      eventBus.emit('route-changed', {
        from: '/dashboard',
        to: '/settings',
        params: { tab: 'profile' },
      });

      const expectedData = {
        from: '/dashboard',
        to: '/settings',
        params: { tab: 'profile' },
      };

      expect(headerHandler).toHaveBeenCalledWith(expectedData);
      expect(breadcrumbHandler).toHaveBeenCalledWith(expectedData);
      expect(sidebarHandler).toHaveBeenCalledWith(expectedData);
    });

    it('supports user session management', () => {
      // Behavior: Authentication events can update entire app state
      const appHandler = vi.fn();
      const menuHandler = vi.fn();

      eventBus.on('session-changed', appHandler);
      eventBus.on('session-changed', menuHandler);

      // User logs in
      eventBus.emit('session-changed', {
        type: 'login',
        user: { id: '123', name: 'Alice', role: 'admin' },
        token: 'jwt-token-here',
      });

      const expectedSessionData = {
        type: 'login',
        user: { id: '123', name: 'Alice', role: 'admin' },
        token: 'jwt-token-here',
      };

      expect(appHandler).toHaveBeenCalledWith(expectedSessionData);
      expect(menuHandler).toHaveBeenCalledWith(expectedSessionData);
    });
  });
});
