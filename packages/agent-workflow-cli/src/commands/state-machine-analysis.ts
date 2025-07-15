/**
 * State Machine Analysis Command
 *
 * CLI command for analyzing XState machines to detect unreachable states
 * and generate coverage reports.
 *
 * STANDARDIZED ACTOR PATTERN INTEGRATION
 * ====================================
 *
 * This command now uses the standardized actor patterns:
 * - Uses ActorRegistry for actor discovery
 * - Subscribes to standardized event emissions
 * - Implements proper actor lifecycle management
 * - Follows the ACTOR-STANDARDIZATION-GUIDE.md patterns
 *
 * ENHANCED INTERACTIVE FEATURES
 * ============================
 *
 * - Autocomplete for available events (Tab completion)
 * - Real-time color feedback (green for available, red for unavailable)
 * - Smart suggestions and fuzzy matching
 * - Enhanced developer experience
 */

import readline from 'node:readline';
import type { ActorSnapshot } from '@actor-core/runtime';
import { enableDevMode, Logger } from '@actor-core/runtime';
import {
  analyzeStateMachine,
  assertNoUnreachableStates,
  generateCoverageReport,
} from '@actor-core/testing';
import chalk from 'chalk';
import type { AnyStateMachine } from 'xstate';

// Create scoped logger for state machine analysis
const log = Logger.namespace('STATE_MACHINE_ANALYSIS');

import {
  createGitActor,
  type GitEmittedEvent,
  type GitEvent,
  gitActorMachine,
  listGitActors,
} from '../actors/git-actor';
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

// ============================================================================
// ENHANCED INTERACTIVE FEATURES
// ============================================================================

/**
 * Enhanced readline interface with autocomplete and real-time feedback
 */
class EnhancedReadline {
  private rl: readline.Interface;
  private allEvents: string[];
  private availableEvents: string[];
  private specialCommands: string[];
  private currentInput = '';
  private suggestions: string[] = [];

