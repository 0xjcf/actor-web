/**
 * @module actor-core/runtime/tests/async-messaging.test
 * @description Tests to verify true async messaging with mailboxes
 * @author Agent A - 2025-07-18
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ActorSystemConfig, createActorSystem } from '../actor-system-impl.js';
import type { ActorMessage } from '../actor-system.js';
import { createActor } from '../create-actor.js';

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

    // Create an actor that processes messages slowly
    const slowActor = createActor<ActorMessage, {}>({
      context: {},
      onMessage: async ({ message, context }) => {
        console.log(`Processing message: ${message.type} at ${Date.now()}`);
        if (message.type === 'SLOW') {
          // Simulate slow processing
          await new Promise((resolve) => setTimeout(resolve, 100));
          slowMessageProcessed = true;
          processedMessages.push('SLOW');
          console.log(`Finished SLOW at ${Date.now()}`);
        } else if (message.type === 'FAST') {
          processedMessages.push('FAST');
          console.log(`Finished FAST at ${Date.now()}`);
        }
        return { context };
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

    // Wait for all messages to be processed
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Messages should be processed in order
    expect(processedMessages).toEqual(['SLOW', 'FAST']);
    expect(slowMessageProcessed).toBe(true);
  });

  it('should not block send() when mailbox is full', async () => {
    // Create a slow actor that will cause mailbox to fill up
    const slowActor = createActor<ActorMessage, { processed: number }>({
      context: { processed: 0 },
      onMessage: async ({ message, context }) => {
        if (message.type === 'SLOW_PROCESS') {
          // Simulate slow processing to fill up mailbox
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { context: { processed: context.processed + 1 } };
        }
        if (message.type === 'CHECK') {
          return {
            context,
            emit: {
              type: 'RESPONSE',
              correlationId: message.correlationId,
              payload: context.processed,
              timestamp: Date.now(),
              version: '1.0.0',
            },
          };
        }
        return { context };
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

    const sendTime = Date.now() - startTime;

    // All sends should complete quickly (< 100ms) even though processing takes ~1s
    expect(sendTime).toBeLessThan(100);

    // Verify some messages were processed
    const processed = await actor.ask<number>({ type: 'CHECK' });
    expect(processed).toBeGreaterThan(0);
  });

  it('should maintain message ordering within an actor', async () => {
    const receivedMessages: number[] = [];

    const orderActor = createActor<ActorMessage, {}>({
      context: {},
      onMessage: async ({ message, context }) => {
        if (message.type === 'NUMBER') {
          receivedMessages.push(message.payload as number);
        }
        return { context };
      },
    });

    const actor = await system.spawn(orderActor, { id: 'order-actor' });

    // Send messages in order
    for (let i = 0; i < 10; i++) {
      await actor.send({ type: 'NUMBER', payload: i });
    }

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Messages should be received in the same order
    expect(receivedMessages).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('should allow multiple actors to process messages concurrently', async () => {
    const actor1Messages: string[] = [];
    const actor2Messages: string[] = [];

    const createSlowActor = (messages: string[]) =>
      createActor<ActorMessage, {}>({
        context: {},
        onMessage: async ({ message, context }) => {
          if (message.type === 'PROCESS') {
            await new Promise((resolve) => setTimeout(resolve, 50));
            messages.push(message.payload as string);
          }
          return { context };
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

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Both actors should have processed their messages
    expect(actor1Messages).toEqual(['A1', 'B1']);
    expect(actor2Messages).toEqual(['A2', 'B2']);
  });
});
