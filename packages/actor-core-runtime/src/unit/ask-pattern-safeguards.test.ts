/**
 * @module actor-core/runtime/unit/ask-pattern-safeguards.test
 * @description Unit tests for ask pattern safeguards
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AskPatternTimeout,
  createAskTimeout,
  DEFAULT_ASK_CONFIG,
  isDevelopmentMode,
  updateAskConfig,
  validateAskResponse,
} from '../ask-pattern-safeguards.js';

describe.skip('Ask Pattern Safeguards', () => {
  beforeEach(() => {
    // Reset config to defaults
    updateAskConfig({
      defaultTimeout: 5000,
      enableDevWarnings: isDevelopmentMode(),
    });
    // Clear console mocks
    vi.clearAllMocks();
  });

  describe.skip('AskPatternTimeout', () => {
    it('should create error with helpful debugging info', () => {
      const error = new AskPatternTimeout('/test/actor', 'GET_DATA', 5000, 'test-correlation-123');

      expect(error.name).toBe('AskPatternTimeout');
      expect(error.actorPath).toBe('/test/actor');
      expect(error.messageType).toBe('GET_DATA');
      expect(error.timeout).toBe(5000);
      expect(error.correlationId).toBe('test-correlation-123');
      expect(error.message).toContain('Ask pattern timeout after 5000ms');
      expect(error.message).toContain('/test/actor');
      expect(error.message).toContain('GET_DATA');
      expect(error.message).toContain('reply');
    });
  });

  describe.skip('validateAskResponse', () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('should not validate when correlationId is undefined', () => {
      validateAskResponse({ context: {} }, '/test/actor', 'REGULAR_MESSAGE', undefined);

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should not warn when reply field is present', () => {
      validateAskResponse(
        { context: {}, reply: { data: 'test' } },
        '/test/actor',
        'GET_DATA',
        'correlation-123'
      );

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should warn when reply field is missing for ask request', () => {
      updateAskConfig({ enableDevWarnings: true });

      validateAskResponse({ context: {} }, '/test/actor', 'GET_DATA', 'correlation-123');

      expect(consoleWarnSpy).toHaveBeenCalledOnce();
      const warning = consoleWarnSpy.mock.calls[0][0] as string;
      expect(warning).toContain('ASK PATTERN WARNING');
      expect(warning).toContain('/test/actor');
      expect(warning).toContain('GET_DATA');
      expect(warning).toContain('correlation-123');
      expect(warning).toContain('return { context, reply:');
    });

    it('should not show console warning when dev warnings disabled', () => {
      updateAskConfig({ enableDevWarnings: false });

      validateAskResponse({ context: {} }, '/test/actor', 'GET_DATA', 'correlation-123');

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should work with any message type, not just GET_*', () => {
      updateAskConfig({ enableDevWarnings: true });

      // Test with non-GET message types
      validateAskResponse({ context: {} }, '/test/actor', 'FETCH_USER', 'correlation-123');

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleWarnSpy.mock.calls[0][0]).toContain('FETCH_USER');

      consoleWarnSpy.mockClear();

      validateAskResponse({ context: {} }, '/test/actor', 'QUERY_DATABASE', 'correlation-456');

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleWarnSpy.mock.calls[0][0]).toContain('QUERY_DATABASE');
    });
  });

  describe.skip('createAskTimeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should create timeout promise that rejects after specified time', async () => {
      const { promise } = createAskTimeout('/test/actor', 'GET_DATA', 'correlation-123', 1000);

      // Advance time but not enough to trigger timeout
      vi.advanceTimersByTime(500);

      // Promise should still be pending
      const racedResult = await Promise.race([
        promise.catch(() => 'rejected'),
        Promise.resolve('still-pending'),
      ]);
      expect(racedResult).toBe('still-pending');

      // Advance past timeout
      vi.advanceTimersByTime(600);

      // Now it should reject
      await expect(promise).rejects.toThrow(AskPatternTimeout);
      await expect(promise).rejects.toThrow('Ask pattern timeout after 1000ms');
    });

    it('should use default timeout when not specified', () => {
      updateAskConfig({ defaultTimeout: 3000 });

      const { promise } = createAskTimeout('/test/actor', 'GET_DATA', 'correlation-123');

      vi.advanceTimersByTime(2999);
      let rejected = false;
      promise.catch(() => {
        rejected = true;
      });

      vi.runAllTimers();
      expect(rejected).toBe(false);

      vi.advanceTimersByTime(2);
      vi.runAllTimers();

      expect(promise).rejects.toThrow('Ask pattern timeout after 3000ms');
    });

    it('should cancel timeout when cancel is called', async () => {
      const { promise, cancel } = createAskTimeout(
        '/test/actor',
        'GET_DATA',
        'correlation-123',
        1000
      );

      // Cancel before timeout
      cancel();

      // Advance past timeout
      vi.advanceTimersByTime(2000);
      await vi.runAllTimersAsync();

      // Promise should still be pending (not rejected)
      let rejected = false;
      let resolved = false;

      promise
        .then(() => {
          resolved = true;
        })
        .catch(() => {
          rejected = true;
        });

      await vi.runAllTimersAsync();

      expect(rejected).toBe(false);
      expect(resolved).toBe(false);
    });

    it('should include all details in timeout error', async () => {
      const { promise } = createAskTimeout(
        '/test/complex/actor',
        'COMPLEX_QUERY',
        'complex-correlation-789',
        2500
      );

      vi.advanceTimersByTime(2600);

      try {
        await promise;
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AskPatternTimeout);
        const timeoutError = error as AskPatternTimeout;
        expect(timeoutError.actorPath).toBe('/test/complex/actor');
        expect(timeoutError.messageType).toBe('COMPLEX_QUERY');
        expect(timeoutError.correlationId).toBe('complex-correlation-789');
        expect(timeoutError.timeout).toBe(2500);
      }
    });
  });

  describe.skip('updateAskConfig', () => {
    it('should update configuration partially', () => {
      expect(DEFAULT_ASK_CONFIG.defaultTimeout).toBe(5000);

      updateAskConfig({ defaultTimeout: 10000 });
      expect(DEFAULT_ASK_CONFIG.defaultTimeout).toBe(10000);
      expect(DEFAULT_ASK_CONFIG.enableDevWarnings).toBe(isDevelopmentMode());

      updateAskConfig({ enableDevWarnings: false });
      expect(DEFAULT_ASK_CONFIG.defaultTimeout).toBe(10000);
      expect(DEFAULT_ASK_CONFIG.enableDevWarnings).toBe(false);
    });

    it('should update all config options', () => {
      updateAskConfig({
        defaultTimeout: 7500,
        enableDevWarnings: true,
      });

      expect(DEFAULT_ASK_CONFIG.defaultTimeout).toBe(7500);
      expect(DEFAULT_ASK_CONFIG.enableDevWarnings).toBe(true);
    });
  });

  describe.skip('isDevelopmentMode', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('should return true for development environment', () => {
      process.env.NODE_ENV = 'development';
      expect(isDevelopmentMode()).toBe(true);
    });

    it('should return true for test environment', () => {
      process.env.NODE_ENV = 'test';
      expect(isDevelopmentMode()).toBe(true);
    });

    it('should return true when NODE_ENV is not set', () => {
      delete process.env.NODE_ENV;
      expect(isDevelopmentMode()).toBe(true);
    });

    it('should return false for production environment', () => {
      process.env.NODE_ENV = 'production';
      expect(isDevelopmentMode()).toBe(false);
    });
  });
});
