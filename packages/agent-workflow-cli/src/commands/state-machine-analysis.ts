/**
 * State Machine Analysis Command
 *
 * CLI command for analyzing XState machines to detect unreachable states
 * and generate coverage reports.
 */

import readline from 'node:readline';
import type { ActorSnapshot } from '@actor-core/runtime';
import {
  analyzeStateMachine,
  assertNoUnreachableStates,
  generateCoverageReport,
} from '@actor-core/testing';
import chalk from 'chalk';
import type { AnyStateMachine } from 'xstate';
import { createGitActor, type GitEvent, gitActorMachine } from '../actors/git-actor';
import { findRepoRoot } from '../core/repo-root-finder';

// Full implementation with @xstate/graph
// Using analyzeStateMachine, assertNoUnreachableStates, generateCoverageReport from @actor-web/core

function extractAllEvents(machine: AnyStateMachine): string[] {
  const events = new Set<string>();

  // Auto-detect events from machine configuration
  const config = machine.config;

  function extractFromState(stateConfig: Record<string, unknown>): void {
    if (!stateConfig || typeof stateConfig !== 'object') return;

    // Extract events from 'on' property
    if (stateConfig.on) {
      Object.keys(stateConfig.on).forEach((event) => {
        if (event !== '') events.add(event);
      });
    }

    // Extract events from 'always' transitions
    if (stateConfig.always) {
      const always = Array.isArray(stateConfig.always) ? stateConfig.always : [stateConfig.always];
      always.forEach((transition: Record<string, unknown>) => {
        if (transition.guard && typeof transition.guard === 'string') {
          // Extract event patterns from guards if needed
        }
      });
    }

    // Recursively check nested states
    if (stateConfig.states) {
      Object.values(stateConfig.states).forEach((nestedState) => {
        extractFromState(nestedState as Record<string, unknown>);
      });
    }
  }

  extractFromState(config);
  return Array.from(events).sort();
}

function extractAvailableEvents(machine: AnyStateMachine, currentState: string): string[] {
  const config = machine.config;
  const events = new Set<string>();

  function findStateConfig(
    stateId: string,
    stateConfig: Record<string, unknown> = config
  ): Record<string, unknown> | null {
    if (!stateConfig || typeof stateConfig !== 'object') return null;

    // Check if this is the target state
    if (stateId === 'idle' && !stateConfig.states) {
      return stateConfig;
    }

    // Check nested states
    if (stateConfig.states) {
      if ((stateConfig.states as Record<string, unknown>)[stateId]) {
        return (stateConfig.states as Record<string, unknown>)[stateId] as Record<string, unknown>;
      }

      // Recursively search nested states
      for (const nestedState of Object.values(stateConfig.states)) {
        const found = findStateConfig(stateId, nestedState as Record<string, unknown>);
        if (found) return found;
      }
    }

    return null;
  }

  const stateConfig = findStateConfig(currentState);
  if (stateConfig?.on) {
    Object.keys(stateConfig.on).forEach((event) => {
      if (event !== '') events.add(event);
    });
  }

  return Array.from(events).sort();
}

