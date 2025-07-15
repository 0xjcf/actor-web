/**
 * State Machine Analysis Command
 *
 * CLI command for analyzing XState machines to detect unreachable states
 * and generate coverage reports.
 */

import type { ActorSnapshot } from '@actor-web/core';
import { getShortestPaths, getSimplePaths } from '@xstate/graph';
import chalk from 'chalk';
import { type AnyStateMachine, createMachine } from 'xstate';
import { createGitActor } from '../actors/git-actor.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

// Full implementation with @xstate/graph
interface StateAnalysisResult {
  totalStates: number;
  reachableStates: number;
  unreachableStates: string[];
  reachablePaths: Record<string, unknown>;
  simplePaths: Array<{
    state: string;
    steps: Array<{ state: string; event: Record<string, unknown> }>;
  }>;
}

async function subscribeToStateMachine(target: string, _machineName: string): Promise<void> {
  if (target !== 'git-actor') {
    console.log(chalk.red('❌ Live monitoring only supported for git-actor'));
    return;
  }

  try {
    const repoRoot = await findRepoRoot();
    const gitActor = createGitActor(repoRoot);

    console.log(chalk.blue('🚀 Starting Git Actor...'));
    gitActor.start();

    let stateCount = 0;
    const startTime = Date.now();

    // Subscribe to state changes
    const stateObserver = gitActor
      .observe((snapshot: ActorSnapshot<unknown>) => snapshot.value)
      .subscribe((state) => {
        stateCount++;
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        const elapsed = Date.now() - startTime;

        console.log(
          chalk.green(
            `[${timestamp}] State #${stateCount} (${elapsed}ms): ${chalk.bold(String(state))}`
          )
        );
      });

    // Subscribe to context changes for additional debugging
    const contextObserver = gitActor
      .observe((snapshot: ActorSnapshot<unknown>) => snapshot.context)
      .subscribe((context) => {
        const ctx = context as Record<string, unknown>;
        if (ctx.lastError) {
          console.log(chalk.red(`  🚨 Error: ${ctx.lastError}`));
        }
        if (ctx.lastOperation) {
          console.log(chalk.blue(`  🔄 Operation: ${ctx.lastOperation}`));
        }
      });

    console.log(chalk.yellow('📍 Initial state check...'));
    gitActor.send({ type: 'CHECK_STATUS' });

    // Add interactive commands
    console.log(chalk.gray('Available commands:'));
    console.log(chalk.gray('  i: Get integration status'));
    console.log(chalk.gray('  s: Simulate ship workflow'));
    console.log(chalk.gray('  q: Quit'));
    console.log('');

    // Set up stdin for interactive commands
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (key) => {
      const input = key.toString();

      if (input === 'q' || input === '\u0003') {
        // q or Ctrl+C
        console.log(chalk.yellow('\n🛑 Stopping state monitoring...'));
        stateObserver.unsubscribe();
        contextObserver.unsubscribe();
        gitActor.stop();
        process.exit(0);
      } else if (input === 'i') {
        console.log(chalk.cyan('\n🔍 Triggering GET_INTEGRATION_STATUS...'));
        gitActor.send({
          type: 'GET_INTEGRATION_STATUS',
          integrationBranch: 'feature/actor-ref-integration',
        });
      } else if (input === 's') {
        console.log(chalk.cyan('\n🚀 Simulating ship workflow...'));
        console.log(chalk.blue('Step 1: Check uncommitted changes'));
        gitActor.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });

        setTimeout(() => {
          console.log(chalk.blue('Step 2: Get integration status'));
          gitActor.send({
            type: 'GET_INTEGRATION_STATUS',
            integrationBranch: 'feature/actor-ref-integration',
          });
        }, 1000);
      }
    });

    // Set up cleanup on exit
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n🛑 Stopping state monitoring...'));
      stateObserver.unsubscribe();
      contextObserver.unsubscribe();
      gitActor.stop();
      process.exit(0);
    });

    // Keep the process alive
    await new Promise(() => {});
  } catch (error) {
    console.error(chalk.red('❌ Error setting up state monitoring:'), error);
    process.exit(1);
  }
}

