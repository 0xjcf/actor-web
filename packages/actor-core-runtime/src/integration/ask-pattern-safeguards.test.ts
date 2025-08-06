/**
 * @module actor-core/runtime/integration/ask-pattern-safeguards.test
 * @description Integration tests for ask pattern safeguards
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorSystem } from '../actor-system.js';
import { type ActorSystemImpl, createActorSystem } from '../actor-system-impl.js';
import { AskPatternTimeout } from '../ask-pattern-safeguards.js';
import { defineActor } from '../unified-actor-builder.js';

describe.skip('Ask Pattern Safeguards - Integration', () => {
  let system: ActorSystem;

  beforeEach(async () => {
    system = createActorSystem({ nodeAddress: 'test-system' });
    // Enable test mode for synchronous message processing
    (system as ActorSystemImpl).enableTestMode();
  });

  afterEach(async () => {
    await system.stop();
  });

  describe.skip('Timeout Behavior', () => {
    it('should timeout when actor does not reply', async () => {
      // Create an actor that doesn't return a reply
      const NoReplyActor = defineActor()
        .withContext({ count: 0 })
        .onMessage(({ message, actor }) => {
          const context = actor.getSnapshot().context;
          if (message.type === 'GET_COUNT') {
            // Missing reply field!
            return { context };
          }
          return { context };
        });

      const actor = await system.spawn(NoReplyActor, { id: 'no-reply-actor' });

      // Ask should timeout with helpful error
      await expect(actor.ask({ type: 'GET_COUNT' }, 1000)).rejects.toThrow(AskPatternTimeout);

      try {
        await actor.ask({ type: 'GET_COUNT' }, 1000);
      } catch (error) {
        expect(error).toBeInstanceOf(AskPatternTimeout);
        const askError = error as AskPatternTimeout;
        expect(askError.message).toContain('did not reply');
        expect(askError.message).toContain('GET_COUNT');
        expect(askError.message).toContain("'reply' field");
        expect(askError.actorPath).toContain('no-reply-actor');
        expect(askError.messageType).toBe('GET_COUNT');
        expect(askError.timeout).toBe(1000);
      }
    });

    it('should work correctly when actor returns reply', async () => {
      // Create an actor that returns a reply
      const ReplyActor = defineActor()
        .withContext({ count: 0 })
        .onMessage(({ message, actor }) => {
          const context = actor.getSnapshot().context;
          if (message.type === 'GET_COUNT') {
            return {
              context,
              reply: { count: context.count },
            };
          }
          if (message.type === 'INCREMENT') {
            return {
              context: { count: context.count + 1 },
            };
          }
          return { context };
        });

      const actor = await system.spawn(ReplyActor, { id: 'reply-actor' });

      // Ask should succeed
      const response = await actor.ask<{ count: number }>({ type: 'GET_COUNT' }, 5000);

      expect(response).toEqual({ count: 0 });

      // Increment
      await actor.send({ type: 'INCREMENT' });

      // Flush to ensure message is processed
      await (system as ActorSystemImpl).flush();

      // Ask again
      const response2 = await actor.ask<{ count: number }>({ type: 'GET_COUNT' }, 5000);

      expect(response2).toEqual({ count: 1 });
    });

    it('should show console warning in development mode', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Create an actor that doesn't return a reply
      const WarningActor = defineActor()
        .withContext({ data: 'test' })
        .onMessage(({ message, actor }) => {
          const context = actor.getSnapshot().context;
          if (message.type === 'FETCH_DATA') {
            // Missing reply field!
            return { context };
          }
          return { context };
        });

      const actor = await system.spawn(WarningActor, { id: 'warning-actor' });

      // Try to ask (will timeout)
      try {
        await actor.ask({ type: 'FETCH_DATA' }, 500);
      } catch {
        // Expected timeout
      }

      // Wait a bit for async console warning
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have shown warning
      expect(consoleWarnSpy).toHaveBeenCalled();
      const warning = consoleWarnSpy.mock.calls[0]?.[0] as string;
      expect(warning).toContain('ASK PATTERN WARNING');
      expect(warning).toContain('FETCH_DATA');
      expect(warning).toContain("'reply' field");

      consoleWarnSpy.mockRestore();
    });

    it('should work with any message type', async () => {
      // Test with various message types, not just GET_*
      const CustomActor = defineActor()
        .withContext({ users: ['Alice', 'Bob'] })
        .onMessage(({ message, actor }) => {
          const context = actor.getSnapshot().context;
          switch (message.type) {
            case 'FETCH_USERS':
              return {
                context,
                reply: { users: context.users },
              };
            case 'QUERY_USER_COUNT':
              return {
                context,
                reply: { count: context.users.length },
              };
            case 'RETRIEVE_FIRST_USER':
              return {
                context,
                reply: { user: context.users[0] },
              };
            default:
              return { context };
          }
        });

      const actor = await system.spawn(CustomActor, { id: 'custom-actor' });

      // All these should work
      const users = await actor.ask<{ users: string[] }>({ type: 'FETCH_USERS' });
      expect(users).toEqual({ users: ['Alice', 'Bob'] });

      const count = await actor.ask<{ count: number }>({
        type: 'QUERY_USER_COUNT',
      });
      expect(count).toEqual({ count: 2 });

      const firstUser = await actor.ask<{ user: string }>({
        type: 'RETRIEVE_FIRST_USER',
      });
      expect(firstUser).toEqual({ user: 'Alice' });
    });

    it('should handle custom timeout values', async () => {
      // Test timeout behavior without actual delays
      const TestActor = defineActor()
        .withContext({ requestCount: 0 })
        .onMessage(({ message, actor }) => {
          const context = actor.getSnapshot().context;

          // Don't reply to TIMEOUT_TEST messages
          if (message.type === 'TIMEOUT_TEST') {
            return {
              context: { requestCount: context.requestCount + 1 },
            };
          }

          // Reply immediately to FAST_OPERATION
          if (message.type === 'FAST_OPERATION') {
            return {
              context: { requestCount: context.requestCount + 1 },
              reply: { result: 'fast', count: context.requestCount + 1 },
            };
          }

          return { context };
        });

      const actor = await system.spawn(TestActor, { id: 'test-timeout-actor' });

      // Should timeout with any timeout value when actor doesn't reply
      await expect(actor.ask({ type: 'TIMEOUT_TEST' }, 100)).rejects.toThrow(AskPatternTimeout);

      // Try different timeout values - all should timeout
      await expect(actor.ask({ type: 'TIMEOUT_TEST' }, 500)).rejects.toThrow(AskPatternTimeout);
      await expect(actor.ask({ type: 'TIMEOUT_TEST' }, 1000)).rejects.toThrow(AskPatternTimeout);

      // Should succeed immediately when actor replies
      const result1 = await actor.ask<{ result: string; count: number }>(
        { type: 'FAST_OPERATION' },
        100
      );
      expect(result1).toEqual({ result: 'fast', count: 4 });

      // Even with a long timeout, it succeeds immediately
      const result2 = await actor.ask<{ result: string; count: number }>(
        { type: 'FAST_OPERATION' },
        5000
      );
      expect(result2).toEqual({ result: 'fast', count: 5 });
    });
  });
});
