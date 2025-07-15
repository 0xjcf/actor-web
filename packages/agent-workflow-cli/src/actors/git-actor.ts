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
  | { type: 'COMMIT_WITH_CONVENTION'; customMessage?: string };

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

    // Add other necessary actors...
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
        // Add other events...
      },
    },

    checkingRepo: {
      invoke: {
        src: 'checkRepo',
        input: ({ context }) => ({ git: context.git }),
        onDone: {
          target: 'idle',
          actions: assign({
            isGitRepo: ({ event }) => event.output.isRepo,
            repoStatus: ({ event }) => event.output.status,
            lastOperation: () => 'CHECK_REPO',
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Repository check failed',
            isGitRepo: () => false,
          }),
        },
      },
    },

    checkingStatus: {
      invoke: {
        src: 'checkStatus',
        input: ({ context }) => ({ git: context.git }),
        onDone: {
          target: 'idle',
          actions: assign({
            currentBranch: ({ event }) => event.output.currentBranch,
            agentType: ({ event }) => event.output.agentType,
            lastOperation: () => 'CHECK_STATUS',
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Status check failed',
          }),
        },
      },
    },

    checkingUncommittedChanges: {
      invoke: {
        src: 'checkUncommittedChanges',
        input: ({ context }) => ({ git: context.git }),
        onDone: {
          target: 'idle',
          actions: assign({
            uncommittedChanges: ({ event }) => event.output,
            lastOperation: () => 'CHECK_UNCOMMITTED_CHANGES',
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Checking uncommitted changes failed',
            uncommittedChanges: () => false,
          }),
        },
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
          target: 'idle',
          actions: assign({
            stagingResult: ({ event }) => event.output.result,
            lastOperation: () => 'STAGING_ALL_DONE',
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Staging failed',
            stagingResult: () => undefined,
          }),
        },
      },
    },

    committingChanges: {
      entry: assign({
        lastOperation: () => 'COMMIT_CHANGES',
      }),
      invoke: {
        src: 'commitChanges',
        input: ({ context, event }) => ({
          git: context.git,
          message: (event as { message: string }).message,
        }),
        onDone: {
          target: 'idle',
          actions: assign({
            lastCommitHash: ({ event }) => event.output,
            lastOperation: () => 'COMMIT_CHANGES_DONE',
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Commit failed',
            lastCommitHash: () => undefined,
          }),
        },
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
          target: 'idle',
          actions: assign({
            changedFiles: ({ event }) => event.output,
            lastOperation: () => 'GET_CHANGED_FILES_DONE',
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Getting changed files failed',
            changedFiles: () => [],
          }),
        },
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
          target: 'idle',
          actions: assign({
            integrationStatus: ({ event }) => event.output,
            lastOperation: () => 'GET_INTEGRATION_STATUS_DONE',
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Integration status check failed',
            integrationStatus: () => ({ ahead: 0, behind: 0 }),
          }),
        },
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
          target: 'idle',
          actions: assign({
            fetchResult: ({ event }) => event.output,
            lastOperation: () => 'FETCH_REMOTE_DONE',
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Fetch remote failed',
            fetchResult: () => undefined,
          }),
        },
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
          target: 'idle',
          actions: assign({
            pushResult: ({ event }) => event.output,
            lastOperation: () => 'PUSH_CHANGES_DONE',
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Push changes failed',
            pushResult: () => undefined,
          }),
        },
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
          target: 'idle',
          actions: assign({
            mergeResult: ({ event }) => event.output,
            lastOperation: () => 'MERGE_BRANCH_DONE',
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Merge branch failed',
            mergeResult: () => undefined,
          }),
        },
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
