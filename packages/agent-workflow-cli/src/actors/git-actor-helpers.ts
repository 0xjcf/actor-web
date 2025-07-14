/**
 * @module agent-workflow-cli/actors/git-actor-helpers
 * @description Helper functions for working with GitActor in CLI commands
 * @author Agent A - CLI Actor Migration
 */

import type { GitActor } from './git-actor';

// ============================================================================
// ACTOR LIFECYCLE HELPERS
// ============================================================================

/**
 * Wait for actor to return to idle state (operation complete)
 */
export async function waitForCompletion(gitActor: GitActor): Promise<void> {
  return new Promise((resolve) => {
    const checkState = () => {
      const snapshot = gitActor.getSnapshot();
      if (snapshot.value === 'idle') {
        resolve();
      } else {
        // Check every 10ms - fast polling for CLI responsiveness
        setTimeout(checkState, 10);
      }
    };
    checkState();
  });
}

/**
 * Wait for actor to reach specific state
 */
export async function waitForState(gitActor: GitActor, targetState: string): Promise<void> {
  return new Promise((resolve) => {
    const checkState = () => {
      const snapshot = gitActor.getSnapshot();
      if (snapshot.value === targetState) {
        resolve();
      } else {
        setTimeout(checkState, 10);
      }
    };
    checkState();
  });
}

/**
 * Wait for completion with timeout
 */
export async function waitForCompletionWithTimeout(
  gitActor: GitActor,
  timeoutMs = 30000 // 30 second default
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Git operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const checkState = () => {
      const snapshot = gitActor.getSnapshot();
      if (snapshot.value === 'idle') {
        clearTimeout(timeout);
        resolve();
      } else {
        setTimeout(checkState, 10);
      }
    };
    checkState();
  });
}

// ============================================================================
// ERROR HANDLING UTILITIES
// ============================================================================

/**
 * Check if actor has error after operation
 */
export function hasError(gitActor: GitActor): boolean {
  const snapshot = gitActor.getSnapshot();
  return !!snapshot.context.lastError;
}

/**
 * Get error message from actor
 */
export function getError(gitActor: GitActor): string | undefined {
  const snapshot = gitActor.getSnapshot();
  return snapshot.context.lastError;
}

/**
 * Throw error if actor has error, otherwise continue
 */
export function throwIfError(gitActor: GitActor, operation: string): void {
  const error = getError(gitActor);
  if (error) {
    throw new Error(`${operation} failed: ${error}`);
  }
}

/**
 * Clear error from actor context
 */
export function clearError(gitActor: GitActor): void {
  // Send a harmless operation to reset the error state
  gitActor.send({ type: 'CHECK_STATUS' });
}

// ============================================================================
// RESULT EXTRACTION UTILITIES
// ============================================================================

/**
 * Get current branch from actor context
 */
export function getCurrentBranch(gitActor: GitActor): string | undefined {
  const snapshot = gitActor.getSnapshot();
  return snapshot.context.currentBranch;
}

/**
 * Get agent type from actor context
 */
export function getAgentType(gitActor: GitActor): string | undefined {
  const snapshot = gitActor.getSnapshot();
  return snapshot.context.agentType;
}

/**
 * Check if directory is git repository
 */
export function isGitRepo(gitActor: GitActor): boolean | undefined {
  const snapshot = gitActor.getSnapshot();
  return snapshot.context.isGitRepo;
}

/**
 * Check if there are uncommitted changes
 */
export function hasUncommittedChanges(gitActor: GitActor): boolean | undefined {
  const snapshot = gitActor.getSnapshot();
  return snapshot.context.uncommittedChanges;
}

/**
 * Get last commit message generated
 */
export function getLastCommitMessage(gitActor: GitActor): string | undefined {
  const snapshot = gitActor.getSnapshot();
  return snapshot.context.lastCommitMessage;
}

/**
 * Get worktree check result
 */
export function getWorktreeCheckResult(gitActor: GitActor): boolean | undefined {
  const snapshot = gitActor.getSnapshot();
  return snapshot.context.worktreeChecks?.lastChecked;
}

/**
 * Get fetch result
 */
export function getFetchResult(gitActor: GitActor): boolean | undefined {
  const snapshot = gitActor.getSnapshot();
  return snapshot.context.fetchResults?.lastFetched;
}

/**
 * Get merge result
 */
export function getMergeResult(
  gitActor: GitActor
): { success: boolean; commitHash?: string } | undefined {
  const snapshot = gitActor.getSnapshot();
  return snapshot.context.mergeResults?.lastMerged;
}

// ============================================================================
// HIGH-LEVEL OPERATION HELPERS
// ============================================================================

/**
 * Perform git repository check with error handling
 */
