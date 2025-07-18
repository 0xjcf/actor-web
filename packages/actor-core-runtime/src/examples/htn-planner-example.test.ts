/**
 * @module actor-core/runtime/examples/htn-planner-example.test
 * @description Test file to run HTN planner examples
 */

import { beforeAll, describe, it } from 'vitest';
import { enableDevMode } from '../logger.js';
import { runHTNPlannerExamples } from './htn-planner-example.js';

describe('HTN Planner Examples', () => {
  beforeAll(() => {
    // Enable dev mode to see all debug logs including planning internals
    enableDevMode();
  });

  it('should run all HTN planner examples without errors', async () => {
    // Run the examples
    await runHTNPlannerExamples();
  }, 30000); // 30 second timeout for all examples
});
