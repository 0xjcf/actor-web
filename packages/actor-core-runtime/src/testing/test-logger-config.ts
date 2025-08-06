/**
 * @module actor-core/runtime/testing/test-logger-config
 * @description Logger configuration for tests
 *
 * This module provides utilities to control logging during tests,
 * reducing noise while still allowing debug output when needed.
 */

import { afterEach } from 'vitest';
import { enableDevMode, resetDevMode } from '../logger.js';

/**
 * Configure logger for test environment
 *
 * By default, logs are suppressed in tests unless:
 * - DEBUG_TESTS=true environment variable is set
 * - enableTestDebugMode() is called
 */
export function configureTestLogger(): void {
  // Reset to default state
  resetDevMode();

  // Only enable logging if explicitly requested
  if (process.env.DEBUG_TESTS === 'true') {
    enableDevMode();
  }
}

/**
 * Enable debug logging for a specific test
 * Useful for debugging failing tests
 */
export function enableTestDebugMode(): void {
  enableDevMode();
}

/**
 * Disable debug logging after a test
 */
export function disableTestDebugMode(): void {
  resetDevMode();
}

/**
 * Run a test with debug logging enabled
 * @param fn - The test function to run
 */
export async function withDebugLogging<T>(fn: () => T | Promise<T>): Promise<T> {
  enableTestDebugMode();
  try {
    return await fn();
  } finally {
    disableTestDebugMode();
  }
}

/**
 * Vitest setup helper - add to setupFiles in vitest.config.ts
 */
export function setupTestLogger(): void {
  // Configure logger before each test file
  configureTestLogger();

  // Ensure clean state between tests
  if (typeof afterEach === 'function') {
    afterEach(() => {
      configureTestLogger();
    });
  }
}