async function _subscribeToStateMachine(target: string, _machineName: string): Promise<void> {
  if (target !== 'git-actor') {
    console.log(chalk.red('❌ Live monitoring only supported for git-actor'));
    return;
  }

  try {
    const repoRoot = await findRepoRoot();
    const gitActor = createGitActor(repoRoot);

    // Use the real machine definition - no more simplified copy!
    const machine = gitActorMachine;
    const allEvents = extractAllEvents(machine);

    console.log(chalk.blue('🚀 Starting Git Actor...'));
    gitActor.start();

    let stateCount = 0;
    let currentState = 'idle';
    const startTime = Date.now();

    // Subscribe to state changes
    const stateObserver = gitActor
      .observe((snapshot: ActorSnapshot<unknown>) => snapshot.value)
      .subscribe((state) => {
        stateCount++;
        currentState = String(state);
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        const elapsed = Date.now() - startTime;

        console.log(
          chalk.green(
            `[${timestamp}] State #${stateCount} (${elapsed}ms): ${chalk.bold(currentState)}`
          )
        );

        // Show available events for current state
        const availableEvents = extractAvailableEvents(machine, currentState);
        if (availableEvents.length > 0) {
          console.log(chalk.gray(`  Available events: ${availableEvents.join(', ')}`));
        }
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
        if (ctx.integrationStatus) {
          console.log(
            chalk.green(`  📊 Integration Status: ${JSON.stringify(ctx.integrationStatus)}`)
          );
        }
        if (ctx.currentBranch) {
          console.log(chalk.cyan(`  🌿 Current Branch: ${ctx.currentBranch}`));
        }
      });

    console.log(chalk.yellow('📍 Initial state check...'));
    gitActor.send({ type: 'CHECK_STATUS' });

    // Show interactive help
    console.log(chalk.gray(''));
    console.log(chalk.gray('Interactive State Machine Simulator:'));
    console.log(chalk.gray('  Type any event name to trigger it'));
    console.log(chalk.gray('  Special commands:'));
    console.log(chalk.gray('    help - Show available events'));
    console.log(chalk.gray('    state - Show current state'));
    console.log(chalk.gray('    events - Show all events'));
    console.log(chalk.gray('    q - Quit'));
    console.log(chalk.gray(''));

    // Set up stdin for interactive commands
    process.stdin.setRawMode(false); // Use line mode for better input handling
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.blue('> '),
    });

    rl.prompt();

    rl.on('line', (input: string) => {
      const command = input.trim();

      if (command === 'q' || command === 'quit') {
        console.log(chalk.yellow('🛑 Stopping state monitoring...'));
        rl.close();
        stateObserver.unsubscribe();
        contextObserver.unsubscribe();
        gitActor.stop();
        process.exit(0);
      } else if (command === 'help') {
        const availableEvents = extractAvailableEvents(machine, currentState);
        console.log(chalk.cyan(`Available events for state "${currentState}":`));
        availableEvents.forEach((event: string) => {
          console.log(chalk.gray(`  - ${event}`));
        });
      } else if (command === 'state') {
        console.log(chalk.cyan(`Current state: ${currentState}`));
        const availableEvents = extractAvailableEvents(machine, currentState);
        console.log(chalk.gray(`Available events: ${availableEvents.join(', ')}`));
      } else if (command === 'events') {
        console.log(chalk.cyan('All available events:'));
        allEvents.forEach((event: string) => {
          console.log(chalk.gray(`  - ${event}`));
        });
      } else if (command.length > 0) {
        // Try to send as an event
        const eventName = command.toUpperCase();

        if (allEvents.includes(eventName)) {
          const availableEvents = extractAvailableEvents(machine, currentState);

          if (availableEvents.includes(eventName)) {
            console.log(chalk.cyan(`🔄 Triggering event: ${eventName}`));

            // Add special handling for events that need parameters
            if (eventName === 'GET_INTEGRATION_STATUS') {
              gitActor.send({
                type: eventName as 'GET_INTEGRATION_STATUS',
                integrationBranch: 'feature/actor-ref-integration',
              });
            } else if (eventName === 'COMMIT_CHANGES') {
              gitActor.send({
                type: eventName as 'COMMIT_CHANGES',
                message: 'Interactive test commit',
              });
            } else if (eventName === 'FETCH_REMOTE' || eventName === 'PUSH_CHANGES') {
              gitActor.send({
                type: eventName as 'FETCH_REMOTE' | 'PUSH_CHANGES',
                branch: 'feature/actor-ref-integration',
              });
            } else {
              gitActor.send({ type: eventName } as unknown as Parameters<typeof gitActor.send>[0]);
            }
          } else {
            console.log(
              chalk.red(`❌ Event "${eventName}" not available in current state "${currentState}"`)
            );
            console.log(chalk.gray(`Available events: ${availableEvents.join(', ')}`));
          }
        } else {
          console.log(chalk.red(`❌ Unknown event: ${eventName}`));
          console.log(chalk.gray('Type "events" to see all available events'));
        }
      }

      rl.prompt();
    });

    // Set up cleanup on exit
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n🛑 Stopping state monitoring...'));
      rl.close();
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

