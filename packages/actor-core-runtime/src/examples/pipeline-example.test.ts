/**
 * Test file for Pipeline Pattern Examples
 */

import { describe, expect, it } from 'vitest';
// import { enableDevMode } from '../logger.js'; // Removed - use pnpm test:debug for verbose output
import { runPipelineExamples } from './pipeline-example.js';

describe('Pipeline Pattern Examples', () => {
  // Removed enableDevMode() - tests run quietly by default
  // Use `pnpm test:debug` for verbose output when needed

  it('should run all pipeline pattern examples without errors', async () => {
    await expect(runPipelineExamples()).resolves.not.toThrow();
  }, 60000); // 60 second timeout for all pipeline examples
});
