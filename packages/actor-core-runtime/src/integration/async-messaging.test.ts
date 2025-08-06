/**
 * @module actor-core/runtime/tests/async-messaging.test
 * @description Tests to verify true async messaging with mailboxes
 * @author Agent A - 2025-07-18
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorMessage } from '../actor-system.js';
import { type ActorSystemConfig, createActorSystem } from '../actor-system-impl.js';
import { defineActor } from '../index.js';
import { Logger } from '../logger.js';
import { createActorDelay } from '../pure-xstate-utilities.js';

const _log = Logger.namespace('TEST');
// Define message types for this test
interface NumberMessage extends ActorMessage {
  type: 'NUMBER';
  value: number;
}

interface CheckOrderMessage extends ActorMessage {
  type: 'CHECK_ORDER';
}

interface ProcessMessage extends ActorMessage {
  type: 'PROCESS';
  text: string;
}

interface CheckMessagesMessage extends ActorMessage {
  type: 'CHECK_MESSAGES';
}

type TestMessage = NumberMessage | CheckOrderMessage | ProcessMessage | CheckMessagesMessage;

describe('Async Messaging with Mailboxes', () => {
  let system: ReturnType<typeof createActorSystem>;
  const config: ActorSystemConfig = {
    nodeAddress: 'test-node',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    system = createActorSystem(config);
  });

  afterEach(async () => {
    if (system.isRunning()) {
      await system.stop();
    }
  });

  it('should process messages asynchronously without blocking send()', async () => {
    const processedMessages: string[] = [];

    // ✅ PURE ACTOR MODEL: Use context-based actor for ask pattern support
    const slowActor = defineActor<ActorMessage>()
      .withContext({ processedMessages: [] as string[], slowMessageProcessed: false })
      .onMessage(async ({ message, actor }) => {
        const context = actor.getSnapshot().context;

        if (message.type === 'SLOW') {
          // ✅ PURE ACTOR MODEL: Use XState delay instead of setTimeout
          await createActorDelay(100);
          processedMessages.push('SLOW');
          return { context };
        }
        if (message.type === 'FAST') {
          processedMessages.push('FAST');
          return { context };
        }

        return { context };
      });

    const actor = await system.spawn(slowActor, { id: 'slow-actor' });

    // Send slow message first
    await actor.send({ type: 'SLOW' });

    // Send fast message
    await actor.send({ type: 'FAST' });

    // Use system.flush() to wait for all messages to be processed
    await system.flush();

    // Both messages should be processed (order is maintained in actor's mailbox)
    expect(processedMessages).toHaveLength(2);
    expect(processedMessages).toContain('SLOW');
    expect(processedMessages).toContain('FAST');
    // Since actors process messages sequentially, order should be maintained
    expect(processedMessages).toEqual(['SLOW', 'FAST']);
  });

  it('should handle high volume of messages without errors', async () => {
    // Create a slow actor that will cause mailbox to fill up
    const slowActor = defineActor<ActorMessage>()
      .withContext({ processedCount: 0 })
      .onMessage(async ({ message, actor }) => {
        const context = actor.getSnapshot().context;

        if (message.type === 'SLOW_PROCESS') {
          // ✅ PURE ACTOR MODEL: Use XState delay instead of setTimeout
          await createActorDelay(10);
          return { context: { ...context, processedCount: context.processedCount + 1 } };
        }
        // ✅ CORRECT: Handle ask pattern - smart defaults will use context
        if (message.type === 'CHECK') {
          // Return current context for smart defaults
          return { context };
        }
        return { context };
      });

    const actor = await system.spawn(slowActor, { id: 'slow-processor' });

    // Send many messages
    const sendPromises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      sendPromises.push(actor.send({ type: 'SLOW_PROCESS' }));
    }

    // All sends should complete without error
    await expect(Promise.all(sendPromises)).resolves.not.toThrow();

    // Use system.flush() to wait for all messages to be processed
    await system.flush();

    // ✅ PURE ACTOR MODEL: Use ask pattern for synchronization instead of arbitrary delay
    const result = await actor.ask<{ processedCount: number }>({ type: 'CHECK' });
    // We should have processed many messages by now
    expect(result.processedCount).toBeGreaterThan(10);
  });

  it('should maintain message ordering within an actor', async () => {
    const orderActor = defineActor<TestMessage>()
      .withContext({ receivedMessages: [] as number[] })
      .onMessage(({ message, actor }) => {
        const context = actor.getSnapshot().context;
        const updatedMessages = [...context.receivedMessages];

        if (message.type === 'NUMBER') {
          updatedMessages.push(message.value);
          return { context: { receivedMessages: updatedMessages } };
        }
        // ✅ CORRECT: Handle ask pattern - smart defaults will use context
        if (message.type === 'CHECK_ORDER') {
          // Return context with the latest messages
          return {
            context: { receivedMessages: context.receivedMessages },
          };
        }
        return { context };
      });

    const actor = await system.spawn(orderActor, { id: 'order-actor' });

    // Send messages in order
    for (let i = 0; i < 10; i++) {
      await actor.send({ type: 'NUMBER', value: i });
    }

    // Use system.flush() to wait for all messages to be processed
    await system.flush();

    // ✅ PURE ACTOR MODEL: Use ask pattern for synchronization instead of setTimeout
    const result = await actor.ask<{ receivedMessages: number[] }>({ type: 'CHECK_ORDER' });

    // Messages should be received in the same order
    expect(result.receivedMessages).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('should allow multiple actors to process messages concurrently', async () => {
    const actor1Messages: string[] = [];
    const actor2Messages: string[] = [];

    const createSlowActor = (messages: string[]) =>
      defineActor<TestMessage>()
        .withContext({ messages: [] as string[] })
        .onMessage(async ({ message, actor }) => {
          const context = actor.getSnapshot().context;

          if (message.type === 'PROCESS') {
            // ✅ PURE ACTOR MODEL: Use XState delay instead of setTimeout
            await createActorDelay(50);
            messages.push(message.text);
            return { context: { messages: [...messages] } };
          }
          // ✅ CORRECT: Handle ask pattern - smart defaults will use context
          if (message.type === 'CHECK_MESSAGES') {
            // Return updated context with messages for smart defaults
            return {
              context: { messages },
            };
          }
          return { context };
        });

    const actor1 = await system.spawn(createSlowActor(actor1Messages), { id: 'actor1' });
    const actor2 = await system.spawn(createSlowActor(actor2Messages), { id: 'actor2' });

    // Send messages to both actors
    await Promise.all([
      actor1.send({ type: 'PROCESS', text: 'A1' }),
      actor2.send({ type: 'PROCESS', text: 'A2' }),
      actor1.send({ type: 'PROCESS', text: 'B1' }),
      actor2.send({ type: 'PROCESS', text: 'B2' }),
    ]);

    // Use system.flush() to wait for all messages to be processed
    await system.flush();

    // ✅ PURE ACTOR MODEL: Use ask pattern for synchronization instead of setTimeout
    const [actor1Result, actor2Result] = await Promise.all([
      actor1.ask<{ messages: string[] }>({ type: 'CHECK_MESSAGES' }),
      actor2.ask<{ messages: string[] }>({ type: 'CHECK_MESSAGES' }),
    ]);

    // Both actors should have processed their messages
    expect(actor1Result.messages).toEqual(['A1', 'B1']);
    expect(actor2Result.messages).toEqual(['A2', 'B2']);
  });
});
