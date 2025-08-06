/**
 * State Machine Analysis Command - Pure Actor Model Implementation
 *
 * CLI command for analyzing XState machines to detect unreachable states
 * and generate coverage reports. Uses pure message-passing where possible.
 *
 * Note: This is a development/analysis tool, so some direct state inspection
 * is necessary for its analytical purposes, but we minimize direct access
 * and use message-passing for actor communication.
 */

import { Logger } from '@actor-core/runtime';
import {
  analyzeStateMachine,
  assertNoUnreachableStates,
  generateCoverageReport,
} from '@actor-core/testing';
import chalk from 'chalk';

const log = Logger.namespace('STATE_MACHINE_ANALYSIS');

import type { AnyStateMachine } from 'xstate';
import { type GitContext, type GitEvent, gitActorMachine } from '../actors/git-actor';
import { GitOperations } from '../core/git-operations.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

// Full implementation with @xstate/graph
// Using analyzeStateMachine, assertNoUnreachableStates, generateCoverageReport from @actor-web/core

/**
 * Simplified state machine monitoring with true interactivity
 * - Interactive mode when no events provided
 * - Auto-run mode with clean exit when events provided
 */
async function monitorStateMachineSimplified(
  git: GitOperations,
  eventsToSend: string[],
  eventDelay: number,
  eventData: Record<string, unknown>
): Promise<void> {
  log.debug(chalk.blue('🎭 State Machine Interactive Simulator'));
  log.debug(chalk.blue('======================================'));

  // Get current git context for realistic simulation
  try {
    const [currentBranch, hasChanges, changedFiles] = await Promise.all([
      git.getCurrentBranch(),
      git.hasUncommittedChanges(),
      git.getChangedFiles(),
    ]);

    log.debug(chalk.blue('🔍 Git Context for Simulation:'));
    log.debug(chalk.gray(`  Branch: ${currentBranch || 'unknown'}`));
    log.debug(chalk.gray(`  Uncommitted Changes: ${hasChanges ? 'Yes' : 'No'}`));
    log.debug(chalk.gray(`  Changed Files: ${changedFiles.length}`));
    log.debug('');

    // Use XState's createActor for simulation (not our complex actor system)
    const { createActor } = await import('xstate');
    const simulationActor = createActor(gitActorMachine, {
      input: { baseDir: process.cwd() },
    });

    log.debug(chalk.green('🎭 Starting State Machine Simulation...'));

    // Start the simulation actor (lightweight XState actor)
    simulationActor.start();

    let currentState = simulationActor.getSnapshot().value;
    log.debug(chalk.yellow(`📍 Initial State: ${String(currentState)}`));
    log.debug('');

    // AUTO-RUN MODE: Run provided events then exit
    if (eventsToSend.length > 0) {
      log.debug(chalk.blue(`🎯 Auto-run Mode: ${eventsToSend.join(' → ')}`));
      log.debug(chalk.gray(`⏱️  Event Delay: ${eventDelay}ms`));
      log.debug('');

      // Simulate each event in sequence
      for (let i = 0; i < eventsToSend.length; i++) {
        const eventName = eventsToSend[i];
        log.debug(chalk.cyan(`🔄 Sending Event: ${eventName}`));

        // Create properly typed event
        const event = createEventFromString(eventName, eventData);

        // Send event to simulation actor
        simulationActor.send(event);

        // Get new state
        const newSnapshot = simulationActor.getSnapshot();
        const newState = String(newSnapshot.value);

        if (newState !== String(currentState)) {
          log.debug(chalk.green(`  ✅ State Transition: ${String(currentState)} → ${newState}`));
          currentState = newSnapshot.value;
        } else {
          log.debug(chalk.gray(`  ⚪ No State Change: Remained in ${String(currentState)}`));
        }

        // Show context changes
        const context = newSnapshot.context as GitContext;
        if (context.lastOperation) {
          log.debug(chalk.blue(`     Context: lastOperation = ${context.lastOperation}`));
        }
        if (context.lastError) {
          log.debug(chalk.red(`     Error: ${context.lastError}`));
        }

        // Add delay between events (except for last event)
        if (eventDelay > 0 && i < eventsToSend.length - 1) {
          log.debug(chalk.gray(`  ⏱️  Waiting ${eventDelay}ms...`));
          await new Promise((resolve) => setTimeout(resolve, eventDelay));
        }

        log.debug('');
      }

      // Clean exit after events complete
      log.debug(chalk.green('🎉 Auto-run Complete!'));
      log.debug(chalk.blue(`📊 Final State: ${String(currentState)}`));
    } else {
      // INTERACTIVE MODE: Create fresh actor to ensure clean state
      log.debug(chalk.cyan('🎮 Interactive Mode - Enter events to see state transitions'));
      log.debug(
        chalk.gray('Available events: CHECK_STATUS, COMMIT_CHANGES, PUSH_CHANGES, CHECK_REPO, etc.')
      );
      log.debug(
        chalk.gray('Type "help" for available events, "state" for current state, "q" to quit')
      );
      log.debug('');

      // ✅ SOLUTION: Create fresh actor for interactive mode
      const { createActor } = await import('xstate');
      const interactiveActor = createActor(gitActorMachine, {
        input: { baseDir: process.cwd() },
      });
      interactiveActor.start();

      const initialInteractiveState = interactiveActor.getSnapshot().value;
      log.debug(chalk.blue(`🎮 Interactive actor starting in: ${String(initialInteractiveState)}`));
      log.debug('');

      await startInteractiveMode(interactiveActor, initialInteractiveState, eventData);
    }

    // Clean shutdown
    simulationActor.stop();
  } catch (error) {
    console.error(chalk.red('❌ Simulation failed:'), error);
  }
}

