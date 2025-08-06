/**
 * @module actor-core/runtime/unit/system-event-generation.test
 * @description Layer 1 tests for system event generation
 *
 * This test file verifies that the actor system correctly generates
 * system event messages with the proper format when lifecycle
 * operations occur.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorBehavior, ActorMessage } from '../actor-system.js';
import { ActorSystemImpl } from '../actor-system-impl.js';
import { Logger } from '../logger.js';

const log = Logger.namespace('LAYER1_TEST');

// Global error tracking for debugging
const globalErrors: Error[] = [];
const originalConsoleError = console.error;

// Track unhandled errors
process.on('uncaughtException', (error) => {
  log.error('🚨 UNCAUGHT EXCEPTION:', error.message);
  globalErrors.push(error);
});

process.on('unhandledRejection', (reason) => {
  log.error('🚨 UNHANDLED REJECTION:', String(reason));
  globalErrors.push(new Error(`Unhandled rejection: ${reason}`));
});

// Override console.error to catch other errors
console.error = (...args: unknown[]) => {
  log.error('🚨 CONSOLE ERROR:', args.join(' '));
  originalConsoleError(...args);
};

describe('Layer 1: System Event Generation', () => {
  let system: ActorSystemImpl;

  beforeEach(async () => {
    // Clear previous errors
    globalErrors.length = 0;

    log.info('🔧 Setting up test system...');

    try {
      // Use ActorSystemImpl directly for internal testing
      system = new ActorSystemImpl({ nodeAddress: 'test-node' });
      // Remove enableTestMode() to use natural async message processing
      await system.start();

      log.info('✅ Test system started successfully');
    } catch (error) {
      log.error('❌ Failed to start test system:', error);
      throw error;
    }
  });

  afterEach(async () => {
    log.info('🧹 Cleaning up test system...');

    try {
      if (system?.isRunning()) {
        await system.stop();
        log.info('✅ Test system stopped successfully');
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        log.info('🗑️ Garbage collection triggered');
      }

      // Check for accumulated errors
      if (globalErrors.length > 0) {
        log.error(`🚨 Found ${globalErrors.length} global errors during test:`, globalErrors);
        // Don't fail the test, just log for debugging
      }
    } catch (error) {
      log.error('❌ Error during cleanup:', error);
      throw error;
    }
  });

  describe('emitSystemEvent method', () => {
    it('should create EMIT_SYSTEM_EVENT message with correct format', async () => {
      log.info('🧪 Testing system event message format...');

      try {
        // Spy on private method to verify message format
        // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
        const emitSystemEventSpy = vi.spyOn(system as any, 'emitSystemEvent');
        // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
        const enqueueMessageSpy = vi.spyOn(system as any, 'enqueueMessage');

        // Directly call emitSystemEvent
        // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
        await (system as any).emitSystemEvent({
          eventType: 'testEvent',
          timestamp: 1234567890,
          data: { test: 'data' },
        });

        // Verify emitSystemEvent was called
        expect(emitSystemEventSpy).toHaveBeenCalledWith({
          eventType: 'testEvent',
          timestamp: 1234567890,
          data: { test: 'data' },
        });

        // Verify enqueueMessage was called with correct format
        expect(enqueueMessageSpy).toHaveBeenCalled();
        // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
        const [address, message] = enqueueMessageSpy.mock.calls[0] as [any, any];

        // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
        expect((address as any).path).toContain('system-event-actor');
        expect(message).toMatchObject({
          type: 'EMIT_SYSTEM_EVENT',
          systemEventType: 'testEvent',
          systemTimestamp: 1234567890,
          systemData: { test: 'data' },
          _timestamp: expect.any(Number),
          _version: expect.any(String),
        });

        log.info('✅ emitSystemEvent creates correct message format');
      } catch (error) {
        log.error('❌ Test failed:', error);
        throw error;
      }
    }, 10000); // 10 second timeout

    it('should use system* prefixed fields, not regular fields', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      const enqueueMessageSpy = vi.spyOn(system as any, 'enqueueMessage');

      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      await (system as any).emitSystemEvent({
        eventType: 'fieldTest',
        timestamp: Date.now(),
      });

      const [, message] =
        enqueueMessageSpy.mock.calls.find(([_addr, msg]) => {
          const typedMsg = msg as ActorMessage & { systemEventType?: string };
          return typedMsg.type === 'EMIT_SYSTEM_EVENT' && typedMsg.systemEventType === 'fieldTest';
        }) || [];

      expect(message).toBeDefined();

      // Should have system* fields
      expect(message).toHaveProperty('systemEventType');
      expect(message).toHaveProperty('systemTimestamp');
      expect(message).toHaveProperty('systemData');

      // Should NOT have regular fields
      expect(message).not.toHaveProperty('eventType');
      expect(message).not.toHaveProperty('timestamp');
      expect(message).not.toHaveProperty('data');

      log.info('✅ System events use correct field names');
    });
  });

  describe('Actor Spawn Event Generation', () => {
    it('should call emitSystemEvent when actor is spawned', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      const emitSystemEventSpy = vi.spyOn(system as any, 'emitSystemEvent');

      // Clear existing calls from system startup
      emitSystemEventSpy.mockClear();

      const behavior: ActorBehavior = {
        onMessage: async () => undefined,
      };

      // Spawn an actor
      await system.spawn(behavior, { id: 'test-actor' });

      // Verify emitSystemEvent was called
      expect(emitSystemEventSpy).toHaveBeenCalledWith({
        eventType: 'actorSpawned',
        timestamp: expect.any(Number),
        data: {
          address: expect.stringContaining('test-actor'),
        },
      });

      log.info('✅ Actor spawn triggers emitSystemEvent');
    });
  });

  describe('Actor Stop Event Generation', () => {
    it('should call emitSystemEvent for stopping and stopped', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      const emitSystemEventSpy = vi.spyOn(system as any, 'emitSystemEvent');

      // Create and spawn an actor
      const actor = await system.spawn({ onMessage: async () => undefined }, { id: 'stop-test' });

      // Clear previous calls
      emitSystemEventSpy.mockClear();

      // Stop the actor
      await actor.stop();

      // Should emit actorStopping and actorStopped
      const emitCalls = emitSystemEventSpy.mock.calls;
      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      const eventTypes = emitCalls.map((call) => (call[0] as any).eventType);

      expect(eventTypes).toContain('actorStopping');
      expect(eventTypes).toContain('actorStopped');

      // Verify event data
      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      const stoppingCall = emitCalls.find((call) => (call[0] as any).eventType === 'actorStopping');
      expect(stoppingCall?.[0]).toMatchObject({
        eventType: 'actorStopping',
        timestamp: expect.any(Number),
        data: {
          address: expect.stringContaining('stop-test'),
        },
      });

      log.info('✅ Actor stop triggers stopping and stopped events');
    });
  });

  describe('System Lifecycle Event Generation', () => {
    it('should emit system events during startup', async () => {
      // Create a new system to capture startup events
      const testSystem = new ActorSystemImpl({ nodeAddress: 'startup-test' });
      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      const emitSystemEventSpy = vi.spyOn(testSystem as any, 'emitSystemEvent');

      await testSystem.start();

      // Should have emitted 'started' event
      expect(emitSystemEventSpy).toHaveBeenCalledWith({
        eventType: 'started',
        timestamp: expect.any(Number),
      });

      await testSystem.stop();

      log.info('✅ System emits started event during startup');
    });

    it('should emit stopping event during shutdown', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      const emitSystemEventSpy = vi.spyOn(system as any, 'emitSystemEvent');

      // Clear startup events
      emitSystemEventSpy.mockClear();

      // Stop the system
      await system.stop();

      // Should emit stopping event
      expect(emitSystemEventSpy).toHaveBeenCalledWith({
        eventType: 'stopping',
        timestamp: expect.any(Number),
      });

      log.info('✅ System emits stopping event during shutdown');
    });
  });

  describe('Event Generation Safeguards', () => {
    it('should handle missing system event actor gracefully', async () => {
      // Create a system but don't let it fully start
      const brokenSystem = new ActorSystemImpl({ nodeAddress: 'broken' });

      // Set system event actor address to undefined
      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      (brokenSystem as any).systemEventActorAddress = undefined;

      // Should not throw when emitting events
      await expect(
        // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
        (brokenSystem as any).emitSystemEvent({
          eventType: 'test',
          timestamp: Date.now(),
        })
      ).resolves.not.toThrow();

      log.info('✅ System handles missing event actor gracefully');
    });
  });

  describe('Message Routing', () => {
    it('should route system events to correct actor address', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      const enqueueMessageSpy = vi.spyOn(system as any, 'enqueueMessage');

      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      await (system as any).emitSystemEvent({
        eventType: 'routingTest',
        timestamp: Date.now(),
      });

      // Find the call for our event
      const systemEventCall = enqueueMessageSpy.mock.calls.find(
        // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
        ([, msg]) => (msg as any).systemEventType === 'routingTest'
      );

      expect(systemEventCall).toBeDefined();
      if (!systemEventCall) {
        throw new Error('systemEventCall should be defined');
      }
      const [address] = systemEventCall;

      // Should be sent to system event actor
      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      expect((address as any).path).toContain('system-event-actor');
      // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
      expect(address).toBe((system as any).systemEventActorAddress);

      log.info('✅ System events routed to system event actor');
    });
  });
});
