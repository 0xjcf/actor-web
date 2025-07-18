/**
 * @module actor-core/runtime/tests/ask-pattern.test
 * @description Tests for ask pattern implementation in the pure actor runtime
 *
 * These tests verify that actors can handle request-response patterns
 * with proper timeout handling and correlation ID management.
 * This is critical for components that need to query actor state.
 *
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emit, setup } from 'xstate';
import { createActorRef } from '../create-actor-ref.js';
import { Logger } from '../logger.js';

// ✅ CORRECT: Test machine designed to work with the framework's ask pattern
// This machine demonstrates proper handling of request-response patterns
const testActorMachine = setup({
  types: {
    context: {} as { lastRequest?: string },
    events: {} as
      | { type: 'REQUEST_STATUS'; requestId: string }
      | { type: 'REQUEST_INFO'; requestId: string; details: string }
      | { type: 'UNKNOWN_REQUEST'; requestId: string },
    emitted: {} as
      | { type: 'REQUEST_RESPONSE'; requestId: string; response: unknown }
      | { type: 'OTHER_EVENT'; data: string },
  },
  actions: {
    // ✅ CORRECT: Use emit() to send response events that framework will capture
    emitStatusResponse: emit(({ event }) => {
      const log = Logger.namespace('TEST_ACTOR');
      log.debug('Emitting status response', { requestId: (event as any).requestId });

      return {
        type: 'REQUEST_RESPONSE' as const,
        requestId: (event as { requestId: string }).requestId,
        response: {
          status: 'running',
          version: '1.0.0',
          uptime: 12345,
        },
      };
    }),
    emitInfoResponse: emit(({ event }) => {
      const log = Logger.namespace('TEST_ACTOR');
      log.debug('Emitting info response', { requestId: (event as any).requestId });

      return {
        type: 'REQUEST_RESPONSE' as const,
        requestId: (event as { requestId: string }).requestId,
        response: {
          info: 'Actor information',
          details: (event as { details: string }).details,
        },
      };
    }),
    emitOtherEvent: emit(() => {
      const log = Logger.namespace('TEST_ACTOR');
      log.debug('Emitting other event (no response)');

      return {
        type: 'OTHER_EVENT' as const,
        data: 'Some other event data',
      };
    }),
  },
}).createMachine({
  id: 'test-actor',
  initial: 'idle',
  context: {
    lastRequest: undefined,
  },
  states: {
    idle: {
      on: {
        REQUEST_STATUS: {
          actions: ['emitStatusResponse'],
        },
        REQUEST_INFO: {
          actions: ['emitInfoResponse'],
        },
        UNKNOWN_REQUEST: {
          // Don't emit any response for unknown requests - this tests timeout behavior
          actions: ['emitOtherEvent'],
        },
      },
    },
  },
});

describe('Ask Pattern - Pure Actor Runtime', () => {
  let actor: ReturnType<typeof createActorRef>;
  let testActors: Array<ReturnType<typeof createActorRef>> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    testActors = [];
  });

  afterEach(async () => {
    // ✅ CORRECT: Proper cleanup prevents memory leaks
    await Promise.all(testActors.map((actor) => actor.stop()));
    testActors = [];
  });

  // ✅ CORRECT: Test name describes expected behavior
  it('should handle status queries using framework API', async () => {
    // Arrange
    actor = createActorRef(testActorMachine, { id: 'test-actor-1' });
    testActors.push(actor);
    actor.start();

    // Act - Use ask pattern with type field for proper request extraction
    const response = await actor.ask({ type: 'REQUEST_STATUS' });

    // Assert - ask() returns the result value directly
    expect(response).toEqual({
      status: 'running',
      version: '1.0.0',
      uptime: 12345,
    });
  });

  it('should handle info queries with additional parameters', async () => {
    // Arrange
    actor = createActorRef(testActorMachine, { id: 'test-actor-2' });
    testActors.push(actor);
    actor.start();

    // Act - Use ask pattern with parameters
    const response = await actor.ask({
      type: 'REQUEST_INFO',
      details: 'Custom details',
    });

    // Assert
    expect(response).toEqual({
      info: 'Actor information',
      details: 'Custom details',
    });
  });

  it('should timeout when no response is received', async () => {
    // Arrange
    actor = createActorRef(testActorMachine, {
      id: 'test-actor-3',
      askTimeout: 100, // Short timeout for testing
    });
    testActors.push(actor);
    actor.start();

    // Act & Assert - Request that won't get a response should timeout
    await expect(actor.ask({ type: 'UNKNOWN_REQUEST' })).rejects.toThrow(
      'ask timed out after 100ms'
    );
  });

  it('should handle multiple concurrent queries with correlation IDs', async () => {
    // Arrange
    actor = createActorRef(testActorMachine, { id: 'test-actor-4' });
    testActors.push(actor);
    actor.start();

    // Act - Multiple concurrent asks should work with proper correlation
    const queries = Promise.all([
      actor.ask({ type: 'REQUEST_STATUS' }),
      actor.ask({ type: 'REQUEST_INFO', details: 'Request 2' }),
      actor.ask({ type: 'REQUEST_STATUS' }),
    ]);

    const [response1, response2, response3] = await queries;

    // Assert - Each query should get the correct response
    expect(response1).toEqual({
      status: 'running',
      version: '1.0.0',
      uptime: 12345,
    });

    expect(response2).toEqual({
      info: 'Actor information',
      details: 'Request 2',
    });

    expect(response3).toEqual({
      status: 'running',
      version: '1.0.0',
      uptime: 12345,
    });
  });

  it('should reject queries when actor is not running', async () => {
    // Arrange - ✅ IMPORTANT: Disable autoStart for lifecycle tests
    actor = createActorRef(testActorMachine, {
      id: 'test-actor-5',
      autoStart: false,
    });
    testActors.push(actor);

    // Act & Assert - Actor should throw when not running
    await expect(actor.ask({ type: 'REQUEST_STATUS' })).rejects.toThrow(
      'Cannot ask query on stopped actor'
    );
  });

  it('should cleanup pending requests when actor stops', async () => {
    // Arrange
    actor = createActorRef(testActorMachine, {
      id: 'test-actor-6',
      askTimeout: 5000, // Long timeout
    });
    testActors.push(actor);
    actor.start();

    // Act - Send a request that won't complete immediately
    const askPromise = actor.ask({ type: 'UNKNOWN_REQUEST' });

    // Stop the actor
    await actor.stop();

    // Assert - The promise should reject due to cleanup
    await expect(askPromise).rejects.toThrow();
  });
});
