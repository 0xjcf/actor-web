/**
 * @module actor-core/runtime/context-actor.test
 * @description Tests for ContextActor implementation - OTP gen_server style
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { isActorInstance } from '../actor-instance.js';
import type { ActorMessage } from '../actor-system.js';
import { ContextActor, isContextActor } from '../context-actor.js';

describe.skip('ContextActor', () => {
  let actor: ContextActor<{ count: number }>;
  const actorId = 'test-context-actor';
  const initialContext = { count: 0 };

  beforeEach(() => {
    actor = new ContextActor(actorId, initialContext);
  });

  describe.skip('construction', () => {
    it('should create actor with initial context', () => {
      expect(actor.id).toBe(actorId);
      expect(actor.getContext()).toEqual(initialContext);
      expect(actor.status).toBe('idle');
    });

    it('should implement ActorInstance interface', () => {
      expect(isActorInstance(actor)).toBe(true);
    });
  });

  describe.skip('lifecycle management', () => {
    it('should start actor and change status to running', () => {
      actor.start();
      expect(actor.status).toBe('running');
    });

    it('should throw error when starting non-idle actor', () => {
      actor.start();
      expect(() => actor.start()).toThrow('Cannot start actor in running state');
    });

    it('should stop actor and change status to stopped', () => {
      actor.start();
      actor.stop();
      expect(actor.status).toBe('stopped');
    });

    it('should allow stopping from any state', () => {
      // From idle
      actor.stop();
      expect(actor.status).toBe('stopped');

      // From running
      actor = new ContextActor(actorId, initialContext);
      actor.start();
      actor.stop();
      expect(actor.status).toBe('stopped');
    });
  });

  describe.skip('message handling', () => {
    it('should accept messages when running', () => {
      actor.start();
      const message: ActorMessage = {
        type: 'TEST_MESSAGE',
        _timestamp: Date.now(),
        _version: '1.0.0',
      };

      expect(() => actor.send(message)).not.toThrow();
    });

    it('should throw error when sending to non-running actor', () => {
      const message: ActorMessage = {
        type: 'TEST_MESSAGE',
        _timestamp: Date.now(),
        _version: '1.0.0',
      };

      expect(() => actor.send(message)).toThrow('Cannot send message to idle actor');

      actor.stop();
      expect(() => actor.send(message)).toThrow('Cannot send message to stopped actor');
    });
  });

  describe.skip('context management', () => {
    it('should get current context', () => {
      expect(actor.getContext()).toEqual(initialContext);
    });

    it('should update context directly', () => {
      const newContext = { count: 5 };
      actor.updateContext(newContext);
      expect(actor.getContext()).toEqual(newContext);
    });

    it('should maintain context immutability', () => {
      const context = actor.getContext();
      context.count = 10;
      expect(actor.getContext().count).toBe(0); // Should still be 0
    });
  });

  describe.skip('snapshot', () => {
    it('should return correct snapshot when idle', () => {
      const snapshot = actor.getSnapshot();
      expect(snapshot).toMatchObject({
        value: 'active',
        context: initialContext,
        status: 'idle',
        error: undefined,
      });
      expect(snapshot.matches('active')).toBe(true);
      expect(snapshot.matches('inactive')).toBe(false);
      expect(snapshot.can({ type: 'TEST' })).toBe(true);
      expect(snapshot.hasTag('test')).toBe(false);
      expect(snapshot.toJSON()).toEqual({ value: 'active', context: initialContext });
    });

    it('should return correct snapshot when running', () => {
      actor.start();
      const snapshot = actor.getSnapshot();
      expect(snapshot).toMatchObject({
        value: 'active',
        context: initialContext,
        status: 'running',
        error: undefined,
      });
    });

    it('should return correct snapshot when stopped', () => {
      actor.start();
      actor.stop();
      const snapshot = actor.getSnapshot();
      expect(snapshot).toMatchObject({
        value: 'active',
        context: initialContext,
        status: 'stopped',
        error: undefined,
      });
    });

    it('should return updated context in snapshot', () => {
      const newContext = { count: 42 };
      actor.updateContext(newContext);
      const snapshot = actor.getSnapshot();
      expect(snapshot.context).toEqual(newContext);
    });
  });

  describe.skip('actor type identification', () => {
    it('should return "context" as actor type', () => {
      expect(actor.getType()).toBe('context');
    });

    it('should be identified by isContextActor type guard', () => {
      expect(isContextActor(actor)).toBe(true);
      expect(isContextActor({})).toBe(false);
      expect(isContextActor(null)).toBe(false);
      expect(isContextActor(undefined)).toBe(false);
    });
  });

  describe.skip('internal state', () => {
    it('should expose internal state for debugging', () => {
      const internalState = actor.getInternalState();
      expect(internalState).toEqual({
        status: 'idle',
        context: initialContext,
      });
    });

    it('should reflect status changes in internal state', () => {
      actor.start();
      expect(actor.getInternalState().status).toBe('running');

      actor.stop();
      expect(actor.getInternalState().status).toBe('stopped');
    });

    it('should reflect context changes in internal state', () => {
      const newContext = { count: 100 };
      actor.updateContext(newContext);
      expect(actor.getInternalState().context).toEqual(newContext);
    });
  });

  describe.skip('ActorInstance interface compliance', () => {
    it('should have all required ActorInstance properties', () => {
      expect(actor).toHaveProperty('id');
      expect(actor).toHaveProperty('status');
      expect(actor).toHaveProperty('send');
      expect(actor).toHaveProperty('start');
      expect(actor).toHaveProperty('stop');
      expect(actor).toHaveProperty('getSnapshot');
      expect(actor).toHaveProperty('getType');
    });

    it('should have correct method signatures', () => {
      expect(typeof actor.id).toBe('string');
      expect(typeof actor.status).toBe('string');
      expect(typeof actor.send).toBe('function');
      expect(typeof actor.start).toBe('function');
      expect(typeof actor.stop).toBe('function');
      expect(typeof actor.getSnapshot).toBe('function');
      expect(typeof actor.getType).toBe('function');
    });
  });

  describe.skip('edge cases', () => {
    it('should handle empty context', () => {
      const emptyActor = new ContextActor('empty', {});
      expect(emptyActor.getContext()).toEqual({});
      expect(emptyActor.getSnapshot().context).toEqual({});
    });

    it('should handle complex context types', () => {
      interface ComplexContext {
        user: { id: string; name: string };
        settings: { theme: string; notifications: boolean };
        data: number[];
      }

      const complexContext: ComplexContext = {
        user: { id: '123', name: 'Test User' },
        settings: { theme: 'dark', notifications: true },
        data: [1, 2, 3],
      };

      const complexActor = new ContextActor<ComplexContext>('complex', complexContext);
      expect(complexActor.getContext()).toEqual(complexContext);
    });
  });
});
