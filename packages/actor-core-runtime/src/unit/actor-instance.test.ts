/**
 * @module actor-core/runtime/actor-instance.test
 * @description Tests for ActorInstance interface and type guards
 */

import { describe, expect, it } from 'vitest';
import {
  type ActorInstance,
  isActorInstance,
  isContextActor,
  isMachineActor,
  isStatelessActor,
} from '../actor-instance.js';
import type { ActorMessage } from '../actor-system.js';
import type { ActorSnapshot } from '../types.js';

describe.skip('ActorInstance Type Guards', () => {
  // Mock actor instance for testing
  const createMockActor = (type: 'stateless' | 'context' | 'machine'): ActorInstance => ({
    id: 'test-actor',
    status: 'running',
    send: (_event: ActorMessage) => {},
    start: () => {},
    stop: () => {},
    ask: async <T>(_message: ActorMessage, _timeout?: number): Promise<T> => {
      return {} as T;
    },
    getSnapshot: (): ActorSnapshot => ({
      context: {},
      value: 'active',
      status: 'running',
      error: undefined,
      matches: () => false,
      can: () => false,
      hasTag: () => false,
      toJSON: () => ({}),
    }),
    getType: () => type,
  });

  describe.skip('isActorInstance', () => {
    it('should return true for valid actor instances', () => {
      const statelessActor = createMockActor('stateless');
      const contextActor = createMockActor('context');
      const machineActor = createMockActor('machine');

      expect(isActorInstance(statelessActor)).toBe(true);
      expect(isActorInstance(contextActor)).toBe(true);
      expect(isActorInstance(machineActor)).toBe(true);
    });

    it('should return false for null or undefined', () => {
      expect(isActorInstance(null)).toBe(false);
      expect(isActorInstance(undefined)).toBe(false);
    });

    it('should return false for non-objects', () => {
      expect(isActorInstance('string')).toBe(false);
      expect(isActorInstance(123)).toBe(false);
      expect(isActorInstance(true)).toBe(false);
      expect(isActorInstance([])).toBe(false);
    });

    it('should return false for objects missing required methods', () => {
      const invalidActor1 = { id: 'test' }; // Missing all methods
      const invalidActor2 = {
        id: 'test',
        status: 'running',
        send: () => {},
        // Missing start, stop, getSnapshot, getType
      };
      const invalidActor3 = {
        id: 'test',
        status: 'running',
        send: () => {},
        start: () => {},
        stop: () => {},
        getSnapshot: () => ({}),
        // Missing getType
      };

      expect(isActorInstance(invalidActor1)).toBe(false);
      expect(isActorInstance(invalidActor2)).toBe(false);
      expect(isActorInstance(invalidActor3)).toBe(false);
    });

    it('should return false for invalid actor types', () => {
      const invalidActor = {
        id: 'test',
        status: 'running',
        send: () => {},
        start: () => {},
        stop: () => {},
        getSnapshot: () => ({}),
        getType: () => 'invalid' as const, // Invalid type
      };

      expect(isActorInstance(invalidActor)).toBe(false);
    });

    it('should return false for objects with non-function methods', () => {
      const invalidActor = {
        id: 'test',
        status: 'running',
        send: 'not a function',
        start: 'not a function',
        stop: 'not a function',
        getSnapshot: 'not a function',
        getType: 'not a function',
      };

      expect(isActorInstance(invalidActor)).toBe(false);
    });
  });

  describe.skip('Actor Type Specific Guards', () => {
    const statelessActor = createMockActor('stateless');
    const contextActor = createMockActor('context');
    const machineActor = createMockActor('machine');

    describe.skip('isStatelessActor', () => {
      it('should correctly identify stateless actors', () => {
        expect(isStatelessActor(statelessActor)).toBe(true);
        expect(isStatelessActor(contextActor)).toBe(false);
        expect(isStatelessActor(machineActor)).toBe(false);
      });
    });

    describe.skip('isContextActor', () => {
      it('should correctly identify context actors', () => {
        expect(isContextActor(statelessActor)).toBe(false);
        expect(isContextActor(contextActor)).toBe(true);
        expect(isContextActor(machineActor)).toBe(false);
      });
    });

    describe.skip('isMachineActor', () => {
      it('should correctly identify machine actors', () => {
        expect(isMachineActor(statelessActor)).toBe(false);
        expect(isMachineActor(contextActor)).toBe(false);
        expect(isMachineActor(machineActor)).toBe(true);
      });
    });
  });

  describe.skip('Edge Cases', () => {
    it('should handle actors with additional properties', () => {
      const actorWithExtras = {
        ...createMockActor('context'),
        extraProp: 'value',
        anotherProp: 123,
      };

      expect(isActorInstance(actorWithExtras)).toBe(true);
    });

    it('should handle actors with async stop method', () => {
      const asyncActor: ActorInstance = {
        ...createMockActor('stateless'),
        stop: async () => {}, // Async version
      };

      expect(isActorInstance(asyncActor)).toBe(true);
    });

    it('should handle actors with optional getInternalState method', () => {
      const actorWithInternalState: ActorInstance = {
        ...createMockActor('context'),
        getInternalState: () => ({ some: 'state' }),
      };

      expect(isActorInstance(actorWithInternalState)).toBe(true);
    });
  });
});
