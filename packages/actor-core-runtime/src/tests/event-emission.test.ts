/**
 * @module actor-core/runtime/tests/event-emission.test
 * @description Tests for actor event emission functionality
 *
 * These tests verify that actors can emit typed events during message
 * processing and that subscribers receive these events correctly.
 *
 * @author Agent A (Tech Lead) - 2025-07-18
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ActorSystemConfig, createActorSystem } from '../actor-system-impl.js';
import type { ActorMessage } from '../actor-system.js';
import { createActor } from '../create-actor.js';
import type { MessageUnion } from '../messaging/typed-messages.js';

describe('Actor Event Emission', () => {
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

  describe('Basic Event Emission', () => {
    it('should emit events when actor returns state with events', async () => {
      interface CounterContext {
        count: number;
      }

      // Define message types using the MessageUnion helper
      type CounterMessage =
        | {
            type: 'INCREMENT';
            payload: { value: number };
          }
        | {
            type: 'DECREMENT';
            payload: { value: number };
          }
        | {
            type: 'RESET';
            payload: { value: number };
          }
        | {
            type: 'GET_COUNT';
            payload: undefined;
            correlationId: string;
          };

      type CounterEmitted =
        | {
            type: 'INCREMENT';
            payload: { value: number };
            timestamp: number;
            version: string;
          }
        | {
            type: 'DECREMENT';
            payload: { value: number };
            timestamp: number;
            version: string;
          }
        | {
            type: 'RESET';
            payload: { value: number };
            timestamp: number;
            version: string;
          }
        | {
            type: 'RESPONSE';
            payload: { value: number };
            correlationId: string;
            timestamp: number;
            version: string;
          };

      const receivedEvents: ActorMessage[] = [];

      // Create actor behavior that emits ActorMessage events
      const counterBehavior = createActor<CounterMessage, CounterContext, CounterEmitted>({
        context: { count: 0 },
        onMessage: async ({ message, context }) => {
          switch (message.type) {
            case 'INCREMENT':
              const newCount = context.count + 1;
              return {
                context: { count: newCount },
                emit: {
                  type: 'INCREMENT',
                  payload: { value: newCount },
                  timestamp: Date.now(),
                  version: '1.0.0',
                },
              };
            case 'DECREMENT':
              const decrementedCount = context.count - 1;
              return {
                context: { count: decrementedCount },
                emit: {
                  type: 'DECREMENT',
                  payload: { value: decrementedCount },
                  timestamp: Date.now(),
                  version: '1.0.0',
                },
              };
            case 'RESET':
              return {
                context: { count: 0 },
                emit: {
                  type: 'RESET',
                  payload: { value: 0 },
                  timestamp: Date.now(),
                  version: '1.0.0',
                },
              };
            case 'GET_COUNT':
              // Return current context with response for ask pattern
              return {
                context,
                emit: {
                  type: 'RESPONSE',
                  correlationId: message.correlationId,
                  payload: { value: context.count },
                  timestamp: Date.now(),
                  version: '1.0.0',
                },
              };
            default:
              return { context };
          }
        },
      });

      // Spawn actor
      const actor = await system.spawn(counterBehavior, { id: 'counter' });

      // Subscribe to all emitted events (excluding RESPONSE events)
      const subscription = actor.subscribe('EMIT:*').subscribe((event) => {
        if (event.type !== 'EMIT:RESPONSE') {
          receivedEvents.push(event);
        }
      });

      // Send messages - since we need to ensure they're processed,
      // we could either:
      // 1. Make the actor respond to these messages with ask()
      // 2. Send a final message with ask() to ensure all previous messages are processed

      // Send messages - the pure actor runtime processes them synchronously
      actor.send({
        type: 'INCREMENT',
      });

      actor.send({
        type: 'INCREMENT',
      });

      actor.send({
        type: 'DECREMENT',
      });

      // Use ask to ensure all messages have been processed
      const count = await actor.ask<{ value: number }>({
        type: 'GET_COUNT',
      });
      expect(count).toEqual({ value: 1 });

      // Verify events were received
      expect(receivedEvents).toHaveLength(3);
      expect(receivedEvents[0].type).toBe('EMIT:INCREMENT');
      expect(receivedEvents[0].payload).toEqual({ value: 1 });
      expect(receivedEvents[1].type).toBe('EMIT:INCREMENT');
      expect(receivedEvents[1].payload).toEqual({ value: 2 });
      expect(receivedEvents[2].type).toBe('EMIT:DECREMENT');
      expect(receivedEvents[2].payload).toEqual({ value: 1 });

      // Cleanup
      subscription.unsubscribe();
    });

    it('should support subscribing to specific event types', async () => {
      const infoEvents: ActorMessage[] = [];
      const errorEvents: ActorMessage[] = [];

      // Define message types using the MessageUnion helper
      type LoggerMessage = MessageUnion<{
        LOG: { level: string; message: string };
        GET_STATUS: undefined;
      }>;

      const loggerBehavior = createActor<LoggerMessage, {}>({
        context: {},
        onMessage: async ({ message, context }) => {
          if (message.type === 'LOG') {
            // TypeScript now knows message.payload has level and message
            const { level, message: text } = message.payload;

            return {
              context,
              emit: {
                type: level,
                payload: { message: text },
                timestamp: Date.now(),
                version: '1.0.0',
              },
            };
          }
          // Handle GET_STATUS message with response for ask pattern
          if (message.type === 'GET_STATUS') {
            return {
              context,
              emit: {
                type: 'RESPONSE',
                correlationId: message.correlationId,
                payload: 'OK',
                timestamp: Date.now(),
                version: '1.0.0',
              },
            };
          }
          return { context };
        },
      });

      const actor = await system.spawn(loggerBehavior, { id: 'logger' });

      // Subscribe to specific event types
      const infoSub = actor.subscribe('EMIT:INFO').subscribe((event) => {
        infoEvents.push(event);
      });

      const errorSub = actor.subscribe('EMIT:ERROR').subscribe((event) => {
        errorEvents.push(event);
      });

      // Send log messages
      actor.send({
        type: 'LOG',
        payload: { level: 'INFO', message: 'System started' },
      });

      actor.send({
        type: 'LOG',
        payload: { level: 'ERROR', message: 'Connection failed' },
      });

      actor.send({
        type: 'LOG',
        payload: { level: 'WARN', message: 'High memory usage' },
      });

      actor.send({
        type: 'LOG',
        payload: { level: 'INFO', message: 'Request processed' },
      });

      // Use ask to ensure all messages have been processed
      await actor.ask({
        type: 'GET_STATUS',
      });

      // Verify specific subscriptions
      expect(infoEvents).toHaveLength(2);
      expect(errorEvents).toHaveLength(1);

      expect(infoEvents[0].payload).toEqual({ message: 'System started' });
      expect(infoEvents[1].payload).toEqual({ message: 'Request processed' });
      expect(errorEvents[0].payload).toEqual({ message: 'Connection failed' });

      // Cleanup
      infoSub.unsubscribe();
      errorSub.unsubscribe();
    });
  });

  describe('Backward Compatibility', () => {
    it('should work with actors that return only state', async () => {
      interface SimpleContext {
        value: number;
      }

      const behavior = createActor<ActorMessage, SimpleContext>({
        context: { value: 0 },
        onMessage: async ({ message, context }) => {
          if (message.type === 'INCREMENT') {
            // Return only context (no events)
            return { context: { value: context.value + 1 } };
          }
          // Handle GET_VALUE message with response for ask pattern
          if (message.type === 'GET_VALUE') {
            // Return context with emit containing response
            return {
              context,
              emit: {
                type: 'RESPONSE',
                correlationId: message.correlationId,
                payload: context.value,
                timestamp: Date.now(),
                version: '1.0.0',
              },
            };
          }
          return { context };
        },
      });

      const actor = await system.spawn(behavior, { id: 'simple' });

      await actor.send({
        type: 'INCREMENT',
      });

      // Use ask pattern to verify the behavior worked correctly
      const value = await actor.ask(
        {
          type: 'GET_VALUE',
        },
        1000
      );

      expect(value).toBe(1);
    });
  });

  describe('Multiple Event Emission', () => {
    it('should emit multiple events from a single message', async () => {
      const events: ActorMessage[] = [];

      const batchBehavior = createActor<ActorMessage, { processed: number }>({
        context: { processed: 0 },
        onMessage: async ({ message, context }) => {
          if (message.type === 'PROCESS_BATCH') {
            const payload = message.payload as { items: string[] };
            const items = payload.items;
            const emittedEvents: ActorMessage[] = [];

            // Process each item and emit event
            for (const item of items) {
              emittedEvents.push({
                type: 'ITEM_PROCESSED',
                payload: { item, timestamp: Date.now() },
                timestamp: Date.now(),
                version: '1.0.0',
              });
            }

            // Emit batch complete event
            emittedEvents.push({
              type: 'BATCH_COMPLETE',
              payload: { totalItems: items.length, processed: context.processed + items.length },
              timestamp: Date.now(),
              version: '1.0.0',
            });

            return {
              context: { processed: context.processed + items.length },
              emit: emittedEvents,
            };
          }
          // Handle ask pattern for synchronization
          if (message.type === 'GET_STATS' && message.correlationId) {
            return {
              context,
              emit: {
                type: 'RESPONSE',
                payload: { processed: context.processed },
                correlationId: message.correlationId,
                timestamp: Date.now(),
                version: '1.0.0',
              },
            };
          }
          return { context };
        },
      });

      const actor = await system.spawn(batchBehavior, { id: 'batch-processor' });

      // Subscribe to all events (excluding RESPONSE events)
      const subscription = actor.subscribe('EMIT:*').subscribe((event) => {
        if (event.type !== 'EMIT:RESPONSE') {
          events.push(event);
        }
      });

      // Process a batch
      actor.send({
        type: 'PROCESS_BATCH',
        payload: { items: ['item1', 'item2', 'item3'] },
      });

      // Use ask to ensure batch processing is complete
      await actor.ask({
        type: 'GET_STATS',
      });

      // Verify all events were emitted
      expect(events).toHaveLength(4); // 3 items + 1 batch complete
      expect(events.filter((e) => e.type === 'EMIT:ITEM_PROCESSED')).toHaveLength(3);
      expect(events.filter((e) => e.type === 'EMIT:BATCH_COMPLETE')).toHaveLength(1);

      // Cleanup
      subscription.unsubscribe();
    });
  });

  describe('Event Message Format', () => {
    it('should properly format emitted events as ActorMessages', async () => {
      const events: ActorMessage[] = [];

      const behavior = createActor<ActorMessage, {}>({
        context: {},
        onMessage: async ({ message, context }) => {
          if (message.type === 'TRIGGER') {
            return {
              context,
              emit: [
                {
                  type: 'CUSTOM_EVENT',
                  payload: { custom: 'data' },
                  timestamp: Date.now(),
                  version: '1.0.0',
                },
              ],
            };
          }
          // Handle ask pattern
          if (message.type === 'CHECK' && message.correlationId) {
            return {
              context,
              emit: {
                type: 'RESPONSE',
                payload: { checked: true },
                correlationId: message.correlationId,
                timestamp: Date.now(),
                version: '1.0.0',
              },
            };
          }
          return { context };
        },
      });

      const actor = await system.spawn(behavior, { id: 'formatter' });

      const subscription = actor.subscribe('EMIT:*').subscribe((event) => {
        if (event.type !== 'EMIT:RESPONSE') {
          events.push(event);
        }
      });

      actor.send({
        type: 'TRIGGER',
      });

      // Use ask to ensure event processing is complete
      await actor.ask({
        type: 'CHECK',
      });

      // Verify event is properly formatted as ActorMessage
      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('payload');
      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('version');
      expect(event.type).toBe('EMIT:CUSTOM_EVENT');
      expect(event.payload).toEqual({ custom: 'data' });
      // The sender property is added by the actor system when emitting
      if (event.sender) {
        expect(event.sender.path).toContain('formatter');
      }

      subscription.unsubscribe();
    });

    it('should preserve ActorMessage format if event is already formatted', async () => {
      const events: ActorMessage[] = [];

      const behavior = createActor<ActorMessage, {}>({
        context: {},
        onMessage: async ({ message, context }) => {
          if (message.type === 'TRIGGER') {
            const emittedMessage: ActorMessage = {
              type: 'CUSTOM_EVENT',
              payload: { data: 'test' },
              timestamp: Date.now(),
              version: '2.0.0',
              correlationId: 'test-123',
            };

            return {
              context,
              emit: [emittedMessage],
            };
          }
          // Handle ask pattern
          if (message.type === 'VERIFY' && message.correlationId) {
            return {
              context,
              emit: {
                type: 'RESPONSE',
                payload: { verified: true },
                correlationId: message.correlationId,
                timestamp: Date.now(),
                version: '1.0.0',
              },
            };
          }
          return { context };
        },
      });

      const actor = await system.spawn(behavior, { id: 'message-emitter' });

      const subscription = actor.subscribe('EMIT:*').subscribe((event) => {
        if (event.type !== 'EMIT:RESPONSE') {
          events.push(event);
        }
      });

      actor.send({
        type: 'TRIGGER',
      });

      // Use ask to ensure event processing is complete
      await actor.ask({
        type: 'VERIFY',
      });

      // Verify ActorMessage format is preserved
      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event.type).toBe('EMIT:CUSTOM_EVENT');
      expect(event.payload).toEqual({ data: 'test' });
      expect(event.version).toBe('2.0.0');
      expect(event.correlationId).toBe('test-123');

      subscription.unsubscribe();
    });
  });
});
