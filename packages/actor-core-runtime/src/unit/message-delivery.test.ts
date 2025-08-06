/**
 * @module actor-core/runtime/unit/message-delivery.test
 * @description Unit tests for Layer 5: Message delivery to mailboxes
 */

import { describe, expect, it } from 'vitest';
import type { ActorMessage } from '../actor-system.js';
import { ActorSystemImpl } from '../actor-system-impl.js';
import { withTimerTesting } from '../testing/timer-test-utils.js';
import { defineActor } from '../unified-actor-builder.js';

describe('Layer 5: Message Delivery to Mailboxes', () => {
  it('should provide self reference in dependencies', async () => {
    const system = new ActorSystemImpl({ nodeAddress: 'test-node' });
    await system.start();

    let capturedSelf: unknown = null;

    const testBehavior = defineActor<ActorMessage>()
      .onMessage(({ dependencies }) => {
        capturedSelf = dependencies.self;
      })
      .build();

    const actor = await system.spawn(testBehavior, { id: 'test-self' });
    await actor.send({ type: 'TEST' });
    await system.flush();

    // Verify self was provided and has expected methods
    expect(capturedSelf).toBeDefined();
    expect(capturedSelf).toHaveProperty('send');
    expect(capturedSelf).toHaveProperty('ask');
    expect(capturedSelf).toHaveProperty('address');

    await system.stop();
  });

  it('should deliver messages to actor mailboxes via enqueueMessage', async () => {
    const system = new ActorSystemImpl({ nodeAddress: 'test-node' });
    // Remove enableTestMode() to use natural async message processing
    await system.start();

    // Track messages received by the actor
    const receivedMessages: ActorMessage[] = [];

    const receiverBehavior = defineActor<ActorMessage>()
      .onMessage(({ message }) => {
        receivedMessages.push(message);
        // Stateless actors don't need to return anything
      })
      .build();

    // Spawn the receiver
    const receiverPid = await system.spawn(receiverBehavior, { id: 'receiver' });

    // Send a message directly
    await receiverPid.send({
      type: 'TEST_MESSAGE',
      value: 42,
    });

    // Wait for message processing
    await system.flush();

    // Verify message was delivered
    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0]).toMatchObject({
      type: 'TEST_MESSAGE',
      value: 42,
    });

    await system.stop();
  });

  it('should deliver emitted events to subscriber mailboxes', async () => {
    const system = new ActorSystemImpl({ nodeAddress: 'test-node' });
    // Remove enableTestMode() to use natural async message processing
    await system.start();

    // Track messages received by subscriber
    const subscriberMessages: ActorMessage[] = [];

    // Create a publisher that emits events
    const publisherBehavior = defineActor<ActorMessage>()
      .onMessage(({ message }) => {
        if (message.type === 'EMIT_EVENT') {
          return {
            emit: [{ type: 'EMITTED_EVENT', data: 'hello' }],
          };
        }
      })
      .build();

    // Create a subscriber that collects messages
    const subscriberBehavior = defineActor<ActorMessage>()
      .onMessage(({ message }) => {
        subscriberMessages.push(message);
        // Stateless actors don't need to return anything
      })
      .build();

    // Spawn actors
    const publisherPid = await system.spawn(publisherBehavior, { id: 'publisher' });
    const subscriberPid = await system.spawn(subscriberBehavior, { id: 'subscriber' });

    // Subscribe to events
    await system.subscribe(publisherPid, {
      subscriber: subscriberPid,
      events: ['EMITTED_EVENT'],
    });

    // Trigger emission
    await publisherPid.send({ type: 'EMIT_EVENT' });

    // Use system.flush() to wait for all messages to be processed
    await system.flush();

    // Verify event was delivered to subscriber
    expect(subscriberMessages).toHaveLength(1);
    expect(subscriberMessages[0]).toMatchObject({
      type: 'EMITTED_EVENT',
      data: 'hello',
    });

    await system.stop();
  });

  it('should handle mailbox overflow strategies', async () => {
    // Use timer testing for deterministic behavior
    const system = new ActorSystemImpl({ nodeAddress: 'test-node' });
    await system.start();
    const testSystem = await withTimerTesting(system);

    // Track processed messages
    const processedMessages: string[] = [];
    let messageProcessingCount = 0;

    // Get the timer actor for scheduling delays
    const timerActor = testSystem.getTimerActor();

    // Create a slow actor that schedules a delay for each message
    const slowActorBehavior = defineActor<ActorMessage>()
      .onMessage(async ({ message, dependencies }) => {
        if (message.type === 'PROCESS_COMPLETE') {
          // Handle the delayed completion
          // Use type predicate to safely access property
          if ('originalType' in message && typeof message.originalType === 'string') {
            processedMessages.push(message.originalType);
          }
        } else {
          // Instead of setTimeout, schedule a delayed callback via timer actor
          messageProcessingCount++;
          const processingId = messageProcessingCount;

          // Schedule a delayed completion message using dependencies.self
          const completionMessage = {
            type: 'PROCESS_COMPLETE',
            originalType: message.type,
            processingId,
          };

          await timerActor.schedule(
            dependencies.self, // Use self reference from dependencies
            completionMessage,
            10 // 10ms delay
          );
        }
      })
      .build();

    const slowActor = await testSystem.spawn(slowActorBehavior, { id: 'slow-actor' });

    // Send many messages quickly to potentially overflow mailbox
    const messageCount = 20;
    const sendPromises = [];
    for (let i = 0; i < messageCount; i++) {
      sendPromises.push(slowActor.send({ type: `MESSAGE_${i}` }));
    }
    // Wait for all sends to complete
    await Promise.all(sendPromises);

    // First flush to process initial messages
    await testSystem.flush();

    // Advance time to trigger all scheduled completions
    await testSystem.advanceTime(15); // Advance past the 10ms delays

    // Final flush to process completion messages
    await testSystem.flush();

    // All messages should be processed (no loss)
    expect(processedMessages).toHaveLength(messageCount);

    await testSystem.stop();
  });

  it('should route messages to correct actor mailboxes', async () => {
    const system = new ActorSystemImpl({ nodeAddress: 'test-node' });
    // Remove enableTestMode() to use natural async message processing
    await system.start();

    // Track messages for each actor
    const actor1Messages: ActorMessage[] = [];
    const actor2Messages: ActorMessage[] = [];

    const actor1Behavior = defineActor<ActorMessage>()
      .onMessage(({ message }) => {
        actor1Messages.push(message);
        // Stateless actors don't need to return anything
      })
      .build();

    const actor2Behavior = defineActor<ActorMessage>()
      .onMessage(({ message }) => {
        actor2Messages.push(message);
        // Stateless actors don't need to return anything
      })
      .build();

    // Spawn actors
    const actor1 = await system.spawn(actor1Behavior, { id: 'actor-1' });
    const actor2 = await system.spawn(actor2Behavior, { id: 'actor-2' });

    // Send messages to specific actors
    await actor1.send({ type: 'FOR_ACTOR_1' });
    await actor2.send({ type: 'FOR_ACTOR_2' });
    await actor1.send({ type: 'ANOTHER_FOR_1' });

    // Wait for processing
    await system.flush();

    // Verify correct routing
    expect(actor1Messages).toHaveLength(2);
    expect(actor1Messages[0].type).toBe('FOR_ACTOR_1');
    expect(actor1Messages[1].type).toBe('ANOTHER_FOR_1');

    expect(actor2Messages).toHaveLength(1);
    expect(actor2Messages[0].type).toBe('FOR_ACTOR_2');

    await system.stop();
  });

  it('should handle dead letter queue for undeliverable messages', async () => {
    const system = new ActorSystemImpl({ nodeAddress: 'test-node' });
    // Remove enableTestMode() to use natural async message processing
    await system.start();

    // Create an actor
    const actorBehavior = defineActor<ActorMessage>()
      .onMessage(() => {
        // Stateless actors don't need to return anything
      })
      .build();

    const actorPid = await system.spawn(actorBehavior, { id: 'temp-actor' });

    // Stop the actor
    await actorPid.stop();

    // Try to send a message to stopped actor
    // This should not throw but message should go to dead letter queue
    await expect(actorPid.send({ type: 'UNDELIVERABLE' })).resolves.not.toThrow();

    await system.stop();
  });

  it('should process messages in order within an actor', async () => {
    const system = new ActorSystemImpl({ nodeAddress: 'test-node' });
    // Remove enableTestMode() to use natural async message processing
    await system.start();

    // Track message order
    const messageOrder: number[] = [];

    const orderTestBehavior = defineActor<ActorMessage>()
      .onMessage(({ message }) => {
        if ('order' in message && typeof message.order === 'number') {
          messageOrder.push(message.order);
        }
        // Stateless actors don't need to return anything
      })
      .build();

    const actor = await system.spawn(orderTestBehavior, { id: 'order-test' });

    // Send messages with order
    for (let i = 0; i < 10; i++) {
      await actor.send({
        type: 'ORDERED',
        order: i,
      });
    }

    // Wait for processing
    await system.flush();

    // Verify order is preserved
    expect(messageOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    await system.stop();
  });

  it('should handle concurrent message processing for different actors', async () => {
    // Use timer testing for deterministic behavior
    const system = new ActorSystemImpl({ nodeAddress: 'test-node' });
    await system.start();
    const testSystem = await withTimerTesting(system);

    // Track when each actor processes
    const processingOrder: string[] = [];

    // Get the timer actor for scheduling delays
    const timerActor = testSystem.getTimerActor();

    // Create actors with different processing times
    const createTimedActor = (id: string, delay: number) => {
      return defineActor<ActorMessage>()
        .onMessage(async ({ message, dependencies }) => {
          if (message.type === 'COMPLETE') {
            // Use type predicate to safely access property
            if ('actorId' in message && typeof message.actorId === 'string') {
              processingOrder.push(`${message.actorId}-end`);
            }
          } else {
            processingOrder.push(`${id}-start`);

            // Schedule a delayed completion using dependencies.self
            const completionMessage = {
              type: 'COMPLETE',
              actorId: id,
            };

            await timerActor.schedule(dependencies.self, completionMessage, delay);
          }
        })
        .build();
    };

    // Spawn actors with different delays
    const fastActor = await testSystem.spawn(createTimedActor('fast', 10), { id: 'fast' });
    const slowActor = await testSystem.spawn(createTimedActor('slow', 50), { id: 'slow' });

    // Send messages to both actors at the same time
    await Promise.all([fastActor.send({ type: 'PROCESS' }), slowActor.send({ type: 'PROCESS' })]);

    // First flush to process initial messages
    await testSystem.flush();

    // Advance time to complete fast actor (10ms)
    await testSystem.advanceTime(10);
    await testSystem.flush();

    // Advance time to complete slow actor (additional 40ms to reach 50ms total)
    await testSystem.advanceTime(40);
    await testSystem.flush();

    // Verify processing order
    expect(processingOrder).toEqual(['fast-start', 'slow-start', 'fast-end', 'slow-end']);

    await testSystem.stop();
  });
});
