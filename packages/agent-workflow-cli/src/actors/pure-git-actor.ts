/**
 * Pure Git Actor - Message-Passing Implementation
 *
 * This actor implements message-passing communication following the pure
 * actor model principles. It uses the available actor-core-runtime types.
 */

import { Logger } from '@actor-core/runtime';
import { type SimpleGit, simpleGit } from 'simple-git';

// Create scoped logger
const log = Logger.namespace('PURE_GIT_ACTOR');

// ============================================================================
// TYPES
// ============================================================================

/**
 * Git actor message types
 */
export type GitMessageType =
  | 'CHECK_REPO'
  | 'CHECK_STATUS'
  | 'CHECK_UNCOMMITTED_CHANGES'
  | 'GET_INTEGRATION_STATUS'
  | 'GET_CHANGED_FILES'
  | 'ADD_ALL'
  | 'COMMIT_CHANGES'
  | 'FETCH_REMOTE'
  | 'PUSH_CHANGES'
  | 'MERGE_BRANCH'
  | 'CREATE_BRANCH'
  | 'GET_LAST_COMMIT'
  | 'CHECK_WORKTREE'
  | 'SETUP_WORKTREES'
  | 'GENERATE_COMMIT_MESSAGE'
  | 'VALIDATE_DATES';

/**
 * Git actor message
 */
export interface GitMessage {
  type: GitMessageType;
  payload?: Record<string, unknown>;
  timestamp: number;
  correlationId?: string;
}

/**
 * Git actor state
 */
export interface GitActorState {
  // Core git state
  git: SimpleGit;
  baseDir: string;

  // Repository state
  isGitRepo?: boolean;
  repoStatus?: unknown;
  currentBranch?: string;
  uncommittedChanges?: boolean;

  // Integration state
  integrationStatus?: { ahead: number; behind: number };

  // File state
  changedFiles?: string[];

  // Commit state
  lastCommitMessage?: string;
  lastCommitHash?: string;

  // Operation results
  stagingResult?: unknown;
  fetchResult?: unknown;
  pushResult?: unknown;
  mergeResult?: unknown;

  // Error state
  lastError?: string;
  lastOperation?: string;

  // Worktree state
  worktreeSetup?: boolean;
  worktreePaths?: Record<string, string>;

  // Validation state
  validationResult?: boolean;
  generatedCommitMessage?: string;
}

/**
 * Git message payload types
 */
export interface GitMessagePayloads {
  CHECK_REPO: Record<string, never>;
  CHECK_STATUS: Record<string, never>;
  CHECK_UNCOMMITTED_CHANGES: Record<string, never>;
  GET_INTEGRATION_STATUS: { integrationBranch?: string };
  GET_CHANGED_FILES: { integrationBranch?: string };
  ADD_ALL: Record<string, never>;
  COMMIT_CHANGES: { message: string };
  FETCH_REMOTE: { branch: string };
  PUSH_CHANGES: { branch: string };
  MERGE_BRANCH: { branch: string; strategy?: 'merge' | 'rebase' };
  CREATE_BRANCH: { branchName: string };
  GET_LAST_COMMIT: Record<string, never>;
  CHECK_WORKTREE: { path: string };
  SETUP_WORKTREES: {
    agentCount: number;
    configOptions?: {
      configPath?: string;
      agentPaths?: Record<string, string>;
      baseDir?: string;
      integrationBranch?: string;
    };
  };
  GENERATE_COMMIT_MESSAGE: Record<string, never>;
  VALIDATE_DATES: { filePaths: string[] };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Dynamic branch detection for multiple agents
 */
function getIntegrationBranch(currentBranch?: string): string {
  const defaultIntegration = 'feature/actor-ref-integration';

  if (!currentBranch) {
    return defaultIntegration;
  }

  // For multiple agents, we can customize the integration branch
  // For now, keep the default but this can be expanded
  return defaultIntegration;
}

/**
 * Generate unique commit message
 */
function generateAutoCommitMessage(branch?: string): string {
  const currentDate = new Date().toISOString().split('T')[0];
  const branchName = branch || 'unknown';

  return `ship: auto-commit for integration deployment

Branch: ${branchName}
Date: ${currentDate}
Context: Automatic commit created by ship workflow

[actor-web] Ship workflow - auto-commit for integration`;
}

// ============================================================================
// PURE GIT ACTOR IMPLEMENTATION
// ============================================================================

/**
 * Pure Git Actor that follows message-passing principles
 */
export class PureGitActor {
  private state: GitActorState;
  private messageQueue: GitMessage[] = [];
  private isProcessing = false;