/**
 * Interactive mode for real-time event input
 */
async function startInteractiveMode(
  actor: ReturnType<typeof import('xstate').createActor>,
  _initialState: unknown,
  eventData: Record<string, unknown>
): Promise<void> {
  const readline = await import('node:readline');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.blue('simulator> '),
  });

  // ✅ FIX: Always get current state from actor, don't rely on stale variable
  const getCurrentState = () => actor.getSnapshot().value;

  const processInput = (input: string) => {
    const command = input.trim();

    if (command === 'q' || command === 'quit' || command === 'exit') {
      log.debug(chalk.yellow('👋 Exiting simulator...'));
      rl.close();
      return;
    }

    if (command === 'help') {
      log.debug(chalk.cyan('Available Events:'));
      log.debug(chalk.gray('  CHECK_STATUS - Check git status'));
      log.debug(chalk.gray('  CHECK_REPO - Verify git repository'));
      log.debug(chalk.gray('  COMMIT_CHANGES - Commit changes'));
      log.debug(chalk.gray('  PUSH_CHANGES - Push to remote'));
      log.debug(chalk.gray('  GET_INTEGRATION_STATUS - Check integration status'));
      log.debug(chalk.gray('  CREATE_BRANCH - Create new branch'));
      log.debug(chalk.gray('  SETUP_WORKTREES - Setup agent worktrees'));
      log.debug(chalk.gray(''));
      log.debug(chalk.cyan('Commands:'));
      log.debug(chalk.gray('  help - Show this help'));
      log.debug(chalk.gray('  state - Show current state'));
      log.debug(chalk.gray('  q - Quit simulator'));
      log.debug('');
      rl.prompt();
      return;
    }

    if (command === 'state') {
      const currentState = getCurrentState();
      log.debug(chalk.blue(`📊 Current State: ${String(currentState)}`));
      log.debug('');
      rl.prompt();
      return;
    }

    if (command.length > 0) {
      // Try to send the event
      log.debug(chalk.cyan(`🔄 Sending Event: ${command}`));

      try {
        const event = createEventFromString(command, eventData);

        // Get current state before sending event
        const beforeSnapshot = actor.getSnapshot();
        const currentState = beforeSnapshot.value;

        actor.send(event);

        // Get new state
        const newSnapshot = actor.getSnapshot();
        const newState = String(newSnapshot.value);

        if (newState !== String(currentState)) {
          log.debug(chalk.green(`  ✅ State Transition: ${String(currentState)} → ${newState}`));
        } else {
          log.debug(chalk.gray(`  ⚪ No State Change: Remained in ${String(currentState)}`));
        }

        // Show context changes
        const context = newSnapshot.context as GitContext;
        if (context.lastOperation) {
          log.debug(chalk.blue(`     Context: lastOperation = ${context.lastOperation}`));
        }
        if (context.lastError) {
          log.debug(chalk.red(`     Error: ${context.lastError}`));
        }
      } catch (_error) {
        log.debug(chalk.red(`  ❌ Invalid event: ${command}`));
        log.debug(chalk.gray('  Type "help" to see available events'));
      }

      log.debug('');
    }

    rl.prompt();
  };

  rl.on('line', processInput);
  rl.on('close', () => {
    log.debug(chalk.yellow('👋 Simulator session ended'));
  });

  // Handle Ctrl+C gracefully
  rl.on('SIGINT', () => {
    log.debug(chalk.yellow('\n👋 Exiting simulator...'));
    rl.close();
  });

  rl.prompt();
}

