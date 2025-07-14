import { type SimpleGit, simpleGit } from 'simple-git';
import { assign, createActor, fromPromise, setup } from 'xstate';

// CLI-specific GitActor interface (simplified for CLI use)
interface GitActor {
  send(event: GitEvent): void;
  getSnapshot(): { context: GitContext };
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
  | { type: 'PUSH_CHANGES'; branch: string }
  | { type: 'GENERATE_COMMIT_MESSAGE' } // New: Generate smart commit message
  | { type: 'VALIDATE_DATES'; filePaths: string[] } // New: Validate dates in files
  | { type: 'COMMIT_WITH_CONVENTION'; customMessage?: string }; // New: Commit with conventional format

export type GitResponse =
  | { type: 'WORKTREES_SETUP'; worktrees: AgentWorktreeConfig[] }
  | { type: 'STATUS_CHECKED'; currentBranch: string; agentType: string }
  | { type: 'CHANGED_FILES'; files: string[] }
  | { type: 'AGENT_TYPE_DETECTED'; agentType: string }
  | { type: 'UNCOMMITTED_STATUS'; hasChanges: boolean }
  | { type: 'INTEGRATION_STATUS'; ahead: number; behind: number }
  | { type: 'CHANGES_COMMITTED'; commitHash: string }
  | { type: 'CHANGES_PUSHED'; success: boolean }
  | { type: 'GIT_ERROR'; error: string }
  | { type: 'COMMIT_MESSAGE_GENERATED'; message: string; scope: string; commitType: string } // New
  | { type: 'DATES_VALIDATED'; issues: DateIssue[] } // New
  | { type: 'CONVENTIONAL_COMMIT_COMPLETE'; commitHash: string; message: string }; // New

// ============================================================================
// GIT ACTOR CONTEXT
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
  git: SimpleGit;
  currentBranch?: string;
  agentType?: string;
  uncommittedChanges?: boolean;
  lastError?: string;
  worktrees: AgentWorktreeConfig[];
  lastCommitMessage?: string; // New: Store generated commit message
  commitConfig?: CommitMessageConfig; // New: Store commit configuration
  dateIssues?: DateIssue[]; // New: Store date validation results
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

    generateCommitMessage: fromPromise(async ({ input }: { input: { git: SimpleGit } }) => {
      const { git } = input;

      // Get changed files
      const changedFiles = await git.raw(['diff', '--cached', '--name-only']).catch(() => '');
      const files = changedFiles
        .trim()
        .split('\n')
        .filter((f) => f.length > 0);

      // Detect agent type
      const status = await git.status();
      const currentBranch = status.current || '';
      let agentType = 'Unknown Agent';
      if (currentBranch.includes('agent-a') || currentBranch.includes('architecture')) {
        agentType = 'Agent A (Architecture)';
      } else if (currentBranch.includes('agent-b') || currentBranch.includes('implementation')) {
        agentType = 'Agent B (Implementation)';
      } else if (currentBranch.includes('agent-c') || currentBranch.includes('test')) {
        agentType = 'Agent C (Testing/Cleanup)';
      }

      // Smart commit type detection
      let commitType = 'feat';
      let scope = 'core';
      let description = 'update implementation';
      let workCategory = 'implementation';

      // Analyze files for commit type
      const testFiles = files.filter((f) => f.includes('.test.') || f.includes('.spec.'));
      const docFiles = files.filter((f) => f.endsWith('.md') || f.startsWith('docs/'));
      const configFiles = files.filter((f) => f.includes('.json') || f.includes('.config.'));

      if (testFiles.length > 0 && testFiles.length === files.length) {
        commitType = 'test';
        scope = 'tests';
        description = 'expand test coverage';
        workCategory = 'test coverage';
      } else if (docFiles.length > 0 && docFiles.length === files.length) {
        commitType = 'docs';
        scope = 'docs';
        description = 'update documentation';
        workCategory = 'documentation';
      } else if (configFiles.length > 0 && configFiles.length === files.length) {
        commitType = 'build';
        scope = 'config';
        description = 'update configuration';
        workCategory = 'configuration';
      }

      // Determine scope based on file patterns
      if (files.some((f) => f.includes('actor-ref'))) {
        scope = 'actor-ref';
        description = 'enhance actor reference system';
      } else if (files.some((f) => f.includes('cli') || f.includes('command'))) {
        scope = 'cli';
        description = 'improve CLI functionality';
      } else if (files.some((f) => f.includes('git-operations'))) {
        scope = 'git-operations';
        description = 'improve git operations';
      }

      // Detect project tag based on current directory
      const currentDir = process.cwd();
      let projectTag = 'actor-web';
      if (currentDir.includes('agent-workflow-cli')) {
        projectTag = 'actor-workflow-cli';
      }

      // Generate conventional commit message
      const message = `${commitType}(${scope}): ${description}

Agent: ${agentType}
Files: ${files.slice(0, 5).join(', ')}${files.length > 5 ? '...' : ''}
Context: Modified ${files.length} files to ${description} for ${workCategory}

[${projectTag}] ${agentType} - ${workCategory}`;

      return { message, scope, commitType, workCategory };
    }),

