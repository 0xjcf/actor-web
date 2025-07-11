import { type SimpleGit, simpleGit } from 'simple-git';
import { assign, setup } from 'xstate';
import { fromPromise } from 'xstate';

// [actor-web] TODO: Import from main framework once ActorRef is available
// import type { ActorRef } from '@actor-web/core';

// Temporary interface until main framework ActorRef is ready
interface ActorRef<TEvent, TResponse> {
  send(event: TEvent): void;
  ask<T = TResponse>(query: TEvent): Promise<T>;
  observe<TState>(selector: (snapshot: unknown) => TState): unknown;
  getSnapshot(): unknown;
  start(): void;
  stop(): void;
}

// ============================================================================
// GIT ACTOR EVENTS
// ============================================================================

export type GitEvent =
  | { type: 'SETUP_WORKTREES'; agentCount: number }
  | { type: 'CHECK_STATUS' }
  | { type: 'GET_CHANGED_FILES'; integrationBranch?: string }
  | { type: 'DETECT_AGENT_TYPE' }
  | { type: 'CHECK_UNCOMMITTED_CHANGES' }
  | { type: 'GET_INTEGRATION_STATUS'; integrationBranch?: string }
  | { type: 'COMMIT_CHANGES'; message: string }
  | { type: 'PUSH_CHANGES'; branch: string };

export type GitResponse =
  | { type: 'WORKTREES_SETUP'; worktrees: AgentWorktreeConfig[] }
  | { type: 'STATUS_CHECKED'; currentBranch: string; agentType: string }
  | { type: 'CHANGED_FILES'; files: string[] }
  | { type: 'AGENT_TYPE_DETECTED'; agentType: string }
  | { type: 'UNCOMMITTED_STATUS'; hasChanges: boolean }
  | { type: 'INTEGRATION_STATUS'; ahead: number; behind: number }
  | { type: 'CHANGES_COMMITTED'; commitHash: string }
  | { type: 'CHANGES_PUSHED'; success: boolean }
  | { type: 'GIT_ERROR'; error: string };

// ============================================================================
// GIT ACTOR CONTEXT
// ============================================================================

export interface GitContext {
  git: SimpleGit;
  currentBranch?: string;
  agentType?: string;
  uncommittedChanges?: boolean;
  lastError?: string;
  worktrees: AgentWorktreeConfig[];
}

export interface AgentWorktreeConfig {
  agentId: string;
  branch: string;
  path: string;
  role: string;
}

// Type guards for event discrimination
function isSetupWorktreesEvent(
  event: GitEvent
): event is { type: 'SETUP_WORKTREES'; agentCount: number } {
  return event.type === 'SETUP_WORKTREES';
}

function isGetChangedFilesEvent(
  event: GitEvent
): event is { type: 'GET_CHANGED_FILES'; integrationBranch?: string } {
  return event.type === 'GET_CHANGED_FILES';
}

function isCommitChangesEvent(
  event: GitEvent
): event is { type: 'COMMIT_CHANGES'; message: string } {
  return event.type === 'COMMIT_CHANGES';
}

// ============================================================================
// GIT ACTOR MACHINE (XState v5 with setup())
// ============================================================================