/**
 * Create properly typed event from string for simulation
 */
function createEventFromString(eventName: string, eventData: Record<string, unknown>): GitEvent {
  // Add event-specific data based on event type
  switch (eventName) {
    case 'COMMIT_CHANGES':
      return {
        type: 'COMMIT_CHANGES',
        message: (eventData.message as string) || 'Simulation test commit',
      };
    case 'PUSH_CHANGES':
      return {
        type: 'PUSH_CHANGES',
        branch: (eventData.branch as string) || 'current-branch',
      };
    case 'GET_INTEGRATION_STATUS':
      return {
        type: 'GET_INTEGRATION_STATUS',
        integrationBranch: (eventData.integrationBranch as string) || 'integration',
      };
    case 'VALIDATE_DATES':
      return {
        type: 'VALIDATE_DATES',
        filePaths: (eventData.filePaths as string[]) || ['README.md'],
      };
    case 'SETUP_WORKTREES':
      return {
        type: 'SETUP_WORKTREES',
        agentCount: (eventData.agentCount as number) || 3,
      };
    case 'CREATE_BRANCH':
      return {
        type: 'CREATE_BRANCH',
        branchName: (eventData.branchName as string) || 'feature/simulation-test',
      };
    case 'CHECK_STATUS':
      return { type: 'CHECK_STATUS' };
    case 'CHECK_REPO':
      return { type: 'CHECK_REPO' };
    case 'CHECK_UNCOMMITTED_CHANGES':
      return { type: 'CHECK_UNCOMMITTED_CHANGES' };
    case 'GET_CHANGED_FILES':
      return { type: 'GET_CHANGED_FILES' };
    default:
      // For unknown events, default to CHECK_STATUS
      return { type: 'CHECK_STATUS' };
  }
}

async function subscribeToStateMachineWithEvents(
  target: string,
  _machineName: string,
  eventsToSend: string[],
  eventDelay: number,
  eventData: Record<string, unknown>
): Promise<void> {
  if (target !== 'git-actor') {
    log.debug(chalk.red('❌ Live monitoring only supported for git-actor'));
    return;
  }

  try {
    const repoRoot = await findRepoRoot();

    // ✅ SIMPLIFIED: Use GitOperations instead of complex GitActor system
    const git = new GitOperations(repoRoot);

    log.debug(chalk.blue('🚀 Starting Git Analysis...'));

    // ✅ SIMPLIFIED: Direct state machine analysis without complex monitoring
    await monitorStateMachineSimplified(git, eventsToSend, eventDelay, eventData);
  } catch (error) {
    console.error(chalk.red('❌ Error setting up state monitoring:'), error);
    process.exit(1);
  }
}

function analyzeStateMachineData(machine: AnyStateMachine) {
  try {
    // For git-actor, we need to get accurate state counts manually due to circular reference issues
    if (machine.id === 'git-actor') {
      const allStates = extractAllStatesFromMachine(machine);
      const stateAnalysis = analyzeStateTransitionsFromConfig(machine.config);

      // Calculate meaningful metrics
      const totalStates = allStates.length;
      const reachableStates = allStates.length - stateAnalysis.orphanedStates.length;
      const unreachableStates = stateAnalysis.orphanedStates;

      return {
        totalStates,
        reachableStates,
        unreachableStates,
        allStates,
        simplePaths: [], // We can't generate paths due to circular references
      };
    }

    // For other machines, try the standard analysis
    const analysis = analyzeStateMachine(machine);

    return {
      totalStates: analysis.totalStates,
      reachableStates: analysis.reachableStates,
      unreachableStates: analysis.unreachableStates,
      allStates: extractAllStatesFromMachine(machine),
      simplePaths: analysis.simplePaths,
    };
  } catch (_error) {
    // Fallback to manual analysis if standard analysis fails
    const allStates = extractAllStatesFromMachine(machine);
    const stateAnalysis = analyzeStateTransitionsFromConfig(machine.config);

    return {
      totalStates: allStates.length,
      reachableStates: allStates.length - stateAnalysis.orphanedStates.length,
      unreachableStates: stateAnalysis.orphanedStates,
      allStates,
      simplePaths: [],
    };
  }
}

