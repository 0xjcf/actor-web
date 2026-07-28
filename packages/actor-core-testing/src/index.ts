/**
 * @module actor-core/testing
 * @description Testing utilities for actor-core applications
 */

export type {
  AgentExecutionConformanceFixture,
  AgentExecutionConformanceFixtureName,
} from './agent-execution-conformance.js';
export {
  AGENT_EXECUTION_CONFORMANCE_SUPPORTED_VERSIONS,
  AGENT_EXECUTION_CONFORMANCE_SUPPORTED_VERSIONS as AGENT_EXECUTION_CONTRACT_SUPPORTED_VERSIONS,
  assertAgentExecutionConformanceFixture,
  getAgentExecutionConformanceFixture,
  listAgentExecutionConformanceFixtures,
} from './agent-execution-conformance.js';
export type { StateAnalysisResult } from './state-machine-analysis.js';
// State machine analysis utilities
export {
  analyzeStateMachine,
  analyzeStateMachineWithGraph,
  assertNoUnreachableStates,
  generateCoverageReport,
} from './state-machine-analysis.js';
