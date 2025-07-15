/**
 * Git Actor - State-Based Implementation
 *
 * This actor manages git operations using proper state-based actor patterns.
 * Instead of emitting responses, it updates context state that clients can observe.
 */

import { type ActorRef, type ActorSnapshot, createActorRef, Logger } from '@actor-web/core';
import { type SimpleGit, simpleGit } from 'simple-git';
import { assign, fromPromise, setup } from 'xstate';

// Use scoped logger for git-actor
const _log = Logger.namespace('GIT_ACTOR');

// ============================================================================
// TIMEOUT CONFIGURATION
// ============================================================================

/**
 * Timeout configuration for all git operations
 * Using XState's built-in delay mechanisms instead of manual timeouts
 */
const TIMEOUTS = {
  STATUS_CHECK: 10000,
  COMMIT_OPERATION: 30000,
  FETCH_REMOTE: 15000,
  PUSH_CHANGES: 20000,
  MERGE_BRANCH: 25000,
  GENERATE_COMMIT_MESSAGE: 15000,
  VALIDATE_DATES: 10000,
  REPO_CHECK: 5000,
  UNCOMMITTED_CHANGES_CHECK: 5000,
  STAGING_OPERATION: 10000,
  CHANGED_FILES_CHECK: 10000,
  INTEGRATION_STATUS_CHECK: 10000,
  WORKTREE_SETUP: 30000,
  WORKTREE_CHECK: 5000,
  BRANCH_CREATION: 10000,
  LAST_COMMIT_CHECK: 5000,
} as const;

// Generate unique actor IDs
function generateGitActorId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

// Dynamic branch detection for multiple agents
function getIntegrationBranch(currentBranch?: string): string {
  // Default integration branch
  const defaultIntegration = 'feature/actor-ref-integration';

  if (!currentBranch) {
    return defaultIntegration;
  }

  // For multiple agents, we can customize the integration branch
  // For now, keep the default but this can be expanded
  return defaultIntegration;
}

function getSourceBranch(currentBranch?: string): string {
  if (!currentBranch) {
    return 'HEAD';
  }

  // Return the current branch for pushing
  return currentBranch;
}

// ============================================================================
// ACTOR INTERFACES
// ============================================================================

/**
 * State-based Git Actor Interface
 * Uses actor-web framework's existing observe pattern
 */
export interface GitActor extends ActorRef<GitEvent, unknown> {
  /** Get current snapshot of git actor state */
  getSnapshot(): ActorSnapshot<GitContext>;
}

// ============================================================================
// GIT ACTOR EVENTS (No Responses!)
// ============================================================================

export type GitEvent =
  | { type: 'CHECK_REPO' }
  | { type: 'CHECK_STATUS' }
  | { type: 'CHECK_UNCOMMITTED_CHANGES' }
  | { type: 'DETECT_AGENT_TYPE' }
  | { type: 'GET_INTEGRATION_STATUS'; integrationBranch?: string }
  | { type: 'GET_CHANGED_FILES'; integrationBranch?: string }
  | { type: 'ADD_ALL' }
  | { type: 'COMMIT_CHANGES'; message: string }
  | { type: 'FETCH_REMOTE'; branch: string }
  | { type: 'PUSH_CHANGES'; branch: string }
  | { type: 'MERGE_BRANCH'; branch: string; strategy?: 'merge' | 'rebase' }
  | { type: 'CREATE_BRANCH'; branchName: string }
  | { type: 'GET_LAST_COMMIT' }
  | { type: 'CHECK_WORKTREE'; path: string }
  | {
      type: 'SETUP_WORKTREES';
      agentCount: number;
      configOptions?: {
        configPath?: string;
        agentPaths?: Record<string, string>;
        baseDir?: string;
        integrationBranch?: string;
      };
    }
  | { type: 'GENERATE_COMMIT_MESSAGE' }
  | { type: 'VALIDATE_DATES'; filePaths: string[] }
  | { type: 'COMMIT_WITH_CONVENTION'; customMessage?: string }
  | { type: 'CONTINUE' }
  | { type: 'RETRY' };

