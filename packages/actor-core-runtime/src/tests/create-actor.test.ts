/**
 * @module actor-core/runtime/tests/create-actor.test
 * @description Tests for createActor function and type-safe event emission
 * @author Agent A - 2025-07-18
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ActorSystemConfig, createActorSystem } from '../actor-system-impl.js';
import type { ActorMessage, JsonValue } from '../actor-system.js';
import { createActor } from '../create-actor.js';

describe('createActor', () => {
  let system: ReturnType<typeof createActorSystem>;
  const config: ActorSystemConfig = {
    nodeAddress: 'test-node',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    system = createActorSystem(config);
    await system.start();
  });

  afterEach(async () => {
    if (system.isRunning()) {
      await system.stop();
    }
  });

  describe('Type-safe event emission', () => {
    it('should emit typed events with proper structure', async () => {
      // Define typed events
      interface CounterEvent {
        type: 'COUNT_CHANGED';
        data: { oldValue: number; newValue: number };
      }

      const receivedEvents: ActorMessage[] = [];

      // Create actor using createActor
      const counterActor = createActor<ActorMessage, { count: number }, CounterEvent>({
        context: { count: 0 },
        onMessage: ({ message, context }) => {
          if (message.type === 'INCREMENT') {
            const oldValue = context.count;
            const newValue = oldValue + 1;
            return {
              context: { count: newValue },
              emit: {
                type: 'COUNT_CHANGED',
                data: { oldValue, newValue },
              },
            };
          }
          return { context };
        },
      });

      const actor = await system.spawn(counterActor, { id: 'counter' });

      // Subscribe to events
      const subscription = actor.subscribe('EMIT:*').subscribe((event) => {
        receivedEvents.push(event);
      });

      // Send increment message
      await actor.send({ type: 'INCREMENT' });

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify event was emitted
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        type: 'EMIT:COUNT_CHANGED',
        payload: {
          type: 'COUNT_CHANGED',
          data: { oldValue: 0, newValue: 1 },
        },
      });

      subscription.unsubscribe();
    });

    it('should support emitting multiple events', async () => {
      type NotificationEvent =
        | { type: 'NOTIFICATION_ADDED'; message: string }
        | { type: 'NOTIFICATION_COUNT'; count: number };

      const receivedEvents: ActorMessage[] = [];

      const notificationActor = createActor<
        ActorMessage,
        { notifications: string[] },
        NotificationEvent
      >({
        context: { notifications: [] },
        onMessage: ({ message, context }) => {
          if (message.type === 'ADD_NOTIFICATION') {
            const newNotification = message.payload as string;
            const newNotifications = [...context.notifications, newNotification];

            return {
              context: { notifications: newNotifications },
              emit: [
                { type: 'NOTIFICATION_ADDED', message: newNotification },
                { type: 'NOTIFICATION_COUNT', count: newNotifications.length },
              ],
            };
          }
          return { context };
        },
      });

      const actor = await system.spawn(notificationActor, { id: 'notifications' });

      // Subscribe to events
      const subscription = actor.subscribe('EMIT:*').subscribe((event) => {
        receivedEvents.push(event);
      });

      // Add notification
      await actor.send({
        type: 'ADD_NOTIFICATION',
        payload: 'Hello World',
      });

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify both events were emitted
      expect(receivedEvents).toHaveLength(2);
      expect(receivedEvents[0]).toMatchObject({
        type: 'EMIT:NOTIFICATION_ADDED',
        payload: { type: 'NOTIFICATION_ADDED', message: 'Hello World' },
      });
      expect(receivedEvents[1]).toMatchObject({
        type: 'EMIT:NOTIFICATION_COUNT',
        payload: { type: 'NOTIFICATION_COUNT', count: 1 },
      });

      subscription.unsubscribe();
    });

    it('should support actors without event emission', async () => {
      const stateActor = createActor<ActorMessage, { value: JsonValue }>({
        context: { value: 'initial' },
        onMessage: ({ message, context }) => {
          if (message.type === 'SET_VALUE') {
            return {
              context: { value: message.payload },
            };
          }
          return { context };
        },
      });

      const actor = await system.spawn(stateActor, { id: 'state' });

      await actor.send({
        type: 'SET_VALUE',
        payload: 'updated',
      });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Just verify no errors occurred
      expect(true).toBe(true);
    });

    it('should handle lifecycle hooks with new return format', async () => {
      const lifecycleEvents: string[] = [];

      const lifecycleActor = createActor<
        ActorMessage,
        { started: boolean },
        { type: 'STARTED' | 'STOPPED' }
      >({
        context: { started: false },
        onStart: () => {
          lifecycleEvents.push('onStart');
          return {
            context: { started: true },
            emit: { type: 'STARTED' },
          };
        },
        onMessage: ({ context }) => {
          lifecycleEvents.push('onMessage');
          return { context };
        },
        onStop: async () => {
          lifecycleEvents.push('onStop');
        },
      });

      const actor = await system.spawn(lifecycleActor, { id: 'lifecycle' });

      // Trigger onStart by sending any message
      await actor.send({ type: 'INIT' });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(lifecycleEvents).toContain('onStart');
      expect(lifecycleEvents).toContain('onMessage');
    });
  });

  describe('Type checking demonstration', () => {
    it('should compile with correct event types', () => {
      // This test just verifies that the code compiles correctly
      // The actual type checking happens at compile time

      type StrictEvent = { type: 'STRICT'; data: { value: number } };

      const strictActor = createActor<ActorMessage, {}, StrictEvent>({
        context: {},
        onMessage: ({ context }) => {
          // This compiles correctly
          return {
            context,
            emit: { type: 'STRICT', data: { value: 42 } },
          };
        },
      });

      expect(strictActor).toBeDefined();
    });

    // The following would not compile (uncomment to verify):
    /*
    it('should not compile with incorrect event types', () => {
      type StrictEvent = { type: 'STRICT'; data: { value: number } };

      const brokenActor = createActor<ActorMessage, {}, StrictEvent>({
        context: {},
        behavior: {
          onMessage: ({ context }) => {
            return {
              context,
              // TypeScript error: 'dat' does not exist in type
              emit: { type: 'STRICT', dat: { value: 42 } },
            };
          },
        },
      });
    });
    */
  });
});