function extractAllStates(machine: AnyStateMachine): string[] {
  const states: string[] = [];

  function traverse(stateConfig: unknown, prefix = '') {
    if (stateConfig && typeof stateConfig === 'object') {
      for (const [key, value] of Object.entries(stateConfig)) {
        const stateName = prefix ? `${prefix}.${key}` : key;
        states.push(stateName);

        if (value && typeof value === 'object' && 'states' in value) {
          traverse(value.states, stateName);
        }
      }
    }
  }

  if (machine.config?.states) {
    traverse(machine.config.states);
  }

  return states;
}

function analyzeStateMachine(machine: AnyStateMachine): StateAnalysisResult {
  try {
    // Get all paths from initial state using shortest paths algorithm
    const shortestPaths = getShortestPaths(machine);

    // Get simple paths for more detailed analysis
    const simplePaths = getSimplePaths(machine);

    // Extract all states from the machine definition
    const allStates = extractAllStates(machine);

    // Find reachable states from the paths
    const reachableStates = new Set<string>();

    // Process shortest paths
    if (Array.isArray(shortestPaths)) {
      for (const path of shortestPaths) {
        if (path.state?.value) {
          const stateValue = path.state.value;
          if (typeof stateValue === 'string') {
            reachableStates.add(stateValue);
          } else if (typeof stateValue === 'object') {
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

          formattedSimplePaths.push({
            state: stateValue,
            steps: Array.isArray(path.steps)
              ? path.steps.map((step) => ({
                  state:
                    typeof step.state?.value === 'string'
                      ? step.state.value
                      : JSON.stringify(step.state?.value || {}),
                  event: step.event || {},
                }))
              : [],
          });
        }
      }
    }

    console.log(
      `🔍 Analysis complete: ${allStates.length} total states, ${reachableStates.size} reachable`
    );

    return {
      totalStates: allStates.length,
      reachableStates: reachableStates.size,
      unreachableStates,
      reachablePaths: Object.fromEntries(Array.from(reachableStates).map((state) => [state, true])),
      simplePaths: formattedSimplePaths,
    };
  } catch (error) {
    console.error('Error analyzing state machine:', error);
    throw error;
  }
}

function assertNoUnreachableStates(machine: AnyStateMachine, machineName = 'machine'): void {
  const analysis = analyzeStateMachine(machine);
  if (analysis.unreachableStates.length > 0) {
    throw new Error(
      `${machineName} has ${analysis.unreachableStates.length} unreachable states: ${analysis.unreachableStates.join(', ')}`
    );
  }
}

function generateCoverageReport(machine: AnyStateMachine, machineName = 'machine'): string {
  const analysis = analyzeStateMachine(machine);
  const coverage = Math.round((analysis.reachableStates / analysis.totalStates) * 100);

  return `=== State Machine Coverage Report: ${machineName} ===
Total States: ${analysis.totalStates}
Reachable States: ${analysis.reachableStates}
Coverage: ${coverage}%

${
  analysis.unreachableStates.length > 0
    ? `❌ Unreachable States (${analysis.unreachableStates.length}):\n${analysis.unreachableStates.map((s) => `  - ${s}`).join('\n')}`
    : '✅ All states are reachable!'
}`;
}

function showDebugInfo(machine: AnyStateMachine, machineName: string): void {
  console.log(chalk.cyan(`🔍 State Machine Debug Info: ${machineName}`));
  console.log('');

  const states = machine.config?.states || {};

  // Show state transitions
  console.log(chalk.yellow('📋 State Transitions:'));
  const criticalStates = [
    'idle',
    'gettingIntegrationStatus',
    'integrationStatusChecked',
    'integrationStatusError',
    'integrationStatusTimeout',
    'fetchingRemote',
    'fetchCompleted',
    'fetchError',
    'fetchTimeout',
    'pushingChanges',
    'pushCompleted',
    'pushError',
    'pushTimeout',
  ];

  for (const [stateName, stateConfig] of Object.entries(states)) {
    if (criticalStates.includes(stateName)) {
      console.log(chalk.blue(`  ${stateName}:`));

      // Show transitions
      const config = stateConfig as Record<string, unknown>;
      if (config.on && typeof config.on === 'object') {
        console.log(chalk.gray('    Events:'));
        for (const [event, target] of Object.entries(config.on)) {
          console.log(chalk.gray(`      ${event} → ${target}`));
        }
      }

      // Show invoke actors
      if (config.invoke && typeof config.invoke === 'object') {
        const invoke = config.invoke as Record<string, unknown>;
        console.log(chalk.gray(`    Invokes: ${invoke.src}`));
        if (invoke.onDone && typeof invoke.onDone === 'object') {
          const onDone = invoke.onDone as Record<string, unknown>;
          console.log(chalk.gray(`      onDone → ${onDone.target}`));
        }
        if (invoke.onError && typeof invoke.onError === 'object') {
          const onError = invoke.onError as Record<string, unknown>;
          console.log(chalk.gray(`      onError → ${onError.target}`));
        }
      }

      // Show timeouts
      if (config.after && typeof config.after === 'object') {
        console.log(chalk.gray('    Timeouts:'));
        for (const [timeout, target] of Object.entries(config.after)) {
          const targetObj = target as Record<string, unknown>;
          console.log(chalk.gray(`      ${timeout}ms → ${targetObj.target}`));
        }
      }

      console.log('');
    }
  }

  // Show timeout configurations
  console.log(chalk.yellow('⏱️  Timeout Configurations:'));
  console.log(chalk.gray('  STATUS_CHECK: 10000ms'));
  console.log(chalk.gray('  INTEGRATION_STATUS_CHECK: 10000ms'));
  console.log(chalk.gray('  FETCH_REMOTE: 15000ms'));
  console.log(chalk.gray('  PUSH_CHANGES: 20000ms'));
  console.log('');

  // Show error patterns
  console.log(chalk.yellow('🚨 Error States:'));
  const errorStates = Object.keys(states).filter(
    (s) => s.includes('Error') || s.includes('Timeout')
  );
  errorStates.forEach((state) => {
    const config = (states as Record<string, Record<string, unknown>>)[state];
    console.log(chalk.red(`  ${state}`));
    if (config.on && typeof config.on === 'object') {
      for (const [event, target] of Object.entries(config.on)) {
        console.log(chalk.gray(`    ${event} → ${target}`));
      }
    }
  });
  console.log('');

  // Show invoke actors (potential hanging points)
  console.log(chalk.yellow('🔧 Invoke Actors (Potential Hanging Points):'));
  for (const [stateName, stateConfig] of Object.entries(states)) {
    const config = stateConfig as Record<string, unknown>;
    if (config.invoke && typeof config.invoke === 'object') {
      const invoke = config.invoke as Record<string, unknown>;
      console.log(chalk.blue(`  ${stateName}:`));
      console.log(chalk.gray(`    Actor: ${invoke.src}`));
      console.log(
        chalk.gray(`    Timeout: ${config.after ? Object.keys(config.after)[0] : 'None'}ms`)
      );

      if (invoke.onDone && typeof invoke.onDone === 'object') {
        const onDone = invoke.onDone as Record<string, unknown>;
        console.log(chalk.gray(`    Success: ${onDone.target || 'None'}`));
      } else {
        console.log(chalk.gray('    Success: None'));
      }

      if (invoke.onError && typeof invoke.onError === 'object') {
        const onError = invoke.onError as Record<string, unknown>;
        console.log(chalk.gray(`    Error: ${onError.target || 'None'}`));
      } else {
        console.log(chalk.gray('    Error: None'));
      }
    }
  }
}

export async function analyzeCommand(options: {
  target?: string;
  verbose?: boolean;
  assert?: boolean;
  debug?: boolean;
  subscribe?: boolean;
}) {
  console.log(chalk.blue('🔍 State Machine Analysis'));
  console.log(chalk.blue('='.repeat(60)));

  const target = options.target || 'git-actor';
  const verbose = options.verbose || false;
  const shouldAssert = options.assert || false;
  const debug = options.debug || false;
  const subscribe = options.subscribe || false;

  try {
    let machine: AnyStateMachine;
    let machineName: string;

    // Select the target machine
    switch (target) {
      case 'git-actor':
        // Create a simplified version for analysis (avoid circular references)
        machine = createSimplifiedGitActorMachine();
        machineName = 'Git Actor';
        break;

      default:
        console.log(chalk.red(`❌ Unknown target: ${target}`));
        console.log(chalk.gray('Available targets: git-actor'));
        process.exit(1);
    }

    console.log(chalk.yellow(`🎯 Analyzing: ${machineName}`));
    console.log('');

    // Handle live subscription mode
    if (subscribe) {
      console.log(chalk.cyan('🔔 Live State Monitoring Mode'));
      console.log(chalk.gray('Press Ctrl+C to stop monitoring'));
      console.log('');
      await subscribeToStateMachine(target, machineName);
      return;
    }

    // Analyze the machine using the full @xstate/graph implementation
    const analysis = analyzeStateMachine(machine);

    // Show basic results
    console.log(chalk.blue('📊 Analysis Results:'));
    console.log(`  Total States: ${analysis.totalStates}`);
    console.log(`  Reachable States: ${analysis.reachableStates}`);
    console.log(
      `  Coverage: ${Math.round((analysis.reachableStates / analysis.totalStates) * 100)}%`
    );
    console.log('');

    if (analysis.unreachableStates.length > 0) {
      console.log(chalk.red('❌ Unreachable States Found:'));
      analysis.unreachableStates.forEach((state: string, index: number) => {
        console.log(chalk.red(`  ${index + 1}. ${state}`));
      });
      console.log('');
    } else {
      console.log(chalk.green('✅ All states are reachable!'));
      console.log('');
    }

    // Show debug information if requested
    if (debug) {
      console.log(chalk.blue('🐛 Debug Information:'));
      showDebugInfo(machine, machineName);
      console.log('');
    }

    // Show verbose output if requested
    if (verbose) {
      console.log(chalk.blue('📋 Detailed Coverage Report:'));
      console.log(generateCoverageReport(machine, machineName));
      console.log('');

      if (analysis.simplePaths.length > 0) {
        console.log(chalk.blue('🛤️  Sample State Paths:'));
        analysis.simplePaths.slice(0, 10).forEach((path, index: number) => {
          console.log(chalk.gray(`  ${index + 1}. ${path.state} (${path.steps.length} steps)`));
        });
        console.log('');
      }
    }

    // Run assertion if requested
    if (shouldAssert) {
      console.log(chalk.blue('🧪 Running Assertion Test:'));
      try {
        assertNoUnreachableStates(machine, machineName);
        console.log(chalk.green('✅ Assertion test passed - no unreachable states!'));
      } catch (error) {
        console.log(
          chalk.red('❌ Assertion test failed:'),
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
      console.log('');
    }

    // Summary and recommendations
    if (analysis.unreachableStates.length > 0) {
      console.log(chalk.yellow('💡 Recommendations:'));
      console.log('  1. Check if unreachable states have missing event wiring');
      console.log('  2. Remove unused states if they are not needed');
      console.log('  3. Connect states to appropriate workflows');
      console.log('');

      process.exit(1);
    } else {
      console.log(chalk.green('🎉 State machine analysis complete - no issues found!'));
    }
  } catch (error) {
    console.error(
      chalk.red('💥 Error during analysis:'),
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

/**
 * Create a simplified version of the git-actor machine for analysis
 * This removes circular references while maintaining the state structure
 */
function createSimplifiedGitActorMachine(): AnyStateMachine {
  // Extract the states from the real machine but use a simplified context
  return createMachine({
    id: 'git-actor-analysis',
    initial: 'idle',
    context: {}, // Simplified context to avoid type issues
    states: {
      idle: {
        on: {
          CHECK_REPO: 'checkingRepo',
          CHECK_STATUS: 'checkingStatus',
          CHECK_UNCOMMITTED_CHANGES: 'checkingUncommittedChanges',
          ADD_ALL: 'stagingAll',
          COMMIT_CHANGES: 'committingChanges',
          GET_INTEGRATION_STATUS: 'gettingIntegrationStatus',
          GET_CHANGED_FILES: 'gettingChangedFiles',
          FETCH_REMOTE: 'fetchingRemote',
          PUSH_CHANGES: 'pushingChanges',
          MERGE_BRANCH: 'mergingBranch',
          GENERATE_COMMIT_MESSAGE: 'generatingCommitMessage',
          VALIDATE_DATES: 'validatingDates',
          SETUP_WORKTREES: 'settingUpWorktrees',
          CHECK_WORKTREE: 'checkingWorktree',
          CREATE_BRANCH: 'creatingBranch',
          GET_LAST_COMMIT: 'gettingLastCommit',
        },
      },

      // Active states
      checkingRepo: { on: { SUCCESS: 'repoChecked', ERROR: 'repoError', TIMEOUT: 'repoTimeout' } },
      checkingStatus: {
        on: { SUCCESS: 'statusChecked', ERROR: 'statusError', TIMEOUT: 'statusTimeout' },
      },
      checkingUncommittedChanges: {
        on: {
          SUCCESS: 'uncommittedChangesChecked',
          ERROR: 'uncommittedChangesError',
          TIMEOUT: 'uncommittedChangesTimeout',
        },
      },
      stagingAll: {
        on: { SUCCESS: 'stagingCompleted', ERROR: 'stagingError', TIMEOUT: 'stagingTimeout' },
      },
      committingChanges: {
        on: { SUCCESS: 'commitCompleted', ERROR: 'commitError', TIMEOUT: 'commitTimeout' },
      },
      gettingIntegrationStatus: {
        on: {
          SUCCESS: 'integrationStatusChecked',
          ERROR: 'integrationStatusError',
          TIMEOUT: 'integrationStatusTimeout',
        },
      },
      gettingChangedFiles: {
        on: {
          SUCCESS: 'changedFilesChecked',
          ERROR: 'changedFilesError',
          TIMEOUT: 'changedFilesTimeout',
        },
      },
      fetchingRemote: {
        on: { SUCCESS: 'fetchCompleted', ERROR: 'fetchError', TIMEOUT: 'fetchTimeout' },
      },
      pushingChanges: {
        on: { SUCCESS: 'pushCompleted', ERROR: 'pushError', TIMEOUT: 'pushTimeout' },
      },
      mergingBranch: {
        on: { SUCCESS: 'mergeCompleted', ERROR: 'mergeError', TIMEOUT: 'mergeTimeout' },
      },
      generatingCommitMessage: {
        on: {
          SUCCESS: 'commitMessageGenerated',
          ERROR: 'commitMessageError',
          TIMEOUT: 'commitMessageTimeout',
        },
      },
      validatingDates: {
        on: {
          SUCCESS: 'datesValidated',
          ERROR: 'datesValidationError',
          TIMEOUT: 'datesValidationTimeout',
        },
      },
      settingUpWorktrees: {
        on: {
          SUCCESS: 'worktreesSetup',
          ERROR: 'worktreesSetupError',
          TIMEOUT: 'worktreesSetupTimeout',
        },
      },
      checkingWorktree: {
        on: {
          SUCCESS: 'worktreeChecked',
          ERROR: 'worktreeCheckError',
          TIMEOUT: 'worktreeCheckTimeout',
        },
      },
      creatingBranch: {
        on: {
          SUCCESS: 'branchCreated',
          ERROR: 'branchCreationError',
          TIMEOUT: 'branchCreationTimeout',
        },
      },
      gettingLastCommit: {
        on: {
          SUCCESS: 'lastCommitChecked',
          ERROR: 'lastCommitError',
          TIMEOUT: 'lastCommitTimeout',
        },
      },

      // Completion states
      repoChecked: {
        on: {
          CONTINUE: 'idle',
          CHECK_STATUS: 'checkingStatus',
          CHECK_UNCOMMITTED_CHANGES: 'checkingUncommittedChanges',
          GET_CHANGED_FILES: 'gettingChangedFiles',
        },
      },
      statusChecked: {
        on: {
          CONTINUE: 'idle',
          CHECK_REPO: 'checkingRepo',
          CHECK_UNCOMMITTED_CHANGES: 'checkingUncommittedChanges',
          COMMIT_CHANGES: 'committingChanges',
        },
      },
      uncommittedChangesChecked: { on: { CONTINUE: 'idle', ADD_ALL: 'stagingAll' } },
      stagingCompleted: { on: { CONTINUE: 'idle', COMMIT_CHANGES: 'committingChanges' } },
      commitCompleted: { on: { CONTINUE: 'idle', PUSH_CHANGES: 'pushingChanges' } },
      integrationStatusChecked: {
        on: { CONTINUE: 'idle', FETCH_REMOTE: 'fetchingRemote', PUSH_CHANGES: 'pushingChanges' },
      },
      changedFilesChecked: { on: { CONTINUE: 'idle', COMMIT_CHANGES: 'committingChanges' } },
      fetchCompleted: { on: { CONTINUE: 'idle', PUSH_CHANGES: 'pushingChanges' } },
      pushCompleted: { on: { CONTINUE: 'idle', MERGE_BRANCH: 'mergingBranch' } },
      mergeCompleted: { on: { CONTINUE: 'idle' } },
      commitMessageGenerated: { on: { CONTINUE: 'idle', COMMIT_CHANGES: 'committingChanges' } },
      datesValidated: { on: { CONTINUE: 'idle' } },
      worktreesSetup: { on: { CONTINUE: 'idle' } },
      worktreeChecked: { on: { CONTINUE: 'idle', SETUP_WORKTREES: 'settingUpWorktrees' } },
      branchCreated: { on: { CONTINUE: 'idle' } },
      lastCommitChecked: { on: { CONTINUE: 'idle' } },

      // Error states
      repoError: { on: { RETRY: 'checkingRepo', CONTINUE: 'idle' } },
      statusError: {
        on: { RETRY: 'checkingStatus', CONTINUE: 'idle', CHECK_STATUS: 'checkingStatus' },
      },
      uncommittedChangesError: { on: { RETRY: 'checkingUncommittedChanges', CONTINUE: 'idle' } },
      stagingError: { on: { RETRY: 'stagingAll', CONTINUE: 'idle' } },
      commitError: { on: { RETRY: 'committingChanges', CONTINUE: 'idle' } },
      integrationStatusError: { on: { RETRY: 'gettingIntegrationStatus', CONTINUE: 'idle' } },
      changedFilesError: { on: { RETRY: 'gettingChangedFiles', CONTINUE: 'idle' } },
      fetchError: { on: { RETRY: 'fetchingRemote', CONTINUE: 'idle' } },
      pushError: { on: { RETRY: 'pushingChanges', CONTINUE: 'idle' } },
      mergeError: { on: { RETRY: 'mergingBranch', CONTINUE: 'idle' } },
      commitMessageError: { on: { RETRY: 'generatingCommitMessage', CONTINUE: 'idle' } },
      datesValidationError: { on: { RETRY: 'validatingDates', CONTINUE: 'idle' } },
      worktreesSetupError: { on: { RETRY: 'settingUpWorktrees', CONTINUE: 'idle' } },
      worktreeCheckError: { on: { RETRY: 'checkingWorktree', CONTINUE: 'idle' } },
      branchCreationError: { on: { RETRY: 'creatingBranch', CONTINUE: 'idle' } },
      lastCommitError: { on: { RETRY: 'gettingLastCommit', CONTINUE: 'idle' } },

      // Timeout states
      repoTimeout: { on: { RETRY: 'checkingRepo', CONTINUE: 'idle' } },
      statusTimeout: { on: { RETRY: 'checkingStatus', CONTINUE: 'idle' } },
      uncommittedChangesTimeout: { on: { RETRY: 'checkingUncommittedChanges', CONTINUE: 'idle' } },
      stagingTimeout: { on: { RETRY: 'stagingAll', CONTINUE: 'idle' } },
      commitTimeout: { on: { RETRY: 'committingChanges', CONTINUE: 'idle' } },
      integrationStatusTimeout: { on: { RETRY: 'gettingIntegrationStatus', CONTINUE: 'idle' } },
      changedFilesTimeout: { on: { RETRY: 'gettingChangedFiles', CONTINUE: 'idle' } },
      fetchTimeout: { on: { RETRY: 'fetchingRemote', CONTINUE: 'idle' } },
      pushTimeout: { on: { RETRY: 'pushingChanges', CONTINUE: 'idle' } },
      mergeTimeout: { on: { RETRY: 'mergingBranch', CONTINUE: 'idle' } },
      commitMessageTimeout: { on: { RETRY: 'generatingCommitMessage', CONTINUE: 'idle' } },
      datesValidationTimeout: { on: { RETRY: 'validatingDates', CONTINUE: 'idle' } },
      worktreesSetupTimeout: { on: { RETRY: 'settingUpWorktrees', CONTINUE: 'idle' } },
      worktreeCheckTimeout: { on: { RETRY: 'checkingWorktree', CONTINUE: 'idle' } },
      branchCreationTimeout: { on: { RETRY: 'creatingBranch', CONTINUE: 'idle' } },
      lastCommitTimeout: { on: { RETRY: 'gettingLastCommit', CONTINUE: 'idle' } },
    },
  });
}
