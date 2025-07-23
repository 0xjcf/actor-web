/**
 * @module actor-core/runtime/tests/async-messaging.test
 * @description Tests to verify true async messaging with mailboxes
 * @author Agent A - 2025-07-18
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorMessage } from '../actor-system.js';
import { type ActorSystemConfig, createActorSystem } from '../actor-system-impl.js';
import { defineBehavior } from '../create-actor.js';
import { createActorDelay } from '../pure-xstate-utilities.js';

describe('Async Messaging with Mailboxes', () => {
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

  it('should process messages asynchronously without blocking send()', async () => {
    const processedMessages: string[] = [];
    let slowMessageProcessed = false;

    // ✅ PURE ACTOR MODEL: Use machine-based state management
    const slowActor = defineBehavior<ActorMessage>({
      onMessage: async ({ message }) => {
        console.log(`Processing message: ${message.type} at ${Date.now()}`);
        if (message.type === 'SLOW') {
          // ✅ PURE ACTOR MODEL: Use XState delay instead of setTimeout
          await createActorDelay(100);
          slowMessageProcessed = true;
          processedMessages.push('SLOW');
          console.log(`Finished SLOW at ${Date.now()}`);
        } else if (message.type === 'FAST') {
          processedMessages.push('FAST');
          console.log(`Finished FAST at ${Date.now()}`);
        }
        // ✅ PURE ACTOR MODEL: Return MessagePlan (void for no emission)
        return undefined;
      },
    });

    const actor = await system.spawn(slowActor, { id: 'slow-actor' });

    // Send slow message first
    const sendStart = Date.now();
    await actor.send({ type: 'SLOW' });
    const sendEnd = Date.now();

    // send() should return immediately (less than 50ms)
    expect(sendEnd - sendStart).toBeLessThan(50);

    // Send fast message
    await actor.send({ type: 'FAST' });

    // At this point, slow message should still be processing
    expect(slowMessageProcessed).toBe(false);
    expect(processedMessages).toEqual([]);

    // ✅ PURE ACTOR MODEL: Use XState delay instead of setTimeout
    await createActorDelay(150);

    // Messages should be processed in order
    expect(processedMessages).toEqual(['SLOW', 'FAST']);
    expect(slowMessageProcessed).toBe(true);
  });

  it('should not block send() when mailbox is full', async () => {
    let processedCount = 0;

    // Create a slow actor that will cause mailbox to fill up
    const slowActor = defineBehavior<ActorMessage>({
      onMessage: async ({ message }) => {
        if (message.type === 'SLOW_PROCESS') {
          // ✅ PURE ACTOR MODEL: Use XState delay instead of setTimeout
          await createActorDelay(10);
          processedCount++;
          return undefined;
        }
        // ✅ CORRECT: Check for correlationId for ask pattern
        if (message.type === 'CHECK' && message.correlationId) {
          // ✅ PURE ACTOR MODEL: Return MessagePlan for response
          return {
            type: 'RESPONSE',
            correlationId: message.correlationId,
            payload: processedCount,
            timestamp: Date.now(),
            version: '1.0.0',
          };
        }
        return undefined;
      },
    });

    const actor = await system.spawn(slowActor, { id: 'slow-processor' });

    // Measure time to send many messages
    const startTime = Date.now();
    const sendPromises: Promise<void>[] = [];

    // Send 100 messages that will take ~1 second to process
    for (let i = 0; i < 100; i++) {
      sendPromises.push(actor.send({ type: 'SLOW_PROCESS' }));
    }

    await Promise.all(sendPromises);
    const sendTime = Date.now() - startTime;

    // All sends should complete quickly (< 100ms) even though processing takes ~1s
    expect(sendTime).toBeLessThan(100);

    // ✅ PURE ACTOR MODEL: Use ask pattern for synchronization instead of arbitrary delay
    const processed = await actor.ask<number>({ type: 'CHECK' });
    expect(processed).toBeGreaterThan(0);
  });

  it('should maintain message ordering within an actor', async () => {
    const receivedMessages: number[] = [];

    const orderActor = defineBehavior<ActorMessage>({
      onMessage: async ({ message }) => {
        if (message.type === 'NUMBER') {
          receivedMessages.push(message.payload as number);
        }
        // ✅ CORRECT: Check for correlationId for ask pattern
        if (message.type === 'CHECK_ORDER' && message.correlationId) {
          // ✅ PURE ACTOR MODEL: Return MessagePlan for response
          return {
            type: 'RESPONSE',
            correlationId: message.correlationId,
            payload: receivedMessages,
            timestamp: Date.now(),
            version: '1.0.0',
          };
        }
        return undefined;
      },
    });

    const actor = await system.spawn(orderActor, { id: 'order-actor' });

    // Send messages in order
    for (let i = 0; i < 10; i++) {
      await actor.send({ type: 'NUMBER', payload: i });
    }

    // ✅ PURE ACTOR MODEL: Use ask pattern for synchronization instead of setTimeout
    const finalOrder = await actor.ask<number[]>({ type: 'CHECK_ORDER' });

    // Messages should be received in the same order
    expect(finalOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('should allow multiple actors to process messages concurrently', async () => {
    const actor1Messages: string[] = [];
    const actor2Messages: string[] = [];

    const createSlowActor = (messages: string[]) =>
      defineBehavior<ActorMessage>({
        onMessage: async ({ message }) => {
          if (message.type === 'PROCESS') {
            // ✅ PURE ACTOR MODEL: Use XState delay instead of setTimeout
            await createActorDelay(50);
            messages.push(message.payload as string);
          }
          // ✅ CORRECT: Check for correlationId for ask pattern
          if (message.type === 'CHECK_MESSAGES' && message.correlationId) {
            // ✅ PURE ACTOR MODEL: Return MessagePlan for response
            return {
              type: 'RESPONSE',
              correlationId: message.correlationId,
              payload: messages,
              timestamp: Date.now(),
              version: '1.0.0',
            };
          }
          return undefined;
        },
      });

    const actor1 = await system.spawn(createSlowActor(actor1Messages), { id: 'actor1' });
    const actor2 = await system.spawn(createSlowActor(actor2Messages), { id: 'actor2' });

    // Send messages to both actors
    const start = Date.now();
    await Promise.all([
      actor1.send({ type: 'PROCESS', payload: 'A1' }),
      actor2.send({ type: 'PROCESS', payload: 'A2' }),
      actor1.send({ type: 'PROCESS', payload: 'B1' }),
      actor2.send({ type: 'PROCESS', payload: 'B2' }),
    ]);
    const sendTime = Date.now() - start;

    // All sends should complete quickly
    expect(sendTime).toBeLessThan(50);

    // ✅ PURE ACTOR MODEL: Use ask pattern for synchronization instead of setTimeout
    const [actor1Results, actor2Results] = await Promise.all([
      actor1.ask<string[]>({ type: 'CHECK_MESSAGES' }),
      actor2.ask<string[]>({ type: 'CHECK_MESSAGES' }),
    ]);

    // Both actors should have processed their messages
    expect(actor1Results).toEqual(['A1', 'B1']);
    expect(actor2Results).toEqual(['A2', 'B2']);
  });
});
