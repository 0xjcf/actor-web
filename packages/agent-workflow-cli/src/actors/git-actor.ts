import { type ActorRef, type ActorSnapshot, createActorRef, Logger } from '@actor-web/core';
import { type SimpleGit, simpleGit } from 'simple-git';
import { assign, fromPromise, setup } from 'xstate';

// Use scoped logger for git-actor internal operations
const log = Logger.namespace('GIT_ACTOR');

/**
 * GitActor-specific snapshot that includes state value for CLI operations
 */
export interface GitActorSnapshot extends ActorSnapshot<GitContext> {
  value: string; // XState machine state value
}

// ============================================================================
// CLI GIT ACTOR INTERFACE - ENFORCES FRAMEWORK CONTRACT
// ============================================================================

/**
 * GitActor interface that properly implements the framework BaseActor contract
 * while providing CLI-specific functionality and event emission
 */
export interface GitActor extends ActorRef<GitEvent, GitResponse> {
  /** CLI-specific snapshot with both context and state value */
  getSnapshot(): GitActorSnapshot;
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
  | { type: 'COMMIT_WITH_CONVENTION'; customMessage?: string } // New: Commit with conventional format
  | { type: 'CHECK_REPO' } // CLI Migration: Replace isGitRepo()
  | { type: 'CHECK_WORKTREE'; path: string } // CLI Migration: Replace worktreeExists()
  | { type: 'FETCH_REMOTE'; branch: string } // CLI Migration: Common git fetch operation
  | { type: 'MERGE_BRANCH'; branch: string }; // CLI Migration: Common git merge operation

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
  | { type: 'CONVENTIONAL_COMMIT_COMPLETE'; commitHash: string; message: string } // New
  | { type: 'REPO_CHECKED'; isGitRepo: boolean } // CLI Migration: Repository validation result
  | { type: 'WORKTREE_CHECKED'; exists: boolean; path: string } // CLI Migration: Worktree existence check
  | { type: 'REMOTE_FETCHED'; branch: string; success: boolean } // CLI Migration: Fetch operation result
  | { type: 'BRANCH_MERGED'; branch: string; success: boolean; commitHash?: string }; // CLI Migration: Merge operation result

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
  isGitRepo?: boolean; // CLI Migration: Repository validation result
  worktreeChecks?: { lastChecked?: boolean }; // CLI Migration: Simplified worktree check result
  fetchResults?: { lastFetched?: boolean }; // CLI Migration: Simplified fetch result
  mergeResults?: { lastMerged?: { success: boolean; commitHash?: string } }; // CLI Migration: Simplified merge result
  lastEventParams?: { [key: string]: unknown }; // CLI Migration: Store event params for actions
  emit?: (response: GitResponse) => void; // CLI Migration: Event emission function
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

function _isCheckWorktreeEvent(event: GitEvent): event is { type: 'CHECK_WORKTREE'; path: string } {
  return event.type === 'CHECK_WORKTREE';
}

function _isFetchRemoteEvent(event: GitEvent): event is { type: 'FETCH_REMOTE'; branch: string } {
  return event.type === 'FETCH_REMOTE';
}

function _isMergeBranchEvent(event: GitEvent): event is { type: 'MERGE_BRANCH'; branch: string } {
  return event.type === 'MERGE_BRANCH';
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
        const { git } = input;

        log.debug('Getting changed files (uncommitted changes)');

        try {
          // Get status to see all changed files (staged and unstaged)
          const status = await git.status();
          const changedFiles: string[] = [];

          // Add staged files
          for (const file of status.staged) {
            changedFiles.push(file);
          }

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

          log.debug('Found changed files', {
            count: changedFiles.length,
            files: changedFiles,
            staged: status.staged,
            modified: status.modified,
            notAdded: status.not_added,
          });

          return changedFiles;
        } catch (error) {
          log.error('Error getting changed files', { error });
          return [];
        }
      }
    ),

    detectAgentType: fromPromise(async ({ input }: { input: { git: SimpleGit } }) => {
      const { git } = input;
      log.debug('Starting agent type detection');

      try {
        const status = await git.status();
        const currentBranch = status.current || '';
        log.debug('Got git status', { currentBranch });

        let agentType: string;
        if (currentBranch.includes('agent-a') || currentBranch.includes('architecture')) {
          agentType = 'Agent A (Architecture)';
        } else if (currentBranch.includes('agent-b') || currentBranch.includes('implementation')) {
          agentType = 'Agent B (Implementation)';
        } else if (currentBranch.includes('agent-c') || currentBranch.includes('test')) {
          agentType = 'Agent C (Testing/Cleanup)';
        } else {
          agentType = 'Unknown Agent';
        }

        log.debug('Agent type detected', { agentType, currentBranch });
        return agentType;
      } catch (error) {
        log.error('Error detecting agent type', { error });
        throw error;
      }
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

    checkRepo: fromPromise(async ({ input }: { input: { git: SimpleGit } }) => {
      const { git } = input;
      try {
        await git.status();
        return true;
      } catch {
        return false;
      }
    }),

    checkWorktree: fromPromise(async ({ input }: { input: { path: string; git: SimpleGit } }) => {
      const { path, git } = input;
      try {
        const worktreeList = await git.raw(['worktree', 'list', '--porcelain']);
        return worktreeList.includes(`worktree ${path}`);
      } catch {
        return false;
      }
    }),

    fetchRemote: fromPromise(async ({ input }: { input: { branch: string; git: SimpleGit } }) => {
      const { branch, git } = input;
      try {
        await git.fetch(['origin', branch]);
        return true;
      } catch {
        return false;
      }
    }),

    mergeBranch: fromPromise(async ({ input }: { input: { branch: string; git: SimpleGit } }) => {
      const { branch, git } = input;
      try {
        await git.merge([branch]);
        return {
          success: true,
        };
      } catch {
        return {
          success: false,
        };
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
      entry: () => {
        log.debug('Git actor entered idle state');
      },
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
          actions: () => {
            log.debug('Received DETECT_AGENT_TYPE event, transitioning to detectingAgentType');
          },
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
        CHECK_REPO: {
          target: 'checkingRepo',
        },
        CHECK_WORKTREE: {
          target: 'checkingWorktree',
        },
        FETCH_REMOTE: {
          target: 'fetchingRemote',
        },
        MERGE_BRANCH: {
          target: 'mergingBranch',
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
          actions: [
            assign({
              currentBranch: ({ event }) => event.output.currentBranch,
              agentType: ({ event }) => event.output.agentType,
            }),
            // Emit response event
            ({ event, self }) => {
              if (self && 'emit' in self) {
                (self as { emit: (event: GitResponse) => void }).emit({
                  type: 'STATUS_CHECKED',
                  currentBranch: event.output.currentBranch,
                  agentType: event.output.agentType,
                });
              }
            },
          ],
        },
        onError: {
          target: 'idle',
          actions: [
            assign({
              lastError: () => 'Status check failed',
            }),
            // Emit error event
            ({ self }) => {
              if (self && 'emit' in self) {
                (self as { emit: (event: GitResponse) => void }).emit({
                  type: 'GIT_ERROR',
                  error: 'Status check failed',
                });
              }
            },
          ],
        },
      },
    },

    gettingChangedFiles: {
      entry: () => {
        log.debug('Entering gettingChangedFiles state');
      },
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
          actions: [
            // Emit response event
            ({ event, context }) => {
              log.debug('getChangedFiles completed successfully', { files: event.output });
              if (context.emit) {
                const response = {
                  type: 'CHANGED_FILES',
                  files: event.output,
                } as const;
                log.debug('Emitting CHANGED_FILES response', response);
                context.emit(response);
              } else {
                log.error('Emit function not available in context for getChangedFiles');
              }
            },
          ],
        },
        onError: {
          target: 'idle',
          actions: [
            assign({
              lastError: () => 'Getting changed files failed',
            }),
            // Emit error event
            ({ context, event }) => {
              log.error('getChangedFiles failed', { error: event.error });
              if (context.emit) {
                const response = {
                  type: 'GIT_ERROR',
                  error: 'Getting changed files failed',
                } as const;
                log.debug('Emitting GIT_ERROR response', response);
                context.emit(response);
              } else {
                log.error('Emit function not available in context for error handling');
              }
            },
          ],
        },
      },
    },

    detectingAgentType: {
      entry: () => {
        log.debug('Entering detectingAgentType state');
      },
      invoke: {
        src: 'detectAgentType',
        input: ({ context }) => ({
          git: context.git,
        }),
        onDone: {
          target: 'idle',
          actions: [
            assign({
              agentType: ({ event }) => event.output,
            }),
            // Emit response event
            ({ event, context }) => {
              log.debug('detectAgentType completed successfully', { agentType: event.output });
              if (context.emit) {
                const response = {
                  type: 'AGENT_TYPE_DETECTED',
                  agentType: event.output,
                } as const;
                log.debug('Emitting AGENT_TYPE_DETECTED response', response);
                context.emit(response);
              } else {
                log.error('Emit function not available in context');
              }
            },
          ],
        },
        onError: {
          target: 'idle',
          actions: [
            assign({
              lastError: () => 'Agent type detection failed',
            }),
            // Emit error event
            ({ context, event }) => {
              log.error('detectAgentType failed', { error: event.error });
              if (context.emit) {
                const response = {
                  type: 'GIT_ERROR',
                  error: 'Agent type detection failed',
                } as const;
                log.debug('Emitting GIT_ERROR response', response);
                context.emit(response);
              } else {
                log.error('Emit function not available in context for error handling');
              }
            },
          ],
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
          actions: [
            assign({
              uncommittedChanges: ({ event }) => event.output,
            }),
            // Emit response event
            ({ event, self }) => {
              if (self && 'emit' in self) {
                (self as { emit: (event: GitResponse) => void }).emit({
                  type: 'UNCOMMITTED_STATUS',
                  hasChanges: event.output,
                });
              }
            },
          ],
        },
        onError: {
          target: 'idle',
          actions: [
            assign({
              lastError: () => 'Checking uncommitted changes failed',
            }),
            // Emit error event
            ({ self }) => {
              if (self && 'emit' in self) {
                (self as { emit: (event: GitResponse) => void }).emit({
                  type: 'GIT_ERROR',
                  error: 'Checking uncommitted changes failed',
                });
              }
            },
          ],
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
          actions: [
            assign({
              lastCommitMessage: ({ event }) => event.output.message,
            }),
            // Emit response event
            ({ event, self }) => {
              if (self && 'emit' in self) {
                (self as { emit: (event: GitResponse) => void }).emit({
                  type: 'CONVENTIONAL_COMMIT_COMPLETE',
                  commitHash: event.output.commitHash,
                  message: event.output.message,
                });
              }
            },
          ],
        },
        onError: {
          target: 'idle',
          actions: [
            assign({
              lastError: () => 'Conventional commit failed',
            }),
            // Emit error event
            ({ self }) => {
              if (self && 'emit' in self) {
                (self as { emit: (event: GitResponse) => void }).emit({
                  type: 'GIT_ERROR',
                  error: 'Conventional commit failed',
                });
              }
            },
          ],
        },
      },
    },

    checkingRepo: {
      invoke: {
        src: 'checkRepo',
        input: ({ context }) => ({
          git: context.git,
        }),
        onDone: {
          target: 'idle',
          actions: [
            assign({
              isGitRepo: ({ event }) => event.output,
            }),
            // Emit response event
            ({ event, self }) => {
              if (self && 'emit' in self) {
                (self as { emit: (event: GitResponse) => void }).emit({
                  type: 'REPO_CHECKED',
                  isGitRepo: event.output,
                });
              }
            },
          ],
        },
        onError: {
          target: 'idle',
          actions: [
            assign({
              lastError: () => 'Repository check failed',
            }),
            // Emit error event
            ({ self }) => {
              if (self && 'emit' in self) {
                (self as { emit: (event: GitResponse) => void }).emit({
                  type: 'GIT_ERROR',
                  error: 'Repository check failed',
                });
              }
            },
          ],
        },
      },
    },

    checkingWorktree: {
      invoke: {
        src: 'checkWorktree',
        input: ({ event, context }) => {
          if (!_isCheckWorktreeEvent(event)) {
            throw new Error('Invalid event type for checkWorktree');
          }
          return {
            path: event.path,
            git: context.git,
          };
        },
        onDone: {
          target: 'idle',
          actions: assign({
            worktreeChecks: ({ context, event }) => ({
              ...context.worktreeChecks,
              // Use a simple key since we can't easily access the original path
              lastChecked: event.output,
            }),
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Worktree check failed',
          }),
        },
      },
    },

    fetchingRemote: {
      invoke: {
        src: 'fetchRemote',
        input: ({ event, context }) => {
          if (!_isFetchRemoteEvent(event)) {
            throw new Error('Invalid event type for fetchRemote');
          }
          return {
            branch: event.branch,
            git: context.git,
          };
        },
        onDone: {
          target: 'idle',
          actions: assign({
            fetchResults: ({ context, event }) => ({
              ...context.fetchResults,
              // Use a simple key since we can't easily access the original branch
              lastFetched: event.output,
            }),
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Remote fetch failed',
          }),
        },
      },
    },

    mergingBranch: {
      invoke: {
        src: 'mergeBranch',
        input: ({ event, context }) => {
          if (!_isMergeBranchEvent(event)) {
            throw new Error('Invalid event type for mergeBranch');
          }
          return {
            branch: event.branch,
            git: context.git,
          };
        },
        onDone: {
          target: 'idle',
          actions: assign({
            mergeResults: ({ context, event }) => ({
              ...context.mergeResults,
              // Use a simple key since we can't easily access the original branch
              lastMerged: event.output,
            }),
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            lastError: () => 'Branch merge failed',
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
 * Create a GitActor instance using the framework's createActorRef
 * This provides proper event emission and subscription capabilities
 */
export function createGitActor(baseDir?: string): GitActor {
  // Use framework's createActorRef to get proper event emission
  const actorRef = createActorRef<GitEvent, GitResponse>(gitActorMachine, {
    id: `git-actor-${Date.now()}`,
    input: { baseDir },
  });

  // Start the actor immediately
  actorRef.start();

  // Store reference to original getSnapshot to avoid recursion
  const originalGetSnapshot = actorRef.getSnapshot.bind(actorRef);

  // Create the GitActor by extending the actorRef with CLI-specific methods
  const gitActor = Object.assign(actorRef, {
    // Override getSnapshot with CLI-specific implementation
    getSnapshot: (): GitActorSnapshot => {
      const snapshot = originalGetSnapshot();
      return {
        context: snapshot.context as GitContext,
        value: 'idle', // Simplified for CLI use
        status: snapshot.status,
        error: snapshot.error,
        // XState compatibility methods - delegated to framework
        matches: (state: string) => state === 'idle',
        can: () => true,
        hasTag: () => false,
        toJSON: () => ({ context: snapshot.context }),
      };
    },
  }) as GitActor;

  return gitActor;
}
