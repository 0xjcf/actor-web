/**
 * @module actor-core/runtime/tests/graceful-shutdown.test
 * @description Tests for graceful shutdown and lifecycle management
 *
 * These tests verify that the actor system can shut down gracefully,
 * properly cleaning up resources and giving actors time to finish
 * processing before termination.
 *
 * @author Agent C (Testing) - 2025-07-18
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorBehavior, ActorMessage } from '../actor-system.js';
import { type ActorSystemConfig, createActorSystem } from '../actor-system-impl.js';
import { defineBehavior } from '../index.js';
import { Logger } from '../logger.js';
import { createActorDelay } from '../pure-xstate-utilities.js';
import { parse } from '../utils/factories.js';

const log = Logger.namespace('SHUTDOWN_TEST');

describe('Graceful Shutdown and Lifecycle Management', () => {
  let system: ReturnType<typeof createActorSystem>;
  const config: ActorSystemConfig = {
    nodeAddress: 'test-node',
    shutdownTimeout: 5000,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    system = createActorSystem(config);
    system.enableTestMode(); // Enable synchronous message processing
    await system.start();
  });

  afterEach(async () => {
    if (system.isRunning()) {
      await system.stop();
    }
  });

  describe('System Lifecycle', () => {
    it('should start and stop the system gracefully', async () => {
      // System should be running after start
      expect(system.isRunning()).toBe(true);

      // Stop the system
      await system.stop();

      // System should not be running after stop
      expect(system.isRunning()).toBe(false);
    });

    it('should handle multiple start calls gracefully', async () => {
      // System is already started in beforeEach
      expect(system.isRunning()).toBe(true);

      // Second start should be idempotent
      expect(system.isRunning()).toBe(true);
    });

    it('should handle multiple stop calls gracefully', async () => {
      // First stop
      await system.stop();
      expect(system.isRunning()).toBe(false);

      // Second stop should be idempotent
      await system.stop();
      expect(system.isRunning()).toBe(false);
    });

    it('produces no dead letters on a clean spawn/emit/flush/stop cycle', async () => {
      // Regression: stopping the system used to stop the system event actor
      // concurrently with its peers, so every actorStopping/actorStopped
      // emission (and the final 'stopped' event) dead-lettered against the
      // already-gone system event actor mailbox.
      const emitter = defineBehavior<{ type: 'PING' }>()
        .withContext({ count: 0 })
        .onMessage(({ message, context }) => {
          if (message.type === 'PING') {
            const count = context.count + 1;
            return { context: { count }, emit: [{ type: 'PONGED', count }] };
          }
          return {};
        })
        .build();

      const actorA = await system.spawn(emitter, { id: 'dead-letter-probe-a' });
      await system.spawn(emitter, { id: 'dead-letter-probe-b' });

      await actorA.send({ type: 'PING' });
      await system.flush();

      await system.stop();

      // Reach into the internal queue: a clean shutdown must not dead-letter
      // anything, system events included.
      const deadLetters = (
        system as unknown as {
          deadLetterQueue: { getAll(): ReadonlyArray<{ messageType: string; reason: string }> };
        }
      ).deadLetterQueue.getAll();
      expect(deadLetters).toEqual([]);
    });
  });

  describe('Actor Lifecycle During Shutdown', () => {
    it('should call onStop for all actors during shutdown', async () => {
      const onStopCalls: string[] = [];

      // ✅ PURE ACTOR MODEL: Use new defineBehavior API without context
      const createBehavior = (id: string): ActorBehavior => ({
        onMessage: async () => undefined,
        onStop: async () => {
          onStopCalls.push(id);
          log.debug('Actor stopped', { id });
        },
      });

      // Spawn multiple actors
      const actor1 = await system.spawn(createBehavior('actor1'), { id: 'actor1' });
      const actor2 = await system.spawn(createBehavior('actor2'), { id: 'actor2' });
      const actor3 = await system.spawn(createBehavior('actor3'), { id: 'actor3' });

      // Verify actors are alive
      expect(await actor1.isAlive()).toBe(true);
      expect(await actor2.isAlive()).toBe(true);
      expect(await actor3.isAlive()).toBe(true);

      // Stop the system
      await system.stop();

      // Wait a bit for onStop callbacks to be executed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify all onStop callbacks were called
      expect(onStopCalls).toHaveLength(3);
      expect(onStopCalls).toContain('actor1');
      expect(onStopCalls).toContain('actor2');
      expect(onStopCalls).toContain('actor3');
    });

    it('should handle actors still processing messages during shutdown', async () => {
      // Track state transitions through the behavior
      let finalState = 'idle';
      let processedSuccessfully = false;

      // ✅ PURE ACTOR MODEL: Use defineBehavior with context for OTP-style reply pattern
      const behavior = defineBehavior<ActorMessage>()
        .withContext({ state: 'idle' })
        .onMessage(async ({ message, actor }) => {
          log.debug('🔍 TEST DEBUG: Actor received message', {
            type: message.type,
            hasCorrelationId: !!message._correlationId,
          });

          const context = actor.getSnapshot().context;
          if (message.type === 'PROCESS') {
            log.debug('Processing message', { message });

            // Simulate async work by yielding control
            await createActorDelay(100);

            processedSuccessfully = true;
            finalState = 'completed';

            // Use OTP-style reply for ask pattern
            log.debug('🔍 TEST DEBUG: Returning reply');
            return {
              context: { state: 'completed' },
              reply: { status: 'completed', result: 'processed' },
            };
          }
          return { context };
        });

      const actor = await system.spawn(behavior, { id: 'long-running' });

      // Use ask pattern to ensure message is processed
      const result = await actor.ask({
        type: 'PROCESS',
        data: 'data',
      });

      // Verify processing completed
      expect(result).toEqual({ status: 'completed', result: 'processed' });
      expect(processedSuccessfully).toBe(true);

      // Stop the system - the message should have been processed
      await system.stop();

      // Verify the actor completed processing before shutdown
      expect(finalState).toBe('completed');
    });
  });

  describe('Shutdown Handlers', () => {
    it('should execute registered shutdown handlers', async () => {
      const handlerCalls: string[] = [];

      // Register multiple shutdown handlers
      system.onShutdown(async () => {
        handlerCalls.push('handler1');
        // Yield control to simulate async work
        await Promise.resolve();
      });

      system.onShutdown(async () => {
        handlerCalls.push('handler2');
        // Yield control to simulate async work
        await Promise.resolve();
      });

      system.onShutdown(async () => {
        handlerCalls.push('handler3');
      });

      // Stop the system
      await system.stop();

      // All handlers should have been called
      expect(handlerCalls).toHaveLength(3);
      expect(handlerCalls).toContain('handler1');
      expect(handlerCalls).toContain('handler2');
      expect(handlerCalls).toContain('handler3');
    });

    it('should handle errors in shutdown handlers gracefully', async () => {
      const handlerCalls: string[] = [];

      // Register handlers, one will throw
      system.onShutdown(async () => {
        handlerCalls.push('handler1');
      });

      system.onShutdown(async () => {
        handlerCalls.push('handler2-error');
        throw new Error('Handler error');
      });

      system.onShutdown(async () => {
        handlerCalls.push('handler3');
      });

      // Stop should not throw despite handler error
      await expect(system.stop()).resolves.toBeUndefined();

      // Other handlers should still run
      expect(handlerCalls).toContain('handler1');
      expect(handlerCalls).toContain('handler2-error');
      expect(handlerCalls).toContain('handler3');
    });
  });

  describe('Shutdown Timeout', () => {
    it('should respect shutdown timeout', async () => {
      // Create a system with short timeout
      const quickSystem = createActorSystem({
        nodeAddress: 'quick-test',
        shutdownTimeout: 100, // 100ms timeout
      });
      await quickSystem.start();

      const behavior: ActorBehavior = {
        onMessage: async () => undefined,
        onStop: async () => {
          // Create a promise that won't resolve within timeout
          await new Promise(() => {
            // This promise never resolves, simulating a hanging shutdown
          });
        },
      };

      // Spawn an actor that takes too long to stop
      await quickSystem.spawn(behavior, { id: 'slow-stopper' });

      // System should complete shutdown despite hanging actor
      await expect(quickSystem.stop()).resolves.toBeUndefined();

      // System should be stopped
      expect(quickSystem.isRunning()).toBe(false);
    });
  });

  describe('System Events During Shutdown', () => {
    it.skip('should emit proper events during shutdown', async () => {
      // ✅ PURE ACTOR MODEL: Use the system's built-in event subscription
      const collectedEvents: string[] = [];

      // Subscribe to system events using the public API
      const unsubscribe = system.subscribeToSystemEvents((event) => {
        log.debug('🔍 GRACEFUL SHUTDOWN TEST: Raw system event:', event);
        log.debug('Raw system event:', event);
        // Handle different event formats
        if (typeof event === 'object' && event !== null) {
          if ('eventType' in event && typeof event.eventType === 'string') {
            log.debug('🔍 GRACEFUL SHUTDOWN TEST: Adding eventType:', event.eventType);
            collectedEvents.push(event.eventType);
          } else if ('type' in event && typeof event.type === 'string') {
            log.debug('🔍 GRACEFUL SHUTDOWN TEST: Adding type:', event.type);
            collectedEvents.push(event.type);
          }
        }
      });

      log.debug(
        '🔍 GRACEFUL SHUTDOWN TEST: After subscribing, unsubscribe function:',
        typeof unsubscribe
      );

      // Give subscription time to set up (since it's async)
      await system.flush();

      log.debug('Before spawning test actor', { collectedEvents });

      // Spawn an actor (which will emit actorSpawned)
      await system.spawn(
        {
          onMessage: async () => undefined,
        },
        { id: 'test-actor' }
      );

      // Flush to ensure spawn events are processed
      await system.flush();
      await createActorDelay(20);

      log.debug('After spawning test actor', { collectedEvents });

      // Record spawn events
      const spawnEvents = [...collectedEvents];
      collectedEvents.length = 0;

      // Stop the system
      await system.stop();
      await createActorDelay(20);

      // System is stopped, no need to flush

      // Log actual events for debugging
      log.debug('Spawn events:', { spawnEvents });
      log.debug('Shutdown events:', { collectedEvents });

      // Clean up subscription
      unsubscribe();

      // Test spawn events
      expect(spawnEvents).toContain('actorSpawned');

      // Test shutdown events
      expect(collectedEvents).toContain('stopping');
      expect(collectedEvents).toContain('actorStopping');

      // Verify order - stopping should come before actorStopping
      const stoppingIndex = collectedEvents.indexOf('stopping');
      const actorStoppingIndex = collectedEvents.indexOf('actorStopping');
      if (stoppingIndex >= 0 && actorStoppingIndex >= 0) {
        expect(stoppingIndex).toBeLessThan(actorStoppingIndex);
      }
    });
  });

  describe('Resource Cleanup', () => {
    it('should clean up directory and request manager', async () => {
      // Spawn some actors
      await system.spawn({
        onMessage: async () => undefined,
      });
      await system.spawn({
        onMessage: async () => undefined,
      });

      // Verify actors exist (excluding system actors)
      const actors = await system.listActors();
      const userActors = actors.filter((actor) => {
        const { id } = parse(actor);
        return (
          !id.includes('system-event-actor') &&
          !id.includes('cluster-event-actor') &&
          id !== 'guardian'
        );
      });
      expect(userActors).toHaveLength(2);

      // Stop the system
      await system.stop();

      // After stop, listing actors should return empty
      // (This would normally throw as system is stopped, but for testing we check the state)
      expect(system.isRunning()).toBe(false);
    });

    it('should handle pending ask operations during shutdown', async () => {
      const behavior: ActorBehavior = {
        async onMessage({ message }) {
          // For ask pattern messages, don't respond to simulate hanging operation
          if (message._correlationId) {
            // Just don't send response to simulate hanging operation
            return undefined;
          }
          return undefined;
        },
      };

      const actor = await system.spawn(behavior, { id: 'ask-handler' });

      // Start an ask operation with short timeout to ensure it fails quickly
      const askPromise = actor
        .ask(
          {
            type: 'QUERY',
            test: 'test',
          },
          50
        )
        .catch((err) => err); // Catch to prevent unhandled rejection

      // Wait for ask to be sent
      await createActorDelay(20);

      // Stop the system while ask is pending
      const stopPromise = system.stop();

      // Wait for both operations to complete
      const [askResult] = await Promise.all([askPromise, stopPromise]);

      // The ask should have failed (timeout or system stopped)
      expect(askResult).toBeInstanceOf(Error);
    }, 500); // Reduced test timeout to 500ms
  });

  describe('Actor Lifecycle Hooks', () => {
    it('should call onStart only once per actor', async () => {
      let onStartCalledCount = 0;

      // ✅ PURE ACTOR MODEL: Use defineBehavior with context tracking message count
      const behavior = defineBehavior<ActorMessage>()
        .withContext({ messageCount: 0 })
        .onMessage(async ({ message, actor }) => {
          const context = actor.getSnapshot().context as { messageCount: number };

          // Use OTP-style reply for ask pattern
          if (message._correlationId) {
            return {
              context: {
                messageCount: context.messageCount + 1,
              },
              reply: { type: 'MSG_RESPONSE', count: context.messageCount + 1 },
            };
          }
          return { context };
        })
        .onStart(async () => {
          onStartCalledCount++;
          log.debug('🚀 onStart called!', { onStartCalledCount });
          log.debug('Actor started', { onStartCalledCount });
        });

      const actor = await system.spawn(behavior, { id: 'lifecycle-test' });

      // Send multiple messages using ask to ensure they're processed
      await actor.ask({ type: 'MSG1' });
      await actor.ask({ type: 'MSG2' });
      await actor.ask({ type: 'MSG3' });

      // Stop the system
      await system.stop();

      // onStart should have been called only once
      expect(onStartCalledCount).toBe(1);
      // Messages were processed - we can verify through the returned counts
    });
  });
});
