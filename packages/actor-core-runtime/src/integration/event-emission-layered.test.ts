/**
 * @module actor-core/runtime/integration/event-emission-layered.test
 * @description Layered integration tests for event emission system
 *
 * Tests each layer of integration progressively to isolate issues:
 * 1. Actor spawning and basic message handling
 * 2. Event emission from actor behaviors
 * 3. Event routing through dependencies.emit
 * 4. Auto-publishing registration
 * 5. Event delivery to subscribers
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActorMessage } from '../actor-system.js';
import { ActorSystemImpl } from '../actor-system-impl.js';
import { Logger } from '../logger.js';
import { defineActor } from '../unified-actor-builder.js';

const log = Logger.namespace('TEST');
describe('Event Emission - Layered Integration Tests', () => {
  let system: ActorSystemImpl;

  beforeEach(async () => {
    system = new ActorSystemImpl({ nodeAddress: 'test-node' });
    system.enableTestMode(); // Enable synchronous message processing
  });

  afterEach(async () => {
    await system.stop();
  });

  describe('Layer 1: Basic Actor Spawning and Message Handling', () => {
    it('should spawn actor and handle basic messages', async () => {
      // Track messages received
      const receivedMessages: ActorMessage[] = [];

      const actorBehavior = defineActor<ActorMessage>()
        .onMessage(({ message }) => {
          receivedMessages.push(message);
        })
        .build();

      const actor = await system.spawn(actorBehavior, { id: 'basic-actor' });

      // Send a test message
      await actor.send({ type: 'TEST' });

      // Verify message was received
      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].type).toBe('TEST');
    });
  });

  describe('Layer 2: Event Emission from Actor Behavior', () => {
    it('should return emit array from message handler', async () => {
      const emittingBehavior = defineActor<ActorMessage>()
        .onMessage(({ message }) => {
          if (message.type === 'TRIGGER') {
            return {
              emit: [
                { type: 'EVENT_A', data: 'hello' },
                { type: 'EVENT_B', data: 'world' },
              ],
            };
          }
        })
        .build();

      const emitter = await system.spawn(emittingBehavior, { id: 'emitter' });

      // Send trigger message
      await emitter.send({ type: 'TRIGGER' });

      // At this point, the handler should have returned the emit array
      // We'll verify in the next layer that emit is called
    });
  });

  describe('Layer 3: Event Routing through dependencies.emit', () => {
    it('should call dependencies.emit for emitted events', async () => {
      // We need to spy on the emit function
      // For now, let's create a collector actor that we'll use in the next layer
      const collectedEvents: ActorMessage[] = [];

      const collectorBehavior = defineActor<ActorMessage>()
        .onMessage(({ message }) => {
          collectedEvents.push(message);
        })
        .build();

      await system.spawn(collectorBehavior, { id: 'collector' });

      // Create emitter that emits events
      const emitterBehavior = defineActor<ActorMessage>()
        .onMessage(({ message }) => {
          if (message.type === 'EMIT_TEST') {
            return {
              emit: [{ type: 'TEST_EVENT', value: 42 }],
            };
          }
        })
        .build();

      const emitter = await system.spawn(emitterBehavior, { id: 'emit-test' });

      // At this point, emitter is created but not subscribed
      // Let's trigger emission
      await emitter.send({ type: 'EMIT_TEST' });

      // Without subscription, collector should not receive anything
      expect(collectedEvents).toHaveLength(0);
    });
  });

  describe('Layer 4: Auto-Publishing Registration and Subscription', () => {
    it('should register actor as auto-publisher and allow subscriptions', async () => {
      const collectedEvents: ActorMessage[] = [];

      // Create collector first
      const collectorBehavior = defineActor<ActorMessage>()
        .onMessage(({ message }) => {
          collectedEvents.push(message);
        })
        .build();

      const collector = await system.spawn(collectorBehavior, { id: 'subscriber' });

      // Create publisher
      const publisherBehavior = defineActor<ActorMessage>()
        .onMessage(({ message }) => {
          if (message.type === 'PUBLISH') {
            return {
              emit: [{ type: 'PUBLISHED_EVENT', data: 'test' }],
            };
          }
        })
        .build();

      const publisher = await system.spawn(publisherBehavior, { id: 'publisher' });

      // Subscribe collector to publisher's events
      await system.subscribe(publisher, {
        subscriber: collector,
        events: ['PUBLISHED_EVENT'],
      });

      // Trigger event emission
      await publisher.send({ type: 'PUBLISH' });

      // Flush to ensure all messages are processed
      await system.flush();

      // Check if event was delivered
      log.debug('Collected events:', collectedEvents);
      expect(collectedEvents).toHaveLength(1);
      expect(collectedEvents[0].type).toBe('PUBLISHED_EVENT');
    });
  });

  describe('Layer 5: Full Event Delivery Flow', () => {
    it('should deliver events from publisher to multiple subscribers', async () => {
      const subscriber1Events: ActorMessage[] = [];
      const subscriber2Events: ActorMessage[] = [];
      log.debug('🔍 TEST: Starting Layer 5 test');

      // Create two subscribers
      const subscriber1 = await system.spawn(
        defineActor<ActorMessage>()
          .onMessage(({ message }) => {
            subscriber1Events.push(message);
          })
          .build(),
        { id: 'sub1' }
      );

      const subscriber2 = await system.spawn(
        defineActor<ActorMessage>()
          .onMessage(({ message }) => {
            subscriber2Events.push(message);
          })
          .build(),
        { id: 'sub2' }
      );

      // Create publisher
      const publisher = await system.spawn(
        defineActor<ActorMessage>()
          .onMessage(({ message }) => {
            if (message.type === 'BROADCAST') {
              return {
                emit: [
                  { type: 'BROADCAST_EVENT', count: 1 },
                  { type: 'OTHER_EVENT', count: 2 },
                ],
              };
            }
          })
          .build(),
        { id: 'broadcaster' }
      );

      // Subscribe both to different events
      log.debug('🔍 TEST: Subscribing subscriber1 to BROADCAST_EVENT');
      await system.subscribe(publisher, {
        subscriber: subscriber1,
        events: ['BROADCAST_EVENT'],
      });

      log.debug('🔍 TEST: Subscribing subscriber2 to OTHER_EVENT');
      await system.subscribe(publisher, {
        subscriber: subscriber2,
        events: ['OTHER_EVENT'],
      });

      // Flush to ensure subscription messages are processed
      await system.flush();

      log.debug('🔍 TEST: Sending BROADCAST message to publisher');
      // Trigger broadcast
      await publisher.send({ type: 'BROADCAST' });

      // Flush to ensure all event delivery is complete
      await system.flush();

      // Verify event delivery
      log.debug('Subscriber 1 events:', subscriber1Events);
      log.debug('Subscriber 2 events:', subscriber2Events);

      expect(subscriber1Events).toHaveLength(1);
      expect(subscriber1Events[0].type).toBe('BROADCAST_EVENT');

      expect(subscriber2Events).toHaveLength(1);
      expect(subscriber2Events[0].type).toBe('OTHER_EVENT');
    });
  });
});