  constructor(baseDir: string = process.cwd()) {
    this.state = {
      git: simpleGit(baseDir),
      baseDir,
    };
  }

  /**
   * Send a message to the actor
   */
  async send(message: GitMessage): Promise<void> {
    this.messageQueue.push(message);

    if (!this.isProcessing) {
      await this.processMessages();
    }
  }

  /**
   * Get current actor state
   */
  getState(): GitActorState {
    return { ...this.state };
  }

  /**
   * Start the actor
   */
  async start(): Promise<void> {
    log.debug('Starting Pure Git Actor', { baseDir: this.state.baseDir });

    try {
      // Initialize git repository check
      const isGitRepo = await this.isGitRepository(this.state.git);

      this.state = {
        ...this.state,
        isGitRepo,
        lastOperation: 'START',
      };
    } catch (error) {
      log.error('Failed to start git actor:', error);
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Failed to start',
        lastOperation: 'START',
      };
    }
  }

  /**
   * Stop the actor
   */
  async stop(): Promise<void> {
    log.debug('Stopping Pure Git Actor');
    this.messageQueue = [];
    this.isProcessing = false;
  }

  /**
   * Process messages from the queue
   */
  private async processMessages(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        await this.handleMessage(message);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Handle incoming messages
   */
  private async handleMessage(message: GitMessage): Promise<void> {
    const { type, payload } = message;

    log.debug(`Processing message: ${type}`, payload);

    try {
      switch (type) {
        case 'CHECK_REPO':
          await this.handleCheckRepo();
          break;

        case 'CHECK_STATUS':
          await this.handleCheckStatus();
          break;

        case 'CHECK_UNCOMMITTED_CHANGES':
          await this.handleCheckUncommittedChanges();
          break;

        case 'GET_INTEGRATION_STATUS':
          await this.handleGetIntegrationStatus(
            payload as GitMessagePayloads['GET_INTEGRATION_STATUS']
          );
          break;

        case 'GET_CHANGED_FILES':
          await this.handleGetChangedFiles(payload as GitMessagePayloads['GET_CHANGED_FILES']);
          break;

        case 'ADD_ALL':
          await this.handleAddAll();
          break;

        case 'COMMIT_CHANGES':
          await this.handleCommitChanges(payload as GitMessagePayloads['COMMIT_CHANGES']);
          break;

        case 'FETCH_REMOTE':
          await this.handleFetchRemote(payload as GitMessagePayloads['FETCH_REMOTE']);
          break;

        case 'PUSH_CHANGES':
          await this.handlePushChanges(payload as GitMessagePayloads['PUSH_CHANGES']);
          break;

        case 'MERGE_BRANCH':
          await this.handleMergeBranch(payload as GitMessagePayloads['MERGE_BRANCH']);
          break;

        case 'CREATE_BRANCH':
          await this.handleCreateBranch(payload as GitMessagePayloads['CREATE_BRANCH']);
          break;

        case 'GET_LAST_COMMIT':
          await this.handleGetLastCommit();
          break;

        case 'CHECK_WORKTREE':
          await this.handleCheckWorktree(payload as GitMessagePayloads['CHECK_WORKTREE']);
          break;

        case 'SETUP_WORKTREES':
          await this.handleSetupWorktrees(payload as GitMessagePayloads['SETUP_WORKTREES']);
          break;

        case 'GENERATE_COMMIT_MESSAGE':
          await this.handleGenerateCommitMessage();
          break;

        case 'VALIDATE_DATES':
          await this.handleValidateDates(payload as GitMessagePayloads['VALIDATE_DATES']);
          break;

        default:
          log.warn(`Unknown message type: ${type}`);
          this.state = {
            ...this.state,
            lastError: `Unknown message type: ${type}`,
            lastOperation: type,
          };
      }
    } catch (error) {
      log.error(`Error processing message ${type}:`, error);
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Unknown error',
        lastOperation: type,
      };
    }
  }

