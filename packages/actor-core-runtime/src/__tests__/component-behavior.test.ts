/**
 * @module actor-core/runtime/__tests__/component-behavior.test
 * @description Tests for component behavior types and utilities
 */

import { describe, expect, it } from 'vitest';
import { createMachine } from 'xstate';
import type { ActorMessage, JsonValue } from '../actor-system.js';
import {
  type ComponentBehaviorConfig,
  componentBehavior,
  isComponentBehavior,
  isJsonSerializable,
  type SerializableEvent,
  validateSerializableEvent,
} from '../component-behavior.js';

describe('Component Behavior Types', () => {
  describe('isJsonSerializable', () => {
    it('should accept primitive types', () => {
      expect(isJsonSerializable(null)).toBe(true);
      expect(isJsonSerializable(undefined)).toBe(true);
      expect(isJsonSerializable('string')).toBe(true);
      expect(isJsonSerializable(123)).toBe(true);
      expect(isJsonSerializable(true)).toBe(true);
      expect(isJsonSerializable(false)).toBe(true);
    });

    it('should accept arrays of primitives', () => {
      expect(isJsonSerializable([1, 2, 3])).toBe(true);
      expect(isJsonSerializable(['a', 'b', 'c'])).toBe(true);
      expect(isJsonSerializable([true, false, null])).toBe(true);
    });

    it('should accept plain objects', () => {
      expect(isJsonSerializable({})).toBe(true);
      expect(isJsonSerializable({ name: 'test', value: 123 })).toBe(true);
      expect(isJsonSerializable({ nested: { deeply: { value: true } } })).toBe(true);
    });

    it('should reject non-serializable types', () => {
      expect(isJsonSerializable(new Date())).toBe(false);
      expect(isJsonSerializable(/regex/)).toBe(false);
      expect(isJsonSerializable(new Error('test'))).toBe(false);
      expect(isJsonSerializable(new Map())).toBe(false);
      expect(isJsonSerializable(new Set())).toBe(false);
      expect(isJsonSerializable(Promise.resolve())).toBe(false);
      expect(isJsonSerializable(() => {})).toBe(false);
      expect(isJsonSerializable(Symbol('test'))).toBe(false);
    });

    it('should reject objects containing non-serializable values', () => {
      expect(isJsonSerializable({ date: new Date() })).toBe(false);
      expect(isJsonSerializable({ func: () => {} })).toBe(false);
      expect(isJsonSerializable({ nested: { map: new Map() } })).toBe(false);
    });
  });

  describe('validateSerializableEvent', () => {
    it('should pass valid serializable events', () => {
      const event1 = { type: 'TEST', data: 'value' };
      expect(validateSerializableEvent(event1)).toBe(event1);

      const event2 = { type: 'COMPLEX', payload: { nested: [1, 2, 3] } };
      expect(validateSerializableEvent(event2)).toBe(event2);
    });

    it('should throw descriptive errors for non-serializable events', () => {
      expect(() =>
        validateSerializableEvent({ type: 'TEST', date: new Date() }, 'TestEvent')
      ).toThrow('TestEvent is not JSON-serializable');

      expect(() => validateSerializableEvent({ type: 'TEST', fn: () => {} })).toThrow(
        'Found non-serializable value'
      );

      expect(() => validateSerializableEvent({ type: 'TEST', map: new Map() })).toThrow('[Map]');
    });
  });

  describe('componentBehavior builder', () => {
    // Define test types
    type TestMessage =
      | { type: 'INCREMENT' }
      | { type: 'DECREMENT' }
      | { type: 'SET_VALUE'; value: number };

    type TestContext = {
      count: number;
      lastUpdate: number;
    };

    type TestEvent =
      | { type: 'COUNT_CHANGED'; count: number }
      | { type: 'VALUE_SET'; value: number };

    it('should build a complete component behavior', () => {
      const behavior = componentBehavior<TestMessage, TestContext, TestEvent>()
        .context({ count: 0, lastUpdate: Date.now() })
        .onMessage(async ({ message, context }) => {
          switch (message.type) {
            case 'INCREMENT':
              return {
                context: { count: context.count + 1, lastUpdate: Date.now() },
                emit: {
                  type: 'COUNT_CHANGED',
                  count: context.count + 1,
                } as SerializableEvent<TestEvent>,
              };
            case 'DECREMENT':
              return {
                context: { count: context.count - 1, lastUpdate: Date.now() },
                emit: {
                  type: 'COUNT_CHANGED',
                  count: context.count - 1,
                } as SerializableEvent<TestEvent>,
              };
            case 'SET_VALUE':
              return {
                context: { count: message.value, lastUpdate: Date.now() },
                emit: { type: 'VALUE_SET', value: message.value } as SerializableEvent<TestEvent>,
              };
          }
        })
        .dependencies({
          logger: 'actor://system/logger',
          metrics: 'actor://system/metrics',
        })
        .mailbox({ capacity: 100, strategy: 'drop-oldest' })
        .transport('local')
        .build();

      expect(behavior.context).toEqual({ count: 0, lastUpdate: expect.any(Number) });
      expect(behavior.dependencies).toEqual({
        logger: 'actor://system/logger',
        metrics: 'actor://system/metrics',
      });
      expect(behavior.mailbox).toEqual({ capacity: 100, strategy: 'drop-oldest' });
      expect(behavior.transport).toBe('local');
      expect(behavior.onMessage).toBeDefined();
    });

    it('should throw error if onMessage is not provided', () => {
      expect(() => componentBehavior().context({ value: 0 }).build()).toThrow(
        'Component behavior must have an onMessage handler'
      );
    });

    it('should support minimal configuration', () => {
      const behavior = componentBehavior()
        .onMessage(async ({ context }) => ({ context }))
        .build();

      expect(behavior.onMessage).toBeDefined();
      expect(behavior.dependencies).toBeUndefined();
      expect(behavior.mailbox).toBeUndefined();
      expect(behavior.transport).toBeUndefined();
    });
  });

  describe('isComponentBehavior type guard', () => {
    it('should identify component behaviors', () => {
      const componentBehaviorObj: ComponentBehaviorConfig = {
        onMessage: async () => ({ context: {} }),
        dependencies: { api: 'actor://api' },
      };
      expect(isComponentBehavior(componentBehaviorObj)).toBe(true);

      const withMailbox: ComponentBehaviorConfig = {
        onMessage: async () => ({ context: {} }),
        mailbox: { capacity: 50, strategy: 'suspend' },
      };
      expect(isComponentBehavior(withMailbox)).toBe(true);

      const withTransport: ComponentBehaviorConfig = {
        onMessage: async () => ({ context: {} }),
        transport: 'worker',
      };
      expect(isComponentBehavior(withTransport)).toBe(true);
    });

    it('should reject standard actor behaviors', () => {
      const actorBehavior = {
        onMessage: async () => ({ context: {} }),
      };
      expect(isComponentBehavior(actorBehavior)).toBe(false);

      const withContext = {
        context: { value: 0 },
        onMessage: async () => ({ context: {} }),
      };
      expect(isComponentBehavior(withContext)).toBe(false);
    });
  });

  describe('Type safety compilation tests', () => {
    it('should enforce JSON serializability at compile time', () => {
      // This test verifies TypeScript compilation behavior
      // The actual type checking happens at compile time

      type ValidEvent = { type: 'VALID'; data: string };
      type InvalidEvent = { type: 'INVALID'; fn: () => void };

      // This would fail TypeScript compilation:
      // @ts-expect-error
      const _invalid: SerializableEvent<InvalidEvent> = { type: 'INVALID', fn: () => {} };

      const valid: SerializableEvent<ValidEvent> = { type: 'VALID', data: 'test' };
      expect(valid).toBeDefined();
    });

    it('should work with XState machines', () => {
      const _toggleMachine = createMachine({
        id: 'toggle',
        initial: 'inactive',
        states: {
          inactive: { on: { TOGGLE: 'active' } },
          active: { on: { TOGGLE: 'inactive' } },
        },
      });

      const behavior = componentBehavior<
        ActorMessage,
        { isActive: boolean },
        { type: 'TOGGLED'; wasActive: boolean }
      >()
        .context({ isActive: false })
        .onMessage(async ({ message, context }) => {
          if (message.type === 'TOGGLE') {
            const wasActive = context.isActive;
            return {
              context: { isActive: !context.isActive },
              emit: { type: 'TOGGLED', wasActive } as SerializableEvent<{
                type: 'TOGGLED';
                wasActive: boolean;
              }>,
            };
          }
          return { context };
        })
        .build();

      expect(behavior).toBeDefined();
    });
  });

  describe('Component behavior with dependencies', () => {
    it('should handle dependency injection patterns', () => {
      interface FormContext {
        formData: Record<string, JsonValue>;
        errors: string[];
        isSubmitting: boolean;
      }

      const formBehavior = componentBehavior<ActorMessage, FormContext>()
        .context({ formData: {}, errors: [], isSubmitting: false })
        .dependencies({
          validator: 'actor://services/validator',
          backend: 'actor://services/backend',
          logger: 'capability://logging',
        })
        .onMessage(async ({ context, dependencies }) => {
          // Dependencies would be resolved PIDs at runtime
          expect(dependencies).toBeDefined();
          return { context };
        })
        .build();

      expect(formBehavior.dependencies).toHaveProperty('validator');
      expect(formBehavior.dependencies).toHaveProperty('backend');
      expect(formBehavior.dependencies).toHaveProperty('logger');
    });
  });
});
