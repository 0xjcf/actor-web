/**
 * Git Actor - State-Based Implementation
 *
 * This actor manages git operations using proper state-based actor patterns.
 * Instead of emitting responses, it updates context state that clients can observe.
 */

import { type ActorRef, type ActorSnapshot, createActorRef, Logger } from '@actor-core/runtime';
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
export interface GitActor extends ActorRef<GitEvent, GitEmittedEvent, ActorSnapshot<GitContext>> {
  // All ActorRef methods are inherited
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
  | { type: 'RETRY' };

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
  | { type: 'REPO_STATUS_CHANGED'; repoStatus: unknown; isGitRepo: boolean }
  | { type: 'BRANCH_CHANGED'; currentBranch: string }
  | { type: 'UNCOMMITTED_CHANGES_DETECTED'; hasChanges: boolean }

  // Operation completions
  | { type: 'COMMIT_COMPLETED'; commitHash: string; message: string }
  | { type: 'FETCH_COMPLETED'; branch: string; result: unknown }
  | { type: 'PUSH_COMPLETED'; branch: string; result: unknown }
  | { type: 'MERGE_COMPLETED'; branch: string; result: unknown }
  | { type: 'BRANCH_CREATED'; branchName: string }
  | { type: 'STAGING_COMPLETED'; result: unknown }

  // Integration status updates
  | { type: 'INTEGRATION_STATUS_UPDATED'; status: { ahead: number; behind: number } }
  | { type: 'CHANGED_FILES_DETECTED'; files: string[] }

  // Worktree operations
  | { type: 'WORKTREE_SETUP_COMPLETED'; worktrees: AgentWorktreeConfig[] }
  | { type: 'WORKTREE_STATUS_CHECKED'; exists: boolean; path: string }

  // Generated content
  | { type: 'COMMIT_MESSAGE_GENERATED'; message: string }
  | { type: 'DATE_VALIDATION_COMPLETED'; issues: DateIssue[] }

  // State transitions
  | { type: 'STATE_CHANGED'; from: string; to: string }
  | { type: 'OPERATION_STARTED'; operation: string }