  constructor(
    allEvents: string[],
    availableEvents: string[],
    onLine: (input: string) => void,
    onClose: () => void
  ) {
    this.allEvents = allEvents;
    this.availableEvents = availableEvents;
    this.specialCommands = [
      'help',
      'state',
      'events',
      'status',
      'registry',
      'completions',
      'q',
      'quit',
      'exit',
    ];

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.blue('> '),
      completer: this.completer.bind(this),
      history: [],
      terminal: true,
    });

    this.setupEventHandlers(onLine, onClose);
  }

  private completer(line: string): [string[], string] {
    const input = line.trim();
    const upperInput = input.toUpperCase();

    // Match special commands (case-insensitive)
    const specialMatches = this.specialCommands.filter((cmd) =>
      cmd.toLowerCase().startsWith(input.toLowerCase())
    );

    // Match available events (uppercase)
    const exactEventMatches = this.availableEvents.filter((event) => event.startsWith(upperInput));

    // Fuzzy match available events
    const fuzzyEventMatches = this.availableEvents.filter(
      (event) => !event.startsWith(upperInput) && event.includes(upperInput)
    );

    // Combine all matches, prioritizing exact matches
    const allMatches = [...specialMatches, ...exactEventMatches, ...fuzzyEventMatches];

    return [allMatches, line];
  }

  private updatePromptWithFeedback(input: string) {
    if (input.length === 0) {
      this.rl.setPrompt(chalk.blue('> '));
    } else {
      const validation = this.validateInput(input);
      const status = validation.isValid ? '✓' : '✗';
      const color = validation.color;
      this.rl.setPrompt(color(`${status} > `));
    }
    this.rl.prompt();
  }

  private setupEventHandlers(onLine: (input: string) => void, onClose: () => void) {
    this.rl.on('line', (input: string) => {
      this.currentInput = '';

      // Show immediate validation feedback
      if (input.trim().length > 0) {
        const validation = this.validateInput(input.trim());
        const status = validation.isValid ? '✓' : '✗';
        const color = validation.color;
        console.log(color(`${status} ${input.trim()}`));

        if (!validation.isValid && validation.message) {
          console.log(chalk.red(`   ${validation.message}`));
        }
      }

      onLine(input);
      this.resetPrompt();
    });

    this.rl.on('close', onClose);

    // Enhanced tab completion feedback - prevent duplicate messages
    let sigintHandled = false;
    this.rl.on('SIGINT', () => {
      if (!sigintHandled) {
        sigintHandled = true;
        console.log(
          chalk.yellow(
            '\n💡 Tip: Use Tab for autocomplete, type "help" for available commands, or "q" to quit'
          )
        );
        setTimeout(() => {
          sigintHandled = false;
        }, 1000); // Reset after 1 second
      }
      this.resetPrompt();
    });
  }

  showCompletionHints() {
    const currentLine = this.rl.line || '';
    const input = currentLine.trim();

    if (input.length > 0) {
      const upperInput = input.toUpperCase();

      // Find matches
      const specialMatches = this.specialCommands.filter((cmd) =>
        cmd.toLowerCase().startsWith(input.toLowerCase())
      );

      const exactEventMatches = this.availableEvents.filter((event) =>
        event.startsWith(upperInput)
      );

      const fuzzyEventMatches = this.availableEvents.filter(
        (event) => !event.startsWith(upperInput) && event.includes(upperInput)
      );

      const allMatches = [...specialMatches, ...exactEventMatches, ...fuzzyEventMatches];

      if (allMatches.length > 0) {
        console.log(chalk.gray(`\n💡 ${allMatches.length} completions:`));
        allMatches.slice(0, 8).forEach((match) => {
          const isAvailable =
            this.availableEvents.includes(match) || this.specialCommands.includes(match);
          const color = isAvailable ? chalk.green : chalk.red;
          const status = isAvailable ? '✓' : '✗';
          console.log(color(`  ${status} ${match}`));
        });
        if (allMatches.length > 8) {
          console.log(chalk.gray(`  ... and ${allMatches.length - 8} more`));
        }
        console.log('');
      }
    } else {
      console.log(chalk.gray('\n💡 Available options:'));
      console.log(
        chalk.blue('  🔧 Special commands: ') +
          chalk.gray('help, state, events, status, registry, q')
      );
      console.log(
        chalk.blue('  🎯 Available events: ') + chalk.green(this.availableEvents.join(', '))
      );
      console.log('');
    }

    this.resetPrompt();
  }

  private resetPrompt() {
    this.rl.setPrompt(chalk.blue('> '));
    this.rl.prompt();
  }

  private updateSuggestions() {
    if (this.currentInput.length === 0) {
      this.suggestions = [];
      return;
    }

    const input = this.currentInput.toUpperCase();
    const allOptions = [...this.specialCommands, ...this.availableEvents];

    // Find matches
    const exactMatches = allOptions.filter((option) => option.toUpperCase().startsWith(input));

    const fuzzyMatches = allOptions.filter(
      (option) => !option.toUpperCase().startsWith(input) && option.toUpperCase().includes(input)
    );

    this.suggestions = [...exactMatches, ...fuzzyMatches].slice(0, 5);
  }

  updateAvailableEvents(availableEvents: string[]) {
    this.availableEvents = availableEvents;
  }

  prompt() {
    this.resetPrompt();
  }

  close() {
    this.rl.close();
  }

  showSuggestions() {
    if (this.suggestions.length > 0) {
      console.log(chalk.gray('💡 Did you mean:'));
      this.suggestions.forEach((suggestion, index) => {
        const isAvailable =
          this.availableEvents.includes(suggestion) || this.specialCommands.includes(suggestion);
        const color = isAvailable ? chalk.green : chalk.red;
        const status = isAvailable ? '✓' : '✗';
        const prefix = index === 0 ? '  → ' : '    ';
        console.log(color(`${prefix}${status} ${suggestion}`));
      });
    } else {
      console.log(chalk.gray('💡 Available options:'));
      console.log(chalk.blue('  🔧 Special commands:'));
      console.log(chalk.gray('     help, state, events, status, registry, q'));
      console.log(chalk.blue('  🎯 Available events:'));
      if (this.availableEvents.length > 0) {
        const eventList = this.availableEvents.join(', ');
        console.log(chalk.green(`     ${eventList}`));
      } else {
        console.log(chalk.gray('     (none in current state)'));
      }
    }
  }

  validateInput(input: string): {
    isValid: boolean;
    color: typeof chalk.green | typeof chalk.red;
    message?: string;
  } {
    const trimmed = input.trim();
    const upper = trimmed.toUpperCase();

    if (this.specialCommands.includes(trimmed)) {
      return { isValid: true, color: chalk.green };
    }

    if (this.availableEvents.includes(upper)) {
      return { isValid: true, color: chalk.green };
    }

    if (this.allEvents.includes(upper)) {
      // Calculate suggestions for better error message
      this.currentInput = trimmed;
      this.updateSuggestions();
      return {
        isValid: false,
        color: chalk.red,
        message: `Event "${upper}" not available in current state`,
      };
    }

    // Calculate suggestions for unknown events
    this.currentInput = trimmed;
    this.updateSuggestions();
    return {
      isValid: false,
      color: chalk.red,
      message: `Unknown event: ${upper}`,
    };
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

    // Loop detection and safety mechanisms
    const stateTransitionHistory: Array<{ state: string; timestamp: number }> = [];
    const _maxStateTransitions = 100;
    const loopDetectionWindow = 10; // Number of recent transitions to check
    const stateTimeoutThreshold = 30000; // 30 seconds
    const stateLastChanged = new Map<string, number>();

    // Create enhanced readline interface variable
    let enhancedRl: EnhancedReadline | null = null;

    // Declare observers for cleanup function
    let stateObserver: { unsubscribe(): void };
    let contextObserver: { unsubscribe(): void };
    let eventObserver: () => void;

    // Add cleanup flag to prevent duplicate cleanup
    let cleanupExecuted = false;

    const performCleanup = () => {
      if (cleanupExecuted) return;
      cleanupExecuted = true;

      console.log(chalk.yellow('🛑 Stopping state monitoring...'));
      stateObserver.unsubscribe();
      contextObserver.unsubscribe();
      eventObserver();
      gitActor.stop();
      // NOTE: Actor cleanup is now handled by the actor system
    };

    // Loop detection function
    function detectInfiniteLoop(): boolean {
      if (stateTransitionHistory.length < loopDetectionWindow) {
        return false;
      }

      const recentTransitions = stateTransitionHistory.slice(-loopDetectionWindow);
      const stateCount = new Map<string, number>();

      for (const transition of recentTransitions) {
        const count = stateCount.get(transition.state) || 0;
        stateCount.set(transition.state, count + 1);

        // If we've seen the same state more than 3 times in recent history, it's likely a loop
        if (count >= 3) {
          return true;
        }
      }

      return false;
    }

    // State timeout detection
    function detectStateTimeout(): boolean {
      const now = Date.now();
      const lastChange = stateLastChanged.get(currentState);

      if (lastChange && now - lastChange > stateTimeoutThreshold) {
        return true;
      }

      return false;
    }

    // Subscribe to state changes using standardized actor pattern
    stateObserver = gitActor
      .observe((snapshot: ActorSnapshot<unknown>) => snapshot.value)
      .subscribe((state) => {
        const stateStr = String(state);

        // Safety check: prevent excessive state transitions
        if (stateTransitionHistory.length >= _maxStateTransitions) {
          console.error(chalk.red('🚨 SAFETY: Maximum state transitions reached!'));
          console.error(chalk.red('   This indicates a potential infinite loop.'));
          console.error(chalk.red('   Stopping monitoring for safety.'));
          performCleanup();
          process.exit(1);
        }

        // Update state transition history
        const now = Date.now();
        stateTransitionHistory.push({ state: stateStr, timestamp: now });
        stateLastChanged.set(stateStr, now);

        // Check for infinite loop
        if (detectInfiniteLoop()) {
          console.error(chalk.red('🔄 INFINITE LOOP DETECTED!'));
          console.error(chalk.yellow('   Recent state transitions:'));
          const recentStates = stateTransitionHistory.slice(-loopDetectionWindow);
          recentStates.forEach((entry, index) => {
            const elapsed = (entry.timestamp - startTime) / 1000;
            console.error(
              chalk.gray(`   ${index + 1}. ${entry.state} (at ${elapsed.toFixed(1)}s)`)
            );
          });
          console.error(chalk.red('   Stopping monitoring to prevent system overload.'));
          performCleanup();
          process.exit(1);
        }

        // Check for state timeout
        if (detectStateTimeout()) {
          console.warn(chalk.yellow('⏰ STATE TIMEOUT WARNING!'));
          console.warn(
            chalk.yellow(
              `   State "${stateStr}" has been active for more than ${stateTimeoutThreshold / 1000}s`
            )
          );
          console.warn(chalk.yellow('   This may indicate a stuck state machine.'));
        }

        // Update current state
        currentState = stateStr;
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        const _elapsed = now - startTime;

        console.log(chalk.green(`[${timestamp}] State: ${chalk.bold(currentState)}`));

        // Show transition count for debugging
        if (stateTransitionHistory.length > 5) {
          console.log(chalk.gray(`  (${stateTransitionHistory.length} transitions so far)`));
        }

        // Show available events for current state
        const availableEvents = extractAvailableEvents(machine, currentState);
        if (availableEvents.length > 0) {
          console.log(chalk.gray('  Available events:'));
          // Format events in columns to avoid line wrapping
          const eventColumns = [];
          for (let i = 0; i < availableEvents.length; i += 3) {
            eventColumns.push(availableEvents.slice(i, i + 3));
          }
          eventColumns.forEach((row) => {
            const formattedRow = row.map((event) => event.padEnd(25)).join(' ');
            console.log(chalk.green(`    ${formattedRow}`));
          });
        }

        // Update enhanced readline with new available events
        if (enhancedRl) {
          enhancedRl.updateAvailableEvents(availableEvents);
        }
      });

    // Subscribe to context changes for additional debugging
    contextObserver = gitActor
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

    // Subscribe to standardized event emissions
    eventObserver = gitActor.on((event: GitEmittedEvent) => {
      log.debug('🎯 Event received from GitActor', {
        event: event.type,
        actorId: gitActor.id,
        timestamp: new Date().toISOString(),
      });
      console.log('DEBUG: Received event:', event);
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];

      switch (event.type) {
        // Repository state changes
        case 'GIT_REPO_STATUS_CHANGED':
          console.log(
            chalk.green(
              `[${timestamp}] ✅ Repository status checked: ${event.isGitRepo ? 'Valid git repo' : 'Not a git repo'}`
            )
          );
          break;
        case 'GIT_BRANCH_CHANGED':
          console.log(chalk.cyan(`[${timestamp}] 🌿 Branch changed: ${event.currentBranch}`));
          break;
        case 'GIT_UNCOMMITTED_CHANGES_DETECTED':
          console.log(
            chalk.yellow(
              `[${timestamp}] 📝 Uncommitted changes: ${event.hasChanges ? 'Found' : 'None'}`
            )
          );
          break;

        // Operation completions
        case 'GIT_COMMIT_COMPLETED':
          console.log(chalk.green(`[${timestamp}] ✅ Commit completed: ${event.commitHash}`));
          break;
        case 'GIT_FETCH_COMPLETED':
          console.log(chalk.green(`[${timestamp}] ✅ Fetch completed for branch: ${event.branch}`));
          break;
        case 'GIT_PUSH_COMPLETED':
          console.log(chalk.green(`[${timestamp}] ✅ Push completed for branch: ${event.branch}`));
          break;
        case 'GIT_MERGE_COMPLETED':
          console.log(chalk.green(`[${timestamp}] ✅ Merge completed for branch: ${event.branch}`));
          break;
        case 'GIT_BRANCH_CREATED':
          console.log(chalk.green(`[${timestamp}] ✅ Branch created: ${event.branchName}`));
          break;
        case 'GIT_STAGING_COMPLETED':
          console.log(chalk.green(`[${timestamp}] ✅ Staging completed`));
          break;

        // Integration status updates
        case 'GIT_INTEGRATION_STATUS_UPDATED':
          console.log(
            chalk.blue(
              `[${timestamp}] 📊 Integration status: ${event.status.ahead} ahead, ${event.status.behind} behind`
            )
          );
          break;
        case 'GIT_CHANGED_FILES_DETECTED':
          console.log(
            chalk.blue(`[${timestamp}] 📁 Changed files detected: ${event.files.length} files`)
          );
          if (event.files.length > 0) {
            event.files.slice(0, 5).forEach((file) => {
              console.log(chalk.gray(`    • ${file}`));
            });
            if (event.files.length > 5) {
              console.log(chalk.gray(`    ... and ${event.files.length - 5} more`));
            }
          }
          break;

        // Worktree operations
        case 'GIT_WORKTREE_SETUP_COMPLETED':
          console.log(
            chalk.green(
              `[${timestamp}] ✅ Worktree setup completed: ${event.worktrees.length} worktrees`
            )
          );
          break;
        case 'GIT_WORKTREE_STATUS_CHECKED':
          console.log(
            chalk.blue(
              `[${timestamp}] 📁 Worktree status: ${event.exists ? 'exists' : 'not found'} at ${event.path}`
            )
          );
          break;

        // Generated content
        case 'GIT_COMMIT_MESSAGE_GENERATED':
          console.log(chalk.blue(`[${timestamp}] 📝 Commit message generated: "${event.message}"`));
          break;
        case 'GIT_DATE_VALIDATION_COMPLETED':
          console.log(
            chalk.blue(
              `[${timestamp}] 📅 Date validation completed: ${event.issues.length} issues found`
            )
          );
          break;

        // State transitions
        case 'GIT_STATE_CHANGED':
          console.log(chalk.gray(`[${timestamp}] 🔄 State changed: ${event.from} → ${event.to}`));
          break;
        case 'GIT_OPERATION_STARTED':
          console.log(chalk.gray(`[${timestamp}] 🚀 Operation started: ${event.operation}`));
          break;

        // Error events
        case 'GIT_OPERATION_FAILED':
          console.log(
            chalk.red(`[${timestamp}] ❌ Operation failed: ${event.operation} - ${event.error}`)
          );
          break;
        case 'GIT_TIMEOUT_OCCURRED':
          console.log(chalk.red(`[${timestamp}] ⏰ Operation timed out: ${event.operation}`));
          break;
        case 'GIT_VALIDATION_FAILED':
          console.log(chalk.red(`[${timestamp}] ❌ Validation failed: ${event.reason}`));
          break;

        // Request/response events
        case 'GIT_REQUEST_RESPONSE':
          console.log(chalk.gray(`[${timestamp}] 📡 Request response: ${event.requestId}`));
          break;

        default:
          console.log(chalk.gray(`[${timestamp}] 📡 Event: ${(event as { type: string }).type}`));
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

      // Clean up and exit
      stateObserver.unsubscribe();
      contextObserver.unsubscribe();
      eventObserver();
      gitActor.stop();
      // NOTE: Actor cleanup is now handled by the actor system
    } else {
      // Show enhanced interactive help
      console.log(chalk.gray(''));
      console.log(chalk.green('🎯 Enhanced Actor State Machine Simulator'));
      console.log(chalk.gray('  Type any event name to trigger it'));
      console.log(chalk.gray('  ✨ Features:'));
      console.log(chalk.gray('    • Tab completion for events'));
      console.log(chalk.gray('    • Real-time color feedback'));
      console.log(chalk.gray('    • Smart suggestions'));
      console.log(chalk.gray(''));
      console.log(chalk.gray('  Special commands:'));
      console.log(chalk.gray('    help - Show available events'));
      console.log(chalk.gray('    state - Show current state'));
      console.log(chalk.gray('    events - Show all events'));
      console.log(chalk.gray('    status - Get actor status via ask() pattern'));
      console.log(chalk.gray('    registry - Show actor registry'));
      console.log(chalk.gray('    q - Quit'));
      console.log(chalk.gray(''));
      console.log(
        chalk.yellow('💡 Tip: Use Tab for autocomplete, available events are shown in green')
      );
      console.log(chalk.gray(''));

      // Get initial available events
      const initialAvailableEvents = extractAvailableEvents(machine, currentState);

      // Create enhanced readline interface
      enhancedRl = new EnhancedReadline(
        allEvents,
        initialAvailableEvents,
        async (input: string) => {
          const command = input.trim();

          if (command === 'q' || command === 'quit' || command === 'exit') {
            performCleanup();
            process.exit(0);
          } else if (command === 'help') {
            const availableEvents = extractAvailableEvents(machine, currentState);
            console.log(chalk.cyan(`📚 Available commands for state "${currentState}":`));
            console.log(chalk.gray(''));
            console.log(chalk.blue('🎯 Available Events (ready to trigger):'));
            availableEvents.forEach((event: string) => {
              console.log(chalk.green(`  ✓ ${event}`));
            });
            console.log(chalk.gray(''));
            console.log(chalk.blue('🔧 Special Commands:'));
            console.log(chalk.gray('  • help - Show this help'));
            console.log(chalk.gray('  • state - Show current state'));
            console.log(chalk.gray('  • events - Show all events'));
            console.log(chalk.gray('  • status - Get actor status'));
            console.log(chalk.gray('  • registry - Show actor registry'));
            console.log(chalk.gray('  • completions - Show completion hints'));
            console.log(chalk.gray('  • q - Quit'));
            console.log(chalk.gray(''));
            console.log(chalk.yellow('💡 Pro tip: Use Tab key to autocomplete available events!'));
          } else if (command === 'completions') {
            enhancedRl?.showCompletionHints();
          } else if (command === 'state') {
            console.log(chalk.cyan(`Current state: ${currentState}`));
            const availableEvents = extractAvailableEvents(machine, currentState);
            console.log(chalk.gray(`Available events: ${availableEvents.join(', ')}`));
          } else if (command === 'events') {
            console.log(chalk.cyan('All available events:'));
            const availableEvents = extractAvailableEvents(machine, currentState);
            allEvents.forEach((event: string) => {
              const isAvailable = availableEvents.includes(event);
              const color = isAvailable ? chalk.green : chalk.gray;
              const prefix = isAvailable ? '  ✓ ' : '    ';
              console.log(color(`${prefix}${event}`));
            });
          } else if (command === 'status') {
            try {
              console.log(chalk.cyan('🔍 Getting current actor status...'));
              const snapshot = gitActor.getSnapshot();
              const { context } = snapshot;
              console.log(chalk.green('📊 Current Status:'));
              console.log(chalk.blue(`  State: ${snapshot.value}`));
              console.log(chalk.blue(`  Current Branch: ${context.currentBranch || 'unknown'}`));
              console.log(chalk.blue(`  Is Git Repo: ${context.isGitRepo}`));
              console.log(
                chalk.blue(`  Uncommitted Changes: ${context.uncommittedChanges || 'unknown'}`)
              );
              console.log(chalk.blue(`  Last Operation: ${context.lastOperation || 'none'}`));
              if (context.lastError) {
                console.log(chalk.red(`  Last Error: ${context.lastError}`));
              }
            } catch (error) {
              console.log(chalk.red(`❌ Status request failed: ${error}`));
            }
          } else if (command === 'registry') {
            console.log(chalk.cyan('📋 Actor Registry:'));
            const actors = listGitActors();
            if (actors.length === 0) {
              console.log(chalk.gray('  No git actors registered'));
            } else {
              actors.forEach((path, index) => {
                console.log(chalk.gray(`  ${index + 1}. ${path}`));
              });
            }
          } else if (command.length > 0) {
            // Validate and send event
            const validation = enhancedRl?.validateInput(command);
            if (validation?.isValid) {
              const eventName = command.toUpperCase();
              console.log(chalk.cyan(`🔄 Triggering event: ${eventName}`));
              const event = createEventFromString(eventName, eventData);
              gitActor.send(event);
            } else {
              // Show suggestions for invalid commands (validation feedback already shown)
              enhancedRl?.showSuggestions();
              console.log(chalk.gray('💡 Tip: Use Tab key to see available completions'));
            }
          }
        },
        () => {
          performCleanup();
          process.exit(0);
        }
      );

      enhancedRl.prompt();

      // Set up cleanup on exit
      process.on('SIGINT', () => {
        performCleanup();
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
  // Only enable dev mode when debug is explicitly requested
  if (options.debug) {
    enableDevMode();
  }

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
