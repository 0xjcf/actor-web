/**
 * @module actor-core/runtime/unit/system-event-actor-processing.test
 * @description Layer 2 tests for system event actor processing
 *
 * This test file verifies that the system event actor correctly
 * processes EMIT_SYSTEM_EVENT messages and returns send instructions
 * for subscribed actors.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActorSystemImpl } from '../actor-system-impl.js';
import { Logger } from '../logger.js';

const log = Logger.namespace('LAYER2_TEST');

describe('Layer 2: System Event Actor Processing', () => {
  let system: ActorSystemImpl;
  let systemEventActorAddress: { path: string };

  beforeEach(async () => {
    system = new ActorSystemImpl({ nodeAddress: 'test-node' });
    await system.start();

    // System event actor address
    systemEventActorAddress = { path: 'actor://test-node/actor/system-event-actor' };
  });

  afterEach(async () => {
    if (system.isRunning()) {
      await system.stop();
    }
  });

  describe('System Event Actor Behavior', () => {
    it('should process EMIT_SYSTEM_EVENT messages and return send instructions', async () => {
      // Create test subscribers
      const subscriber1 = await system.spawn(
        { onMessage: async () => undefined },
        { id: 'subscriber-1' }
      );

      const subscriber2 = await system.spawn(
        { onMessage: async () => undefined },
        { id: 'subscriber-2' }
      );

      // Subscribe to system events through the system event actor
      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      await (system as any).enqueueMessage(systemEventActorAddress, {
        type: 'SUBSCRIBE',
        subscriberPath: subscriber1.address.path,
        subscriberRef: subscriber1, // Pass the actual ActorPID
        eventTypes: ['actorSpawned'],
      });

      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      await (system as any).enqueueMessage(systemEventActorAddress, {
        type: 'SUBSCRIBE',
        subscriberPath: subscriber2.address.path,
        subscriberRef: subscriber2, // Pass the actual ActorPID
        eventTypes: ['actorSpawned', 'actorStopped'],
      });

      // Flush to ensure subscriptions are processed
      await system.flush();

      // Now send EMIT_SYSTEM_EVENT
      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      const emitResult = await (system as any).askActor(
        systemEventActorAddress,
        {
          type: 'EMIT_SYSTEM_EVENT',
          systemEventType: 'actorSpawned',
          systemTimestamp: Date.now(),
          systemData: { address: 'actor://test-node/actor/test' },
          _timestamp: Date.now(),
          _version: '1.0.0',
        },
        5000
      );

      log.info('EMIT_SYSTEM_EVENT result:', emitResult);

      // Should return array of send instructions
      expect(emitResult).toBeDefined();
      expect(Array.isArray(emitResult)).toBe(true);

      // Should have 2 send instructions (one for each subscriber)
      expect(emitResult).toHaveLength(2);

      // Verify send instruction format
      const [inst1, inst2] = emitResult;

      expect(inst1).toHaveProperty('to');
      expect(inst1).toHaveProperty('tell');
      expect(inst1.tell.type).toBe('SYSTEM_EVENT_NOTIFICATION');
      expect(inst1.tell.eventType).toBe('actorSpawned');
      expect(inst1.tell.data).toEqual({ address: 'actor://test-node/actor/test' });

      expect(inst2).toHaveProperty('to');
      expect(inst2).toHaveProperty('tell');
      expect(inst2.tell.type).toBe('SYSTEM_EVENT_NOTIFICATION');
      expect(inst2.tell.eventType).toBe('actorSpawned');
      expect(inst2.tell.data).toEqual({ address: 'actor://test-node/actor/test' });

      log.info('✅ System event actor returns correct send instructions');
    });

    it('should handle subscription filtering by event type', async () => {
      // Create subscribers with different event subscriptions
      const spawnSubscriber = await system.spawn(
        { onMessage: async () => undefined },
        { id: 'spawn-subscriber' }
      );

      const stopSubscriber = await system.spawn(
        { onMessage: async () => undefined },
        { id: 'stop-subscriber' }
      );

      // Subscribe to different events
      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      await (system as any).enqueueMessage(systemEventActorAddress, {
        type: 'SUBSCRIBE',
        subscriberPath: spawnSubscriber.address.path,
        subscriberRef: spawnSubscriber, // Pass the actual ActorPID
        eventTypes: ['actorSpawned'],
      });

      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      await (system as any).enqueueMessage(systemEventActorAddress, {
        type: 'SUBSCRIBE',
        subscriberPath: stopSubscriber.address.path,
        subscriberRef: stopSubscriber, // Pass the actual ActorPID
        eventTypes: ['actorStopped'],
      });

      await system.flush();

      // Emit a spawn event
      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      const spawnResult = await (system as any).askActor(
        systemEventActorAddress,
        {
          type: 'EMIT_SYSTEM_EVENT',
          systemEventType: 'actorSpawned',
          systemTimestamp: Date.now(),
          systemData: { address: 'test-actor' },
          _timestamp: Date.now(),
          _version: '1.0.0',
        },
        5000
      );

      // Should only notify spawn subscriber
      expect(spawnResult).toHaveLength(1);
      expect(spawnResult[0].tell.eventType).toBe('actorSpawned');

      // Emit a stop event
      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      const stopResult = await (system as any).askActor(
        systemEventActorAddress,
        {
          type: 'EMIT_SYSTEM_EVENT',
          systemEventType: 'actorStopped',
          systemTimestamp: Date.now(),
          systemData: { address: 'test-actor' },
          _timestamp: Date.now(),
          _version: '1.0.0',
        },
        5000
      );

      // Should only notify stop subscriber
      expect(stopResult).toHaveLength(1);
      expect(stopResult[0].tell.eventType).toBe('actorStopped');

      log.info('✅ System event actor filters subscriptions correctly');
    });

    it('should handle wildcard subscriptions', async () => {
      const wildcardSubscriber = await system.spawn(
        { onMessage: async () => undefined },
        { id: 'wildcard-subscriber' }
      );

      // Subscribe with wildcard
      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      await (system as any).enqueueMessage(systemEventActorAddress, {
        type: 'SUBSCRIBE',
        subscriberPath: wildcardSubscriber.address.path,
        subscriberRef: wildcardSubscriber, // Pass the actual ActorPID
        eventTypes: ['*'], // All events
      });

      await system.flush();

      // Test various event types
      const eventTypes = ['actorSpawned', 'actorStopped', 'customEvent'];

      for (const eventType of eventTypes) {
        // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
        const result = await (system as any).askActor(
          systemEventActorAddress,
          {
            type: 'EMIT_SYSTEM_EVENT',
            systemEventType: eventType,
            systemTimestamp: Date.now(),
            systemData: null,
            _timestamp: Date.now(),
            _version: '1.0.0',
          },
          5000
        );

        expect(result).toHaveLength(1);
        expect(result[0].tell.eventType).toBe(eventType);
      }

      log.info('✅ System event actor handles wildcard subscriptions');
    });

    it('should handle unsubscribe messages', async () => {
      const subscriber = await system.spawn(
        { onMessage: async () => undefined },
        { id: 'temp-subscriber' }
      );

      // Subscribe
      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      await (system as any).enqueueMessage(systemEventActorAddress, {
        type: 'SUBSCRIBE',
        subscriberPath: subscriber.address.path,
        subscriberRef: subscriber, // Pass the actual ActorPID
        eventTypes: ['testEvent'],
      });

      await system.flush();

      // Verify subscription works
      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      const beforeResult = await (system as any).askActor(
        systemEventActorAddress,
        {
          type: 'EMIT_SYSTEM_EVENT',
          systemEventType: 'testEvent',
          systemTimestamp: Date.now(),
          systemData: null,
          _timestamp: Date.now(),
          _version: '1.0.0',
        },
        5000
      );

      expect(beforeResult).toHaveLength(1);

      // Unsubscribe
      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      await (system as any).enqueueMessage(systemEventActorAddress, {
        type: 'UNSUBSCRIBE',
        subscriberPath: subscriber.address.path,
      });

      await system.flush();

      // Verify unsubscription worked
      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      const afterResult = await (system as any).askActor(
        systemEventActorAddress,
        {
          type: 'EMIT_SYSTEM_EVENT',
          systemEventType: 'testEvent',
          systemTimestamp: Date.now(),
          systemData: null,
          _timestamp: Date.now(),
          _version: '1.0.0',
        },
        5000
      );

      // Should return empty array when no subscribers
      expect(afterResult).toEqual([]);

      log.info('✅ System event actor handles unsubscribe correctly');
    });
  });

  describe('Send Instruction Format', () => {
    it('should create send instructions with correct event format', async () => {
      const subscriber = await system.spawn(
        { onMessage: async () => undefined },
        { id: 'format-test-subscriber' }
      );

      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      await (system as any).enqueueMessage(systemEventActorAddress, {
        type: 'SUBSCRIBE',
        subscriberPath: subscriber.address.path,
        subscriberRef: subscriber, // Pass the actual ActorPID
        eventTypes: ['formatTest'],
      });

      await system.flush();

      const testData = {
        key: 'value',
        nested: { prop: 'data' },
        array: [1, 2, 3],
      };

      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      const result = await (system as any).askActor(
        systemEventActorAddress,
        {
          type: 'EMIT_SYSTEM_EVENT',
          systemEventType: 'formatTest',
          systemTimestamp: 1234567890,
          systemData: testData,
          _timestamp: Date.now(),
          _version: '1.0.0',
        },
        5000
      );

      expect(result).toHaveLength(1);
      const instruction = result[0];

      // Verify event transformation
      expect(instruction.tell).toMatchObject({
        type: 'SYSTEM_EVENT_NOTIFICATION',
        eventType: 'formatTest',
        timestamp: 1234567890,
        data: testData,
      });

      log.info('✅ System event actor creates properly formatted events');
    });

    it('should handle events without data', async () => {
      const subscriber = await system.spawn(
        { onMessage: async () => undefined },
        { id: 'no-data-subscriber' }
      );

      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      await (system as any).enqueueMessage(systemEventActorAddress, {
        type: 'SUBSCRIBE',
        subscriberPath: subscriber.address.path,
        subscriberRef: subscriber, // Pass the actual ActorPID
        eventTypes: ['simpleEvent'],
      });

      await system.flush();

      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      const result = await (system as any).askActor(
        systemEventActorAddress,
        {
          type: 'EMIT_SYSTEM_EVENT',
          systemEventType: 'simpleEvent',
          systemTimestamp: Date.now(),
          systemData: null,
          _timestamp: Date.now(),
          _version: '1.0.0',
        },
        5000
      );

      expect(result).toHaveLength(1);
      const instruction = result[0];

      // Event should have type and timestamp, data can be null
      expect(instruction.tell.type).toBe('SYSTEM_EVENT_NOTIFICATION');
      expect(instruction.tell.eventType).toBe('simpleEvent');
      expect(instruction.tell).toHaveProperty('timestamp');
      expect(instruction.tell.data).toBeNull();

      log.info('✅ System event actor handles events without data');
    });
  });

  describe('Edge Cases', () => {
    it('should handle EMIT_SYSTEM_EVENT with no subscribers', async () => {
      // No subscriptions made
      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      const result = await (system as any).askActor(
        systemEventActorAddress,
        {
          type: 'EMIT_SYSTEM_EVENT',
          systemEventType: 'lonelyEvent',
          systemTimestamp: Date.now(),
          systemData: null,
          _timestamp: Date.now(),
          _version: '1.0.0',
        },
        5000
      );

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);

      log.info('✅ System event actor handles no subscribers gracefully');
    });

    it('should handle duplicate subscriptions', async () => {
      const subscriber = await system.spawn(
        { onMessage: async () => undefined },
        { id: 'duplicate-subscriber' }
      );

      // Subscribe twice
      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      await (system as any).enqueueMessage(systemEventActorAddress, {
        type: 'SUBSCRIBE',
        subscriberPath: subscriber.address.path,
        subscriberRef: subscriber, // Pass the actual ActorPID
        eventTypes: ['duplicateTest'],
      });

      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      await (system as any).enqueueMessage(systemEventActorAddress, {
        type: 'SUBSCRIBE',
        subscriberPath: subscriber.address.path,
        subscriberRef: subscriber, // Pass the actual ActorPID
        eventTypes: ['duplicateTest'],
      });

      await system.flush();

      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      const result = await (system as any).askActor(
        systemEventActorAddress,
        {
          type: 'EMIT_SYSTEM_EVENT',
          systemEventType: 'duplicateTest',
          systemTimestamp: Date.now(),
          systemData: null,
          _timestamp: Date.now(),
          _version: '1.0.0',
        },
        5000
      );

      // Should only get one instruction (no duplicates)
      expect(result).toHaveLength(1);

      log.info('✅ System event actor handles duplicate subscriptions');
    });

    it('should handle invalid message types gracefully', async () => {
      // Send an unknown message type
      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      await (system as any).enqueueMessage(systemEventActorAddress, {
        type: 'UNKNOWN_MESSAGE_TYPE',
        someData: 'test',
      });

      // Should not crash - flush to process
      await system.flush();

      // System should still be functional
      const subscriber = await system.spawn(
        { onMessage: async () => undefined },
        { id: 'post-error-subscriber' }
      );

      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      await (system as any).enqueueMessage(systemEventActorAddress, {
        type: 'SUBSCRIBE',
        subscriberPath: subscriber.address.path,
        subscriberRef: subscriber, // Pass the actual ActorPID
        eventTypes: ['stillWorks'],
      });

      await system.flush();

      // biome-ignore lint/suspicious/noExplicitAny: Testing internal methods
      const result = await (system as any).askActor(
        systemEventActorAddress,
        {
          type: 'EMIT_SYSTEM_EVENT',
          systemEventType: 'stillWorks',
          systemTimestamp: Date.now(),
          systemData: null,
          _timestamp: Date.now(),
          _version: '1.0.0',
        },
        5000
      );

      expect(result).toHaveLength(1);

      log.info('✅ System event actor handles invalid messages gracefully');
    });
  });
});