// Function to create properly typed events
function createEventFromString(eventName: string, eventData: Record<string, unknown>): GitEvent {
  // Handle events that need parameters
  if (eventName === 'GET_INTEGRATION_STATUS') {
    return {
      type: 'GET_INTEGRATION_STATUS' as const,
      integrationBranch: (eventData.integrationBranch as string) || 'feature/actor-ref-integration',
    };
  }

  if (eventName === 'COMMIT_CHANGES') {
    return {
      type: 'COMMIT_CHANGES' as const,
      message: (eventData.message as string) || 'Interactive test commit',
    };
  }

  if (eventName === 'FETCH_REMOTE') {
    return {
      type: 'FETCH_REMOTE' as const,
      branch: (eventData.branch as string) || 'feature/actor-ref-integration',
    };
  }

  if (eventName === 'PUSH_CHANGES') {
    return {
      type: 'PUSH_CHANGES' as const,
      branch: (eventData.branch as string) || 'feature/actor-ref-integration',
    };
  }

  if (eventName === 'MERGE_BRANCH') {
    return {
      type: 'MERGE_BRANCH' as const,
      branch: (eventData.branch as string) || 'feature/actor-ref-integration',
      strategy: (eventData.strategy as 'merge' | 'rebase') || 'merge',
    };
  }

  if (eventName === 'VALIDATE_DATES') {
    return {
      type: 'VALIDATE_DATES' as const,
      filePaths: (eventData.filePaths as string[]) || ['docs/README.md'],
    };
  }

  if (eventName === 'SETUP_WORKTREES') {
    return {
      type: 'SETUP_WORKTREES' as const,
      agentCount: (eventData.agentCount as number) || 3,
      configOptions: eventData.configOptions as Record<string, unknown> | undefined,
    };
  }

  if (eventName === 'CHECK_WORKTREE') {
    return {
      type: 'CHECK_WORKTREE' as const,
      path: (eventData.path as string) || '../agent-workspace',
    };
  }

  if (eventName === 'CREATE_BRANCH') {
    return {
      type: 'CREATE_BRANCH' as const,
      branchName: (eventData.branchName as string) || 'feature/test-branch',
    };
  }

  // For simple events without parameters, cast to GitEvent
  return { type: eventName } as GitEvent;
}

