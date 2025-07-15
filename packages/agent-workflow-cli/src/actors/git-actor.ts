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
  | { type: 'MERGE_BRANCH'; branch: string }
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

  // Operation state
  stagingInProgress?: boolean;
  stagingComplete?: boolean;
  commitInProgress?: boolean;
  commitComplete?: boolean;
  fetchInProgress?: boolean;
  fetchComplete?: boolean;
  pushInProgress?: boolean;
  pushComplete?: boolean;

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
  operationInProgress?: boolean;
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
        await git.status();
        return true;
      } catch {
        return false;
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
      await git.add('.');
      return true;
    }),

    commitChanges: fromPromise(
      async ({ input }: { input: { message: string; git: SimpleGit } }) => {
        const { message, git } = input;
        const result = await git.commit(message);
        return result.commit;
      }
    ),

    getIntegrationStatus: fromPromise(
      async ({ input }: { input: { integrationBranch?: string; git: SimpleGit } }) => {
        const { integrationBranch = 'feature/actor-ref-integration', git } = input;

        try {
          await git.fetch(['origin', integrationBranch]);

          const ahead = await git.raw(['rev-list', '--count', `origin/${integrationBranch}..HEAD`]);
          const behind = await git.raw([
            'rev-list',
            '--count',
            `HEAD..origin/${integrationBranch}`,
          ]);

          return {
            ahead: Number.parseInt(ahead.trim()) || 0,
            behind: Number.parseInt(behind.trim()) || 0,
          };
        } catch {
          return { ahead: 0, behind: 0 };
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

    // Add other necessary actors...
  },
}).createMachine({
  id: 'git-actor',

  context: ({ input }) => ({
    git: simpleGit(input?.baseDir || process.cwd()),
    baseDir: input?.baseDir || process.cwd(),
    worktrees: [],
    isGitRepo: undefined,
    currentBranch: undefined,
    uncommittedChanges: undefined,
    agentType: undefined,
    integrationStatus: undefined,
    changedFiles: undefined,
    lastCommitMessage: undefined,
    lastCommitHash: undefined,
    stagingInProgress: false,
    stagingComplete: false,
    commitInProgress: false,
    commitComplete: false,
    fetchInProgress: false,
    fetchComplete: false,
    pushInProgress: false,
    pushComplete: false,
    worktreeExists: undefined,
    generatedCommitMessage: undefined,
    commitConfig: undefined,
    dateIssues: undefined,
    lastCommitInfo: undefined,
    lastError: undefined,
    lastOperation: undefined,
    operationInProgress: false,
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
            isGitRepo: ({ event }) => event.output,
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
        stagingInProgress: () => true,
        stagingComplete: () => false,
      }),
      invoke: {
        src: 'addAll',
        input: ({ context }) => ({ git: context.git }),
        onDone: {
          target: 'idle',
          actions: assign({
            stagingInProgress: () => false,
            stagingComplete: () => true,
            lastOperation: () => 'ADD_ALL',
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Staging failed',
            stagingInProgress: () => false,
            stagingComplete: () => false,
          }),
        },
      },
    },

    committingChanges: {
      entry: assign({
        commitInProgress: () => true,
        commitComplete: () => false,
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
            commitInProgress: () => false,
            commitComplete: () => true,
            lastOperation: () => 'COMMIT_CHANGES',
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Commit failed',
            commitInProgress: () => false,
            commitComplete: () => false,
          }),
        },
      },
    },

    gettingChangedFiles: {
      invoke: {
        src: 'getChangedFiles',
        input: ({ context }) => ({ git: context.git }),
        onDone: {
          target: 'idle',
          actions: assign({
            changedFiles: ({ event }) => event.output,
            lastOperation: () => 'GET_CHANGED_FILES',
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
      invoke: {
        src: 'getIntegrationStatus',
        input: ({ context, event }) => ({
          git: context.git,
          integrationBranch: (event as { integrationBranch?: string }).integrationBranch,
        }),
        onDone: {
          target: 'idle',
          actions: assign({
            integrationStatus: ({ event }) => event.output,
            lastOperation: () => 'GET_INTEGRATION_STATUS',
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
