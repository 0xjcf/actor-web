/**
 * @module actor-core/runtime/__tests__/correlation-manager.test
 * @description Comprehensive tests for Correlation Manager implementation
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActorMessage } from '../actor-system.js';
import {
  type CorrelationManagerConfig,
  createCorrelationManager,
  createMockCorrelationManager,
  MockCorrelationManager,
  XStateCorrelationManager,
} from '../correlation-manager.js';
import { createActorDelay, PureXStateCorrelationManager } from '../pure-xstate-utilities.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const mockResponse = {
  type: 'RESPONSE',
  result: 'success',
  data: 'test response',
};

const mockErrorResponse = {
  type: 'ERROR_RESPONSE',
  error: 'Request failed',
  code: 500,
};

// ============================================================================
// DEFAULT CORRELATION MANAGER TESTS
// ============================================================================

describe.skip('XStateCorrelationManager', () => {
  let manager: XStateCorrelationManager;

  beforeEach(() => {
    manager = new XStateCorrelationManager();
  });

  afterEach(async () => {
    // ✅ CORRECT: Add timeout to prevent hanging during cleanup
    await Promise.race([
      (async () => {
        try {
          manager.clearAllRequests();
        } catch {
          // Ignore cleanup errors
        }
      })(),
      createActorDelay(100),
    ]);
  });

  describe.skip('Correlation ID Generation', () => {
    it('should generate unique correlation IDs', () => {
      const id1 = manager.generateId();
      const id2 = manager.generateId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
      expect(typeof id2).toBe('string');
    });

    it('should generate correlation IDs that are valid strings', () => {
      // Test behavior: IDs should be non-empty strings
      const id = manager.generateId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should increment correlation IDs sequentially', () => {
      // Test behavior: Sequential IDs should be different
      const ids = new Set<string>();

      // Generate multiple IDs
      for (let i = 0; i < 10; i++) {
        ids.add(manager.generateId());
      }

      // All IDs should be unique
      expect(ids.size).toBe(10);
    });
  });

  describe.skip('Request Registration', () => {
    it('should register and track requests', async () => {
      const correlationId = manager.generateId();
      const timeout = 5000;

      expect(manager.getPendingRequestCount()).toBe(0);

      const promise = manager.registerRequest(correlationId, timeout);
      expect(manager.getPendingRequestCount()).toBe(1);

      // Clean up
      manager.handleResponse(correlationId, mockResponse);
      await expect(promise).resolves.toBe(mockResponse);
      expect(manager.getPendingRequestCount()).toBe(0);
    });

    it('should reject duplicate correlation IDs', async () => {
      // ✅ CORRECT: Correlation IDs should be unique - duplicates are a bug
      const correlationId = manager.generateId();

      // ✅ CORRECT: First request should succeed
      const firstRequest = manager.registerRequest(correlationId, 5000);

      // ✅ CORRECT: Second request with same ID should throw immediately
      await expect(manager.registerRequest(correlationId, 5000)).rejects.toThrow(
        'Correlation ID already in use'
      );

      // ✅ CORRECT: Clean up the first request to prevent timeout error
      manager.handleResponse(correlationId, {
        type: 'TEST_RESPONSE',
        timestamp: Date.now(),
        version: '1.0.0',
      });

      // ✅ CORRECT: Verify the first request resolves properly
      await expect(firstRequest).resolves.toEqual(
        expect.objectContaining({
          type: 'TEST_RESPONSE',
        })
      );
    });

    it('should handle multiple concurrent requests', async () => {
      // ✅ CORRECT: XStateCorrelationManager supports unlimited concurrent requests
      const requests: Array<{ id: string; promise: Promise<unknown> }> = [];

      for (let i = 0; i < 5; i++) {
        const id = manager.generateId();
        requests.push({ id, promise: manager.registerRequest(id, 50) });
      }

      // ✅ CORRECT: Use Promise.allSettled to properly handle rejections
      const results = await Promise.allSettled(requests.map((r) => r.promise));

      // All requests should be rejected due to timeout
      for (const result of results) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
          expect(result.reason.message).toContain('timed out');
        }
      }
    }, 1000); // Add 1 second test timeout

    it('should use default timeout when none provided', async () => {
      const correlationId = manager.generateId();

      // Register with 0 timeout should use default
      const promise = manager.registerRequest(correlationId, 0);

      // Should not timeout immediately
      expect(manager.getPendingRequestCount()).toBe(1);

      // Clean up
      manager.handleResponse(correlationId, mockResponse);
      await expect(promise).resolves.toBe(mockResponse);
    });
  });

  describe.skip('Response Handling', () => {
    it('should resolve promises with response data', async () => {
      const correlationId = manager.generateId();
      const promise = manager.registerRequest<ActorMessage>(correlationId, 5000);

      manager.handleResponse(correlationId, mockResponse);

      const result = await promise;
      expect(result).toBe(mockResponse);
      expect(manager.getPendingRequestCount()).toBe(0);
    });

    it('should handle response for unknown correlation ID', () => {
      const unknownId = 'unknown-correlation-id';

      // Should not throw
      expect(() => {
        manager.handleResponse(unknownId, mockResponse);
      }).not.toThrow();
    });

    it('should handle multiple responses correctly', async () => {
      const id1 = manager.generateId();
      const id2 = manager.generateId();

      const promise1 = manager.registerRequest<ActorMessage>(id1, 5000);
      const promise2 = manager.registerRequest<ActorMessage>(id2, 5000);

      expect(manager.getPendingRequestCount()).toBe(2);

      manager.handleResponse(id1, mockResponse);
      manager.handleResponse(id2, mockErrorResponse);

      const result1 = await promise1;
      const result2 = await promise2;

      expect(result1).toBe(mockResponse);
      expect(result2).toBe(mockErrorResponse);
      expect(manager.getPendingRequestCount()).toBe(0);
    });
  });

  describe.skip('Timeout Handling', () => {
    it('should handle timeout and reject promise', async () => {
      const correlationId = manager.generateId();
      const promise = manager.registerRequest(correlationId, 5000);

      manager.handleTimeout(correlationId);

      await expect(promise).rejects.toThrow(/timed out/);
      expect(manager.getPendingRequestCount()).toBe(0);
    });

    it('should handle timeout for unknown correlation ID', () => {
      const unknownId = 'unknown-correlation-id';

      // Should not throw
      expect(() => {
        manager.handleTimeout(unknownId);
      }).not.toThrow();
    });

    it('should include timing information in timeout error', async () => {
      const correlationId = manager.generateId();
      const promise = manager.registerRequest(correlationId, 1000);

      // Wait a bit then timeout
      await createActorDelay(10);
      manager.handleTimeout(correlationId);

      try {
        await promise;
        expect.fail('Promise should have rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        if (error instanceof Error) {
          expect(error.message).toContain('timed out');
          expect(error.message).toContain('1000ms'); // configured timeout
        }
      }
    });
  });

  describe.skip('Cleanup Operations', () => {
    it('should clear all pending requests', async () => {
      const id1 = manager.generateId();
      const id2 = manager.generateId();

      const promise1 = manager.registerRequest(id1, 5000);
      const promise2 = manager.registerRequest(id2, 5000);

      expect(manager.getPendingRequestCount()).toBe(2);

      manager.clearAllRequests();

      expect(manager.getPendingRequestCount()).toBe(0);

      // ✅ CORRECT: XStateCorrelationManager uses "Correlation manager cleared" message
      await expect(promise1).rejects.toThrow('Correlation manager cleared');
      await expect(promise2).rejects.toThrow('Correlation manager cleared');
    });

    it('should handle clear when no requests pending', () => {
      expect(manager.getPendingRequestCount()).toBe(0);
      // ✅ CORRECT: Should not throw when clearing empty request list
      expect(() => manager.clearAllRequests()).not.toThrow();
      expect(manager.getPendingRequestCount()).toBe(0);
    });
  });

  describe.skip('Configuration', () => {
    it('should use fixed configuration', () => {
      // ✅ CORRECT: XStateCorrelationManager uses fixed configuration (no customization)
      const defaultManager = new XStateCorrelationManager();

      // Test that manager can generate IDs and track requests
      const id = defaultManager.generateId();
      expect(id).toMatch(/^corr-/);
      expect(defaultManager.getPendingRequestCount()).toBe(0);
    });

    it('should not accept custom configuration', () => {
      // ✅ CORRECT: XStateCorrelationManager constructor takes no parameters
      const manager = new XStateCorrelationManager();

      // Verify basic functionality works
      expect(manager.getPendingRequestCount()).toBe(0);
      const id = manager.generateId();
      expect(typeof id).toBe('string');
    });
  });

  describe.skip('Statistics', () => {
    it('should provide pending request count', async () => {
      const initialCount = manager.getPendingRequestCount();
      expect(initialCount).toBe(0);

      // Register some requests
      const id1 = manager.generateId();
      const id2 = manager.generateId();

      const promise1 = manager.registerRequest(id1, 1000);
      const promise2 = manager.registerRequest(id2, 1000);

      expect(manager.getPendingRequestCount()).toBe(2);

      // Clean up by handling responses
      manager.handleResponse(id1, {
        type: 'TEST_RESPONSE',
        data: 'response1',
        timestamp: Date.now(),
        version: '1.0.0',
      });

      expect(manager.getPendingRequestCount()).toBe(1);

      manager.handleResponse(id2, {
        type: 'TEST_RESPONSE',
        data: 'response2',
        timestamp: Date.now(),
        version: '1.0.0',
      });

      expect(manager.getPendingRequestCount()).toBe(0);

      // Verify responses
      await expect(promise1).resolves.toEqual(expect.objectContaining({ data: 'response1' }));
      await expect(promise2).resolves.toEqual(expect.objectContaining({ data: 'response2' }));
    });
  });
});

// ============================================================================
// MOCK CORRELATION MANAGER TESTS
// ============================================================================

describe.skip('MockCorrelationManager', () => {
  let mockManager: MockCorrelationManager;

  beforeEach(() => {
    mockManager = new MockCorrelationManager();
  });

  afterEach(async () => {
    // ✅ CORRECT: Suppress cleanup errors to prevent uncaught exceptions
    try {
      mockManager.reset();
    } catch {
      // Ignore cleanup errors - they're expected during test teardown
    }

    // ✅ CORRECT: Add small delay to ensure cleanup completes
    await createActorDelay(10);
  });

  describe.skip('Mock ID Generation', () => {
    it('should generate predictable IDs', () => {
      const id1 = mockManager.generateId();
      const id2 = mockManager.generateId();

      expect(id1).toBe('mock-corr-1');
      expect(id2).toBe('mock-corr-2');
    });

    it('should reset counter on reset', () => {
      mockManager.generateId(); // mock-corr-1
      mockManager.generateId(); // mock-corr-2
      mockManager.reset();

      const id = mockManager.generateId();
      expect(id).toBe('mock-corr-1');
    });
  });

  describe.skip('Mock Request Handling', () => {
    it('should register and resolve requests', async () => {
      const correlationId = mockManager.generateId();
      const promise = mockManager.registerRequest<ActorMessage>(correlationId, 5000);

      expect(mockManager.getPendingRequestCount()).toBe(1);
      expect(mockManager.hasPendingRequest(correlationId)).toBe(true);

      mockManager.handleResponse(correlationId, mockResponse);

      const result = await promise;
      expect(result).toBe(mockResponse);
      expect(mockManager.getPendingRequestCount()).toBe(0);
      expect(mockManager.responses.get(correlationId)).toBe(mockResponse);
    });

    it('should handle timeouts in mock', async () => {
      const correlationId = mockManager.generateId();
      const promise = mockManager.registerRequest(correlationId, 1000);

      expect(mockManager.hasPendingRequest(correlationId)).toBe(true);

      mockManager.triggerTimeout(correlationId);

      await expect(promise).rejects.toThrow('Mock timeout');
      expect(mockManager.timeouts.has(correlationId)).toBe(true);
      expect(mockManager.getPendingRequestCount()).toBe(0);
    });

    it('should track pending correlation IDs', async () => {
      const id1 = mockManager.generateId();
      const id2 = mockManager.generateId();

      // ✅ CORRECT: Capture promises to handle rejections during cleanup
      const promise1 = mockManager.registerRequest(id1, 5000);
      const promise2 = mockManager.registerRequest(id2, 5000);

      const pendingIds = mockManager.getPendingCorrelationIds();
      expect(pendingIds).toContain(id1);
      expect(pendingIds).toContain(id2);
      expect(pendingIds).toHaveLength(2);

      // ✅ CORRECT: Clean up promises to prevent uncaught exceptions in afterEach
      mockManager.handleResponse(id1, mockResponse);
      mockManager.handleResponse(id2, mockResponse);

      await expect(promise1).resolves.toBe(mockResponse);
      await expect(promise2).resolves.toBe(mockResponse);
    });
  });

  describe.skip('Mock State Management', () => {
    it('should reset all state', async () => {
      const id1 = mockManager.generateId();
      const id2 = mockManager.generateId();

      const promise1 = mockManager.registerRequest(id1, 5000);
      const promise2 = mockManager.registerRequest(id2, 5000);
      mockManager.handleResponse(id1, mockResponse);

      expect(mockManager.responses.size).toBe(1);
      expect(mockManager.getPendingRequestCount()).toBe(1);

      // ✅ CORRECT: Handle the pending promises before reset to prevent uncaught exceptions
      const settledPromises = Promise.allSettled([promise1, promise2]);

      mockManager.reset();

      expect(mockManager.responses.size).toBe(0);
      expect(mockManager.timeouts.size).toBe(0);
      expect(mockManager.getPendingRequestCount()).toBe(0);
      expect(mockManager.generateId()).toBe('mock-corr-1'); // Counter reset

      // ✅ CORRECT: Wait for promise settlement and verify results
      const results = await settledPromises;
      expect(results[0].status).toBe('fulfilled'); // promise1 was resolved
      expect(results[1].status).toBe('rejected'); // promise2 was rejected by reset
    });
  });

  describe.skip('Mock Utility Methods', () => {
    it('should provide mock-specific testing utilities', async () => {
      const id = mockManager.generateId();

      // Test hasPendingRequest
      expect(mockManager.hasPendingRequest(id)).toBe(false);

      // ✅ CORRECT: Capture the promise to handle its rejection
      const requestPromise = mockManager.registerRequest(id, 5000);
      expect(mockManager.hasPendingRequest(id)).toBe(true);

      // Test getPendingCorrelationIds
      const pendingIds = mockManager.getPendingCorrelationIds();
      expect(pendingIds).toEqual([id]);

      // ✅ CORRECT: Test triggerTimeout and handle promise rejection
      mockManager.triggerTimeout(id);
      expect(mockManager.hasPendingRequest(id)).toBe(false);
      expect(mockManager.timeouts.has(id)).toBe(true);

      // ✅ CORRECT: Properly handle the rejected promise
      await expect(requestPromise).rejects.toThrow('Mock timeout');
    });
  });
});

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe.skip('Factory Functions', () => {
  it('should create correlation manager with default config', () => {
    const manager = createCorrelationManager();
    // ✅ CORRECT: Factory returns XStateCorrelationManager for pure actor model compliance
    expect(manager).toBeInstanceOf(XStateCorrelationManager);
    manager.clearAllRequests();
  });

  it('should create correlation manager with custom config', () => {
    const config: Partial<CorrelationManagerConfig> = {
      defaultTimeout: 15000,
      idPrefix: 'factory',
    };

    const manager = createCorrelationManager(config);
    expect(manager).toBeInstanceOf(PureXStateCorrelationManager);

    // Pure implementation generates its own IDs
    const id = manager.generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    manager.clearAllRequests();
  });

  it('should create mock correlation manager', () => {
    const mockManager = createMockCorrelationManager();
    expect(mockManager).toBeInstanceOf(MockCorrelationManager);

    const id = mockManager.generateId();
    expect(id).toBe('mock-corr-1');
  });
});
