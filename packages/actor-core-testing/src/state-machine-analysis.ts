/**
 * @module actor-core/testing/state-machine-analysis
 * @description Utilities for analyzing XState machines using @xstate/graph
 */

import { Logger } from '@actor-core/runtime';
import { getShortestPaths, getSimplePaths } from '@xstate/graph';
import type { AnyStateMachine } from 'xstate';

const log = Logger.namespace('STATE_MACHINE_ANALYSIS');

/**
 * Result of state machine analysis
 */
export interface StateAnalysisResult {
  /** Total number of states defined in the machine */
  totalStates: number;
  /** Number of reachable states */
  reachableStates: number;
  /** States that cannot be reached from the initial state */
  unreachableStates: string[];
  /** All state paths that can be reached */
  reachablePaths: Record<string, unknown>;
  /** Simple paths through the machine */
  simplePaths: Array<{
    state: string;
    steps: Array<{ state: string; event: Record<string, unknown> }>;
  }>;
}

/**
 * Analyzes a state machine to find unreachable states and generate coverage information
 *
 * @param machine - XState machine to analyze
 * @returns Analysis result with reachable/unreachable state information
 */
export function analyzeStateMachine(machine: AnyStateMachine): StateAnalysisResult {
  try {
    // Get all paths from initial state using shortest paths algorithm
    const shortestPaths = getShortestPaths(machine);

    // Get simple paths for more detailed analysis
    const simplePaths = getSimplePaths(machine);

    // Extract all states from the machine definition
    const allStates = extractAllStates(machine);

    // Find reachable states from the paths - extract from state.value in each path
    const reachableStates = new Set<string>();

    // getShortestPaths returns an array of path objects
    if (Array.isArray(shortestPaths)) {
      for (const path of shortestPaths) {
        if (path.state?.value) {
          const stateValue = path.state.value;
          // Handle both simple string states and complex state objects
          if (typeof stateValue === 'string') {
            reachableStates.add(stateValue);
          } else if (typeof stateValue === 'object') {
            // For nested states, add the serialized form
            reachableStates.add(JSON.stringify(stateValue));
          }
        }
      }
    }

    // Find unreachable states
    const unreachableStates = allStates.filter((state) => !reachableStates.has(state));

    // Convert simple paths to our format
    const formattedSimplePaths: Array<{
      state: string;
      steps: Array<{ state: string; event: Record<string, unknown> }>;
    }> = [];

    if (Array.isArray(simplePaths)) {
      for (const path of simplePaths) {
        if (path.state && path.steps) {
          const stateValue =
            typeof path.state.value === 'string'
              ? path.state.value
              : JSON.stringify(path.state.value);

          const steps = path.steps.map((step) => {
            const stepAsRecord = step as unknown as Record<string, unknown>;
            const stepState = stepAsRecord.state as Record<string, unknown> | undefined;
            const stepEvent = stepAsRecord.event as Record<string, unknown>;

            return {
              state:
                stepState && typeof stepState.value === 'string'
                  ? stepState.value
                  : JSON.stringify(stepState?.value || {}),
              event: stepEvent,
            };
          });

          formattedSimplePaths.push({
            state: stateValue,
            steps,
          });
        }
      }
    }

    const result: StateAnalysisResult = {
      totalStates: allStates.length,
      reachableStates: reachableStates.size,
      unreachableStates,
      reachablePaths: shortestPaths as unknown as Record<string, unknown>,
      simplePaths: formattedSimplePaths,
    };

    if (unreachableStates.length > 0) {
      log.warn(`Found ${unreachableStates.length} unreachable states:`, unreachableStates);
    } else {
      log.info(`All ${allStates.length} states are reachable`);
    }

    return result;
  } catch (error) {
    log.error('Error analyzing state machine:', error);
    throw new Error(
      `Failed to analyze state machine: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Extract all state names from a machine definition
 */
function extractAllStates(machine: AnyStateMachine): string[] {
  const states: string[] = [];

  function traverse(stateNode: Record<string, unknown>, path: string[] = []): void {
    if (stateNode.states && typeof stateNode.states === 'object') {
      for (const [key, value] of Object.entries(stateNode.states)) {
        const fullPath = [...path, key].join('.');
        states.push(fullPath);

        // Recursively traverse nested states
        if (value && typeof value === 'object') {
          traverse(value as Record<string, unknown>, [...path, key]);
        }
      }
    }
  }

  // Start traversal from the machine's states
  if (machine.config && typeof machine.config === 'object') {
    traverse(machine.config as Record<string, unknown>, []);
  }

  return states;
}

/**
 * Validates that a state machine has no unreachable states
 * Useful for test assertions
 */
export function assertNoUnreachableStates(machine: AnyStateMachine, machineName = 'machine'): void {
  const analysis = analyzeStateMachine(machine);

  if (analysis.unreachableStates.length > 0) {
    throw new Error(
      `${machineName} has ${analysis.unreachableStates.length} unreachable states: ${analysis.unreachableStates.join(', ')}`
    );
  }
}

/**
 * Generates test coverage report for a state machine
 */
export function generateCoverageReport(machine: AnyStateMachine, machineName = 'machine'): string {
  const analysis = analyzeStateMachine(machine);

  const coveragePercent = Math.round((analysis.reachableStates / analysis.totalStates) * 100);

  let report = `\n=== State Machine Coverage Report: ${machineName} ===\n`;
  report += `Total States: ${analysis.totalStates}\n`;
  report += `Reachable States: ${analysis.reachableStates}\n`;
  report += `Coverage: ${coveragePercent}%\n`;

  if (analysis.unreachableStates.length > 0) {
    report += `\n❌ Unreachable States (${analysis.unreachableStates.length}):\n`;
    analysis.unreachableStates.forEach((state) => {
      report += `  - ${state}\n`;
    });
  } else {
    report += '\n✅ All states are reachable!\n';
  }

  report += `\n📊 State Paths (${Object.keys(analysis.reachablePaths).length}):\n`;
  Object.entries(analysis.reachablePaths).forEach(([state, path]) => {
    const pathInfo = path as Record<string, unknown>;
    const steps = pathInfo.steps as Array<unknown> | undefined;
    report += `  - ${state}: ${steps?.length || 0} steps\n`;
  });

  return report;
}
