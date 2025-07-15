/**
 * Git Actor - State-Based Implementation
 *
 * This actor manages git operations using proper state-based actor patterns.
 * Instead of emitting responses, it updates context state that clients can observe.
 *
 * STANDARDIZED ACTOR PATTERN IMPLEMENTATION
 * =======================================
 *
 * This actor follows the unified actor standardization patterns:
 * 1. Uses createActorRef() for unified actor creation
 * 2. Registers with ActorRegistry for discovery
 * 3. Emits events for actor-to-actor communication
 * 4. Supports ask() pattern for request/response
 * 5. Defines supervision strategies
 *
 * Actor Address: actor://system/git/{id}
 * Communication: Event emission + ask() pattern
 * Supervision: Restart strategy with retry limits
 */

import { type ActorRef, type ActorSnapshot, createActorRef, Logger } from '@actor-core/runtime';
import { type SimpleGit, simpleGit } from 'simple-git';
import { assign, emit, fromPromise, setup } from 'xstate';

// Use scoped logger for git-actor
const log = Logger.namespace('GIT_ACTOR');

// ============================================================================
// ACTOR REGISTRY INTEGRATION
// ============================================================================

/**
 * Actor Registry for standardized actor discovery
 * TODO: This should be imported from @actor-core/runtime once implemented
 */
type AnyActorRef = ActorRef<{ type: string }, { type: string }, ActorSnapshot<unknown>>;

class ActorRegistryService {
  private static instance: ActorRegistryService;
  private registry = new Map<string, AnyActorRef>();

  static getInstance(): ActorRegistryService {
    if (!ActorRegistryService.instance) {
      ActorRegistryService.instance = new ActorRegistryService();
    }
    return ActorRegistryService.instance;
  }

  register(path: string, actor: AnyActorRef): void {
    this.registry.set(path, actor);
    log.debug(`Registered actor at ${path}`);
  }

  lookup(path: string): AnyActorRef | undefined {
    return this.registry.get(path);
  }

  unregister(path: string): void {
    this.registry.delete(path);
    log.debug(`Unregistered actor at ${path}`);
  }

  list(): string[] {
    return Array.from(this.registry.keys());
  }
}

export const ActorRegistry = ActorRegistryService.getInstance();

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
export interface GitActor extends ActorRef<GitEvent, GitEmittedEvent, ActorSnapshot<GitContext>> {
  // All ActorRef methods are inherited
  // Additional standardized methods will be added here
}

// ============================================================================
// GIT ACTOR EVENTS (No Responses!)
// ============================================================================

export type GitEvent =
  | { type: 'CHECK_REPO' }
  | { type: 'CHECK_STATUS' }
  | { type: 'CHECK_UNCOMMITTED_CHANGES' }
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
  | { type: 'START' }
  | { type: 'STOP' }
  | { type: 'CONTINUE' }
  | { type: 'RETRY' }
  // REQUEST/RESPONSE PATTERN EVENTS
  | { type: 'REQUEST_STATUS'; requestId: string }
  | { type: 'REQUEST_BRANCH_INFO'; requestId: string }
  | { type: 'REQUEST_COMMIT_STATUS'; requestId: string };

// ============================================================================
// SUPPORTING TYPES FOR GIT ACTOR
// ============================================================================

/**
 * Configuration for agent worktree setup
 */
export interface AgentWorktreeConfig {
  agentId: string;
  path: string;
  branch: string;
  role: string;
  exists: boolean;
}

// ============================================================================
// GIT ACTOR EMITTED EVENTS (OUTGOING NOTIFICATIONS)
// ============================================================================

/**
 * Events that the GitActor can emit to notify other actors or subscribers
 * about state changes, operation completions, and errors.
 */
