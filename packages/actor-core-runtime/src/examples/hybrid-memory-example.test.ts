/**
 * Test file for Hybrid Memory Examples
 */

import { describe, expect, it } from 'vitest';
// import { enableDevMode } from '../logger.js'; // Removed - use pnpm test:debug for verbose output
import { runHybridMemoryExamples } from './hybrid-memory-example.js';

describe('Hybrid Memory Examples', () => {
  // Removed enableDevMode() - tests run quietly by default
  // Use `pnpm test:debug` for verbose output when needed

  it('should run all hybrid memory examples without errors', async () => {
    await expect(runHybridMemoryExamples()).resolves.not.toThrow();
  }, 10000); // 10 second timeout
});