async function subscribeToStateMachineWithEvents(
  target: string,
  _machineName: string,
  eventsToSend: string[],
  eventDelay: number,
  eventData: Record<string, unknown>,
  autoRun: boolean
): Promise<void> {
  if (target !== 'git-actor') {
    console.log(chalk.red('❌ Live monitoring only supported for git-actor'));
    return;
  }

  try {
    const repoRoot = await findRepoRoot();
    const gitActor = createGitActor(repoRoot);

    // Use the real machine definition - no more simplified copy!
    const machine = gitActorMachine;
    const allEvents = extractAllEvents(machine);

    console.log(chalk.blue('🚀 Starting Git Actor...'));
    gitActor.start();

    let currentState = 'idle';
    const startTime = Date.now();

    // Subscribe to state changes
    const stateObserver = gitActor
      .observe((snapshot: ActorSnapshot<unknown>) => snapshot.value)
      .subscribe((state) => {
        currentState = String(state);
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        const _elapsed = Date.now() - startTime;

        console.log(chalk.green(`[${timestamp}] State: ${chalk.bold(currentState)}`));

        // Show available events for current state
        const availableEvents = extractAvailableEvents(machine, currentState);
        if (availableEvents.length > 0) {
          console.log(chalk.gray(`  Available events: ${availableEvents.join(', ')}`));
        }
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
        if (ctx.integrationStatus) {
          console.log(
            chalk.green(`  📊 Integration Status: ${JSON.stringify(ctx.integrationStatus)}`)
          );
        }
        if (ctx.currentBranch) {
          console.log(chalk.cyan(`  🌿 Current Branch: ${ctx.currentBranch}`));
        }
      });

    console.log(chalk.yellow('📍 Initial state check...'));
    gitActor.send({ type: 'CHECK_STATUS' });

    // Send events in sequence if autoRun is true
    if (autoRun) {
      console.log(chalk.yellow('🚀 Auto-running events...'));
      for (const eventName of eventsToSend) {
        if (allEvents.includes(eventName)) {
          const availableEvents = extractAvailableEvents(machine, currentState);
          if (availableEvents.includes(eventName)) {
            console.log(chalk.cyan(`🔄 Triggering event: ${eventName}`));
            const event = createEventFromString(eventName, eventData);
            gitActor.send(event);
            await new Promise((resolve) => setTimeout(resolve, eventDelay));
          } else {
            console.log(
              chalk.red(`❌ Event "${eventName}" not available in current state "${currentState}"`)
            );
            console.log(chalk.gray(`Available events: ${availableEvents.join(', ')}`));
          }
        } else {
          console.log(chalk.red(`❌ Unknown event: ${eventName}`));
          console.log(chalk.gray('Type "events" to see all available events'));
        }
      }
      console.log(chalk.green('✅ Auto-run complete.'));
    } else {
      // Show interactive help
      console.log(chalk.gray(''));
      console.log(chalk.gray('Interactive State Machine Simulator:'));
      console.log(chalk.gray('  Type any event name to trigger it'));
      console.log(chalk.gray('  Special commands:'));
      console.log(chalk.gray('    help - Show available events'));
      console.log(chalk.gray('    state - Show current state'));
      console.log(chalk.gray('    events - Show all events'));
      console.log(chalk.gray('    q - Quit'));
      console.log(chalk.gray(''));

      // Set up stdin for interactive commands
      process.stdin.setRawMode(false); // Use line mode for better input handling
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.blue('> '),
      });

      rl.prompt();

      rl.on('line', (input: string) => {
        const command = input.trim();

        if (command === 'q' || command === 'quit') {
          console.log(chalk.yellow('🛑 Stopping state monitoring...'));
          rl.close();
          stateObserver.unsubscribe();
          contextObserver.unsubscribe();
          gitActor.stop();
          process.exit(0);
        } else if (command === 'help') {
          const availableEvents = extractAvailableEvents(machine, currentState);
          console.log(chalk.cyan(`Available events for state "${currentState}":`));
          availableEvents.forEach((event: string) => {
            console.log(chalk.gray(`  - ${event}`));
          });
        } else if (command === 'state') {
          console.log(chalk.cyan(`Current state: ${currentState}`));
          const availableEvents = extractAvailableEvents(machine, currentState);
          console.log(chalk.gray(`Available events: ${availableEvents.join(', ')}`));
        } else if (command === 'events') {
          console.log(chalk.cyan('All available events:'));
          allEvents.forEach((event: string) => {
            console.log(chalk.gray(`  - ${event}`));
          });
        } else if (command.length > 0) {
          // Try to send as an event
          const eventName = command.toUpperCase();

          if (allEvents.includes(eventName)) {
            const availableEvents = extractAvailableEvents(machine, currentState);

            if (availableEvents.includes(eventName)) {
              console.log(chalk.cyan(`🔄 Triggering event: ${eventName}`));
              const event = createEventFromString(eventName, eventData);
              gitActor.send(event);
            } else {
              console.log(
                chalk.red(
                  `❌ Event "${eventName}" not available in current state "${currentState}"`
                )
              );
              console.log(chalk.gray(`Available events: ${availableEvents.join(', ')}`));
            }
          } else {
            console.log(chalk.red(`❌ Unknown event: ${eventName}`));
            console.log(chalk.gray('Type "events" to see all available events'));
          }
        }

        rl.prompt();
      });

      // Set up cleanup on exit
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\n🛑 Stopping state monitoring...'));
        rl.close();
        stateObserver.unsubscribe();
        contextObserver.unsubscribe();
        gitActor.stop();
        process.exit(0);
      });

      // Keep the process alive
      await new Promise(() => {});
    }
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
    const allEvents = extractAllEvents(machine);
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
    console.log(chalk.green('✅ Machine validation passed'));
  } else {
    console.log(chalk.red('❌ Machine validation failed'));
  }

  if (results.errors.length > 0) {
    console.log(chalk.red('Errors:'));
    results.errors.forEach((error) => console.log(chalk.red(`  - ${error}`)));
  }

  if (results.warnings.length > 0) {
    console.log(chalk.yellow('Warnings:'));
    results.warnings.forEach((warning) => console.log(chalk.yellow(`  - ${warning}`)));
  }
}

// NEW: Display workflow analysis results
function displayWorkflowAnalysisResults(results: { errors: string[]; warnings: string[] }): void {
  if (results.errors.length === 0 && results.warnings.length === 0) {
    console.log(chalk.green('✅ Workflow analysis passed - no issues found!'));
    return;
  }

  if (results.errors.length > 0) {
    console.log(chalk.red('❌ Workflow Errors:'));
    results.errors.forEach((error) => console.log(chalk.red(`  - ${error}`)));
  }

  if (results.warnings.length > 0) {
    console.log(chalk.yellow('⚠️  Workflow Warnings:'));
    results.warnings.forEach((warning) => console.log(chalk.yellow(`  - ${warning}`)));
  }

  // Provide generic recommendations based on errors
  if (results.errors.length > 0) {
    console.log(chalk.cyan('💡 Generic Workflow Recommendations:'));

    if (results.errors.some((e) => e.includes('dead-end states'))) {
      console.log(chalk.gray('  - Review states with no outgoing transitions'));
      console.log(
        chalk.gray('  - Consider adding transitions to continue workflow or mark as final states')
      );
    }

    if (results.warnings.some((w) => w.includes('Final states with outgoing transitions'))) {
      console.log(chalk.gray('  - Final states typically should not have outgoing transitions'));
      console.log(
        chalk.gray('  - Consider if these states should be final or have different transitions')
      );
    }

    if (results.warnings.some((w) => w.includes('no incoming transitions'))) {
      console.log(chalk.gray('  - Review states that may be unreachable'));
      console.log(chalk.gray('  - Ensure states have proper entry points or remove if unused'));
    }
  }
}