function extractAllStatesFromMachine(machine: AnyStateMachine): string[] {
  const states: string[] = [];

  function traverse(stateConfig: Record<string, unknown> | undefined, prefix = '') {
    if (stateConfig && typeof stateConfig === 'object') {
      for (const [key, value] of Object.entries(stateConfig)) {
        const stateName = prefix ? `${prefix}.${key}` : key;
        states.push(stateName);

        if (value && typeof value === 'object' && 'states' in value) {
          traverse(value.states as Record<string, unknown> | undefined, stateName);
        }
      }
    }
  }

  if (machine.config?.states) {
    traverse(machine.config.states as Record<string, unknown> | undefined);
  }

  return states;
}

function validateStateMachine(
  machine: AnyStateMachine,
  _machineName: string
): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Basic validation using @xstate/graph
    const analysis = analyzeStateMachine(machine);

    if (analysis.unreachableStates.length > 0) {
      errors.push(`Found ${analysis.unreachableStates.length} unreachable states`);
    }

    // Check for common issues
    const allEvents = ['CHECK_STATUS', 'REQUEST_STATUS']; // Simplified event list for analysis
    if (allEvents.length === 0) {
      warnings.push('No events detected in machine');
    }

    if (analysis.totalStates < 2) {
      warnings.push('Machine has very few states - consider if this is intentional');
    }

    // NEW: Enhanced workflow analysis
    const workflowIssues = analyzeWorkflowCompleteness(machine);
    errors.push(...workflowIssues.errors);
    warnings.push(...workflowIssues.warnings);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      isValid: false,
      errors,
      warnings,
    };
  }
}