  // ============================================================================
  // MESSAGE HANDLERS
  // ============================================================================

  private async handleCheckRepo(): Promise<void> {
    try {
      const isGitRepo = await this.isGitRepository(this.state.git);

      this.state = {
        ...this.state,
        isGitRepo,
        lastOperation: 'CHECK_REPO',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        isGitRepo: false,
        lastError: error instanceof Error ? error.message : 'Repo check failed',
        lastOperation: 'CHECK_REPO',
      };
    }
  }

  private async handleCheckStatus(): Promise<void> {
    try {
      const status = await this.state.git.status();
      const currentBranch = status.current || undefined;

      this.state = {
        ...this.state,
        repoStatus: status,
        currentBranch,
        lastOperation: 'CHECK_STATUS',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Status check failed',
        lastOperation: 'CHECK_STATUS',
      };
    }
  }

  private async handleCheckUncommittedChanges(): Promise<void> {
    try {
      const status = await this.state.git.status();
      const uncommittedChanges = status.files.length > 0;

      this.state = {
        ...this.state,
        uncommittedChanges,
        lastOperation: 'CHECK_UNCOMMITTED_CHANGES',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Uncommitted changes check failed',
        lastOperation: 'CHECK_UNCOMMITTED_CHANGES',
      };
    }
  }

  private async handleGetIntegrationStatus(
    payload: GitMessagePayloads['GET_INTEGRATION_STATUS']
  ): Promise<void> {
    try {
      const targetBranch =
        payload.integrationBranch || getIntegrationBranch(this.state.currentBranch);

      // Fetch remote branch
      await this.state.git.fetch(['origin', targetBranch]);

      // Get ahead/behind counts
      const ahead = await this.state.git.raw([
        'rev-list',
        '--count',
        `origin/${targetBranch}..HEAD`,
      ]);
      const behind = await this.state.git.raw([
        'rev-list',
        '--count',
        `HEAD..origin/${targetBranch}`,
      ]);

      const integrationStatus = {
        ahead: Number.parseInt(ahead.trim()) || 0,
        behind: Number.parseInt(behind.trim()) || 0,
      };

      this.state = {
        ...this.state,
        integrationStatus,
        lastOperation: 'GET_INTEGRATION_STATUS',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        integrationStatus: { ahead: 0, behind: 0 },
        lastError: error instanceof Error ? error.message : 'Integration status check failed',
        lastOperation: 'GET_INTEGRATION_STATUS',
      };
    }
  }

  private async handleAddAll(): Promise<void> {
    try {
      const result = await this.state.git.add('.');

      this.state = {
        ...this.state,
        stagingResult: result,
        lastOperation: 'ADD_ALL',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Add all failed',
        lastOperation: 'ADD_ALL',
      };
    }
  }

  private async handleCommitChanges(payload: GitMessagePayloads['COMMIT_CHANGES']): Promise<void> {
    try {
      const result = await this.state.git.commit(payload.message);

      this.state = {
        ...this.state,
        lastCommitMessage: payload.message,
        lastCommitHash: result.commit,
        lastOperation: 'COMMIT_CHANGES',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Commit failed',
        lastOperation: 'COMMIT_CHANGES',
      };
    }
  }

  private async handlePushChanges(payload: GitMessagePayloads['PUSH_CHANGES']): Promise<void> {
    try {
      const result = await this.state.git.push(['origin', payload.branch]);

      this.state = {
        ...this.state,
        pushResult: result,
        lastOperation: 'PUSH_CHANGES',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Push failed',
        lastOperation: 'PUSH_CHANGES',
      };
    }
  }

  private async handleFetchRemote(payload: GitMessagePayloads['FETCH_REMOTE']): Promise<void> {
    try {
      const result = await this.state.git.fetch(['origin', payload.branch]);

      this.state = {
        ...this.state,
        fetchResult: result,
        lastOperation: 'FETCH_REMOTE',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Fetch failed',
        lastOperation: 'FETCH_REMOTE',
      };
    }
  }