function showDebugInfo(machine: AnyStateMachine, _machineName: string): void {
  console.log('');

  const allEvents = extractAllEvents(machine);
  console.log(`Machine ID: ${machine.id || 'not specified'}`);
  console.log(`Machine Type: ${machine.config.type || 'not specified'}`);
  console.log(`Total Events: ${allEvents.length}`);

  if (allEvents.length > 0) {
    console.log('All Events:');
    allEvents.forEach((event: string) => console.log(`  - ${event}`));
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
  console.log(chalk.blue('🔍 State Machine Analysis'));
  console.log(chalk.blue('='.repeat(60)));

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
  const autoRun = options.autoRun || false;

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
        console.log(chalk.red(`❌ Unknown target: ${target}`));
        console.log(chalk.gray('Available targets: git-actor'));
        process.exit(1);
    }

    console.log(chalk.yellow(`🎯 Analyzing: ${machineName}`));
    console.log('');

    // Handle automated event sending or live subscription mode
    if (subscribe || eventsToSend.length > 0) {
      console.log(chalk.cyan('🔔 Live State Monitoring Mode'));
      console.log(chalk.gray('Press Ctrl+C to stop monitoring'));
      console.log('');

      if (eventsToSend.length > 0) {
        console.log(chalk.yellow(`🎯 Automated Event Sequence: ${eventsToSend.join(' → ')}`));
        console.log(chalk.gray(`⏱️  Event Delay: ${eventDelay}ms`));
        console.log('');
      }

      await subscribeToStateMachineWithEvents(
        target,
        machineName,
        eventsToSend,
        eventDelay,
        eventData,
        autoRun
      );
      return;
    }

    // Analyze the machine using the full @xstate/graph implementation
    const analysis = analyzeStateMachineData(machine);

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

    // Run comprehensive validation if requested
    if (validate) {
      console.log(chalk.blue('🔍 Comprehensive Validation:'));
      const validationResults = validateStateMachine(machine, machineName);
      displayValidationResults(validationResults);
      console.log('');
    }

    // NEW: Run workflow analysis if requested
    if (workflow) {
      console.log(chalk.blue('⚙️  Workflow Analysis:'));
      const workflowIssues = analyzeWorkflowCompleteness(machine);
      displayWorkflowAnalysisResults(workflowIssues);
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

      // Handle git-actor separately due to circular reference issues
      if (target === 'git-actor') {
        console.log(chalk.yellow('Git Actor Analysis:'));
        console.log(`  Machine ID: ${machine.id}`);
        console.log(`  Total States: ${analysis.totalStates}`);
        console.log(`  All States: ${analysis.allStates.join(', ')}`);
        console.log('  Note: Detailed path analysis unavailable due to circular references');
      } else {
        try {
          console.log(generateCoverageReport(machine, machineName));
        } catch (_error) {
          console.log(chalk.red('❌ Coverage report unavailable due to analysis limitations'));
        }
      }

      console.log('');

      if (analysis.simplePaths.length > 0) {
        console.log(chalk.blue('🛤️  Sample State Paths:'));
        analysis.simplePaths.slice(0, 10).forEach(
          (
            path: {
              state: string;
              steps: Array<{ state: string; event: Record<string, unknown> }>;
            },
            index: number
          ) => {
            console.log(chalk.gray(`  ${index + 1}. ${path.state} (${path.steps.length} steps)`));
          }
        );
        console.log('');
      } else if (target === 'git-actor') {
        console.log(chalk.blue('🛤️  Sample States:'));
        analysis.allStates.slice(0, 10).forEach((state, index) => {
          console.log(chalk.gray(`  ${index + 1}. ${state}`));
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