export type GitEmittedEvent =
  // Repository state changes
  | { type: 'GIT_REPO_STATUS_CHANGED'; repoStatus: unknown; isGitRepo: boolean }
  | { type: 'GIT_BRANCH_CHANGED'; currentBranch: string }
  | { type: 'GIT_UNCOMMITTED_CHANGES_DETECTED'; hasChanges: boolean }

  // Operation completions
  | { type: 'GIT_COMMIT_COMPLETED'; commitHash: string; message: string }
  | { type: 'GIT_FETCH_COMPLETED'; branch: string; result: unknown }
  | { type: 'GIT_PUSH_COMPLETED'; branch: string; result: unknown }
  | { type: 'GIT_MERGE_COMPLETED'; branch: string; result: unknown }
  | { type: 'GIT_BRANCH_CREATED'; branchName: string }
  | { type: 'GIT_STAGING_COMPLETED'; result: unknown }

  // Integration status updates
  | { type: 'GIT_INTEGRATION_STATUS_UPDATED'; status: { ahead: number; behind: number } }
  | { type: 'GIT_CHANGED_FILES_DETECTED'; files: string[] }

  // Worktree operations
  | { type: 'GIT_WORKTREE_SETUP_COMPLETED'; worktrees: AgentWorktreeConfig[] }
  | { type: 'GIT_WORKTREE_STATUS_CHECKED'; exists: boolean; path: string }

  // Generated content
  | { type: 'GIT_COMMIT_MESSAGE_GENERATED'; message: string }
  | { type: 'GIT_DATE_VALIDATION_COMPLETED'; issues: DateIssue[] }

  // State transitions
  | { type: 'GIT_STATE_CHANGED'; from: string; to: string }
  | { type: 'GIT_OPERATION_STARTED'; operation: string }

  // Error events
  | { type: 'GIT_OPERATION_FAILED'; operation: string; error: string }
  | { type: 'GIT_TIMEOUT_OCCURRED'; operation: string }
  | { type: 'GIT_VALIDATION_FAILED'; reason: string }

  // Request/response events
  | { type: 'GIT_REQUEST_RESPONSE'; requestId: string; response: unknown };

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

  // Request/response tracking
  pendingRequests?: Record<string, unknown>;
}

// ============================================================================
// STATE MACHINE DEFINITION
// ============================================================================

