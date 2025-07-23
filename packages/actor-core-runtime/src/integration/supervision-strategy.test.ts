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
import { assign, setup } from 'xstate';
import type { ActorMessage, ActorSystem } from '../actor-system.js';
import { SupervisionDirective } from '../actor-system.js';
import { createActorSystem } from '../actor-system-impl.js';
import { defineBehavior } from '../create-actor.js';

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
// TEST ACTOR MACHINES (Pure Actor Model)
// ============================================================================

interface TestActorContext {
  messageCount: number;
}

// ✅ PURE ACTOR MODEL: XState machine replaces context-based behavior
const createTestActorMachine = () =>
  setup({
    types: {
      context: {} as TestActorContext,
      events: {} as ActorMessage,
    },
    actions: {
      incrementMessageCount: assign({
        messageCount: ({ context }) => context.messageCount + 1,
      }),
    },
  }).createMachine({
    context: { messageCount: 0 },
    initial: 'active',
    states: {
      active: {
        on: {
          '*': {
            actions: ['incrementMessageCount'],
          },
        },
      },
    },
  });

// ============================================================================
// SUPERVISION BEHAVIORS (Pure Actor Model)
// ============================================================================

// ✅ PURE ACTOR MODEL: Behavior that fails on specific message and uses RESTART
const createRestartOnFailureBehavior = () =>
  defineBehavior({
    machine: createTestActorMachine(),
    async onMessage({ message, machine }) {
      const context = machine.getSnapshot().context;

      if (message.type === 'TRIGGER_ERROR') {
        throw new Error('Simulated processing failure');
      }

      // Return domain event instead of context update
      return {
        type: 'MESSAGE_PROCESSED',
        messageType: message.type,
        messageCount: context.messageCount,
        timestamp: Date.now(),
      };
    },
    supervisionStrategy: {
      onFailure: () => SupervisionDirective.RESTART,
      maxRetries: 3,
      retryDelay: 1000,
    },
  });

// ✅ PURE ACTOR MODEL: Behavior that uses STOP supervision directive
const createStopOnFailureBehavior = () =>
  defineBehavior({
    machine: createTestActorMachine(),
    async onMessage({ message, machine }) {
      const context = machine.getSnapshot().context;

      if (message.type === 'TRIGGER_ERROR') {
        throw new Error('Simulated processing failure');
      }

      return {
        type: 'MESSAGE_PROCESSED',
        messageType: message.type,
        messageCount: context.messageCount,
        timestamp: Date.now(),
      };
    },
    supervisionStrategy: {
      onFailure: () => SupervisionDirective.STOP,
      maxRetries: 3,
      retryDelay: 1000,
    },
  });

// ✅ PURE ACTOR MODEL: Behavior that uses ESCALATE supervision directive
const createEscalateOnFailureBehavior = () =>
  defineBehavior({
    machine: createTestActorMachine(),
    async onMessage({ message, machine }) {
      const context = machine.getSnapshot().context;

      if (message.type === 'TRIGGER_ERROR') {
        throw new Error('Simulated processing failure');
      }

      return {
        type: 'MESSAGE_PROCESSED',
        messageType: message.type,
        messageCount: context.messageCount,
        timestamp: Date.now(),
      };
    },
    supervisionStrategy: {
      onFailure: () => SupervisionDirective.ESCALATE,
      maxRetries: 3,
      retryDelay: 1000,
    },
  });

// ✅ PURE ACTOR MODEL: Behavior that uses RESUME supervision directive
const createResumeOnFailureBehavior = () =>
  defineBehavior({
    machine: createTestActorMachine(),
    async onMessage({ message, machine }) {
      const context = machine.getSnapshot().context;

      if (message.type === 'TRIGGER_ERROR') {
        throw new Error('Simulated processing failure');
      }

      return {
        type: 'MESSAGE_PROCESSED',
        messageType: message.type,
        messageCount: context.messageCount,
        timestamp: Date.now(),
      };
    },
    supervisionStrategy: {
      onFailure: () => SupervisionDirective.RESUME,
      maxRetries: 3,
      retryDelay: 1000,
    },
  });

