/**
 * @module actor-core/runtime/examples/hybrid-memory-example.test
 * @description Test file to run hybrid memory pattern examples
 */

import { beforeAll, describe, it } from 'vitest';
import { enableDevMode } from '../logger.js';
import { runHybridMemoryExamples } from './hybrid-memory-example.js';

describe('Hybrid Memory Pattern Examples', () => {
  beforeAll(() => {
    // Enable dev mode to see all debug logs including memory internals
    enableDevMode();
  });

  it('should run all hybrid memory pattern examples without errors', async () => {
    // Run the examples
    await runHybridMemoryExamples();
  }, 60000); // 60 second timeout for all examples
});