// ============================================================================
// GIT ACTOR CONTEXT (Pure State)
// ============================================================================

interface DateIssue {
  file: string;
  line: number;
  date: string;
  issue: 'future' | 'past' | 'invalid';
  context: string;
}

interface CommitMessageConfig {
  projectTag?: string;
  agentType?: string;
  scope?: string;
  type?: string;
  description?: string;
  workCategory?: string;
}

export interface GitContext {
  // Core git state
  git: SimpleGit;
  baseDir: string;

  // Repository state
  isGitRepo?: boolean;
  repoStatus?: unknown;
  currentBranch?: string;
  uncommittedChanges?: boolean;

  // Agent state
  agentType?: string;

  // Integration state
  integrationStatus?: { ahead: number; behind: number };

  // File state
  changedFiles?: string[];

  // Commit state
  lastCommitMessage?: string;
  lastCommitHash?: string;

  // Operation results (no more boolean flags!)
  stagingResult?: unknown;
  fetchResult?: unknown;
  pushResult?: unknown;
  mergeResult?: unknown;

  // Worktree state
  worktrees: AgentWorktreeConfig[];
  worktreeExists?: boolean;

  // Generated content
  generatedCommitMessage?: string;
  commitConfig?: CommitMessageConfig;
  dateIssues?: DateIssue[];

  // Last commit info
  lastCommitInfo?: string;

  // Error state
  lastError?: string;

  // Operation tracking
  lastOperation?: string;
}

import type { AgentWorktreeConfig } from '../core/agent-config.js';

// ============================================================================
// STATE MACHINE DEFINITION
// ============================================================================

