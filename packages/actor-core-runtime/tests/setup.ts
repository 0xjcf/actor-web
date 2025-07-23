/**
 * @module actor-core/runtime/tests/setup
 * @description Test setup file
 */

import { beforeAll } from 'vitest';
import { resetDevMode } from '../src/logger.js';

// Ensure debug mode is disabled for tests by default
beforeAll(() => {
  resetDevMode();
});
