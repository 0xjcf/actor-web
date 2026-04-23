/**
 * @module actor-core/testing/state-machine-analysis
 * @description Utilities for statically analyzing XState machine configs
 */

import { Logger } from '@actor-core/runtime';
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

interface StaticStatePath {
  state: {
    value: string;
  };
  steps: Array<{ state: string; event: Record<string, unknown> }>;
}

interface OptionalXStateGraphModule {
  getShortestPaths: (machine: AnyStateMachine) => unknown;
  getSimplePaths: (machine: AnyStateMachine) => unknown;
}

/**
 * Analyzes a state machine to find unreachable states and generate coverage information
 *
 * @param machine - XState machine to analyze
 * @returns Analysis result with reachable/unreachable state information
 */
export function analyzeStateMachine(machine: AnyStateMachine): StateAnalysisResult {
  try {
    // Extract all states from the machine definition
    const allStates = extractAllStates(machine);
    const shortestPaths = analyzeStaticReachability(machine, allStates);
    const reachableStates = new Set(shortestPaths.map((path) => path.state.value));

    // Find unreachable states
    const unreachableStates = allStates.filter((state) => !reachableStates.has(state));

    // Convert simple paths to our format
    const formattedSimplePaths: Array<{
      state: string;
      steps: Array<{ state: string; event: Record<string, unknown> }>;
    }> = [];

    for (const path of shortestPaths) {
      formattedSimplePaths.push({
        state: path.state.value,
        steps: path.steps,
      });
    }

    const result: StateAnalysisResult = {
      totalStates: allStates.length,
      reachableStates: reachableStates.size,
      unreachableStates,
      reachablePaths: shortestPaths.reduce<Record<string, unknown>>((paths, path) => {
        paths[path.state.value] = path;
        return paths;
      }, {}),
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
 * Analyzes a state machine with @xstate/graph when it is installed.
 *
 * The package keeps the synchronous static analyzer as the build-safe baseline,
 * and this async API provides richer graph traversal for environments that have
 * @xstate/graph available.
 */
export async function analyzeStateMachineWithGraph(
  machine: AnyStateMachine
): Promise<StateAnalysisResult> {
  const graph = await loadOptionalXStateGraph();

  if (!graph) {
    return analyzeStateMachine(machine);
  }

  try {
    const shortestPaths = graph.getShortestPaths(machine);
    const simplePaths = graph.getSimplePaths(machine);
    const allStates = extractAllStates(machine);
    const reachableStates = extractReachableStatesFromGraphPaths(shortestPaths);
    const unreachableStates = allStates.filter((state) => !reachableStates.has(state));

    return {
      totalStates: allStates.length,
      reachableStates: reachableStates.size,
      unreachableStates,
      reachablePaths: pathsToRecord(shortestPaths),
      simplePaths: formatGraphSimplePaths(simplePaths),
    };
  } catch (error) {
    log.warn('Falling back to static state machine analysis after graph analysis failed', error);
    return analyzeStateMachine(machine);
  }
}

async function loadOptionalXStateGraph(): Promise<OptionalXStateGraphModule | undefined> {
  try {
    const moduleSpecifier: string = '@xstate/graph';
    return (await import(moduleSpecifier)) as OptionalXStateGraphModule;
  } catch {
    return undefined;
  }
}

function extractReachableStatesFromGraphPaths(paths: unknown): Set<string> {
  const reachableStates = new Set<string>();

  if (!Array.isArray(paths)) {
    return reachableStates;
  }

  for (const path of paths) {
    const stateValue = extractGraphPathStateValue(path);

    if (stateValue) {
      reachableStates.add(stateValue);
    }
  }

  return reachableStates;
}

function pathsToRecord(paths: unknown): Record<string, unknown> {
  if (!Array.isArray(paths)) {
    return {};
  }

  return paths.reduce<Record<string, unknown>>((record, path, index) => {
    const state = extractGraphPathStateValue(path) ?? `path-${index}`;
    record[state] = path;
    return record;
  }, {});
}

function formatGraphSimplePaths(paths: unknown): StateAnalysisResult['simplePaths'] {
  if (!Array.isArray(paths)) {
    return [];
  }

  return paths.map((path) => ({
    state: extractGraphPathStateValue(path) ?? 'unknown',
    steps: extractGraphPathSteps(path),
  }));
}

function extractGraphPathStateValue(path: unknown): string | undefined {
  if (!path || typeof path !== 'object') {
    return undefined;
  }

  const state = (path as Record<string, unknown>).state;

  if (!state || typeof state !== 'object') {
    return undefined;
  }

  const value = (state as Record<string, unknown>).value;

  if (typeof value === 'string') {
    return value;
  }

  if (value !== undefined) {
    return JSON.stringify(value);
  }

  return undefined;
}

function extractGraphPathSteps(
  path: unknown
): Array<{ state: string; event: Record<string, unknown> }> {
  if (!path || typeof path !== 'object') {
    return [];
  }

  const steps = (path as Record<string, unknown>).steps;

  if (!Array.isArray(steps)) {
    return [];
  }

  return steps.map((step) => {
    const stepRecord = step && typeof step === 'object' ? (step as Record<string, unknown>) : {};
    const state = stepRecord.state;
    const event = stepRecord.event;

    return {
      state: extractGraphStateValue(state) ?? 'unknown',
      event: event && typeof event === 'object' ? (event as Record<string, unknown>) : {},
    };
  });
}

function extractGraphStateValue(state: unknown): string | undefined {
  if (!state || typeof state !== 'object') {
    return undefined;
  }

  const value = (state as Record<string, unknown>).value;

  if (typeof value === 'string') {
    return value;
  }

  if (value !== undefined) {
    return JSON.stringify(value);
  }

  return undefined;
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
 * Performs conservative static reachability over machine.config.
 *
 * This intentionally avoids importing @xstate/graph in the package build path.
 * It handles common string and object targets and treats unknown dynamic targets
 * as non-fatal rather than inventing reachability.
 */
function analyzeStaticReachability(
  machine: AnyStateMachine,
  allStates: readonly string[]
): StaticStatePath[] {
  const config = machine.config as Record<string, unknown> | undefined;
  const stateMap = extractStateMap(config);
  const initialState = typeof config?.initial === 'string' ? config.initial : allStates[0];

  if (!initialState) {
    return [];
  }

  const paths = new Map<string, StaticStatePath>();
  const queue: StaticStatePath[] = [
    {
      state: { value: initialState },
      steps: [],
    },
  ];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (!currentPath) {
      continue;
    }

    const currentState = currentPath.state.value;
    if (paths.has(currentState)) {
      continue;
    }

    paths.set(currentState, currentPath);

    for (const transition of extractTransitions(stateMap.get(currentState))) {
      if (!stateMap.has(transition.target) || paths.has(transition.target)) {
        continue;
      }

      queue.push({
        state: { value: transition.target },
        steps: [
          ...currentPath.steps,
          {
            state: transition.target,
            event: { type: transition.eventType },
          },
        ],
      });
    }
  }

  return [...paths.values()];
}

function extractStateMap(
  config: Record<string, unknown> | undefined
): Map<string, Record<string, unknown>> {
  const stateMap = new Map<string, Record<string, unknown>>();

  function traverse(states: Record<string, unknown> | undefined, path: string[] = []): void {
    if (!states) {
      return;
    }

    for (const [key, value] of Object.entries(states)) {
      if (!value || typeof value !== 'object') {
        continue;
      }

      const fullPath = [...path, key].join('.');
      const stateNode = value as Record<string, unknown>;
      stateMap.set(fullPath, stateNode);

      if (stateNode.states && typeof stateNode.states === 'object') {
        traverse(stateNode.states as Record<string, unknown>, [...path, key]);
      }
    }
  }

  const states = config?.states;
  traverse(states && typeof states === 'object' ? (states as Record<string, unknown>) : undefined);

  return stateMap;
}

function extractTransitions(
  stateNode: Record<string, unknown> | undefined
): Array<{ eventType: string; target: string }> {
  const transitions: Array<{ eventType: string; target: string }> = [];

  if (!stateNode?.on || typeof stateNode.on !== 'object') {
    return transitions;
  }

  for (const [eventType, transitionValue] of Object.entries(
    stateNode.on as Record<string, unknown>
  )) {
    for (const target of extractTransitionTargets(transitionValue)) {
      transitions.push({ eventType, target });
    }
  }

  return transitions;
}

function extractTransitionTargets(transitionValue: unknown): string[] {
  if (typeof transitionValue === 'string') {
    return [normalizeTarget(transitionValue)];
  }

  if (Array.isArray(transitionValue)) {
    return transitionValue.flatMap(extractTransitionTargets);
  }

  if (transitionValue && typeof transitionValue === 'object') {
    const target = (transitionValue as Record<string, unknown>).target;

    if (typeof target === 'string') {
      return [normalizeTarget(target)];
    }

    if (Array.isArray(target)) {
      return target
        .filter((value): value is string => typeof value === 'string')
        .map(normalizeTarget);
    }
  }

  return [];
}

function normalizeTarget(target: string): string {
  return target.replace(/^#/, '').replace(/^\./, '');
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
