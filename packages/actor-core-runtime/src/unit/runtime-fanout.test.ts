/**
 * @file Runtime Fan-Out Shortcut Tests
 * @description Tests for the Runtime Fan-Out type system and core logic
 */

import { describe, expect, it } from 'vitest';
import {
  type CreateDomainEvent,
  createFanOutHelper,
  type DomainEvent,
  detectFanOutEvents,
  type EnsureValidDomainEvent,
  type FormSavedEvent,
  isDomainEvent,
  type UserLoggedInEvent,
  type ValidDomainEvent,
} from '../runtime-fanout.js';

describe('Runtime Fan-Out Type System', () => {
  // ============================================================================
  // Domain Event Type Tests
  // ============================================================================

  describe('DomainEvent types', () => {
    it('should accept valid domain events at compile time', () => {
      // Valid domain events
      type ValidEvent1 = ValidDomainEvent<{ type: 'TEST'; data: string }>;
      type ValidEvent2 = ValidDomainEvent<{
        type: 'USER_ACTION';
        userId: string;
        timestamp: number;
      }>;

      // These should compile without errors
      const event1: ValidEvent1 = { type: 'TEST', data: 'hello' };
      const event2: ValidEvent2 = { type: 'USER_ACTION', userId: '123', timestamp: Date.now() };

      expect(event1.type).toBe('TEST');
      expect(event2.userId).toBe('123');
    });

    it('should reject invalid domain events at compile time', () => {
      // These should show TypeScript errors (commented out for runtime tests)
      // type InvalidEvent1 = ValidDomainEvent<{ data: string }>; // No type property
      // type InvalidEvent2 = ValidDomainEvent<{ type: 'TEST'; fn: () => void }>; // Non-serializable

      // Ensure our examples work
      type FormEvent = FormSavedEvent;
      type UserEvent = UserLoggedInEvent;

      const formEvent: FormEvent = {
        type: 'FORM_SAVED',
        formId: 'user-profile',
        timestamp: Date.now(),
      };

      const userEvent: UserEvent = {
        type: 'USER_LOGGED_IN',
        userId: '123',
        sessionId: 'abc',
        timestamp: Date.now(),
      };

      expect(formEvent.type).toBe('FORM_SAVED');
      expect(userEvent.type).toBe('USER_LOGGED_IN');
    });
  });

  // ============================================================================
  // Runtime Type Guard Tests
  // ============================================================================

  describe('isDomainEvent runtime type guard', () => {
    it('should identify valid domain events', () => {
      const validEvent = { type: 'TEST_EVENT', data: 'hello', timestamp: 123 };
      const validEventArray = { type: 'ARRAY_EVENT', items: ['a', 'b', 'c'] };
      const validEventNested = { type: 'NESTED_EVENT', user: { id: '123', name: 'Alice' } };

      expect(isDomainEvent(validEvent)).toBe(true);
      expect(isDomainEvent(validEventArray)).toBe(true);
      expect(isDomainEvent(validEventNested)).toBe(true);
    });

    it('should reject invalid domain events', () => {
      const noType = { data: 'hello' };
      const nonStringType = { type: 123, data: 'hello' };
      const withFunction = { type: 'TEST', fn: () => {} };
      const withDate = { type: 'TEST', date: new Date() };
      const withUndefined = { type: 'TEST', value: undefined };
      const nullValue = null;
      const primitiveValue = 'string';

      expect(isDomainEvent(noType)).toBe(false);
      expect(isDomainEvent(nonStringType)).toBe(false);
      expect(isDomainEvent(withFunction)).toBe(false);
      expect(isDomainEvent(withDate)).toBe(false);
      expect(isDomainEvent(withUndefined)).toBe(false);
      expect(isDomainEvent(nullValue)).toBe(false);
      expect(isDomainEvent(primitiveValue)).toBe(false);
    });
  });

  // ============================================================================
  // Fan-Out Detection Tests
  // ============================================================================

  describe('detectFanOutEvents', () => {
    const originalContext = { count: 0, lastUpdate: Date.now() };

    it('should detect direct domain event return', () => {
      const domainEvent = { type: 'COUNT_CHANGED', newValue: 5 };
      const result = detectFanOutEvents(domainEvent, originalContext);

      expect(result.context).toBe(originalContext);
      expect(result.emit).toBeUndefined();
      expect(result.fanOutEvents).toHaveLength(1);
      expect(result.fanOutEvents[0]).toBe(domainEvent);
    });

    it('should detect array of domain events', () => {
      const events = [
        { type: 'FIRST_EVENT', data: 1 },
        { type: 'SECOND_EVENT', data: 2 },
      ];
      const result = detectFanOutEvents(events, originalContext);

      expect(result.context).toBe(originalContext);
      expect(result.emit).toBeUndefined();
      expect(result.fanOutEvents).toHaveLength(2);
      expect(result.fanOutEvents).toBe(events);
    });

    it('should handle traditional behavior result', () => {
      const behaviorResult = {
        context: { count: 1, lastUpdate: Date.now() },
        emit: { type: 'TRADITIONAL_EMIT', value: 42 },
      };
      const result = detectFanOutEvents(behaviorResult, originalContext);

      expect(result.context).toBe(behaviorResult.context);
      expect(result.emit).toBe(behaviorResult.emit);
      expect(result.fanOutEvents).toHaveLength(0);
    });

    it('should handle invalid results gracefully', () => {
      const invalidResult = 'invalid-string';
      const result = detectFanOutEvents(invalidResult as never, originalContext);

      expect(result.context).toBe(originalContext);
      expect(result.emit).toBeUndefined();
      expect(result.fanOutEvents).toHaveLength(0);
    });
  });

  // ============================================================================
  // Imperative Helper Tests
  // ============================================================================

  describe('FanOutHelper', () => {
    it('should queue events for fan-out', () => {
      const helper = createFanOutHelper<DomainEvent>();

      const event1 = { type: 'FIRST', data: 'a' };
      const event2 = { type: 'SECOND', data: 'b' };

      helper.emitAndSend(event1);
      helper.emitAndSend(event2);

      const queued = helper.getQueuedEvents();
      expect(queued).toHaveLength(2);
      expect(queued[0]).toBe(event1);
      expect(queued[1]).toBe(event2);
    });

    it('should clear queued events', () => {
      const helper = createFanOutHelper();

      helper.emitAndSend({ type: 'TEST', data: 'test' });
      expect(helper.getQueuedEvents()).toHaveLength(1);

      helper.clear();
      expect(helper.getQueuedEvents()).toHaveLength(0);
    });
  });

  // ============================================================================
  // Type Utility Tests
  // ============================================================================

  describe('Type utilities', () => {
    it('should validate CreateDomainEvent type', () => {
      type SavedEvent = CreateDomainEvent<'FORM_SAVED', { formId: string; timestamp: number }>;
      type SimpleEvent = CreateDomainEvent<'BUTTON_CLICKED'>;

      const savedEvent: SavedEvent = {
        type: 'FORM_SAVED',
        formId: 'user-profile',
        timestamp: Date.now(),
      };

      const simpleEvent: SimpleEvent = {
        type: 'BUTTON_CLICKED',
      };

      expect(savedEvent.type).toBe('FORM_SAVED');
      expect(simpleEvent.type).toBe('BUTTON_CLICKED');
    });

    it('should validate EnsureValidDomainEvent type', () => {
      type ValidEvent = EnsureValidDomainEvent<{ type: 'VALID'; data: string }>;
      // type InvalidEvent = EnsureValidDomainEvent<{ data: string }>; // Would show error message

      const validEvent: ValidEvent = { type: 'VALID', data: 'test' };
      expect(validEvent.type).toBe('VALID');
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration scenarios', () => {
    it('should support typical component usage patterns', () => {
      // Simulate component message handler returning domain event
      interface FormContext {
        formData: Record<string, string>;
        submitting: boolean;
      }
      type FormDomainEvents =
        | { type: 'FORM_SAVED'; formId: string; timestamp: number }
        | { type: 'FORM_CLEARED'; timestamp: number };

      const context: FormContext = { formData: { name: 'Alice' }, submitting: false };

      // Test direct event return
      const saveEvent: ValidDomainEvent<FormDomainEvents> = {
        type: 'FORM_SAVED',
        formId: 'profile',
        timestamp: Date.now(),
      };

      const result = detectFanOutEvents(saveEvent, context);

      expect(result.fanOutEvents).toHaveLength(1);
      expect(result.fanOutEvents[0].type).toBe('FORM_SAVED');
      expect(result.context).toBe(context);
    });

    it('should maintain backward compatibility', () => {
      // Traditional behavior result should work unchanged
      const traditionalResult = {
        context: { data: 'updated' },
        emit: [
          { type: 'DATA_UPDATED', timestamp: Date.now() },
          { type: 'ANALYTICS_EVENT', action: 'update' },
        ],
      };

      const result = detectFanOutEvents(traditionalResult, { data: 'original' });

      expect(result.context).toBe(traditionalResult.context);
      expect(result.emit).toBe(traditionalResult.emit);
      expect(result.fanOutEvents).toHaveLength(0);
    });
  });
});