    validateDates: fromPromise(
      async ({ input }: { input: { filePaths: string[]; git: SimpleGit } }) => {
        const { filePaths } = input;
        const issues: DateIssue[] = [];

        for (const filePath of filePaths) {
          try {
            const content = await import('node:fs').then((fs) =>
              fs.promises.readFile(filePath, 'utf8')
            );
            const lines = content.split('\n');

            lines.forEach((line, index) => {
              const dateMatch = line.match(/202[0-9]-[0-9]{2}-[0-9]{2}/);
              if (dateMatch) {
                const date = dateMatch[0];
                const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                  .toISOString()
                  .split('T')[0];
                const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                  .toISOString()
                  .split('T')[0];

                // Check for problematic dates
                if (date < sevenDaysAgo && line.includes('@author')) {
                  issues.push({
                    file: filePath,
                    line: index + 1,
                    date,
                    issue: 'past',
                    context: line.trim(),
                  });
                } else if (date > sevenDaysFromNow) {
                  issues.push({
                    file: filePath,
                    line: index + 1,
                    date,
                    issue: 'future',
                    context: line.trim(),
                  });
                }
              }
            });
          } catch {
            // Skip files that can't be read
          }
        }

        return issues;
      }
    ),

    commitWithConvention: fromPromise(
      async ({ input }: { input: { customMessage?: string; git: SimpleGit } }) => {
        const { customMessage, git } = input;

        // Stage all changes
        await git.add('.');

        let commitMessage = customMessage;
        if (!commitMessage) {
          // Generate smart commit message
          const changedFiles = await git.raw(['diff', '--cached', '--name-only']).catch(() => '');
          const files = changedFiles
            .trim()
            .split('\n')
            .filter((f) => f.length > 0);

          // Use the same logic as generateCommitMessage
          const status = await git.status();
          const currentBranch = status.current || '';
          let agentType = 'Unknown Agent';
          if (currentBranch.includes('agent-a') || currentBranch.includes('architecture')) {
            agentType = 'Agent A (Architecture)';
          } else if (
            currentBranch.includes('agent-b') ||
            currentBranch.includes('implementation')
          ) {
            agentType = 'Agent B (Implementation)';
          } else if (currentBranch.includes('agent-c') || currentBranch.includes('test')) {
            agentType = 'Agent C (Testing/Cleanup)';
          }

          const projectTag = process.cwd().includes('agent-workflow-cli')
            ? 'actor-workflow-cli'
            : 'actor-web';

          commitMessage = `feat(core): update implementation

Agent: ${agentType}
Files: ${files.slice(0, 5).join(', ')}${files.length > 5 ? '...' : ''}
Context: Modified ${files.length} files for implementation work

[${projectTag}] ${agentType} - implementation`;
        }

        // Commit with the message
        const result = await git.commit(commitMessage);
        return { commitHash: result.commit, message: commitMessage };
      }
    ),
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
        GENERATE_COMMIT_MESSAGE: {
          target: 'generatingCommitMessage',
        },
        VALIDATE_DATES: {
          target: 'validatingDates',
        },
        COMMIT_WITH_CONVENTION: {
          target: 'committingWithConvention',
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

    generatingCommitMessage: {
      invoke: {
        src: 'generateCommitMessage',
        input: ({ context }) => ({
          git: context.git,
        }),
        onDone: {
          target: 'idle',
          actions: assign({
            lastCommitMessage: ({ event }) => event.output.message,
            commitConfig: ({ event }) => ({
              scope: event.output.scope,
              type: event.output.commitType,
              workCategory: event.output.workCategory,
            }),
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Commit message generation failed',
          }),
        },
      },
    },

    validatingDates: {
      invoke: {
        src: 'validateDates',
        input: ({ event, context }) => ({
          filePaths: (event as { filePaths: string[] }).filePaths,
          git: context.git,
        }),
        onDone: {
          target: 'idle',
          actions: assign({
            dateIssues: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Date validation failed',
          }),
        },
      },
    },

    committingWithConvention: {
      invoke: {
        src: 'commitWithConvention',
        input: ({ event, context }) => ({
          customMessage: (event as { customMessage?: string }).customMessage,
          git: context.git,
        }),
        onDone: {
          target: 'idle',
          actions: assign({
            lastCommitMessage: ({ event }) => event.output.message,
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Conventional commit failed',
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
 * Create a GitActor instance using XState directly for CLI use
 * Ready for production use with enhanced commit and date functionality
 */
export function createGitActor(baseDir?: string): GitActor {
  const actor = createActor(gitActorMachine, {
    input: { baseDir },
  });

  return {
    send: (event: GitEvent) => actor.send(event),
    getSnapshot: () => actor.getSnapshot(),
    start: () => actor.start(),
    stop: () => actor.stop(),
  };
}
