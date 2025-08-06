/**
 * @module actor-core/testing
 * @description Testing utilities for actor-core applications
 */

export type { StateAnalysisResult } from './state-machine-analysis.js';
// State machine analysis utilities
export {
  analyzeStateMachine,
  assertNoUnreachableStates,
  generateCoverageReport,
} from './state-machine-analysis.js';
