/**
 * @module actor-core/runtime/integration/event-emission-debug.test
 * @description Focused debugging test for event emission issue
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActorMessage } from '../actor-system.js';
import { ActorSystemImpl } from '../actor-system-impl.js';
import { Logger } from '../logger.js';
import { defineActor } from '../unified-actor-builder.js';

const log = Logger.namespace('TEST');
describe('Event Emission - Debug Multiple Subscribers', () => {
  let system: ActorSystemImpl;

  beforeEach(async () => {
    system = new ActorSystemImpl({ nodeAddress: 'test-node' });
    system.enableTestMode();
  });

  afterEach(async () => {
    await system.stop();
  });

  it('should handle multiple subscribers to same publisher', async () => {
    const sub1Events: ActorMessage[] = [];
    const sub2Events: ActorMessage[] = [];

    // Create publisher that emits one event
    const publisher = await system.spawn(
      defineActor<ActorMessage>()
        .onMessage(({ message }) => {
          if (message.type === 'TRIGGER') {
            return {
              emit: [{ type: 'TEST_EVENT', data: 'hello' }],
            };
          }
        })
        .build(),
      { id: 'publisher' }
    );

    // Create first subscriber
    const sub1 = await system.spawn(
      defineActor<ActorMessage>()
        .onMessage(({ message }) => {
          log.debug('SUB1 received:', message.type);
          sub1Events.push(message);
          return undefined;
        })
        .build(),
      { id: 'sub1' }
    );

    // Create second subscriber
    const sub2 = await system.spawn(
      defineActor<ActorMessage>()
        .onMessage(({ message }) => {
          log.debug('SUB2 received:', message.type);
          sub2Events.push(message);
          return undefined;
        })
        .build(),
      { id: 'sub2' }
    );

    // Subscribe both to same event
    log.debug('=== Subscribing sub1 ===');
    await system.subscribe(publisher, {
      subscriber: sub1,
      events: ['TEST_EVENT'],
    });

    // Check registry state after first subscription
    // Type assertion for accessing private testing property
    interface TestActorSystem {
      autoPublishingRegistry: {
        getPublishableActor(path: string): { subscribers: Map<string, unknown> };
      };
    }
    const registry = (system as unknown as TestActorSystem).autoPublishingRegistry;
    const metadata1 = registry.getPublishableActor('actor://test-node/actor/publisher');
    log.debug('After sub1 subscription:', {
      subscribers: Array.from(metadata1.subscribers.entries()),
    });

    log.debug('=== Subscribing sub2 ===');
    await system.subscribe(publisher, {
      subscriber: sub2,
      events: ['TEST_EVENT'],
    });

    // Check registry state after second subscription
    const metadata2 = registry.getPublishableActor('actor://test-node/actor/publisher');
    log.debug('After sub2 subscription:', {
      subscribers: Array.from(metadata2.subscribers.entries()),
    });

    // Trigger event
    log.debug('=== Triggering event ===');
    await publisher.send({ type: 'TRIGGER' });

    // Flush to ensure all event delivery is complete
    await system.flush();

    // Both should receive the event
    log.debug('Sub1 events:', sub1Events.length);
    log.debug('Sub2 events:', sub2Events.length);

    expect(sub1Events).toHaveLength(1);
    expect(sub1Events[0].type).toBe('TEST_EVENT');

    expect(sub2Events).toHaveLength(1);
    expect(sub2Events[0].type).toBe('TEST_EVENT');
  });
});