export const gitActorMachine = setup({
  types: {
    context: {} as GitContext,
    events: {} as GitEvent,
    input: {} as { baseDir?: string },
  },

  actors: {
    setupWorktrees: fromPromise(
      async ({ input }: { input: { agentCount: number; git: SimpleGit } }) => {
        const { agentCount, git } = input;

        // [actor-web] TODO: Use the same configs as current GitOperations
        const configs = [
          {
            agentId: 'agent-a',
            branch: 'feature/agent-a',
            path: '../actor-web-architecture',
            role: 'Architecture',
          },
          {
            agentId: 'agent-b',
            branch: 'feature/agent-b',
            path: '../actor-web-implementation',
            role: 'Implementation',
          },
          {
            agentId: 'agent-c',
            branch: 'feature/agent-c',
            path: '../actor-web-tests',
            role: 'Testing',
          },
        ] satisfies AgentWorktreeConfig[];

        const results: AgentWorktreeConfig[] = [];

        for (const config of configs.slice(0, agentCount)) {
          try {
            // Check if worktree already exists using git worktree list
            const worktreeList = await git.raw(['worktree', 'list', '--porcelain']);
            if (worktreeList.includes(`worktree ${config.path}`)) {
              results.push(config);
              continue;
            }

            try {
              // Try to add worktree with existing remote branch
              await git.raw([
                'show-ref',
                '--verify',
                '--quiet',
                `refs/remotes/origin/${config.branch}`,
              ]);
              await git.raw([
                'worktree',
                'add',
                '-B',
                config.branch,
                config.path,
                `origin/${config.branch}`,
              ]);
            } catch {
              // Remote branch doesn't exist, create new branch
              await git.raw(['worktree', 'add', config.path, '-b', config.branch]);
            }

            results.push(config);
          } catch (error) {
            // Continue with other worktrees even if one fails
            console.error(`Failed to create worktree for ${config.agentId}:`, error);
          }
        }

        return results;
      }
    ),

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

    getChangedFiles: fromPromise(
      async ({ input }: { input: { integrationBranch?: string; git: SimpleGit } }) => {
        const { integrationBranch = 'feature/actor-ref-integration', git } = input;

        try {
          await git.fetch(['origin', integrationBranch]);
          const diff = await git.raw(['diff', '--name-only', `origin/${integrationBranch}..HEAD`]);
          return diff
            .trim()
            .split('\n')
            .filter((line) => line.length > 0);
        } catch {
          // Fallback to comparing with HEAD~1
          try {
            const diff = await git.raw(['diff', '--name-only', 'HEAD~1..HEAD']);
            return diff
              .trim()
              .split('\n')
              .filter((line) => line.length > 0);
          } catch {
            return [];
          }
        }
      }
    ),

    detectAgentType: fromPromise(async ({ input }: { input: { git: SimpleGit } }) => {
      const { git } = input;
      const status = await git.status();
      const currentBranch = status.current || '';

      if (currentBranch.includes('agent-a') || currentBranch.includes('architecture')) {
        return 'Agent A (Architecture)';
      }
      if (currentBranch.includes('agent-b') || currentBranch.includes('implementation')) {
        return 'Agent B (Implementation)';
      }
      if (currentBranch.includes('agent-c') || currentBranch.includes('test')) {
        return 'Agent C (Testing/Cleanup)';
      }
      return 'Unknown Agent';
    }),

    checkUncommittedChanges: fromPromise(async ({ input }: { input: { git: SimpleGit } }) => {
      const { git } = input;
      const status = await git.status();
      return status.files.length > 0;
    }),

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

    commitChanges: fromPromise(
      async ({ input }: { input: { message: string; git: SimpleGit } }) => {
        const { message, git } = input;

        // Stage all changes
        await git.add('.');

        // Commit with the provided message
        const result = await git.commit(message);
        return result.commit;
      }
    ),

    pushChanges: fromPromise(async ({ input }: { input: { branch: string; git: SimpleGit } }) => {
      const { branch, git } = input;

      try {
        await git.push(['origin', branch]);
        return true;
      } catch {
        return false;
      }
    }),
  },
}).createMachine({
  id: 'git-actor',

  context: ({ input }) => ({
    git: simpleGit(input?.baseDir || process.cwd()),
    worktrees: [],
  }),

  initial: 'idle',

  states: {
    idle: {
      on: {
        SETUP_WORKTREES: {
          target: 'settingUpWorktrees',
        },
        CHECK_STATUS: {
          target: 'checkingStatus',
        },
        GET_CHANGED_FILES: {
          target: 'gettingChangedFiles',
        },
        DETECT_AGENT_TYPE: {
          target: 'detectingAgentType',
        },
        CHECK_UNCOMMITTED_CHANGES: {
          target: 'checkingUncommittedChanges',
        },
        GET_INTEGRATION_STATUS: {
          target: 'gettingIntegrationStatus',
        },
        COMMIT_CHANGES: {
          target: 'committingChanges',
        },
        PUSH_CHANGES: {
          target: 'pushingChanges',
        },
      },
    },

    settingUpWorktrees: {
      invoke: {
        src: 'setupWorktrees',
        input: ({ event, context }) => {
          if (!isSetupWorktreesEvent(event)) {
            throw new Error('Invalid event type for setupWorktrees');
          }
          return {
            agentCount: event.agentCount,
            git: context.git,
          };
        },
        onDone: {
          target: 'idle',
          actions: assign({
            worktrees: ({ event }) => event.output,
          }),
          // [actor-web] TODO: Send response to requesting actor
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Worktree setup failed',
          }),
        },
      },
    },

    checkingStatus: {
      invoke: {
        src: 'checkStatus',
        input: ({ context }) => ({
          git: context.git,
        }),
        onDone: {
          target: 'idle',
          actions: assign({
            currentBranch: ({ event }) => event.output.currentBranch,
            agentType: ({ event }) => event.output.agentType,
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

    gettingChangedFiles: {
      invoke: {
        src: 'getChangedFiles',
        input: ({ event, context }) => {
          if (!isGetChangedFilesEvent(event)) {
            throw new Error('Invalid event type for getChangedFiles');
          }
          return {
            integrationBranch: event.integrationBranch,
            git: context.git,
          };
        },
        onDone: {
          target: 'idle',
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Getting changed files failed',
          }),
        },
      },
    },

    detectingAgentType: {
      invoke: {
        src: 'detectAgentType',
        input: ({ context }) => ({
          git: context.git,
        }),
        onDone: {
          target: 'idle',
          actions: assign({
            agentType: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Agent type detection failed',
          }),
        },
      },
    },

    checkingUncommittedChanges: {
      invoke: {
        src: 'checkUncommittedChanges',
        input: ({ context }) => ({
          git: context.git,
        }),
        onDone: {
          target: 'idle',
          actions: assign({
            uncommittedChanges: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Checking uncommitted changes failed',
          }),
        },
      },
    },

    gettingIntegrationStatus: {
      invoke: {
        src: 'getIntegrationStatus',
        input: ({ event, context }) => ({
          integrationBranch: (event as { integrationBranch?: string }).integrationBranch,
          git: context.git,
        }),
        onDone: {
          target: 'idle',
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Getting integration status failed',
          }),
        },
      },
    },

    committingChanges: {
      invoke: {
        src: 'commitChanges',
        input: ({ event, context }) => {
          if (!isCommitChangesEvent(event)) {
            throw new Error('Invalid event type for commitChanges');
          }
          return {
            message: event.message,
            git: context.git,
          };
        },
        onDone: {
          target: 'idle',
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Committing changes failed',
          }),
        },
      },
    },

    pushingChanges: {
      invoke: {
        src: 'pushChanges',
        input: ({ event, context }) => ({
          branch: (event as { branch: string }).branch,
          git: context.git,
        }),
        onDone: {
          target: 'idle',
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Pushing changes failed',
          }),
        },
      },
    },
  },
});

// ============================================================================
// GIT ACTOR FACTORY
// ============================================================================

/**
 * Create a GitActor instance using the actor-web framework
 * [actor-web] TODO: Use createActorRef from main framework once available
 */
export function createGitActor(_baseDir?: string): ActorRef<GitEvent, GitResponse> {
  // This will be replaced with proper ActorRef creation once the main framework's
  // ActorRef implementation is complete
  throw new Error('[actor-web] TODO: Implement createGitActor using ActorRef from main framework');
}
