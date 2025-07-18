/**
 * @module actor-core/runtime/examples/pipeline-example.test
 * @description Test file to run pipeline pattern examples
 */

import { beforeAll, describe, it } from 'vitest';
import { enableDevMode } from '../logger.js';
import { runPipelineExamples } from './pipeline-example.js';

describe('Pipeline Pattern Examples', () => {
  beforeAll(() => {
    // Enable dev mode to see all debug logs including pipeline internals
    enableDevMode();
  });

  it('should run all pipeline pattern examples without errors', async () => {
    // Run the examples
    await runPipelineExamples();
  }, 60000); // 60 second timeout for all examples
});