export async function checkGitRepository(gitActor: GitActor): Promise<boolean> {
  gitActor.send({ type: 'CHECK_REPO' });
  await waitForCompletion(gitActor);

  if (hasError(gitActor)) {
    return false; // Error means not a git repo
  }

  return isGitRepo(gitActor) ?? false;
}

/**
 * Get current status (branch + agent type) with error handling
 */
export async function getGitStatus(gitActor: GitActor): Promise<{
  currentBranch: string;
  agentType: string;
}> {
  gitActor.send({ type: 'CHECK_STATUS' });
  await waitForCompletion(gitActor);
  throwIfError(gitActor, 'Check status');

  const currentBranch = getCurrentBranch(gitActor);
  const agentType = getAgentType(gitActor);

  if (!currentBranch || !agentType) {
    throw new Error('Failed to get complete git status');
  }

  return { currentBranch, agentType };
}

/**
 * Check for uncommitted changes with error handling
 */
export async function checkUncommittedChanges(gitActor: GitActor): Promise<boolean> {
  gitActor.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });
  await waitForCompletion(gitActor);
  throwIfError(gitActor, 'Check uncommitted changes');

  return hasUncommittedChanges(gitActor) ?? false;
}

/**
 * Commit changes with message
 */
export async function commitChanges(gitActor: GitActor, message: string): Promise<void> {
  gitActor.send({ type: 'COMMIT_CHANGES', message });
  await waitForCompletion(gitActor);
  throwIfError(gitActor, 'Commit changes');
}

/**
 * Generate and commit with smart message
 */
export async function generateAndCommit(
  gitActor: GitActor,
  customMessage?: string
): Promise<string> {
  if (customMessage) {
    await commitChanges(gitActor, customMessage);
    return customMessage;
  }

  // Generate smart commit message
  gitActor.send({ type: 'GENERATE_COMMIT_MESSAGE' });
  await waitForCompletion(gitActor);
  throwIfError(gitActor, 'Generate commit message');

  const generatedMessage = getLastCommitMessage(gitActor);
  if (!generatedMessage) {
    throw new Error('Failed to generate commit message');
  }

  // Commit with generated message
  await commitChanges(gitActor, generatedMessage);
  return generatedMessage;
}

/**
 * Push changes to branch
 */
export async function pushChanges(gitActor: GitActor, branch: string): Promise<void> {
  gitActor.send({ type: 'PUSH_CHANGES', branch });
  await waitForCompletion(gitActor);
  throwIfError(gitActor, `Push to ${branch}`);
}

// ============================================================================
// ACTOR LIFECYCLE MANAGEMENT
// ============================================================================

/**
 * Create and start git actor with proper error handling
 */
export function createAndStartGitActor(baseDir?: string): GitActor {
  const { createGitActor } = require('./git-actor');
  const gitActor = createGitActor(baseDir);
  gitActor.start();
  return gitActor;
}

/**
 * Safely stop git actor
 */
export function stopGitActor(gitActor: GitActor): void {
  try {
    gitActor.stop();
  } catch (error) {
    // Ignore stop errors - actor may already be stopped
    console.warn('Warning: Error stopping git actor:', error);
  }
}

/**
 * Execute git operation with automatic actor lifecycle management
 */
export async function withGitActor<T>(
  operation: (gitActor: GitActor) => Promise<T>,
  baseDir?: string
): Promise<T> {
  const gitActor = createAndStartGitActor(baseDir);

  try {
    return await operation(gitActor);
  } finally {
    stopGitActor(gitActor);
  }
}

// ============================================================================
// CLI COMMAND PATTERNS
// ============================================================================

/**
 * Standard CLI validation pattern - check repo and get status
 */
export async function validateCLIEnvironment(gitActor: GitActor): Promise<{
  isGitRepo: boolean;
  currentBranch?: string;
  agentType?: string;
}> {
  // Check if git repository
  const isRepo = await checkGitRepository(gitActor);

  if (!isRepo) {
    return { isGitRepo: false };
  }

  // Get git status
  const { currentBranch, agentType } = await getGitStatus(gitActor);

  return {
    isGitRepo: true,
    currentBranch,
    agentType,
  };
}

/**
 * Full save workflow pattern - validate, check changes, commit, push
 */
export async function performSaveWorkflow(
  gitActor: GitActor,
  customMessage?: string
): Promise<{
  committed: boolean;
  commitMessage?: string;
  branch?: string;
}> {
  // Validate environment
  const env = await validateCLIEnvironment(gitActor);
  if (!env.isGitRepo) {
    throw new Error('Not in a Git repository');
  }

  // Check for changes
  const hasChanges = await checkUncommittedChanges(gitActor);
  if (!hasChanges) {
    return { committed: false };
  }

  // Commit changes
  const commitMessage = await generateAndCommit(gitActor, customMessage);

  return {
    committed: true,
    commitMessage,
    branch: env.currentBranch,
  };
}