  private async handleGetChangedFiles(
    _payload: GitMessagePayloads['GET_CHANGED_FILES']
  ): Promise<void> {
    try {
      const status = await this.state.git.status();
      const changedFiles = [
        ...status.staged,
        ...status.modified,
        ...status.created,
        ...status.deleted,
      ];

      this.state = {
        ...this.state,
        changedFiles,
        lastOperation: 'GET_CHANGED_FILES',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Get changed files failed',
        lastOperation: 'GET_CHANGED_FILES',
      };
    }
  }

  private async handleMergeBranch(payload: GitMessagePayloads['MERGE_BRANCH']): Promise<void> {
    try {
      const result = await this.state.git.merge([payload.branch]);

      this.state = {
        ...this.state,
        mergeResult: result,
        lastOperation: 'MERGE_BRANCH',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Merge failed',
        lastOperation: 'MERGE_BRANCH',
      };
    }
  }

  private async handleCreateBranch(payload: GitMessagePayloads['CREATE_BRANCH']): Promise<void> {
    try {
      await this.state.git.checkoutLocalBranch(payload.branchName);

      this.state = {
        ...this.state,
        currentBranch: payload.branchName,
        lastOperation: 'CREATE_BRANCH',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Create branch failed',
        lastOperation: 'CREATE_BRANCH',
      };
    }
  }

  private async handleGetLastCommit(): Promise<void> {
    try {
      const log = await this.state.git.log(['-1']);
      const lastCommit = log.latest;

      this.state = {
        ...this.state,
        lastCommitHash: lastCommit?.hash,
        lastCommitMessage: lastCommit?.message,
        lastOperation: 'GET_LAST_COMMIT',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Get last commit failed',
        lastOperation: 'GET_LAST_COMMIT',
      };
    }
  }

  private async handleCheckWorktree(payload: GitMessagePayloads['CHECK_WORKTREE']): Promise<void> {
    try {
      // Check if worktree exists
      const worktreeList = await this.state.git.raw(['worktree', 'list']);
      const worktreeExists = worktreeList.includes(payload.path);

      this.state = {
        ...this.state,
        worktreeSetup: worktreeExists,
        lastOperation: 'CHECK_WORKTREE',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Check worktree failed',
        lastOperation: 'CHECK_WORKTREE',
      };
    }
  }

  private async handleSetupWorktrees(
    payload: GitMessagePayloads['SETUP_WORKTREES']
  ): Promise<void> {
    try {
      // This is a simplified implementation
      // In a real implementation, you'd set up multiple worktrees
      log.debug('Setting up worktrees', payload);

      this.state = {
        ...this.state,
        worktreeSetup: true,
        worktreePaths: payload.configOptions?.agentPaths || {},
        lastOperation: 'SETUP_WORKTREES',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Setup worktrees failed',
        lastOperation: 'SETUP_WORKTREES',
      };
    }
  }

  private async handleGenerateCommitMessage(): Promise<void> {
    try {
      const message = generateAutoCommitMessage(this.state.currentBranch);

      this.state = {
        ...this.state,
        generatedCommitMessage: message,
        lastOperation: 'GENERATE_COMMIT_MESSAGE',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Generate commit message failed',
        lastOperation: 'GENERATE_COMMIT_MESSAGE',
      };
    }
  }

  private async handleValidateDates(payload: GitMessagePayloads['VALIDATE_DATES']): Promise<void> {
    try {
      // Simplified validation - in real implementation, you'd check file dates
      const validationResult = payload.filePaths.length > 0;

      this.state = {
        ...this.state,
        validationResult,
        lastOperation: 'VALIDATE_DATES',
        lastError: undefined,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Validate dates failed',
        lastOperation: 'VALIDATE_DATES',
      };
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private async isGitRepository(git: SimpleGit): Promise<boolean> {
    try {
      await git.status();
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new Pure Git Actor
 */
export function createPureGitActor(baseDir?: string): PureGitActor {
  return new PureGitActor(baseDir || process.cwd());
}

/**
 * Create git message for operations
 */
export function createGitMessage<T extends GitMessageType>(
  type: T,
  payload?: GitMessagePayloads[T],
  correlationId?: string
): GitMessage {
  return {
    type,
    payload: payload || {},
    timestamp: Date.now(),
    correlationId: correlationId || `git-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  };
}