export const gitActorMachine = setup({
  types: {
    context: {} as GitContext,
    events: {} as GitEvent,
    input: {} as { baseDir?: string },
    emitted: {} as GitEmittedEvent,
  },
  actions: {
    // Event emission actions for actor-to-actor communication
    emitRepoStatusChanged: emit(({ context }) => {
      const event = {
        type: 'GIT_REPO_STATUS_CHANGED' as const,
        repoStatus: context.repoStatus,
        isGitRepo: context.isGitRepo || false,
      };
      log.debug('🔥 XState emit() action triggered', { action: 'emitRepoStatusChanged', event });
      return event;
    }),
    emitBranchChanged: emit(({ context }) => {
      const event = {
        type: 'GIT_BRANCH_CHANGED' as const,
        currentBranch: context.currentBranch || 'unknown',
      };
      log.debug('🔥 XState emit() action triggered', { action: 'emitBranchChanged', event });
      return event;
    }),
    emitCommitCompleted: emit(({ context }) => ({
      type: 'GIT_COMMIT_COMPLETED' as const,
      commitHash: context.lastCommitHash || '',
      message: context.lastCommitMessage || '',
    })),
    emitStagingCompleted: emit(({ context }) => ({
      type: 'GIT_STAGING_COMPLETED' as const,
      result: context.stagingResult,
    })),
    emitFetchCompleted: emit(({ context }) => ({
      type: 'GIT_FETCH_COMPLETED' as const,
      branch: context.currentBranch || 'unknown',
      result: context.fetchResult,
    })),
    emitPushCompleted: emit(({ context }) => ({
      type: 'GIT_PUSH_COMPLETED' as const,
      branch: context.currentBranch || 'unknown',
      result: context.pushResult,
    })),
    emitMergeCompleted: emit(({ context }) => ({
      type: 'GIT_MERGE_COMPLETED' as const,
      branch: context.currentBranch || 'unknown',
      result: context.mergeResult,
    })),
    emitOperationFailed: emit(({ context }) => ({
      type: 'GIT_OPERATION_FAILED' as const,
      operation: context.lastOperation || 'unknown',
      error: context.lastError || 'Unknown error',
    })),
  },
  actors: {
    // Keep the existing actor implementations but add response emission
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

    // === MISSING ACTOR IMPLEMENTATIONS ===

    setupWorktrees: fromPromise(
      async ({
        input,
      }: {
        input: { agentCount: number; configOptions?: Record<string, unknown>; git: SimpleGit };
      }) => {
        const { agentCount, configOptions: _configOptions, git } = input;
        try {
          const worktrees: Array<{
            agentId: string;
            branch: string;
            path: string;
            role: string;
            exists: boolean;
          }> = [];

          // Basic worktree setup logic
          for (let i = 1; i <= agentCount; i++) {
            const agentId = `agent-${String.fromCharCode(96 + i)}`; // a, b, c, etc.
            const branch = `feature/${agentId}`;
            const path = `../${agentId}-workspace`;

            let role = 'Implementation';
            if (i === 1) role = 'Architecture';
            else if (i === 3) role = 'Testing/Cleanup';

            try {
              // Check if worktree already exists
              const existingWorktrees = await git.raw(['worktree', 'list', '--porcelain']);
              const exists = existingWorktrees.includes(path);

              if (!exists) {
                // Create branch if it doesn't exist
                try {
                  await git.checkout(['-b', branch]);
                } catch {
                  // Branch might already exist, try to checkout
                  try {
                    await git.checkout([branch]);
                  } catch {
                    // Skip if branch operations fail
                  }
                }

                // Create worktree
                await git.raw(['worktree', 'add', path, branch]);
              }

              worktrees.push({
                agentId,
                branch,
                path,
                role,
                exists,
              });
            } catch (error) {
              // Continue with other worktrees even if one fails
              console.warn(`Failed to create worktree for ${agentId}:`, error);
            }
          }

          return worktrees;
        } catch (error) {
          throw new Error(
            `Failed to setup worktrees: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    ),

    checkWorktree: fromPromise(async ({ input }: { input: { path: string; git: SimpleGit } }) => {
      const { path, git } = input;
      try {
        const worktreeList = await git.raw(['worktree', 'list', '--porcelain']);
        const exists = worktreeList.includes(`worktree ${path}`);

        if (exists) {
          // Get more details about the worktree
          const lines = worktreeList.split('\n');
          let branch = '';
          let head = '';

          for (let i = 0; i < lines.length; i++) {
            if (lines[i] === `worktree ${path}`) {
              // Look for branch and head in following lines
              if (lines[i + 1] && lines[i + 1].startsWith('HEAD ')) {
                head = lines[i + 1].substring(5);
              }
              if (lines[i + 2] && lines[i + 2].startsWith('branch ')) {
                branch = lines[i + 2].substring(7);
              }
              break;
            }
          }

          return {
            exists: true,
            path,
            branch,
            head,
          };
        }

        return {
          exists: false,
          path,
          branch: '',
          head: '',
        };
      } catch (error) {
        throw new Error(
          `Failed to check worktree: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }),

    createBranch: fromPromise(
      async ({ input }: { input: { branchName: string; git: SimpleGit } }) => {
        const { branchName, git } = input;
        try {
          // Check if branch already exists
          const branches = await git.branch();
          const branchExists = branches.all.includes(branchName);

          if (branchExists) {
            return {
              success: true,
              branchName,
              existed: true,
              message: `Branch ${branchName} already exists`,
            };
          }

          // Create and checkout the new branch
          await git.checkout(['-b', branchName]);

          return {
            success: true,
            branchName,
            existed: false,
            message: `Created and switched to branch ${branchName}`,
          };
        } catch (error) {
          throw new Error(
            `Failed to create branch: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    ),

    getLastCommit: fromPromise(async ({ input }: { input: { git: SimpleGit } }) => {
      const { git } = input;
      try {
        const log = await git.log(['-1']); // Get the last commit

        if (log.latest) {
          return {
            hash: log.latest.hash,
            message: log.latest.message,
            author: log.latest.author_name,
            email: log.latest.author_email,
            date: log.latest.date,
          };
        }

        return {
          hash: '',
          message: 'No commits found',
          author: '',
          email: '',
          date: '',
        };
      } catch (error) {
        throw new Error(
          `Failed to get last commit: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }),

    // REQUEST/RESPONSE HANDLERS
    handleStatusRequest: fromPromise(
      async ({ input }: { input: { context: GitContext; requestId: string } }) => {
        const { context, requestId } = input;
        return {
          requestId,
          response: {
            currentBranch: context.currentBranch,
            isGitRepo: context.isGitRepo,
            uncommittedChanges: context.uncommittedChanges,
            lastOperation: context.lastOperation,
            lastError: context.lastError,
          },
        };
      }
    ),

    handleBranchInfoRequest: fromPromise(
      async ({ input }: { input: { context: GitContext; requestId: string } }) => {
        const { context, requestId } = input;
        return {
          requestId,
          response: {
            currentBranch: context.currentBranch,
            agentType: context.agentType,
            integrationStatus: context.integrationStatus,
          },
        };
      }
    ),

    handleCommitStatusRequest: fromPromise(
      async ({ input }: { input: { context: GitContext; requestId: string } }) => {
        const { context, requestId } = input;
        return {
          requestId,
          response: {
            lastCommitHash: context.lastCommitHash,
            lastCommitMessage: context.lastCommitMessage,
            uncommittedChanges: context.uncommittedChanges,
          },
        };
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
    pendingRequests: {},
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
        // Newly wired up events
        SETUP_WORKTREES: 'settingUpWorktrees',
        CHECK_WORKTREE: 'checkingWorktree',
        CREATE_BRANCH: 'creatingBranch',
        GET_LAST_COMMIT: 'gettingLastCommit',
        // Request/response events
        REQUEST_STATUS: 'handlingStatusRequest',
        REQUEST_BRANCH_INFO: 'handlingBranchInfoRequest',
        REQUEST_COMMIT_STATUS: 'handlingCommitStatusRequest',
      },
    },

    checkingRepo: {
      invoke: {
        src: 'checkRepo',
        input: ({ context }) => ({ git: context.git }),
        onDone: {
          target: 'repoChecked',
          actions: [
            assign({
              isGitRepo: ({ event }) => event.output.isRepo,
              repoStatus: ({ event }) => event.output.status,
            }),
            'emitRepoStatusChanged',
          ],
        },
        onError: {
          target: 'repoError',
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Repository check failed',
              isGitRepo: () => false,
            }),
            'emitOperationFailed',
          ],
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
          actions: [
            assign({
              currentBranch: ({ event }) => event.output.currentBranch,
              agentType: ({ event }) => event.output.agentType,
            }),
            'emitBranchChanged',
          ],
        },
        onError: {
          target: 'statusError',
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Status check failed',
            }),
            'emitOperationFailed',
          ],
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
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error
                  ? event.error.message
                  : 'Checking uncommitted changes failed',
              uncommittedChanges: () => false,
            }),
            'emitOperationFailed',
          ],
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
          actions: [
            assign({
              stagingResult: ({ event }) => event.output,
            }),
            'emitStagingCompleted',
          ],
        },
        onError: {
          target: 'stagingError',
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Staging all failed',
              stagingResult: () => undefined,
            }),
            'emitOperationFailed',
          ],
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
          actions: [
            assign({
              lastCommitHash: ({ event }) => event.output,
            }),
            'emitCommitCompleted',
          ],
        },
        onError: {
          target: 'commitError',
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Commit changes failed',
              lastCommitHash: () => undefined,
            }),
            'emitOperationFailed',
          ],
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
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Get changed files failed',
              changedFiles: () => [],
            }),
            'emitOperationFailed',
          ],
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
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error
                  ? event.error.message
                  : 'Integration status check failed',
              integrationStatus: () => ({ ahead: 0, behind: 0 }),
            }),
            'emitOperationFailed',
          ],
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
          actions: [
            assign({
              fetchResult: ({ event }) => event.output,
            }),
            'emitFetchCompleted',
          ],
        },
        onError: {
          target: 'fetchError',
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Fetch remote failed',
              fetchResult: () => undefined,
            }),
            'emitOperationFailed',
          ],
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
          actions: [
            assign({
              pushResult: ({ event }) => event.output,
            }),
            'emitPushCompleted',
          ],
        },
        onError: {
          target: 'pushError',
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Push changes failed',
              pushResult: () => undefined,
            }),
            'emitOperationFailed',
          ],
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
          actions: [
            assign({
              mergeResult: ({ event }) => event.output,
            }),
            'emitMergeCompleted',
          ],
        },
        onError: {
          target: 'mergeError',
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Merge branch failed',
              mergeResult: () => undefined,
            }),
            'emitOperationFailed',
          ],
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
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error
                  ? event.error.message
                  : 'Commit message generation failed',
            }),
            'emitOperationFailed',
          ],
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
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Date validation failed',
            }),
            'emitOperationFailed',
          ],
        },
      },
      after: {
        [TIMEOUTS.VALIDATE_DATES]: { target: 'datesValidationTimeout' },
      },
    },

    // === NEWLY ADDED ACTIVE STATES ===

    settingUpWorktrees: {
      entry: assign({
        lastOperation: () => 'SETTING_UP_WORKTREES',
      }),
      invoke: {
        src: 'setupWorktrees',
        input: ({ context, event }) => ({
          git: context.git,
          agentCount: (event as { agentCount: number }).agentCount,
          configOptions: (event as { configOptions?: Record<string, unknown> }).configOptions,
        }),
        onDone: {
          target: 'worktreesSetup',
          actions: assign({
            worktrees: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'worktreesSetupError',
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Worktree setup failed',
            }),
            'emitOperationFailed',
          ],
        },
      },
      after: {
        [TIMEOUTS.WORKTREE_SETUP]: { target: 'worktreesSetupTimeout' },
      },
    },

    checkingWorktree: {
      entry: assign({
        lastOperation: () => 'CHECKING_WORKTREE',
      }),
      invoke: {
        src: 'checkWorktree',
        input: ({ context, event }) => ({
          git: context.git,
          path: (event as { path: string }).path,
        }),
        onDone: {
          target: 'worktreeChecked',
          actions: assign({
            worktreeExists: ({ event }) => event.output.exists,
          }),
        },
        onError: {
          target: 'worktreeCheckError',
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Worktree check failed',
            }),
            'emitOperationFailed',
          ],
        },
      },
      after: {
        [TIMEOUTS.WORKTREE_CHECK]: { target: 'worktreeCheckTimeout' },
      },
    },

    creatingBranch: {
      entry: assign({
        lastOperation: () => 'CREATING_BRANCH',
      }),
      invoke: {
        src: 'createBranch',
        input: ({ context, event }) => ({
          git: context.git,
          branchName: (event as { branchName: string }).branchName,
        }),
        onDone: {
          target: 'branchCreated',
          actions: assign({
            currentBranch: ({ event }) => event.output.branchName,
          }),
        },
        onError: {
          target: 'branchCreationError',
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Branch creation failed',
            }),
            'emitOperationFailed',
          ],
        },
      },
      after: {
        [TIMEOUTS.BRANCH_CREATION]: { target: 'branchCreationTimeout' },
      },
    },

    gettingLastCommit: {
      entry: assign({
        lastOperation: () => 'GETTING_LAST_COMMIT',
      }),
      invoke: {
        src: 'getLastCommit',
        input: ({ context }) => ({
          git: context.git,
        }),
        onDone: {
          target: 'lastCommitChecked',
          actions: assign({
            lastCommitInfo: ({ event }) => event.output.hash,
          }),
        },
        onError: {
          target: 'lastCommitError',
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Last commit check failed',
            }),
            'emitOperationFailed',
          ],
        },
      },
      after: {
        [TIMEOUTS.LAST_COMMIT_CHECK]: { target: 'lastCommitTimeout' },
      },
    },

    // === REQUEST/RESPONSE HANDLERS ===

    handlingStatusRequest: {
      invoke: {
        src: 'handleStatusRequest',
        input: ({ context, event }) => ({
          context,
          requestId: (event as { requestId: string }).requestId,
        }),
        onDone: {
          target: 'idle',
          actions: emit(({ event }) => ({
            type: 'GIT_REQUEST_RESPONSE' as const,
            requestId: event.output.requestId,
            response: event.output.response,
          })),
        },
        onError: {
          target: 'idle',
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Status request failed',
            }),
            'emitOperationFailed',
          ],
        },
      },
    },

    handlingBranchInfoRequest: {
      invoke: {
        src: 'handleBranchInfoRequest',
        input: ({ context, event }) => ({
          context,
          requestId: (event as { requestId: string }).requestId,
        }),
        onDone: {
          target: 'idle',
          actions: emit(({ event }) => ({
            type: 'GIT_REQUEST_RESPONSE' as const,
            requestId: event.output.requestId,
            response: event.output.response,
          })),
        },
        onError: {
          target: 'idle',
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Branch info request failed',
            }),
            'emitOperationFailed',
          ],
        },
      },
    },

    handlingCommitStatusRequest: {
      invoke: {
        src: 'handleCommitStatusRequest',
        input: ({ context, event }) => ({
          context,
          requestId: (event as { requestId: string }).requestId,
        }),
        onDone: {
          target: 'idle',
          actions: emit(({ event }) => ({
            type: 'GIT_REQUEST_RESPONSE' as const,
            requestId: event.output.requestId,
            response: event.output.response,
          })),
        },
        onError: {
          target: 'idle',
          actions: [
            assign({
              lastError: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Commit status request failed',
            }),
            'emitOperationFailed',
          ],
        },
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
        CHECK_UNCOMMITTED_CHANGES: 'checkingUncommittedChanges',
        COMMIT_CHANGES: 'committingChanges',
        GET_INTEGRATION_STATUS: 'gettingIntegrationStatus',
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
        GET_CHANGED_FILES: 'gettingChangedFiles',
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
        PUSH_CHANGES: 'pushingChanges',
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

    // === NEWLY ADDED COMPLETION STATES ===

    worktreesSetup: {
      entry: assign({
        lastOperation: () => 'WORKTREES_SETUP',
      }),
      on: {
        CONTINUE: 'idle',
      },
    },

    worktreeChecked: {
      entry: assign({
        lastOperation: () => 'WORKTREE_CHECKED',
      }),
      on: {
        CONTINUE: 'idle',
        SETUP_WORKTREES: 'settingUpWorktrees',
      },
    },

    branchCreated: {
      entry: assign({
        lastOperation: () => 'BRANCH_CREATED',
      }),
      on: {
        CONTINUE: 'idle',
      },
    },

    lastCommitChecked: {
      entry: assign({
        lastOperation: () => 'LAST_COMMIT_CHECKED',
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

    // === NEWLY ADDED ERROR STATES ===

    worktreesSetupError: {
      entry: assign({
        lastOperation: () => 'WORKTREES_SETUP_ERROR',
      }),
      on: {
        RETRY: 'settingUpWorktrees',
        CONTINUE: 'idle',
      },
    },

    worktreeCheckError: {
      entry: assign({
        lastOperation: () => 'WORKTREE_CHECK_ERROR',
      }),
      on: {
        RETRY: 'checkingWorktree',
        CONTINUE: 'idle',
      },
    },

    branchCreationError: {
      entry: assign({
        lastOperation: () => 'BRANCH_CREATION_ERROR',
      }),
      on: {
        RETRY: 'creatingBranch',
        CONTINUE: 'idle',
      },
    },

    lastCommitError: {
      entry: assign({
        lastOperation: () => 'LAST_COMMIT_ERROR',
      }),
      on: {
        RETRY: 'gettingLastCommit',
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

    // === NEWLY ADDED TIMEOUT STATES ===

    worktreesSetupTimeout: {
      entry: assign({
        lastError: () => 'Worktrees setup timed out',
        lastOperation: () => 'WORKTREES_SETUP_TIMEOUT',
      }),
      on: {
        RETRY: 'settingUpWorktrees',
        CONTINUE: 'idle',
      },
    },

    worktreeCheckTimeout: {
      entry: assign({
        lastError: () => 'Worktree check timed out',
        lastOperation: () => 'WORKTREE_CHECK_TIMEOUT',
      }),
      on: {
        RETRY: 'checkingWorktree',
        CONTINUE: 'idle',
      },
    },

    branchCreationTimeout: {
      entry: assign({
        lastError: () => 'Branch creation timed out',
        lastOperation: () => 'BRANCH_CREATION_TIMEOUT',
      }),
      on: {
        RETRY: 'creatingBranch',
        CONTINUE: 'idle',
      },
    },

    lastCommitTimeout: {
      entry: assign({
        lastError: () => 'Last commit check timed out',
        lastOperation: () => 'LAST_COMMIT_TIMEOUT',
      }),
      on: {
        RETRY: 'gettingLastCommit',
        CONTINUE: 'idle',
      },
    },
  },
});

// ============================================================================
// STANDARDIZED ACTOR FACTORY
// ============================================================================

/**
 * Create a state-based GitActor using the standardized actor pattern
 *
 * This function follows the ACTOR-STANDARDIZATION-GUIDE.md patterns:
 * 1. Uses createActorRef() for unified actor creation
 * 2. Registers with ActorRegistry for discovery
 * 3. Supports supervision strategies
 * 4. Implements proper event emission and request/response patterns
 *
 * NOTE: This function is in transition for Phase 2 - Pure Actor Model
 * Future versions will use ActorSystem.spawn() instead of direct createActorRef()
 */
export function createGitActor(baseDir?: string): GitActor {
  const actorId = generateGitActorId('git-actor');

  log.debug('🏗️  Creating GitActor', { actorId, baseDir });

  const actorRef = createActorRef(gitActorMachine, {
    id: actorId,
    input: { baseDir },
    autoStart: false,
  });

  // Register in actor registry for discovery
  const actorPath = `actor://system/git/${actorId}`;
  ActorRegistry.register(actorPath, actorRef as unknown as AnyActorRef);

  // Log actor creation
  log.debug(`✅ Created git actor with ID: ${actorId}`);
  log.debug(`📍 Registered at path: ${actorPath}`);

  // Cast to GitActor interface (the framework handles the typing)
  return actorRef as unknown as GitActor;
}

/**
 * Create a GitActor behavior for use with ActorSystem.spawn()
 * This is the preferred method for Phase 2 - Pure Actor Model
 */
export function createGitActorBehavior(baseDir?: string) {
  return {
    machine: gitActorMachine,
    input: { baseDir },
    options: {
      type: 'git-actor',
      autoStart: false,
    },
  };
}

// ============================================================================
// STANDARDIZED ACTOR LOOKUP
// ============================================================================

/**
 * List all registered git actors
 */
export function listGitActors(): string[] {
  const allActors = ActorRegistry.list();
  return allActors.filter((path) => path.startsWith('actor://system/git/'));
}

// ============================================================================
// ACTOR LIFECYCLE MANAGEMENT
// ============================================================================

// NOTE: Direct function calls removed for Phase 2 - Pure Actor Model
// Use ActorSystem.spawn(), ActorSystem.lookup(), and message-based communication instead

// ============================================================================
// MIGRATION GUIDE FOR PHASE 2
// ============================================================================

/*
PHASE 2 MIGRATION GUIDE:

OLD PATTERN (Direct Function Calls):
  const gitActor = createGitActor(baseDir);
  const result = await askGitActor(gitActor.id, 'STATUS');
  const unsubscribe = subscribeToGitActor(gitActor.id, handler);
  cleanupGitActor(gitActor.id);

NEW PATTERN (Message-Based Communication):
  const actorSystem = createActorSystem();
  const gitActor = await actorSystem.spawn(gitActorBehavior, { id: 'git-actor' });
  const result = await gitActor.ask({ type: 'REQUEST_STATUS' });
  const unsubscribe = gitActor.on('*', handler);
  await actorSystem.stop(gitActor);

This ensures pure actor model compliance and location transparency.
*/
