/**
 * Test file for HTN Planner Examples
 */

import { describe, expect, it } from 'vitest';
// import { enableDevMode } from '../logger.js'; // Removed - use pnpm test:debug for verbose output
import { runHTNPlannerExamples } from './htn-planner-example.js';

describe('HTN Planner Examples', () => {
  // Removed enableDevMode() - tests run quietly by default
  // Use `pnpm test:debug` for verbose output when needed

  it('should run all HTN planner examples without errors', async () => {
    // This test runs all the HTN planner examples
    await expect(runHTNPlannerExamples()).resolves.not.toThrow();
  }, 20000); // 20 second timeout for all examples
});
