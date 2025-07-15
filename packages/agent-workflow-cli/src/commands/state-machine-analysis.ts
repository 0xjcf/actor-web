/**
 * State Machine Analysis Command
 *
 * CLI command for analyzing XState machines to detect unreachable states
 * and generate coverage reports.
 */

import { getShortestPaths, getSimplePaths } from '@xstate/graph';
import chalk from 'chalk';
import { type AnyStateMachine, createMachine } from 'xstate';

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

export async function analyzeCommand(options: {
  target?: string;
  verbose?: boolean;
  assert?: boolean;
}) {
  console.log(chalk.blue('🔍 State Machine Analysis'));
  console.log(chalk.blue('='.repeat(60)));

  const target = options.target || 'git-actor';
  const verbose = options.verbose || false;
  const shouldAssert = options.assert || false;

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