  // Error events
  | { type: 'OPERATION_FAILED'; operation: string; error: string }
  | { type: 'TIMEOUT_OCCURRED'; operation: string }
  | { type: 'VALIDATION_FAILED'; reason: string };

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
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5RQJYBcC0BDAxmg9gE4B0KEANmAMQDCAEgKI0DSA+gEoMAKA8gNoAGALqJQAB3yx0KfADtRIAB6IAjACYVAZmIqVAdhUAWLQDY1Gk4YA0IAJ6IArIYAcxNQM0C9etQE5fziYmvgC+ITaomLgEJGSUtIwsrADKACoAgqkAqsmCIkggElJoMvIFygjqWjr6RqbmKpY29gjuRsS+hiYCKr4CfUECamER6Nh4RKQU1PRMbFkAcjQ8ALIrAJKpqQwAIqz06QsA4gy5wgpF0nIKFVXaugbGmmYW1naqDg6+boZqeppff6adTOEYgSLjGJTeLpHZ7dIAGQReQukiuZVAtw091qTxejTeLTUnwExEMAM6vk0egEJj0JjBEOikziM1WG1S+zohxOZ3y4jRJWu5VU2Jqj3qr2aiEMAi8ZICDhMWj+gQcjLGzNi0yoJ056wW2yO7Ey6x4CxSGWyfNRxVKN1F1QedWeDSa7wQhi63zUzkMAQMwWCw3C4M1E218T1XJ5u1YADF1gjTiiCpchRilI6cRLXVKPZ5fGpiCZNL5dLTfipnCp1aGmRHodR4wxUvQOAwVjxtqmBXbhZjs+KXfj3S1uoYHMQnGZAqqPCHRlFG6yqFwcnQY8cU+c04L7SLKmLnXi3YTEHTOsRnJpzBpZV8HJoNcuoauVgx2CdWAAhE1LOhe0KfcByzI8nVxSUCWlBBnGcH0y39bon2rXoX0hFkdROBZP0yBh9nZTZWA-ZJknSE4gPTA9B3AnMRzPGDJ16Yg9GcBwvAcdQPE8OslwwyNqAANURdYdjw1gxO2G0937TMsQg3NR3PBAnDg69fmcP5iU6Lx0K1YgcAACzAHAAGsUFkKB2DACQqAgOQwFIWQADd8FMxyGyhIyTPMyzrIkBALNcnAsAzPJKJAuTVF8Vi3DUMwhh6PQnhgsViTlL5DFYuk9E6PTG28syLKsmz8CoMBCEISYxHIUKADMiAAW2ITzJkK3ySoCoL8BCsLhAi2SHUqGLviVdxOgnL1ghgoJXF8FCND+TjAmfetwy84yiss5I0FCgBXWA7IcpzXPclr1razaOp2-bYEClyetC0pwt3Pt0SG3oaTcOC9E48kvG4mDq04n4-F0Zxkq+ARDHyjafOKm60AO8rKuq2q0Aawhmtakh2oR3akbu7reue-rXuAwbD0+lQSzULovSS-46VSrQpyDWlPBML5nAEXiw1fS74csrJZBwfBGsa9A0EgGhDKwSy4CO2RHO6s6cYMq7ipFsWJalmW5YVomHpJuQXv5Cn3qpiHi00TTbe8dRniMVLNE8HR-TLHoHECLLVr4-S8eF0XxcltBpYgWX5ZgQ6KqqkgavqprzoF3HNaDnXQ-DyPDfu4KntNsnzao0Dbmt4hbbUe2DEr5VlJUWlSRcXwzFy3KjFhyZYF21BLPSchyCVlWHrVi6SC7rAe6gPvyFzx6+qEAbLZo30so6XmRs02UK5g12-RLMtfS58lJ0CDux+74rp5RuPiATjGk-V8fJ+n2eTdkM3bSXsCV70NfAQCOmHhNJA1Qm4MsdJehOC6NDM+BkQ5S2KtnaOg8TpuQ8qPOBusw6IINtHV++d36F0-hmIazxV4QJJE+Us2UZoOGStOE+-Rkq6D5urDOCDLJIMVrHNGicsbJ34pgzOOCo5wHwfPReJDDxkN-hQ9iVDqSBB3gEUk7h163g4gCWBMBsGcNwZAeMKBKCHXssrVBI8U4tTALoqAXCICGOMeI0mC9ybFyipUMuFcq6O1rjvbm6k6Y1gMD0HK2jrElD0aI+xRjuGo3jujTG2MME6IibY-R0THHEwIR-GSX9S4+HLnbCG1cnbKT+AU6sypgxZT+H7fmgiUnFXWLIaWUBCAEMRsjUxQ9TroMsY0yyzTWntIzJ0o2ecJGuMih9Isqj4q9DgqWYIDgYKcV+joBclgt4WDCTYoZYA2kdIJsjHh8S+FJP6eEppLSDkjNKGMpxBcXFF2mVTIsNMxrAnKbWOkzhGKBI6AESwRZWLsTqerOq1ijLFWso1fA0sUGqz6YIyFaBoV+TAHC6WjzCHPOIdRMC1YCleOKT452HogwmGIAIO2T5Xa9F0LA1F6KSpYuoKc2+CSH4YOZYZGFmL4VgBxTkt6UiaJEptkUh2NdyUtG9sCcu-1yy6BVDDNalixAHT5ZEw2iLh7Iv0pq2A2q0miPGXPZxkiCUVC9AUjQtJgjGC6GYHeugqW5VqeYNuLhYFGpNVwmOcTOXnIEYarVIic5ZMmS8ymNFbXFntUEToRgghqBmgEGmuVKw9D9GYcFGDGoVUnj+dpotDJ6t6aGxshbCDFtLUZYVRDclirAg4dKOhraV2pGYGKrq5TXnpPXdwvwvT6FgTWut8sjLX14fffh6sJ3FRLVOwyja8XNutTKG8U5Oj+nLP0SufgVkFn0FOAEWlGhaEnAydVDSwDKzuZw+BaAVhwFgBPag3TzEGsbDAB9T0n1YNfbAd9MA11WpLqoTxUqSm+IpbWVwmh-p0IsOoMJ-7Uk0GfcB0D7Kg130SVWqEf6KoAdsdht9H7wNTNjYS6DldSUyuUrbckLF5qTmMA8Toi56n6WclgcgZAyM7FCorL9SKiOTH44JiAwnRPmrfiKi2LaKh00+Gxrmv02JZU4qsycv9AwryfH0GKsDpNCdSSJ6Wgab4Ee5ZY8zsnLPyeozGvJ0VLDUqcDIjwNI6GrPiq4T4lhayZW6De-2jZx6E1lj5SAtBzSpANFkBgEH3FtqpbUO2XM6ZlmPS0B8xZ65ll6K7R1SpYHRYOrFsy8XZhJE4LwNLQ0Ms6AMNltt5J5o73pB0FCugyFPlBLe-SVXYA1fchABIcxWCLGWGsTY2w9gHG3NJUVm6VLxTa9WGunW8tA3toC+K0Nob-CcHoSrxzxtXTq4RTkK3eTNcPK1rLu3cvdYLPFbQcEiy-CVDWMsF2RuNkIKVCbt3DTJdSzR9zm3Mvtbe11-LiBPakm6M8T4LgwVDFgaDiQ4Opv1bYGkTIOQns0RewjjH73keVEvEd7w-gXClnMLjsHN3CeJHmEsO7S2tyPZhypxwW3XvU6Rwd6kCpiSNH6BAiLvGQfs7i1N6MD24yJmTGt5TG3Kc7bF-tj0fgDDXngg6oIJg5ywL2sHLBWd9HXeVwlyHCwUvk+-j0Qw1LK5eB8EhxnmhUq-G0N0YkTx2K+bVZFqE1v2Fh31magnVBYTwiRG71Tk4py5U097c7unDeylkWxG8QIYrVkuxPRB4sarWIh0ll30O3NC9aGxb70NZS1kaD4NNBYsquAPeSbwSG-RwXL5PLDjVq-hwSwt+73JVtp5R9WT3vQkI1iqR9loSGzBtboa7Hwk4-CwNj+PyfteocL4QNSdoVIDDsVLF6L4M0gi-38PBboVJQ9H+fSfygU-1zJE3DVy1zcSGllEnG+i8BinmS6FpyCDbWpU0kHz304nzUsQsmGSOVukT2WGd1d0Fx1xFypxy3Fw9GZ1-k4n8Fl3LGeHl3VnQNuUwJiw5yoBbDbE3E4C7B7HwMgzh22w6xpxmj+A+WgXpBcFCx4zoJuUOVGSu0T3-0ALnwF0bwIPhz12IINxaH30Ly+HtXYipC5iP3SQcTgGwMS3P24PcTaE9yGE8G8EriylygDwLGDDcHmhZz6FC2Gyj0uiiWMId1q0Jzu35x3GUJ4LU0z2bjoRzx0xUB3jpCpUUVYivXbwkJ5ShUMh-xr0CNwIb3xTCI9y91sN9wcKpHTVrGnE0niiG3UB8CZXSMyL-w3GCOANeWXgzw0yiO01+liIpRimX1+FD1v29l9S1QaLP3rwvwP20H8CpAXBpQtz0FSipCnB+39G8D9GrFQMET9TGKmw-C-Hwj-EOHoEmO3Q6C9H8HriLFvA30XzpmvAyzK1nDHWByhAnTAF2KdzrzwNCPSz8G+BrHijpF9CfCcBghrGnDlC9jBQBDYlYQwVjxww-SOHvVIynxwO+NyI3XyPaBsJ93sP91WV+w0zpm9yEK2IDgoxA2RNRJGVuxn2aIv3CI6K01zx6PHEaCpVlF9ArDbSVApMbCczgEEgEws3GJ+LyMsLbTR1ynJDoXmgrCcIKxBB+ECF5k8GBD9HL0JgYDiSoE4FSHYAAE0L8JVCkGNpVSlUpzBvgjB3k-t-gaQgdvDz5bpdS44vjzDfiPpbZvgnhW59BJxbY-lDdiRf4hg5SLc21KR4TLExt3SiBpskgSdrRTT6NvEmNrTcoSwPYhh3AeZ+hI8FcoQ8d8AEzCB9TWxjS0ziUYMyVlJ6RixZQW46Y4DRC2cJByzPSJiLCfT4IyQtAAzIZgyYJkouS391T-pSwrcbdM549DYuyDTqzezDxh1Pd-QiVr1yklTVA5RvgAh2M5QQSegBTo9Zy9YI57cuyMSvTJShorDCj8S-dHCQEnxzjylyw-NgQVBR9ipFyqyTSVzl44JPdakFk-QspGgQE3Z-h5o-Q5QK5GhfzLJryzCezvTVyW9rw28vZO9zAgY-hPdgw7YjAc9eYv8sF-zDTAKMKaJqRwCHx5ENFvBmMixvgaReZeZiQLdm5aCETn1UKciL8r9Pcb9awOYH9fAZpXZtBoZBgnTbZghYF6DpD7krsqLlzaK6NayLTYNZUZQkMmzlo5RvR4JTyWQpC7k5AxlBLMTTTfSBzqRS9hy4JGJbwqUnwXBuj7YkNDDfCYlYANKaK7zVy28FRNyxpB9UofAaYLduhATeKkNzLU5-LjFbLbzsTLCCi8S7DnzSjDcIEO0vgqQkNirPg6i0VDIgqmSwqNyIYtyoqPQ6EeZ1JPAPAZcoyKqjJ0r0KQrl5srvdcqSidyVJ-hSRDLyw21645KRjjVqqgKwIM91yozyR9AbwTB00FU-BeY20u0Agiz1Y-UeqJTMrQC21pj-ANT8yFiZogySSaUC9OJx0i0wB5qtKbUzjd1LiD0bjad3LXAeZvYfAeYXAuhnra1Xq9SbzerTrDwpjAVZiNFAgIYd5iRiwftST-stBTNXi2oqTcM3q+r3cvRwr6rIr-gesqRXCqEqkWFLAKLQ4kSYBjqsT1scTrDBrijCSCxkpixco21WJdD9A+LLEhTYARSZMCFCbYbxV0zGMrSmrXRqV+glRfkyrYExaJaLNSgWb7L+z-TnKgzXLFauhqU2KMd-RfQvDizO4rtUgUBC18A9o0BKzqKL9dd+CSCWh9A3ZLbAhWJ-AhDtSDp7bHbnbuyTq2a-jVDPaNCZQ5RYqgFgRFLbCOz8BQ6wAnaXalzgqZbW1CC1C9tbjPQ-gyQnwaU1QdMfBnSbaSBSyM6s6I7WbtceCPbEc46S6XAvchgoYsoggZzY87czUG7w6c73aC7Y7i6jBbYpdghegRpliB7n0h7DYR6XbobI6W7o6+D27i7JLu7d4NSNJkKoA17XbNKiaKg279cp6QSSxzbbZaQ-gT6z6N7m6QDnsJ7d6-qFSNl6KkrVa2IGb0Az6x6Fqr6v6b7YDbxiw5KCRyQNBQhcbcZn1X60LN6P6KdIH1C97Axu6K6xD1AkGXSnIMCZDbpQGALx6Y7v7VleZPcAQYHoZVRm5lLLLGCQ6HbM7w637qGd6oHGI4Dpw1EMpPB-RyLkGNZUq4BKG3bwHhcaGBHPtqhfTawuhT0Pc-KFYMkZGuHG7eH5HeDRccHadr1PdpT4pq6aVywurDJZGL686IHFGTGZpOTXDSxPBiRXY21bG0GhLDHr6XHSD6QPK2hRDgR6RrbDqtV7Hc6o6WtsGi7adq52LtNkIsoM1Zq7G9GeH0H37Wj87nGknGIglu74pyRN5dJJH3jYm+HjHimPQixIS5QaQbwAQLdbxwaYA-G7KAnEmBCeaWrEpfhm46gSrgGX1KNumcns6qG+mimBmCtyw+956YpLA1FJwJmmawAemMr4nP6FmvaZQ-pu79AP8e7UjRb5MtanNShan5n+Ggm5V39pwiwIZHYaka71ZNbRTbm5BdmYb9msHDmO71GpxEoARdraxVpQxZB8AIA4AFAcZL7EAMANqPQ0XlaoTsWoS7TlLpgUWEA+giLcQD1iWtBGITnpSvkhCOZDChZOp8BCWNBetag1lFFEHadlovcONNIeYV4omES04oAxlmXhbtt2XBbIEgZLjzjHxit2IdlJHA4oBtZl75zo5CW1GPkXhqQImYpjbvbmyyQNIIENAXiSGn5L5+5mXU1rxVRfoqQ4SPAXZjcozNJvZoWvgJnMN7dCWkNdA4oJxqkuYf7Sw2sDAtANTPhLm70bE7E-CtW6EqUllfTXZmyd5eYU2ywNEKnU1kqrE9l2HyHCYxXWXb8fapW97yRtAV4YolQgzOnJHeV+U2Uk3+zbwc2-RFFgxXG3Y-Aj4TKAgm2SG-UI1NXHGZQ6YaZp2eKYDgRlJggZ6jBWymJ3BkIuml161DJCWwUEjEDlQa55oRrPBAhy421u3Jw2LBXLkMNK8gMpmwAk2QYPAY2faeYgUSnt90cvgJxPhbYzNfm5NrMxWIYEa5cBsB89NWNehfQ5KAQBtg7-DJstXV4rjXYHqngO6yx-AWIaQGgqQAEb3BFSyCck2E1KkQLsaPdu9N9h83A-MXA-gLdNil7bcNWTCOcy3VDJXNJpXDcWMSw2J6Q3mC9T5JGrXANT8IBmX-Ad0L3jBBhL0-qusd84DZp4IJndj-XhOECqFOg6F150Xxwe0EDAlwFisDqMEVKrLZAxkyPJ2EAghy5ko+jZRywwZRyFlqUARVqgg99iHa6pHtG-CHOgXv5IEB0uhgRqC57aOUcuZtBFEqRoF3l4pbHtPHOGhSROJy71S+gHV00QYV2C8VFWIsnMvwubVzd3Ys8ugfBm5FiT0egHjVRiKc0umPiq9f9IBd3R0Oh4rAh65+a-qaUd0nZVbqDGVlX8aaSMNeusul8vM3CtkgaspXHWNuSpr4ixuNbrmgPw5bXt9ECIYvhbYSQRqoE+b6RXZlms8RbBF4y4ktWuZM11B9MJVoYQyiR7CeXOIehUJYySPSpyyXuywyQmZyxjAxobxRzK4yR4InxgbeavQ2O5zLyzVQfFvy2O9HS+Op7eY5pBhJqKm7CT6seqvEB-j5OV5OSQlawQFszAxWYKDegDCZvKLnvHPzvwyW9ys-Nm5lFYocp5wqQVU2GyG1K3SufKe6cWuWNIitAV8pLSCNTpwh8AYbwVatGYAdHAqZet77zxW2XK38fac-gWvKkTzAEmcvm0jKqKfDfVzjeK28fOXVl6RxqRmEPOLNnJGjqDfMHFqaujA6vgTGuyjSQs1GPLigHqmXrHeg-quvpoZzvOsTKT2bSTdCP5V02tnH3E+CnVMXfceOX+PN87C2NoyawdqLWgufnJaMxC-aNbhlQ0dfMEMYv-NFb4f+hT2M0vRNOJO7aZnyO3BKONjPYV23LGgGOoSQK7w0616x+NBkbJ+PDfh-l648O8zeaFlY39IY91WMfV7R-HPN-SCqwd-D1yXngX6z-Zfp6yQ4q1TPBKkghGJ64pwLepoE7IYJnl+jnJ-nTEuog1zszMClCvCr43cnWU0CXgwRLacMw6aAQlsbj5YAw+gInI+HQ30B-0WEQwNUkDwDhGEAqgAx-pby9i-A5Km8XoJS1Lo-8lQvFdUr4wf5O9xU8BVfhbnX40dXGfgalDAXnpY51ARAxsH6jIFsDCUHAifk8A37xcEANIJpqCS5gRkF2P5ePhDXEFJ8PgidUPoHV9C3hgEPNX4Dv1vBVhxGB-AqLN2mbIDUBv8PdJ0B4jdBWIuUEpi1RE7wRzAvwauHt2sw3MCEmgovogDYhBtFW52CGL2iaooZFUnMMlj9DrBhAgAA */
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
        // Newly wired up events
        SETUP_WORKTREES: 'settingUpWorktrees',
        CHECK_WORKTREE: 'checkingWorktree',
        CREATE_BRANCH: 'creatingBranch',
        GET_LAST_COMMIT: 'gettingLastCommit',
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
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Worktree setup failed',
          }),
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
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Worktree check failed',
          }),
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
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Branch creation failed',
          }),
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
          actions: assign({
            lastError: ({ event }) =>
              event.error instanceof Error ? event.error.message : 'Last commit check failed',
          }),
        },
      },
      after: {
        [TIMEOUTS.LAST_COMMIT_CHECK]: { target: 'lastCommitTimeout' },
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