// NEW: Enhanced workflow analysis function
function analyzeWorkflowCompleteness(machine: AnyStateMachine): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Use a simpler approach that works with XState's actual API
    const stateAnalysis = analyzeStateTransitionsFromConfig(machine.config);

    // For git-actor, apply specific workflow patterns
    if (machine.id === 'git-actor') {
      return analyzeGitActorWorkflow(stateAnalysis);
    }

    // Generic analysis for other machines
    return analyzeGenericWorkflow(stateAnalysis);
  } catch (error) {
    errors.push(
      `Workflow analysis failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return { errors, warnings };
  }
}

// NEW: Git-actor specific workflow analysis
function analyzeGitActorWorkflow(stateAnalysis: {
  stateTransitions: Record<string, string[]>;
  deadEndStates: string[];
  finalStates: string[];
  orphanedStates: string[];
}): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for completion states that don't return to idle
  const completionStates = Object.keys(stateAnalysis.stateTransitions).filter(
    (state) =>
      state.includes('Completed') ||
      state.includes('Checked') ||
      state.includes('Setup') ||
      state.includes('Generated') ||
      state.includes('Validated') ||
      state.includes('Created')
  );

  const missingContinueStates = completionStates.filter(
    (state) => !stateAnalysis.stateTransitions[state]?.includes('CONTINUE')
  );

  if (missingContinueStates.length > 0) {
    errors.push(
      `Completion states missing CONTINUE transitions: ${missingContinueStates.join(', ')}`
    );
  }

  // Check for error states that don't have RETRY transitions
  const errorStates = Object.keys(stateAnalysis.stateTransitions).filter(
    (state) => state.includes('Error') || state.includes('Timeout')
  );

  const errorStatesWithoutRetry = errorStates.filter(
    (state) => !stateAnalysis.stateTransitions[state]?.includes('RETRY')
  );

  if (errorStatesWithoutRetry.length > 0) {
    warnings.push(`Error states missing RETRY transitions: ${errorStatesWithoutRetry.join(', ')}`);
  }

  // Check for invoke states that should have automatic transitions
  const invokeStates = Object.keys(stateAnalysis.stateTransitions).filter(
    (state) => state.includes('ing') && !state.includes('Error') && !state.includes('Timeout')
  );

  const invokeStatesWithoutTransitions = invokeStates.filter(
    (state) =>
      !stateAnalysis.stateTransitions[state]?.includes('onDone') &&
      !stateAnalysis.stateTransitions[state]?.includes('onError')
  );

  if (invokeStatesWithoutTransitions.length > 0) {
    warnings.push(
      `Invoke states without onDone/onError transitions: ${invokeStatesWithoutTransitions.join(', ')}`
    );
  }

  // Generic dead-end state detection (exclude invoke states which have implicit transitions)
  const realDeadEndStates = stateAnalysis.deadEndStates.filter(
    (state) => !state.includes('ing') // Invoke states have implicit onDone/onError transitions
  );

  if (realDeadEndStates.length > 0) {
    errors.push(`Dead-end states (no outgoing transitions): ${realDeadEndStates.join(', ')}`);
  }

  return { errors, warnings };
}

// NEW: Generic workflow analysis for non-git-actor machines
function analyzeGenericWorkflow(stateAnalysis: {
  stateTransitions: Record<string, string[]>;
  deadEndStates: string[];
  finalStates: string[];
  orphanedStates: string[];
}): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Generic dead-end state detection
  if (stateAnalysis.deadEndStates.length > 0) {
    errors.push(
      `Found ${stateAnalysis.deadEndStates.length} dead-end states: ${stateAnalysis.deadEndStates.join(', ')}`
    );
  }

  // Generic final state analysis
  const finalStatesWithTransitions = stateAnalysis.finalStates.filter(
    (state) =>
      stateAnalysis.stateTransitions[state] && stateAnalysis.stateTransitions[state].length > 0
  );

  if (finalStatesWithTransitions.length > 0) {
    warnings.push(
      `Final states with outgoing transitions: ${finalStatesWithTransitions.join(', ')}`
    );
  }

  // Check for states with no incoming transitions (except initial state)
  if (stateAnalysis.orphanedStates.length > 0) {
    warnings.push(
      `States with no incoming transitions: ${stateAnalysis.orphanedStates.join(', ')}`
    );
  }

  return { errors, warnings };
}

// NEW: Analyze state transitions directly from machine configuration
function analyzeStateTransitionsFromConfig(config: Record<string, unknown>): {
  stateTransitions: Record<string, string[]>;
  deadEndStates: string[];
  finalStates: string[];
  orphanedStates: string[];
} {
  const stateTransitions: Record<string, string[]> = {};
  const stateTargets: Record<string, string[]> = {}; // Track actual transition targets
  const deadEndStates: string[] = [];
  const finalStates: string[] = [];
  const allStates: string[] = [];
  const incomingTransitions: Record<string, string[]> = {};

  // Extract states and transitions from configuration
  function extractStatesAndTransitions(
    stateConfig: Record<string, unknown>,
    stateName: string,
    parentPath = ''
  ): void {
    if (!stateConfig || typeof stateConfig !== 'object') return;

    const fullStateName = parentPath ? `${parentPath}.${stateName}` : stateName;
    allStates.push(fullStateName);

    const events: string[] = [];
    const targets: string[] = [];

    // Extract events and targets from 'on' property
    if (stateConfig.on && typeof stateConfig.on === 'object') {
      Object.entries(stateConfig.on).forEach(([event, transitionConfig]) => {
        if (event !== '') {
          events.push(event);

          // Extract target states from transition configuration
          if (typeof transitionConfig === 'string') {
            targets.push(transitionConfig);
            addIncomingTransition(transitionConfig, fullStateName);
          } else if (typeof transitionConfig === 'object' && transitionConfig !== null) {
            if (Array.isArray(transitionConfig)) {
              // Handle array of transitions
              transitionConfig.forEach((trans) => {
                if (typeof trans === 'object' && trans !== null && 'target' in trans) {
                  const target = String(trans.target);
                  targets.push(target);
                  addIncomingTransition(target, fullStateName);
                }
              });
            } else if ('target' in transitionConfig) {
              const target = String(transitionConfig.target);
              targets.push(target);
              addIncomingTransition(target, fullStateName);
            }
          }
        }
      });
    }

    // Extract transitions from 'invoke' states (onDone, onError)
    if (stateConfig.invoke && typeof stateConfig.invoke === 'object') {
      const invokeConfig = stateConfig.invoke as Record<string, unknown>;

      if (invokeConfig.onDone) {
        events.push('onDone');
        extractTransitionTargets(invokeConfig.onDone, targets, fullStateName);
      }

      if (invokeConfig.onError) {
        events.push('onError');
        extractTransitionTargets(invokeConfig.onError, targets, fullStateName);
      }
    }

    // Extract transitions from 'after' (timeout transitions)
    if (stateConfig.after && typeof stateConfig.after === 'object') {
      Object.entries(stateConfig.after).forEach(([timeout, transitionConfig]) => {
        events.push(`after_${timeout}`);
        extractTransitionTargets(transitionConfig, targets, fullStateName);
      });
    }

    // Check if this is a final state
    if (stateConfig.type === 'final') {
      finalStates.push(fullStateName);
    }

    stateTransitions[fullStateName] = events;
    stateTargets[fullStateName] = targets;

    // Identify dead-end states (non-final states with no outgoing transitions)
    if (events.length === 0 && stateConfig.type !== 'final') {
      deadEndStates.push(fullStateName);
    }

    // Recursively check nested states
    if (stateConfig.states && typeof stateConfig.states === 'object') {
      Object.entries(stateConfig.states).forEach(([nestedStateName, nestedState]) => {
        extractStatesAndTransitions(
          nestedState as Record<string, unknown>,
          nestedStateName,
          fullStateName
        );
      });
    }
  }

  // Helper function to extract targets from transition configuration
  function extractTransitionTargets(
    transitionConfig: unknown,
    targets: string[],
    sourceState: string
  ): void {
    if (typeof transitionConfig === 'string') {
      targets.push(transitionConfig);
      addIncomingTransition(transitionConfig, sourceState);
    } else if (typeof transitionConfig === 'object' && transitionConfig !== null) {
      if (Array.isArray(transitionConfig)) {
        transitionConfig.forEach((trans) => {
          if (typeof trans === 'object' && trans !== null && 'target' in trans) {
            const target = String(trans.target);
            targets.push(target);
            addIncomingTransition(target, sourceState);
          }
        });
      } else if ('target' in transitionConfig) {
        const target = String(transitionConfig.target);
        targets.push(target);
        addIncomingTransition(target, sourceState);
      }
    }
  }

  // Helper function to track incoming transitions
  function addIncomingTransition(targetState: string, sourceState: string): void {
    if (!incomingTransitions[targetState]) {
      incomingTransitions[targetState] = [];
    }
    if (!incomingTransitions[targetState].includes(sourceState)) {
      incomingTransitions[targetState].push(sourceState);
    }
  }

  // Extract from root states
  if (config.states && typeof config.states === 'object') {
    Object.entries(config.states).forEach(([stateName, stateConfig]) => {
      extractStatesAndTransitions(stateConfig as Record<string, unknown>, stateName);
    });
  }

  // Find orphaned states using actual incoming transition analysis
  const orphanedStates = findOrphanedStatesWithIncomingAnalysis(
    allStates,
    incomingTransitions,
    config
  );

  return {
    stateTransitions,
    deadEndStates,
    finalStates,
    orphanedStates,
  };
}

// NEW: More robust orphaned state detection using incoming transition analysis
function findOrphanedStatesWithIncomingAnalysis(
  allStates: string[],
  incomingTransitions: Record<string, string[]>,
  config: Record<string, unknown>
): string[] {
  const orphanedStates: string[] = [];

  // Get initial state from config
  const initialState = config.initial ? String(config.initial) : '';

  // Check each state for incoming transitions
  allStates.forEach((state) => {
    // Skip initial state
    if (state === initialState) return;

    // Check if state has any incoming transitions
    const hasIncomingTransitions =
      incomingTransitions[state] && incomingTransitions[state].length > 0;

    if (!hasIncomingTransitions) {
      orphanedStates.push(state);
    }
  });

  return orphanedStates;
}

function displayValidationResults(results: {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}): void {
  if (results.isValid) {
    log.debug(chalk.green('✅ Machine validation passed'));
  } else {
    log.debug(chalk.red('❌ Machine validation failed'));
  }

  if (results.errors.length > 0) {
    log.debug(chalk.red('Errors:'));
    results.errors.forEach((error) => log.debug(chalk.red(`  - ${error}`)));
  }

  if (results.warnings.length > 0) {
    log.debug(chalk.yellow('Warnings:'));
    results.warnings.forEach((warning) => log.debug(chalk.yellow(`  - ${warning}`)));
  }
}

// NEW: Display workflow analysis results
function displayWorkflowAnalysisResults(results: { errors: string[]; warnings: string[] }): void {
  if (results.errors.length === 0 && results.warnings.length === 0) {
    log.debug(chalk.green('✅ Workflow analysis passed - no issues found!'));
    return;
  }

  if (results.errors.length > 0) {
    log.debug(chalk.red('❌ Workflow Errors:'));
    results.errors.forEach((error) => log.debug(chalk.red(`  - ${error}`)));
  }

  if (results.warnings.length > 0) {
    log.debug(chalk.yellow('⚠️  Workflow Warnings:'));
    results.warnings.forEach((warning) => log.debug(chalk.yellow(`  - ${warning}`)));
  }

  // Provide generic recommendations based on errors
  if (results.errors.length > 0) {
    log.debug(chalk.cyan('💡 Generic Workflow Recommendations:'));

    if (results.errors.some((e) => e.includes('dead-end states'))) {
      log.debug(chalk.gray('  - Review states with no outgoing transitions'));
      log.debug(
        chalk.gray('  - Consider adding transitions to continue workflow or mark as final states')
      );
    }

    if (results.warnings.some((w) => w.includes('Final states with outgoing transitions'))) {
      log.debug(chalk.gray('  - Final states typically should not have outgoing transitions'));
      log.debug(
        chalk.gray('  - Consider if these states should be final or have different transitions')
      );
    }

    if (results.warnings.some((w) => w.includes('no incoming transitions'))) {
      log.debug(chalk.gray('  - Review states that may be unreachable'));
      log.debug(chalk.gray('  - Ensure states have proper entry points or remove if unused'));
    }
  }
}

function showDebugInfo(machine: AnyStateMachine, _machineName: string): void {
  log.debug('');

  const allEvents = ['CHECK_STATUS', 'REQUEST_STATUS']; // Simplified event list for analysis
  log.debug(`Machine ID: ${machine.id || 'not specified'}`);
  log.debug(`Machine Type: ${machine.config.type || 'not specified'}`);
  log.debug(`Total Events: ${allEvents.length}`);

  if (allEvents.length > 0) {
    log.debug('All Events:');
    allEvents.forEach((event: string) => log.debug(`  - ${event}`));
  }
}

export async function analyzeCommand(options: {
  target?: string;
  verbose?: boolean;
  assert?: boolean;
  debug?: boolean;
  subscribe?: boolean;
  validate?: boolean;
  workflow?: boolean;
  events?: string;
  eventDelay?: string;
  eventData?: string;
  autoRun?: boolean;
}) {
  // Only enable dev mode when debug is explicitly requested
  // if (options.debug) {
  //   enableDevMode();
  // }

  log.debug(chalk.blue('🔍 State Machine Analysis'));
  log.debug(chalk.blue('='.repeat(60)));

  const target = options.target || 'git-actor';
  const verbose = options.verbose || false;
  const shouldAssert = options.assert || false;
  const debug = options.debug || false;
  const subscribe = options.subscribe || false;
  const validate = options.validate || false;
  const workflow = options.workflow || false;
  const eventsToSend = options.events ? options.events.split(',').map((e) => e.trim()) : [];
  const eventDelay = Number.parseInt(options.eventDelay || '1000', 10);
  const eventData = options.eventData ? JSON.parse(options.eventData) : {};

  try {
    let machine: AnyStateMachine;
    let machineName: string;

    // Select the target machine - using real machine definitions
    switch (target) {
      case 'git-actor':
        machine = gitActorMachine;
        machineName = 'Git Actor';
        break;

      default:
        log.debug(chalk.red(`❌ Unknown target: ${target}`));
        log.debug(chalk.gray('Available targets: git-actor'));
        process.exit(1);
    }

    log.debug(chalk.yellow(`🎯 Analyzing: ${machineName}`));
    log.debug('');

    // Handle automated event sending or live subscription mode
    if (subscribe || eventsToSend.length > 0) {
      log.debug(chalk.cyan('🔔 Live State Monitoring Mode'));
      log.debug(chalk.gray('Press Ctrl+C to stop monitoring'));
      log.debug('');

      if (eventsToSend.length > 0) {
        log.debug(chalk.yellow(`🎯 Automated Event Sequence: ${eventsToSend.join(' → ')}`));
        log.debug(chalk.gray(`⏱️  Event Delay: ${eventDelay}ms`));
        log.debug('');
      }

      await subscribeToStateMachineWithEvents(
        target,
        machineName,
        eventsToSend,
        eventDelay,
        eventData
      );
      return;
    }

    // Analyze the machine using the full @xstate/graph implementation
    const analysis = analyzeStateMachineData(machine);

    // Show basic results
    log.debug(chalk.blue('📊 Analysis Results:'));
    log.debug(`  Total States: ${analysis.totalStates}`);
    log.debug(`  Reachable States: ${analysis.reachableStates}`);
    log.debug(
      `  Coverage: ${Math.round((analysis.reachableStates / analysis.totalStates) * 100)}%`
    );
    log.debug('');

    if (analysis.unreachableStates.length > 0) {
      log.debug(chalk.red('❌ Unreachable States Found:'));
      analysis.unreachableStates.forEach((state: string, index: number) => {
        log.debug(chalk.red(`  ${index + 1}. ${state}`));
      });
      log.debug('');
    } else {
      log.debug(chalk.green('✅ All states are reachable!'));
      log.debug('');
    }

    // Run comprehensive validation if requested
    if (validate) {
      log.debug(chalk.blue('🔍 Comprehensive Validation:'));
      const validationResults = validateStateMachine(machine, machineName);
      displayValidationResults(validationResults);
      log.debug('');
    }

    // NEW: Run workflow analysis if requested
    if (workflow) {
      log.debug(chalk.blue('⚙️  Workflow Analysis:'));
      const workflowIssues = analyzeWorkflowCompleteness(machine);
      displayWorkflowAnalysisResults(workflowIssues);
      log.debug('');
    }

    // Show debug information if requested
    if (debug) {
      log.debug(chalk.blue('🐛 Debug Information:'));
      showDebugInfo(machine, machineName);
      log.debug('');
    }

    // Show verbose output if requested
    if (verbose) {
      log.debug(chalk.blue('📋 Detailed Coverage Report:'));

      // Handle git-actor separately due to circular reference issues
      if (target === 'git-actor') {
        log.debug(chalk.yellow('Git Actor Analysis:'));
        log.debug(`  Machine ID: ${machine.id}`);
        log.debug(`  Total States: ${analysis.totalStates}`);
        log.debug(`  All States: ${analysis.allStates.join(', ')}`);
        log.debug('  Note: Detailed path analysis unavailable due to circular references');
      } else {
        try {
          log.debug(generateCoverageReport(machine, machineName));
        } catch (_error) {
          log.debug(chalk.red('❌ Coverage report unavailable due to analysis limitations'));
        }
      }

      log.debug('');

      if (analysis.simplePaths.length > 0) {
        log.debug(chalk.blue('🛤️  Sample State Paths:'));
        analysis.simplePaths.slice(0, 10).forEach(
          (
            path: {
              state: string;
              steps: Array<{ state: string; event: Record<string, unknown> }>;
            },
            index: number
          ) => {
            log.debug(chalk.gray(`  ${index + 1}. ${path.state} (${path.steps.length} steps)`));
          }
        );
        log.debug('');
      } else if (target === 'git-actor') {
        log.debug(chalk.blue('🛤️  Sample States:'));
        analysis.allStates.slice(0, 10).forEach((state, index) => {
          log.debug(chalk.gray(`  ${index + 1}. ${state}`));
        });
        log.debug('');
      }
    }

    // Run assertion if requested
    if (shouldAssert) {
      log.debug(chalk.blue('🧪 Running Assertion Test:'));
      try {
        assertNoUnreachableStates(machine, machineName);
        log.debug(chalk.green('✅ Assertion test passed - no unreachable states!'));
      } catch (error) {
        log.debug(
          chalk.red('❌ Assertion test failed:'),
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
      log.debug('');
    }

    // Summary and recommendations
    if (analysis.unreachableStates.length > 0) {
      log.debug(chalk.yellow('💡 Recommendations:'));
      log.debug('  1. Check if unreachable states have missing event wiring');
      log.debug('  2. Remove unused states if they are not needed');
      log.debug('  3. Connect states to appropriate workflows');
      log.debug('');

      process.exit(1);
    } else {
      log.debug(chalk.green('🎉 State machine analysis complete - no issues found!'));
    }
  } catch (error) {
    console.error(
      chalk.red('💥 Error during analysis:'),
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}