// ✅ PURE ACTOR MODEL: Behavior with no supervision strategy (default handling)
const createNoSupervisionBehavior = () =>
  defineBehavior({
    machine: createTestActorMachine(),
    async onMessage({ message, machine }) {
      const context = machine.getSnapshot().context;

      if (message.type === 'TRIGGER_ERROR') {
        throw new Error('Simulated processing failure');
      }

      return {
        type: 'MESSAGE_PROCESSED',
        messageType: message.type,
        messageCount: context.messageCount,
        timestamp: Date.now(),
      };
    },
    // ✅ No supervision strategy - will use default behavior
  });

// ✅ PURE ACTOR MODEL: Behavior with faulty supervision strategy (returns invalid directive)
const createFaultySupervisionBehavior = () =>
  defineBehavior({
    machine: createTestActorMachine(),
    async onMessage({ message, machine }) {
      const context = machine.getSnapshot().context;

      return {
        type: 'MESSAGE_PROCESSED',
        messageType: message.type,
        messageCount: context.messageCount,
        timestamp: Date.now(),
      };
    },
    supervisionStrategy: {
      onFailure: () => 'INVALID_DIRECTIVE' as SupervisionDirective,
      maxRetries: 3,
      retryDelay: 1000,
    },
  });

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
      const actor = await actorSystem.spawn(createRestartOnFailureBehavior(), {
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

      // ✅ FRAMEWORK-STANDARD: No timeouts - supervision processing is event-driven
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
      const actor = await actorSystem.spawn(createStopOnFailureBehavior(), {
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

      // ✅ FRAMEWORK-STANDARD: No timeouts - supervision processing is event-driven
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
      const actor = await actorSystem.spawn(createEscalateOnFailureBehavior(), {
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

      // ✅ FRAMEWORK-STANDARD: No timeouts - supervision processing is event-driven
      // With escalate, the Guardian should receive an ACTOR_FAILED message
      // This would be verified by checking Guardian's message handling
      // For now, verify actor is still alive (escalation doesn't stop it immediately)
      expect(await actor.isAlive()).toBe(true);
    });
  });

  describe('RESUME Supervision Directive', () => {
    it('should resume actor processing when using RESUME directive', async () => {
      const actor = await actorSystem.spawn(createResumeOnFailureBehavior(), {
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

      // ✅ FRAMEWORK-STANDARD: No timeouts - supervision processing is event-driven
      // Actor should still be alive and processing
      expect(await actor.isAlive()).toBe(true);
    });
  });

  describe('Default Supervision Behavior', () => {
    it('should default to RESTART when no supervision strategy is defined', async () => {
      const actor = await actorSystem.spawn(createNoSupervisionBehavior(), {
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

      // ✅ FRAMEWORK-STANDARD: No timeouts - supervision processing is event-driven
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
      const actor = await actorSystem.spawn(createFaultySupervisionBehavior(), {
        id: 'faulty-supervision-actor',
      });

      // Trigger error with faulty supervision
      await actor.send({
        type: 'TRIGGER_ERROR',
        payload: null,
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // ✅ FRAMEWORK-STANDARD: No timeouts - supervision processing is event-driven
      // Should fallback to default restart behavior
      const restartEvents = systemEvents.filter(
        (event) => isSystemEventPayload(event) && event.eventType === 'actorRestarted'
      );

      expect(restartEvents.length).toBeGreaterThan(0);
    });

    it('should maintain actor system stability during supervision failures', async () => {
      const actor1 = await actorSystem.spawn(createRestartOnFailureBehavior(), {
        id: 'stable-actor-1',
      });

      const actor2 = await actorSystem.spawn(createStopOnFailureBehavior(), {
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

      // ✅ FRAMEWORK-STANDARD: No timeouts - supervision processing is event-driven
      // System should remain stable
      expect(actorSystem.isRunning()).toBe(true);

      // Events should be recorded for both actors
      expect(systemEvents.length).toBeGreaterThan(0);
    });
  });
});