export const gitActorMachine = setup({
  types: {
    context: {} as GitContext,
    events: {} as GitEvent,
    input: {} as { baseDir?: string },
  },
  actors: {
    // Keep the existing actor implementations but remove response emission
    checkRepo: fromPromise(async ({ input }: { input: { git: SimpleGit } }) => {
      const { git } = input;
      try {
        const status = await git.status();
        return { isRepo: true, status };
      } catch (error) {
        return { isRepo: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }),

    checkStatus: fromPromise(async ({ input }: { input: { git: SimpleGit } }) => {
      const { git } = input;
      const status = await git.status();
      const currentBranch = status.current || 'unknown';

      // Agent type detection logic
      let agentType = 'Unknown Agent';
      if (currentBranch.includes('agent-a') || currentBranch.includes('architecture')) {
        agentType = 'Agent A (Architecture)';
      } else if (currentBranch.includes('agent-b') || currentBranch.includes('implementation')) {
        agentType = 'Agent B (Implementation)';
      } else if (currentBranch.includes('agent-c') || currentBranch.includes('test')) {
        agentType = 'Agent C (Testing/Cleanup)';
      }

      return { currentBranch, agentType };
    }),

    checkUncommittedChanges: fromPromise(async ({ input }: { input: { git: SimpleGit } }) => {
      const { git } = input;
      const status = await git.status();
      return status.files.length > 0;
    }),

    addAll: fromPromise(async ({ input }: { input: { git: SimpleGit } }) => {
      const { git } = input;
      const result = await git.add('.');
      return { success: true, result };
    }),

    commitChanges: fromPromise(
      async ({ input }: { input: { message: string; git: SimpleGit } }) => {
        const { message, git } = input;
        const result = await git.commit(message);
        return result.commit;
      }
    ),

    getIntegrationStatus: fromPromise(
      async ({
        input,
      }: {
        input: { integrationBranch?: string; currentBranch?: string; git: SimpleGit };
      }) => {
        const { integrationBranch, currentBranch, git } = input;

        // Use dynamic branch detection if not provided
        const targetBranch = integrationBranch || getIntegrationBranch(currentBranch);

        try {
          await git.fetch(['origin', targetBranch]);

          const ahead = await git.raw(['rev-list', '--count', `origin/${targetBranch}..HEAD`]);
          const behind = await git.raw(['rev-list', '--count', `HEAD..origin/${targetBranch}`]);

          return {
            ahead: Number.parseInt(ahead.trim()) || 0,
            behind: Number.parseInt(behind.trim()) || 0,
            integrationBranch: targetBranch,
            sourceBranch: getSourceBranch(currentBranch),
          };
        } catch (error) {
          return {
            ahead: 0,
            behind: 0,
            integrationBranch: targetBranch,
            sourceBranch: getSourceBranch(currentBranch),
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }
    ),

    getChangedFiles: fromPromise(async ({ input }: { input: { git: SimpleGit } }) => {
      const { git } = input;

      try {
        // Get status to see all changed files (staged and unstaged)
        const status = await git.status();
        const changedFiles: string[] = [];

        // Add staged files
        changedFiles.push(...status.staged);

        // Add modified files (unstaged)
        for (const file of status.modified) {
          if (!changedFiles.includes(file)) {
            changedFiles.push(file);
          }
        }

        // Add new files
        for (const file of status.not_added) {
          if (!changedFiles.includes(file)) {
            changedFiles.push(file);
          }
        }

        return changedFiles;
      } catch {
        return [];
      }
    }),

    fetchRemote: fromPromise(async ({ input }: { input: { branch: string; git: SimpleGit } }) => {
      const { branch, git } = input;
      try {
        const result = await git.fetch(['origin', branch]);
        return { success: true, branch, result };
      } catch (error) {
        return {
          success: false,
          branch,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }),

    pushChanges: fromPromise(async ({ input }: { input: { branch: string; git: SimpleGit } }) => {
      const { branch, git } = input;
      try {
        const result = await git.push(['origin', branch]);
        return { success: true, branch, result };
      } catch (error) {
        return {
          success: false,
          branch,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }),

    mergeBranch: fromPromise(
      async ({
        input,
      }: {
        input: { branch: string; strategy?: 'merge' | 'rebase'; git: SimpleGit };
      }) => {
        const { branch, strategy = 'merge', git } = input;
        try {
          let result: unknown;
          if (strategy === 'rebase') {
            result = await git.rebase([branch]);
          } else {
            result = await git.merge([branch]);
          }

          // Extract commit hash if available
          let commitHash: string | undefined;
          if (result && typeof result === 'object' && 'commit' in result) {
            commitHash = (result as { commit?: string }).commit;
          }

          return {
            success: true,
            branch,
            strategy,
            result,
            commitHash,
          };
        } catch (error) {
          return {
            success: false,
            branch,
            strategy,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }
    ),

    generateCommitMessage: fromPromise(async ({ input }: { input: { git: SimpleGit } }) => {
      const { git } = input;
      try {
        // Get the current status and files
        const status = await git.status();
        const files = status.files;

        if (files.length === 0) {
          return {
            type: 'chore',
            scope: 'core',
            description: 'no changes to commit',
            workCategory: 'maintenance',
          };
        }

        // Simple commit message generation logic
        // This is a placeholder - in a real implementation, you'd use AI or more sophisticated logic
        const hasNewFiles = files.some((file) => file.index === 'A');
        const hasModifiedFiles = files.some((file) => file.index === 'M');
        const hasDeletedFiles = files.some((file) => file.index === 'D');

        let type = 'feat';
        let description = 'update implementation';

        if (hasNewFiles && hasModifiedFiles) {
          type = 'feat';
          description = 'add new features and update existing functionality';
        } else if (hasNewFiles) {
          type = 'feat';
          description = 'add new functionality';
        } else if (hasModifiedFiles) {
          type = 'fix';
          description = 'update existing functionality';
        } else if (hasDeletedFiles) {
          type = 'refactor';
          description = 'remove unused code';
        }

        return {
          type,
          scope: 'core',
          description,
          workCategory: 'implementation',
          projectTag: 'actor-web',
        };
      } catch (error) {
        throw new Error(
          `Failed to generate commit message: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }),

    validateDates: fromPromise(
      async ({ input }: { input: { filePaths: string[]; git: SimpleGit } }) => {
        const { filePaths, git } = input;
        try {
          const issues: Array<{
            file: string;
            line: number;
            date: string;
            issue: 'future' | 'past' | 'invalid';
            context: string;
          }> = [];

          // Simple date validation logic
          // This is a placeholder - in a real implementation, you'd scan files for dates

          for (const filePath of filePaths) {
            try {
              // Check if file exists in git
              const fileExists = await git
                .raw(['ls-files', '--error-unmatch', filePath])
                .then(() => true)
                .catch(() => false);

              if (!fileExists) {
              }

              // Placeholder validation - in reality, you'd read and parse the file
              // For now, we'll just return an empty array to indicate no issues
              // Real implementation would scan for date patterns and validate them
            } catch {
              // Skip
            }
          }

          return issues;
        } catch (error) {
          throw new Error(
            `Failed to validate dates: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    ),
  },
}).createMachine({
  id: 'git-actor',

  context: ({ input }) => ({
    git: simpleGit(input?.baseDir || process.cwd()),
    baseDir: input?.baseDir || process.cwd(),
    worktrees: [],
    isGitRepo: undefined,
    repoStatus: undefined,
    currentBranch: undefined,
    uncommittedChanges: undefined,
    agentType: undefined,
    integrationStatus: undefined,
    changedFiles: undefined,
    lastCommitMessage: undefined,
    lastCommitHash: undefined,
    stagingResult: undefined,
    fetchResult: undefined,
    pushResult: undefined,
    mergeResult: undefined,
    worktreeExists: undefined,
    generatedCommitMessage: undefined,
    commitConfig: undefined,
    dateIssues: undefined,
    lastCommitInfo: undefined,
    lastError: undefined,
    lastOperation: undefined,
  }),

  initial: 'idle',

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
        // Add other events...
      },
    },

    checkingRepo: {
      invoke: {
        src: 'checkRepo',
        input: ({ context }) => ({ git: context.git }),
        onDone: {
          target: 'repoChecked',
          actions: assign({
            isGitRepo: ({ event }) => event.output.isRepo,
            repoStatus: ({ event }) => event.output.status,
          }),
        },
        onError: {
          target: 'repoError',
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Repository check failed',
            isGitRepo: () => false,
          }),
        },
      },
      after: {
        [TIMEOUTS.REPO_CHECK]: { target: 'repoTimeout' },
      },
    },

    checkingStatus: {
      invoke: {
        src: 'checkStatus',
        input: ({ context }) => ({ git: context.git }),
        onDone: {
          target: 'statusChecked',
          actions: assign({
            currentBranch: ({ event }) => event.output.currentBranch,
            agentType: ({ event }) => event.output.agentType,
          }),
        },
        onError: {
          target: 'statusError',
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Status check failed',
          }),
        },
      },
      after: {
        [TIMEOUTS.STATUS_CHECK]: { target: 'statusTimeout' },
      },
    },

    checkingUncommittedChanges: {
      invoke: {
        src: 'checkUncommittedChanges',
        input: ({ context }) => ({ git: context.git }),
        onDone: {
          target: 'uncommittedChangesChecked',
          actions: assign({
            uncommittedChanges: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'uncommittedChangesError',
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error
                ? event.error.message
                : 'Checking uncommitted changes failed',
            uncommittedChanges: () => false,
          }),
        },
      },
      after: {
        [TIMEOUTS.UNCOMMITTED_CHANGES_CHECK]: { target: 'uncommittedChangesTimeout' },
      },
    },

    stagingAll: {
      entry: assign({
        lastOperation: () => 'STAGING_ALL',
      }),
      invoke: {
        src: 'addAll',
        input: ({ context }) => ({ git: context.git }),
        onDone: {
          target: 'stagingCompleted',
          actions: assign({
            stagingResult: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'stagingError',
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Staging all failed',
            stagingResult: () => undefined,
          }),
        },
      },
      after: {
        [TIMEOUTS.STAGING_OPERATION]: { target: 'stagingTimeout' },
      },
    },

    committingChanges: {
      entry: assign({
        lastOperation: () => 'COMMITTING_CHANGES',
      }),
      invoke: {
        src: 'commitChanges',
        input: ({ context, event }) => ({
          git: context.git,
          message: (event as { message: string }).message,
        }),
        onDone: {
          target: 'commitCompleted',
          actions: assign({
            lastCommitHash: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'commitError',
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Commit changes failed',
            lastCommitHash: () => undefined,
          }),
        },
      },
      after: {
        [TIMEOUTS.COMMIT_OPERATION]: { target: 'commitTimeout' },
      },
    },

    gettingChangedFiles: {
      entry: assign({
        lastOperation: () => 'GET_CHANGED_FILES',
      }),
      invoke: {
        src: 'getChangedFiles',
        input: ({ context }) => ({ git: context.git }),
        onDone: {
          target: 'changedFilesChecked',
          actions: assign({
            changedFiles: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'changedFilesError',
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Get changed files failed',
            changedFiles: () => [],
          }),
        },
      },
      after: {
        [TIMEOUTS.CHANGED_FILES_CHECK]: { target: 'changedFilesTimeout' },
      },
    },

    gettingIntegrationStatus: {
      entry: assign({
        lastOperation: () => 'GET_INTEGRATION_STATUS',
      }),
      invoke: {
        src: 'getIntegrationStatus',
        input: ({ context, event }) => ({
          git: context.git,
          integrationBranch: (event as { integrationBranch?: string }).integrationBranch,
          currentBranch: context.currentBranch,
        }),
        onDone: {
          target: 'integrationStatusChecked',
          actions: assign({
            integrationStatus: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'integrationStatusError',
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error
                ? event.error.message
                : 'Integration status check failed',
            integrationStatus: () => ({ ahead: 0, behind: 0 }),
          }),
        },
      },
      after: {
        [TIMEOUTS.INTEGRATION_STATUS_CHECK]: { target: 'integrationStatusTimeout' },
      },
    },

    fetchingRemote: {
      entry: assign({
        lastOperation: () => 'FETCH_REMOTE',
      }),
      invoke: {
        src: 'fetchRemote',
        input: ({ context, event }) => ({
          git: context.git,
          branch: (event as { branch: string }).branch,
        }),
        onDone: {
          target: 'fetchCompleted',
          actions: assign({
            fetchResult: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'fetchError',
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Fetch remote failed',
            fetchResult: () => undefined,
          }),
        },
      },
      after: {
        [TIMEOUTS.FETCH_REMOTE]: { target: 'fetchTimeout' },
      },
    },

    pushingChanges: {
      entry: assign({
        lastOperation: () => 'PUSH_CHANGES',
      }),
      invoke: {
        src: 'pushChanges',
        input: ({ context, event }) => ({
          git: context.git,
          branch: (event as { branch: string }).branch,
        }),
        onDone: {
          target: 'pushCompleted',
          actions: assign({
            pushResult: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'pushError',
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Push changes failed',
            pushResult: () => undefined,
          }),
        },
      },
      after: {
        [TIMEOUTS.PUSH_CHANGES]: { target: 'pushTimeout' },
      },
    },

    mergingBranch: {
      entry: assign({
        lastOperation: () => 'MERGE_BRANCH',
      }),
      invoke: {
        src: 'mergeBranch',
        input: ({ context, event }) => ({
          git: context.git,
          branch: (event as { branch: string; strategy?: 'merge' | 'rebase' }).branch,
          strategy: (event as { branch: string; strategy?: 'merge' | 'rebase' }).strategy,
        }),
        onDone: {
          target: 'mergeCompleted',
          actions: assign({
            mergeResult: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'mergeError',
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Merge branch failed',
            mergeResult: () => undefined,
          }),
        },
      },
      after: {
        [TIMEOUTS.MERGE_BRANCH]: { target: 'mergeTimeout' },
      },
    },

    generatingCommitMessage: {
      entry: assign({
        lastOperation: () => 'GENERATING_COMMIT_MESSAGE',
      }),
      invoke: {
        src: 'generateCommitMessage',
        input: ({ context }) => ({ git: context.git }),
        onDone: {
          target: 'commitMessageGenerated',
          actions: assign({
            commitConfig: ({ event }) => event.output,
            lastCommitMessage: ({ event }) =>
              `${event.output.type}${event.output.scope ? `(${event.output.scope})` : ''}: ${event.output.description}`,
          }),
        },
        onError: {
          target: 'commitMessageError',
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error
                ? event.error.message
                : 'Commit message generation failed',
          }),
        },
      },
      after: {
        [TIMEOUTS.GENERATE_COMMIT_MESSAGE]: { target: 'commitMessageTimeout' },
      },
    },

    validatingDates: {
      entry: assign({
        lastOperation: () => 'VALIDATING_DATES',
      }),
      invoke: {
        src: 'validateDates',
        input: ({ context, event }) => ({
          git: context.git,
          filePaths: (event as { filePaths: string[] }).filePaths,
        }),
        onDone: {
          target: 'datesValidated',
          actions: assign({
            dateIssues: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'datesValidationError',
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Date validation failed',
          }),
        },
      },
      after: {
        [TIMEOUTS.VALIDATE_DATES]: { target: 'datesValidationTimeout' },
      },
    },

    // ============================================================================
    // COMPLETION STATES
    // ============================================================================

    statusChecked: {
      entry: assign({
        lastOperation: () => 'STATUS_CHECK_DONE',
      }),
      on: {
        CONTINUE: 'idle',
        CHECK_REPO: 'checkingRepo',
        COMMIT_CHANGES: 'committingChanges',
      },
    },

    repoChecked: {
      entry: assign({
        lastOperation: () => 'REPO_CHECK_DONE',
      }),
      on: {
        CONTINUE: 'idle',
        CHECK_STATUS: 'checkingStatus',
        CHECK_UNCOMMITTED_CHANGES: 'checkingUncommittedChanges',
      },
    },

    uncommittedChangesChecked: {
      entry: assign({
        lastOperation: () => 'UNCOMMITTED_CHANGES_CHECK_DONE',
      }),
      on: {
        CONTINUE: 'idle',
        ADD_ALL: 'stagingAll',
      },
    },

    stagingCompleted: {
      entry: assign({
        lastOperation: () => 'STAGING_COMPLETED',
      }),
      on: {
        CONTINUE: 'idle',
        COMMIT_CHANGES: 'committingChanges',
      },
    },

    commitCompleted: {
      entry: assign({
        lastOperation: () => 'COMMIT_COMPLETED',
      }),
      on: {
        CONTINUE: 'idle',
        PUSH_CHANGES: 'pushingChanges',
      },
    },

    integrationStatusChecked: {
      entry: assign({
        lastOperation: () => 'INTEGRATION_STATUS_CHECKED',
      }),
      on: {
        CONTINUE: 'idle',
        FETCH_REMOTE: 'fetchingRemote',
      },
    },

    changedFilesChecked: {
      entry: assign({
        lastOperation: () => 'CHANGED_FILES_CHECKED',
      }),
      on: {
        CONTINUE: 'idle',
        COMMIT_CHANGES: 'committingChanges',
      },
    },

    fetchCompleted: {
      entry: assign({
        lastOperation: () => 'FETCH_COMPLETED',
      }),
      on: {
        CONTINUE: 'idle',
        PUSH_CHANGES: 'pushingChanges',
      },
    },

    pushCompleted: {
      entry: assign({
        lastOperation: () => 'PUSH_COMPLETED',
      }),
      on: {
        CONTINUE: 'idle',
        MERGE_BRANCH: 'mergingBranch',
      },
    },

    mergeCompleted: {
      entry: assign({
        lastOperation: () => 'MERGE_COMPLETED',
      }),
      on: {
        CONTINUE: 'idle',
      },
    },

    commitMessageGenerated: {
      entry: assign({
        lastOperation: () => 'COMMIT_MESSAGE_GENERATED',
      }),
      on: {
        CONTINUE: 'idle',
        COMMIT_CHANGES: 'committingChanges',
      },
    },

    datesValidated: {
      entry: assign({
        lastOperation: () => 'DATES_VALIDATED',
      }),
      on: {
        CONTINUE: 'idle',
      },
    },

    // ============================================================================
    // ERROR STATES
    // ============================================================================

    statusError: {
      entry: assign({
        lastOperation: () => 'STATUS_CHECK_ERROR',
      }),
      on: {
        RETRY: 'checkingStatus',
        CONTINUE: 'idle',
        CHECK_STATUS: 'checkingStatus', // Allow retrying directly
      },
    },

    repoError: {
      entry: assign({
        lastOperation: () => 'REPO_CHECK_ERROR',
      }),
      on: {
        RETRY: 'checkingRepo',
        CONTINUE: 'idle',
      },
    },

    uncommittedChangesError: {
      entry: assign({
        lastOperation: () => 'UNCOMMITTED_CHANGES_CHECK_ERROR',
      }),
      on: {
        RETRY: 'checkingUncommittedChanges',
        CONTINUE: 'idle',
      },
    },

    stagingError: {
      entry: assign({
        lastOperation: () => 'STAGING_ERROR',
      }),
      on: {
        RETRY: 'stagingAll',
        CONTINUE: 'idle',
      },
    },

    commitError: {
      entry: assign({
        lastOperation: () => 'COMMIT_ERROR',
      }),
      on: {
        RETRY: 'committingChanges',
        CONTINUE: 'idle',
      },
    },

    integrationStatusError: {
      entry: assign({
        lastOperation: () => 'INTEGRATION_STATUS_ERROR',
      }),
      on: {
        RETRY: 'gettingIntegrationStatus',
        CONTINUE: 'idle',
      },
    },

    changedFilesError: {
      entry: assign({
        lastOperation: () => 'CHANGED_FILES_ERROR',
      }),
      on: {
        RETRY: 'gettingChangedFiles',
        CONTINUE: 'idle',
      },
    },

    fetchError: {
      entry: assign({
        lastOperation: () => 'FETCH_ERROR',
      }),
      on: {
        RETRY: 'fetchingRemote',
        CONTINUE: 'idle',
      },
    },

    pushError: {
      entry: assign({
        lastOperation: () => 'PUSH_ERROR',
      }),
      on: {
        RETRY: 'pushingChanges',
        CONTINUE: 'idle',
      },
    },

    mergeError: {
      entry: assign({
        lastOperation: () => 'MERGE_ERROR',
      }),
      on: {
        RETRY: 'mergingBranch',
        CONTINUE: 'idle',
      },
    },

    commitMessageError: {
      entry: assign({
        lastOperation: () => 'COMMIT_MESSAGE_ERROR',
      }),
      on: {
        RETRY: 'generatingCommitMessage',
        CONTINUE: 'idle',
      },
    },

    datesValidationError: {
      entry: assign({
        lastOperation: () => 'DATES_VALIDATION_ERROR',
      }),
      on: {
        RETRY: 'validatingDates',
        CONTINUE: 'idle',
      },
    },

    // ============================================================================
    // TIMEOUT STATES
    // ============================================================================

    statusTimeout: {
      entry: assign({
        lastError: () => 'Status check timed out',
        lastOperation: () => 'STATUS_CHECK_TIMEOUT',
      }),
      on: {
        RETRY: 'checkingStatus',
        CONTINUE: 'idle',
      },
    },

    repoTimeout: {
      entry: assign({
        lastError: () => 'Repository check timed out',
        lastOperation: () => 'REPO_CHECK_TIMEOUT',
      }),
      on: {
        RETRY: 'checkingRepo',
        CONTINUE: 'idle',
      },
    },

    uncommittedChangesTimeout: {
      entry: assign({
        lastError: () => 'Uncommitted changes check timed out',
        lastOperation: () => 'UNCOMMITTED_CHANGES_CHECK_TIMEOUT',
      }),
      on: {
        RETRY: 'checkingUncommittedChanges',
        CONTINUE: 'idle',
      },
    },

    stagingTimeout: {
      entry: assign({
        lastError: () => 'Staging operation timed out',
        lastOperation: () => 'STAGING_TIMEOUT',
      }),
      on: {
        RETRY: 'stagingAll',
        CONTINUE: 'idle',
      },
    },

    commitTimeout: {
      entry: assign({
        lastError: () => 'Commit operation timed out',
        lastOperation: () => 'COMMIT_TIMEOUT',
      }),
      on: {
        RETRY: 'committingChanges',
        CONTINUE: 'idle',
      },
    },

    integrationStatusTimeout: {
      entry: assign({
        lastError: () => 'Integration status check timed out',
        lastOperation: () => 'INTEGRATION_STATUS_TIMEOUT',
      }),
      on: {
        RETRY: 'gettingIntegrationStatus',
        CONTINUE: 'idle',
      },
    },

    changedFilesTimeout: {
      entry: assign({
        lastError: () => 'Changed files check timed out',
        lastOperation: () => 'CHANGED_FILES_TIMEOUT',
      }),
      on: {
        RETRY: 'gettingChangedFiles',
        CONTINUE: 'idle',
      },
    },

    fetchTimeout: {
      entry: assign({
        lastError: () => 'Fetch operation timed out',
        lastOperation: () => 'FETCH_TIMEOUT',
      }),
      on: {
        RETRY: 'fetchingRemote',
        CONTINUE: 'idle',
      },
    },

    pushTimeout: {
      entry: assign({
        lastError: () => 'Push operation timed out',
        lastOperation: () => 'PUSH_TIMEOUT',
      }),
      on: {
        RETRY: 'pushingChanges',
        CONTINUE: 'idle',
      },
    },

    mergeTimeout: {
      entry: assign({
        lastError: () => 'Merge operation timed out',
        lastOperation: () => 'MERGE_TIMEOUT',
      }),
      on: {
        RETRY: 'mergingBranch',
        CONTINUE: 'idle',
      },
    },

    commitMessageTimeout: {
      entry: assign({
        lastError: () => 'Commit message generation timed out',
        lastOperation: () => 'COMMIT_MESSAGE_TIMEOUT',
      }),
      on: {
        RETRY: 'generatingCommitMessage',
        CONTINUE: 'idle',
      },
    },

    datesValidationTimeout: {
      entry: assign({
        lastError: () => 'Dates validation timed out',
        lastOperation: () => 'DATES_VALIDATION_TIMEOUT',
      }),
      on: {
        RETRY: 'validatingDates',
        CONTINUE: 'idle',
      },
    },
  },
});

// ============================================================================
// ACTOR FACTORY
// ============================================================================

/**
 * Create a state-based GitActor using the actor-web framework
 */
export function createGitActor(baseDir?: string): GitActor {
  const actorRef = createActorRef(gitActorMachine, {
    id: generateGitActorId('git-actor'),
    input: { baseDir },
    autoStart: false,
  });

  // Cast to GitActor interface (the framework handles the typing)
  return actorRef as unknown as GitActor;
}
