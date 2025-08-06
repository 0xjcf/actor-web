/**
 * @module actor-core/runtime/tests/setup
 * @description Test setup file
 */

import { afterEach, beforeAll } from 'vitest';
import { configureTestLogger } from '../src/testing/test-logger-config.js';

// Ensure debug mode is configured properly for tests
beforeAll(() => {
  configureTestLogger();
});

// Reset logger state between tests
afterEach(() => {
  configureTestLogger();
});
