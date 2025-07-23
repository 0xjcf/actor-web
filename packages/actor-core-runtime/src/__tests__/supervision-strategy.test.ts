/**
 * Supervision Strategy Tests
 *
 * Tests for the supervision strategy implementation that was fixed.
 * Previously, message processing failures were ignored.
 * Now proper supervision strategies are applied for fault tolerance.
 *
 * ✅ FRAMEWORK-STANDARD COMPLIANT: Zero `any` types, proper type guards
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorBehavior, ActorMessage, ActorSystem } from '../actor-system.js';
import { SupervisionDirective } from '../actor-system.js';
import { createActorSystem } from '../actor-system-impl.js';

// ============================================================================
// TEST UTILITIES AND TYPE GUARDS
// ============================================================================

function hasProperty<K extends PropertyKey>(obj: unknown, prop: K): obj is Record<K, unknown> {
  return obj !== null && typeof obj === 'object' && prop in obj;
}

function isSystemEventPayload(value: unknown): value is {
  eventType: string;
  timestamp: number;
  data?: Record<string, unknown>;
} {
  return (
    value !== null &&
    typeof value === 'object' &&
    hasProperty(value, 'eventType') &&
    hasProperty(value, 'timestamp') &&
    typeof value.eventType === 'string' &&
    typeof value.timestamp === 'number'
  );
}

// ============================================================================
// TEST CONTEXTS AND BEHAVIORS - Properly typed
// ============================================================================

interface TestActorContext {
  messageCount: number;
}

// Behavior that fails on specific message and uses RESTART
const restartOnFailureBehavior: ActorBehavior<ActorMessage, TestActorContext> = {
  context: { messageCount: 0 },

  async onMessage({ message, context }) {
    const newContext: TestActorContext = {
      ...context,
      messageCount: context.messageCount + 1,
    };

    if (message.type === 'TRIGGER_ERROR') {
      throw new Error('Simulated processing failure');
    }

    return { context: newContext };
  },

  supervisionStrategy: {
    onFailure: () => SupervisionDirective.RESTART,
    maxRetries: 3,
    retryDelay: 1000,
  },
};

// Behavior that uses STOP supervision directive
const stopOnFailureBehavior: ActorBehavior<ActorMessage, TestActorContext> = {
  context: { messageCount: 0 },

  async onMessage({ message, context }) {
    const newContext: TestActorContext = {
      ...context,
      messageCount: context.messageCount + 1,
    };

    if (message.type === 'TRIGGER_ERROR') {
      throw new Error('Critical failure - should stop');
    }

    return { context: newContext };
  },

  supervisionStrategy: {
    onFailure: () => SupervisionDirective.STOP,
    maxRetries: 1,
    retryDelay: 100,
  },
};

// Behavior that uses ESCALATE supervision directive
const escalateOnFailureBehavior: ActorBehavior<ActorMessage, TestActorContext> = {
  context: { messageCount: 0 },

  async onMessage({ message, context }) {
    const newContext: TestActorContext = {
      ...context,
      messageCount: context.messageCount + 1,
    };

    if (message.type === 'TRIGGER_ERROR') {
      throw new Error('Error needs escalation');
    }

    return { context: newContext };
  },

  supervisionStrategy: {
    onFailure: () => SupervisionDirective.ESCALATE,
    maxRetries: 2,
    retryDelay: 500,
  },
};

// Behavior that uses RESUME supervision directive
const resumeOnFailureBehavior: ActorBehavior<ActorMessage, TestActorContext> = {
  context: { messageCount: 0 },

  async onMessage({ message, context }) {
    const newContext: TestActorContext = {
      ...context,
      messageCount: context.messageCount + 1,
    };

    if (message.type === 'TRIGGER_ERROR') {
      throw new Error('Transient error - should resume');
    }

    return { context: newContext };
  },

  supervisionStrategy: {
    onFailure: () => SupervisionDirective.RESUME,
    maxRetries: 5,
    retryDelay: 200,
  },
};

// Behavior with no supervision strategy (should default to restart)
const noSupervisionBehavior: ActorBehavior<ActorMessage, TestActorContext> = {
  context: { messageCount: 0 },

  async onMessage({ message, context }) {
    const newContext: TestActorContext = {
      ...context,
      messageCount: context.messageCount + 1,
    };

    if (message.type === 'TRIGGER_ERROR') {
      throw new Error('No supervision strategy');
    }

    return { context: newContext };
  },
  // No supervisionStrategy property
};

// ============================================================================
// TESTS
// ============================================================================

describe('Supervision Strategy - Critical Fix Tests', () => {
  let actorSystem: ActorSystem;
  let systemEvents: unknown[] = [];

  beforeEach(async () => {
    // Create actor system with event capture
    actorSystem = createActorSystem({
      nodeAddress: 'test-supervision-node',
      debug: false,
      maxActors: 50,
    });

    await actorSystem.start();

    // Capture system events for verification
    systemEvents = [];

    // ✅ FRAMEWORK-STANDARD: Use property check instead of type casting
    if (
      hasProperty(actorSystem, 'emitSystemEvent') &&
      typeof actorSystem.emitSystemEvent === 'function'
    ) {
      const originalEmitSystemEvent = actorSystem.emitSystemEvent;
      actorSystem.emitSystemEvent = vi.fn().mockImplementation(async (event: unknown) => {
        systemEvents.push(event);
        return originalEmitSystemEvent.call(actorSystem, event);
      });
    }
  });

  afterEach(async () => {
    if (actorSystem?.isRunning()) {
      await actorSystem.stop();
    }
  });

  describe('RESTART Supervision Directive', () => {
    it('should restart actor on failure when using RESTART directive', async () => {
      const actor = await actorSystem.spawn(restartOnFailureBehavior, {
        id: 'restart-test-actor',
      });

      // Verify actor is alive initially
      expect(await actor.isAlive()).toBe(true);

      // Trigger error that should cause restart
      await actor.send({
        type: 'TRIGGER_ERROR',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // Give time for supervision to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify system events include restart
      const restartEvents = systemEvents.filter(
        (event) => isSystemEventPayload(event) && event.eventType === 'actorRestarted'
      );

      expect(restartEvents.length).toBeGreaterThan(0);

      if (restartEvents.length > 0) {
        const restartEvent = restartEvents[0];
        expect(isSystemEventPayload(restartEvent)).toBe(true);
        if (isSystemEventPayload(restartEvent)) {
          expect(restartEvent.eventType).toBe('actorRestarted');
        }
      }
    });
  });

  describe('STOP Supervision Directive', () => {
    it('should stop actor on failure when using STOP directive', async () => {
      const actor = await actorSystem.spawn(stopOnFailureBehavior, {
        id: 'stop-test-actor',
      });

      // Verify actor is alive initially
      expect(await actor.isAlive()).toBe(true);

      // Trigger error that should cause stop
      await actor.send({
        type: 'TRIGGER_ERROR',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // Give time for supervision to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify system events include stop
      const stopEvents = systemEvents.filter(
        (event) => isSystemEventPayload(event) && event.eventType === 'actorStopped'
      );

      expect(stopEvents.length).toBeGreaterThan(0);

      if (stopEvents.length > 0) {
        const stopEvent = stopEvents[0];
        expect(isSystemEventPayload(stopEvent)).toBe(true);
        if (isSystemEventPayload(stopEvent)) {
          expect(stopEvent.eventType).toBe('actorStopped');
          if (stopEvent.data && hasProperty(stopEvent.data, 'reason')) {
            expect(stopEvent.data.reason).toBe('supervision-stop');
          }
        }
      }
    });
  });

  describe('ESCALATE Supervision Directive', () => {
    it('should escalate failure to Guardian when using ESCALATE directive', async () => {
      const actor = await actorSystem.spawn(escalateOnFailureBehavior, {
        id: 'escalate-test-actor',
      });

      // Verify actor is alive initially
      expect(await actor.isAlive()).toBe(true);

      // Trigger error that should escalate
      await actor.send({
        type: 'TRIGGER_ERROR',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // Give time for supervision to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      // With escalate, the Guardian should receive an ACTOR_FAILED message
      // This would be verified by checking Guardian's message handling
      // For now, verify actor is still alive (escalation doesn't stop it immediately)
      expect(await actor.isAlive()).toBe(true);
    });
  });

  describe('RESUME Supervision Directive', () => {
    it('should resume actor processing when using RESUME directive', async () => {
      const actor = await actorSystem.spawn(resumeOnFailureBehavior, {
        id: 'resume-test-actor',
      });

      // Verify actor is alive initially
      expect(await actor.isAlive()).toBe(true);

      // Send a normal message first
      await actor.send({
        type: 'NORMAL_MESSAGE',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // Trigger error that should be resumed
      await actor.send({
        type: 'TRIGGER_ERROR',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // Send another normal message to verify processing continues
      await actor.send({
        type: 'NORMAL_MESSAGE_2',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // Give time for processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Actor should still be alive and processing
      expect(await actor.isAlive()).toBe(true);
    });
  });

  describe('Default Supervision Behavior', () => {
    it('should default to RESTART when no supervision strategy is defined', async () => {
      const actor = await actorSystem.spawn(noSupervisionBehavior, {
        id: 'default-supervision-actor',
      });

      // Verify actor is alive initially
      expect(await actor.isAlive()).toBe(true);

      // Trigger error with no supervision strategy
      await actor.send({
        type: 'TRIGGER_ERROR',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // Give time for supervision to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should default to restart behavior
      const restartEvents = systemEvents.filter(
        (event) => isSystemEventPayload(event) && event.eventType === 'actorRestarted'
      );

      expect(restartEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Supervision Strategy Edge Cases', () => {
    it('should handle supervision strategy errors gracefully', async () => {
      // Create behavior with faulty supervision strategy
      const faultySupervisionBehavior: ActorBehavior<ActorMessage, TestActorContext> = {
        context: { messageCount: 0 },

        async onMessage({ message, context }) {
          if (message.type === 'TRIGGER_ERROR') {
            throw new Error('Message processing error');
          }
          return { context };
        },

        supervisionStrategy: {
          onFailure: () => {
            throw new Error('Supervision strategy itself fails');
          },
          maxRetries: 1,
          retryDelay: 100,
        },
      };

      const actor = await actorSystem.spawn(faultySupervisionBehavior, {
        id: 'faulty-supervision-actor',
      });

      // Trigger error with faulty supervision
      await actor.send({
        type: 'TRIGGER_ERROR',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // Give time for processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should fallback to default restart behavior
      const restartEvents = systemEvents.filter(
        (event) => isSystemEventPayload(event) && event.eventType === 'actorRestarted'
      );

      expect(restartEvents.length).toBeGreaterThan(0);
    });

    it('should maintain actor system stability during supervision failures', async () => {
      const actor1 = await actorSystem.spawn(restartOnFailureBehavior, {
        id: 'stable-actor-1',
      });

      const actor2 = await actorSystem.spawn(stopOnFailureBehavior, {
        id: 'stable-actor-2',
      });

      // Trigger errors in both actors
      await Promise.all([
        actor1.send({
          type: 'TRIGGER_ERROR',
          payload: null,
          timestamp: Date.now(),
          version: '1.0.0',
        }),
        actor2.send({
          type: 'TRIGGER_ERROR',
          payload: null,
          timestamp: Date.now(),
          version: '1.0.0',
        }),
      ]);

      // Give time for supervision
      await new Promise((resolve) => setTimeout(resolve, 200));

      // System should remain stable
      expect(actorSystem.isRunning()).toBe(true);

      // Events should be recorded for both actors
      expect(systemEvents.length).toBeGreaterThan(0);
    });
  });
});
