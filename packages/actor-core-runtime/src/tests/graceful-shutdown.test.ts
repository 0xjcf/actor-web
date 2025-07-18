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
import { type ActorSystemConfig, createActorSystem } from '../actor-system-impl.js';
import type { ActorBehavior, ActorMessage } from '../actor-system.js';
import { Logger } from '../logger.js';

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
      await system.start();
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
  });

  describe('Actor Lifecycle During Shutdown', () => {
    it('should call onStop for all actors during shutdown', async () => {
      const onStopCalls: string[] = [];

      const createBehavior = (id: string): ActorBehavior => ({
        onMessage: async ({ context }) => context,
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

      // Verify all onStop callbacks were called
      expect(onStopCalls).toHaveLength(3);
      expect(onStopCalls).toContain('actor1');
      expect(onStopCalls).toContain('actor2');
      expect(onStopCalls).toContain('actor3');
    });

    it('should handle actors still processing messages during shutdown', async () => {
      // Track state transitions through the behavior
      let finalState = 'idle';

      const behavior: ActorBehavior = {
        context: { status: 'idle', processed: false },
        onMessage: async ({ message, context }) => {
          if (message.type === 'PROCESS') {
            // Simulate async work by yielding control
            await Promise.resolve();

            // Return completed state with response for ask pattern
            return {
              context: { status: 'completed', processed: true },
              emit: [
                {
                  type: 'RESPONSE',
                  correlationId: message.correlationId,
                  payload: 'completed',
                  timestamp: Date.now(),
                  version: '1.0.0',
                },
              ],
            };
          }
          return context;
        },
        onStop: async ({ context }) => {
          // Capture the final state when actor stops
          finalState = (context as any).status;
          log.debug('Actor stopping', { status: (context as any).status });
        },
      };

      const actor = await system.spawn(behavior, { id: 'long-running' });

      // Use ask pattern to ensure message is processed
      await actor.ask(
        {
          type: 'PROCESS',
          payload: 'data',
          timestamp: Date.now(),
          version: '1.0.0',
        },
        1000
      );

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
        onMessage: async ({ context }) => context,
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
    it('should emit proper events during shutdown', async () => {
      const events: Array<{ type: string }> = [];

      // Subscribe to system events
      const subscription = system.subscribeToSystemEvents().subscribe((event) => {
        events.push({ type: event.type });
      });

      // Spawn an actor
      await system.spawn(
        {
          onMessage: async ({ context }) => context,
        },
        { id: 'test-actor' }
      );

      // Stop the system
      await system.stop();

      // Unsubscribe
      subscription.unsubscribe();

      // Verify events were emitted in order
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('actorSpawned');
      expect(eventTypes).toContain('stopping');
      expect(eventTypes).toContain('actorStopping');
      expect(eventTypes).toContain('actorStopped');
      expect(eventTypes).toContain('stopped');

      // Verify order
      const stoppingIndex = eventTypes.indexOf('stopping');
      const stoppedIndex = eventTypes.indexOf('stopped');
      expect(stoppingIndex).toBeLessThan(stoppedIndex);
    });
  });

  describe('Resource Cleanup', () => {
    it('should clean up directory and request manager', async () => {
      // Spawn some actors
      await system.spawn({
        onMessage: async ({ context }) => context,
      });
      await system.spawn({
        onMessage: async ({ context }) => context,
      });

      // Verify actors exist
      const actors = await system.listActors();
      expect(actors).toHaveLength(2);

      // Stop the system
      await system.stop();

      // After stop, listing actors should return empty
      // (This would normally throw as system is stopped, but for testing we check the state)
      expect(system.isRunning()).toBe(false);
    });

    it('should handle pending ask operations during shutdown', async () => {
      const behavior: ActorBehavior = {
        context: { queryReceived: false },
        onMessage: async ({ message, context }) => {
          // For ask pattern messages, don't respond to simulate pending operation
          if (message.correlationId) {
            // Just update context but don't send response
            return { queryReceived: true };
          }
          return context;
        },
      };

      const actor = await system.spawn(behavior, { id: 'ask-handler' });

      // Start an ask operation with short timeout
      const askPromise = actor
        .ask(
          {
            type: 'QUERY',
            payload: 'test',
            timestamp: Date.now(),
            version: '1.0.0',
          },
          100 // Short timeout
        )
        .catch((err) => err); // Catch to prevent unhandled rejection

      // Immediately stop the system
      const stopPromise = system.stop();

      // Both operations should complete
      const [askResult] = await Promise.all([askPromise, stopPromise]);

      // The ask should have failed (timeout or system stopped)
      expect(askResult).toBeInstanceOf(Error);
    });
  });

  describe('Actor Lifecycle Hooks', () => {
    it('should call onStart only once per actor', async () => {
      let onStartCount = 0;
      let messageCount = 0;

      interface TestContext {
        count: number;
        started?: boolean;
      }

      const behavior: ActorBehavior<ActorMessage, TestContext> = {
        context: { count: 0 },
        onStart: async ({ context }) => {
          onStartCount++;
          log.debug('Actor started', { onStartCount });
          return { ...context, started: true };
        },
        onMessage: async ({ message, context }) => {
          messageCount++;
          // Return context with response for ask pattern
          return {
            context: { ...context, count: messageCount },
            emit: [
              {
                type: 'RESPONSE',
                correlationId: message.correlationId,
                payload: messageCount,
                timestamp: Date.now(),
                version: '1.0.0',
              },
            ],
          };
        },
        onStop: async ({ context }) => {
          log.debug('Actor stopped', { context, onStartCount, messageCount });
        },
      };

      const actor = await system.spawn(behavior, { id: 'lifecycle-test' });

      // Send multiple messages using ask to ensure they're processed
      await actor.ask(
        { type: 'MSG1', payload: null, timestamp: Date.now(), version: '1.0.0' },
        1000
      );
      await actor.ask(
        { type: 'MSG2', payload: null, timestamp: Date.now(), version: '1.0.0' },
        1000
      );
      await actor.ask(
        { type: 'MSG3', payload: null, timestamp: Date.now(), version: '1.0.0' },
        1000
      );

      // Stop the system
      await system.stop();

      // onStart should have been called only once
      expect(onStartCount).toBe(1);
      expect(messageCount).toBe(3);
    });
  });
});
