/**
 * Git Actor CLI Integration Helper - Actor-Web Framework
 *
 * Provides promise-based interface to git-actor for CLI commands
 * Replaces GitOperations with event-driven actor pattern
 * Uses proper event subscription with framework's ActorRef system
 */

// Import from framework dependency
import { Logger } from '@actor-web/core';
import {
  createGitActor,
  type GitActor,
  type GitContext,
  type GitEvent,
  type GitResponse,
} from '../actors/git-actor.js';

// Use scoped logger for git-actor integration
const log = Logger.namespace('GIT_ACTOR_INTEGRATION');

/**
 * Promise-based wrapper for git-actor operations using proper event emission
 */

export class GitActorIntegration {
  private actor: GitActor;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      unsubscribe: () => void;
      responseHandler?: (response: GitResponse) => unknown;
    }
  >();

  constructor(baseDir?: string) {
    log.debug('Initializing GitActorIntegration', { baseDir });
    this.actor = createGitActor(baseDir);

    // Add debug logging for actor state
    log.debug('Git actor created, starting actor', {
      actorId: this.actor.id,
      actorStatus: this.actor.status,
    });

    this.actor.start();

    // Inject our handleResponse method into the git-actor context
    const snapshot = this.actor.getSnapshot();
    if (snapshot.context) {
      (snapshot.context as GitContext).emit = (response: GitResponse) => {
        log.debug('Git-actor emitted response', response);
        this.handleResponse(response);
      };
      log.debug('Injected handleResponse into git-actor context');
    }

    // Check actor state after start
    const updatedSnapshot = this.actor.getSnapshot();
    log.debug('Git actor started', {
      actorId: this.actor.id,
      actorStatus: this.actor.status,
      currentState: updatedSnapshot.value,
      hasEmitFunction: !!updatedSnapshot.context?.emit,
    });

    // Set up event subscription for responses
    this.setupEventHandling();
    log.debug('GitActorIntegration initialized successfully');
  }

  /**
   * Check if current directory is a git repository
   * Replaces: git.isGitRepo()
   */
  async isGitRepo(): Promise<boolean> {
    log.debug('Checking if directory is a git repository');
    return this.createRequest<boolean>('CHECK_REPO', (response) => {
      if (response.type === 'REPO_CHECKED') {
        log.debug('Git repository check result', { isGitRepo: response.isGitRepo });
        return response.isGitRepo;
      }
      return undefined;
    });
  }

  /**
   * Check if there are uncommitted changes
   * Replaces: git.hasUncommittedChanges()
   */
  async hasUncommittedChanges(): Promise<boolean> {
    log.debug('Checking for uncommitted changes');
    return this.createRequest<boolean>('CHECK_UNCOMMITTED_CHANGES', (response) => {
      if (response.type === 'UNCOMMITTED_STATUS') {
        log.debug('Uncommitted changes check result', { hasChanges: response.hasChanges });
        return response.hasChanges;
      }
      return undefined;
    });
  }

  /**
   * Get current branch name
   * Replaces: git.getCurrentBranch()
   */
  async getCurrentBranch(): Promise<string> {
    log.debug('Getting current branch name');
    return this.createRequest<string>('CHECK_STATUS', (response) => {
      if (response.type === 'STATUS_CHECKED') {
        log.debug('Current branch retrieved', { currentBranch: response.currentBranch });
        return response.currentBranch;
      }
      return undefined;
    });
  }

  /**
   * Detect agent type from current branch
   * Replaces: git.detectAgentType()
   */
  async detectAgentType(): Promise<string> {
    log.debug('Detecting agent type from branch');
    return this.createRequest<string>('DETECT_AGENT_TYPE', (response) => {
      if (response.type === 'AGENT_TYPE_DETECTED') {
        log.debug('Agent type detected', { agentType: response.agentType });
        return response.agentType;
      }
      return undefined;
    });
  }

  /**
   * Get changed files for commit message analysis
   * Replaces: git.getGit().diff(['--name-only', '--cached'])
   * Note: This is a simplified version for save.ts context analysis
   */
  async getChangedFiles(): Promise<string[]> {
    log.debug('Getting changed files for commit analysis');
    return this.createRequest<string[]>('GET_CHANGED_FILES', (response) => {
      if (response.type === 'CHANGED_FILES') {
        log.debug('Changed files retrieved', { files: response.files });
        return response.files;
      }
      return undefined;
    });
  }

  /**
   * Get changed files synchronously using git status (for testing)
   * This bypasses the actor system for immediate results
   */
  private async getChangedFilesSync(): Promise<string[]> {
    try {
      // Use simple git to get status directly
      const { simpleGit } = await import('simple-git');
      const git = simpleGit(process.cwd());

      const status = await git.status();
      const changedFiles: string[] = [];

      // Add all changed files
      changedFiles.push(...status.staged);
      changedFiles.push(...status.modified.filter((file) => !changedFiles.includes(file)));
      changedFiles.push(...status.not_added.filter((file) => !changedFiles.includes(file)));

      log.debug('Got changed files synchronously', {
        count: changedFiles.length,
        files: changedFiles,
      });

      return changedFiles;
    } catch (error) {
      log.error('Error getting changed files synchronously', { error });
      return [];
    }
  }

  /**
   * Stage all changes and commit with message
   * Replaces: git.getGit().add('.') + git.getGit().commit(message)
   */
  async stageAndCommit(message?: string): Promise<string> {
    log.debug('Staging and committing changes', { customMessage: message });
    return this.createRequest<string>(
      { type: 'COMMIT_WITH_CONVENTION', customMessage: message },
      (response) => {
        if (response.type === 'CONVENTIONAL_COMMIT_COMPLETE') {
          log.debug('Commit completed successfully', {
            commitHash: response.commitHash,
            message: response.message,
          });
          return response.commitHash;
        }
        return undefined;
      }
    );
  }

  /**
   * Commit with conventional commit format following project standards
   * Automatically detects type, scope, and generates proper commit message
   */
  async commitWithConvention(customDescription?: string): Promise<string> {
    log.debug('Creating conventional commit', { customDescription });

    // Get current context for commit analysis
    const [agentType, changedFiles] = await Promise.all([
      this.detectAgentType(),
      this.getChangedFilesSync(), // Use sync version for now
    ]);

    // Detect commit type and scope based on changed files
    const commitAnalysis = this.analyzeChangesForCommit(changedFiles);

    // Generate conventional commit message
    const commitMessage = this.generateConventionalCommitMessage({
      type: commitAnalysis.type,
      scope: commitAnalysis.scope,
      description: customDescription || commitAnalysis.description,
      agentType,
      changedFiles,
      workCategory: commitAnalysis.workCategory,
    });

    log.debug('Generated conventional commit message', { commitMessage });

    return this.createRequest<string>(
      { type: 'COMMIT_CHANGES', message: commitMessage },
      (response) => {
        if (response.type === 'CHANGES_COMMITTED') {
          log.debug('Conventional commit completed successfully', {
            commitHash: response.commitHash,
          });
          return response.commitHash;
        }
        return undefined;
      }
    );
  }

  /**
   * Analyze changed files to determine commit type and scope
   */
  private analyzeChangesForCommit(changedFiles: string[]): {
    type: string;
    scope: string;
    description: string;
    workCategory: string;
  } {
    // Default values
    let type = 'feat';
    let scope = 'core';
    let description = 'update implementation';
    let workCategory = 'implementation';

    // Analyze file patterns to determine commit characteristics
    const fileAnalysis = {
      hasTests: changedFiles.some((file) => file.includes('.test.') || file.includes('/test/')),
      hasDocs: changedFiles.some((file) => file.endsWith('.md') || file.includes('/docs/')),
      hasCore: changedFiles.some((file) => file.includes('/core/')),
      hasActorRef: changedFiles.some(
        (file) => file.includes('actor-ref') || file.includes('create-actor-ref')
      ),
      hasIntegration: changedFiles.some(
        (file) => file.includes('integration') || file.includes('xstate')
      ),
      hasTypes: changedFiles.some((file) => file.includes('types.ts') || file.includes('/types/')),
      hasArchitecture: changedFiles.some(
        (file) => file.includes('architecture') || file.includes('design')
      ),
      hasCLI: changedFiles.some((file) => file.includes('agent-workflow-cli')),
      hasGitActor: changedFiles.some((file) => file.includes('git-actor')),
    };

    // Determine commit type
    if (fileAnalysis.hasTests && !fileAnalysis.hasCore) {
      type = 'test';
      workCategory = 'testing';
    } else if (fileAnalysis.hasDocs && !fileAnalysis.hasCore) {
      type = 'docs';
      workCategory = 'documentation';
    } else if (changedFiles.some((file) => file.includes('fix') || file.includes('bug'))) {
      type = 'fix';
      workCategory = 'bug fix';
    } else {
      type = 'feat';
      workCategory = 'implementation';
    }

    // Determine scope based on Agent A patterns
    if (fileAnalysis.hasActorRef) {
      scope = 'actor-ref';
      description = 'enhance actor reference system';
    } else if (fileAnalysis.hasIntegration) {
      scope = 'integration';
      description = 'improve framework integration';
    } else if (fileAnalysis.hasTypes) {
      scope = 'types';
      description = 'update type definitions';
    } else if (fileAnalysis.hasArchitecture) {
      scope = 'architecture';
      description = 'refine system architecture';
    } else if (fileAnalysis.hasCLI || fileAnalysis.hasGitActor) {
      scope = 'cli';
      description = 'enhance CLI actor integration';
      workCategory = 'cli development';
    } else if (fileAnalysis.hasCore) {
      scope = 'core';
      description = 'update core implementation';
    }

    // Handle test-specific descriptions
    if (type === 'test') {
      if (fileAnalysis.hasActorRef) {
        description = 'add actor reference tests';
      } else if (fileAnalysis.hasCore) {
        description = 'enhance core test suite';
      } else {
        description = 'improve test coverage';
      }
    }

    // Handle documentation descriptions
    if (type === 'docs') {
      if (fileAnalysis.hasArchitecture) {
        description = 'update architecture documentation';
      } else {
        description = 'improve documentation';
      }
    }

    return { type, scope, description, workCategory };
  }

  /**
   * Generate conventional commit message following project standards
   */
  private generateConventionalCommitMessage(options: {
    type: string;
    scope: string;
    description: string;
    agentType: string;
    changedFiles: string[];
    workCategory: string;
  }): string {
    const { type, scope, description, agentType, changedFiles, workCategory } = options;

    // Format changed files summary (max 5 files, then "...")
    const filesPreview =
      changedFiles.length > 5
        ? `${changedFiles.slice(0, 5).join(', ')}...`
        : changedFiles.join(', ');

    // Generate the conventional commit message
    const subject = `${type}(${scope}): ${description}`;

    const body = `
Agent: ${agentType}
Files: ${filesPreview}
Context: ${description} across ${changedFiles.length} files

[actor-web] ${agentType} - ${workCategory}`.trim();

    return `${subject}\n\n${body}`;
  }

  /**
   * Clean up actor resources
   */
  async stop(): Promise<void> {
    log.debug('Stopping GitActorIntegration', { pendingRequests: this.pendingRequests.size });
    // Clean up any pending requests
    for (const [_requestId, request] of this.pendingRequests.entries()) {
      request.unsubscribe();
      request.reject(new Error('Actor stopped'));
    }
    this.pendingRequests.clear();

    await this.actor.stop();
    log.debug('GitActorIntegration stopped successfully');
  }

  /**
   * Set up event handling using actor subscription
   */
  private setupEventHandling(): void {
    log.debug('Setting up event handling subscription');

    // Monitor context changes to emit events
    const lastContext: Partial<{
      isGitRepo: boolean;
      uncommittedChanges: boolean;
      currentBranch: string;
      agentType: string;
      agentTypeOnly: string;
      lastCommitMessage: string;
      lastError: string;
    }> = {};

    // Poll for context changes and emit events accordingly
    const checkContextChanges = () => {
      try {
        const snapshot = this.actor.getSnapshot();
        const context = snapshot.context;

        // Check for repo status change
        if (context.isGitRepo !== undefined && context.isGitRepo !== lastContext.isGitRepo) {
          const response: GitResponse = { type: 'REPO_CHECKED', isGitRepo: context.isGitRepo };
          log.debug('Emitting REPO_CHECKED event', response);
          this.handleResponse(response);
          lastContext.isGitRepo = context.isGitRepo;
        }

        // Check for uncommitted changes status
        if (
          context.uncommittedChanges !== undefined &&
          context.uncommittedChanges !== lastContext.uncommittedChanges
        ) {
          const response: GitResponse = {
            type: 'UNCOMMITTED_STATUS',
            hasChanges: context.uncommittedChanges,
          };
          log.debug('Emitting UNCOMMITTED_STATUS event', response);
          this.handleResponse(response);
          lastContext.uncommittedChanges = context.uncommittedChanges;
        }

        // Check for branch/agent type changes
        if (
          context.currentBranch &&
          context.agentType &&
          (context.currentBranch !== lastContext.currentBranch ||
            context.agentType !== lastContext.agentType)
        ) {
          const response: GitResponse = {
            type: 'STATUS_CHECKED',
            currentBranch: context.currentBranch,
            agentType: context.agentType,
          };
          log.debug('Emitting STATUS_CHECKED event', response);
          this.handleResponse(response);
          lastContext.currentBranch = context.currentBranch;
          lastContext.agentType = context.agentType;
        }

        // Check for agent type detection
        if (context.agentType && context.agentType !== lastContext.agentTypeOnly) {
          const response: GitResponse = {
            type: 'AGENT_TYPE_DETECTED',
            agentType: context.agentType,
          };
          log.debug('Emitting AGENT_TYPE_DETECTED event', response);
          this.handleResponse(response);
          lastContext.agentTypeOnly = context.agentType;
        }

        // Check for commit completion
        if (
          context.lastCommitMessage &&
          context.lastCommitMessage !== lastContext.lastCommitMessage
        ) {
          const response: GitResponse = {
            type: 'CONVENTIONAL_COMMIT_COMPLETE',
            commitHash: 'commit-hash-placeholder', // TODO: Get real hash from context
            message: context.lastCommitMessage,
          };
          log.debug('Emitting CONVENTIONAL_COMMIT_COMPLETE event', response);
          this.handleResponse(response);
          lastContext.lastCommitMessage = context.lastCommitMessage;
        }

        // Check for errors
        if (context.lastError && context.lastError !== lastContext.lastError) {
          const response: GitResponse = { type: 'GIT_ERROR', error: context.lastError };
          log.debug('Emitting GIT_ERROR event', response);
          this.handleResponse(response);
          lastContext.lastError = context.lastError;
        }

        // Continue monitoring if we have pending requests
        if (this.pendingRequests.size > 0) {
          setTimeout(checkContextChanges, 100);
        }
      } catch (error) {
        log.error('Error in context monitoring:', error);
      }
    };

    // Start monitoring when we have pending requests
    const originalSet = this.pendingRequests.set.bind(this.pendingRequests);
    this.pendingRequests.set = (key, value) => {
      const result = originalSet(key, value);
      if (this.pendingRequests.size === 1) {
        // Start monitoring when first request is added
        setTimeout(checkContextChanges, 50);
      }
      return result;
    };
  }

  /**
   * Create a request with proper event subscription and timeout
   */
  private async createRequest<T>(
    event: GitEvent | string,
    responseHandler: (response: GitResponse) => T | undefined,
    timeoutMs = 5000
  ): Promise<T> {
    const requestId = this.generateRequestId();
    const eventType = typeof event === 'string' ? event : event.type;

    log.debug('Creating git-actor request', { requestId, eventType, timeoutMs });

    return new Promise<T>((resolve, reject) => {
      // Set up timeout using framework timer
      const timeoutId = setTimeout(() => {
        const request = this.pendingRequests.get(requestId);
        if (request) {
          request.unsubscribe();
          this.pendingRequests.delete(requestId);
          log.warn('Request timed out', { requestId, eventType, timeoutMs });
          reject(new Error(`Request ${requestId} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      // Store the request with cleanup function
      this.pendingRequests.set(requestId, {
        resolve: (value: unknown) => {
          clearTimeout(timeoutId);
          log.debug('Request resolved successfully', { requestId, eventType });
          resolve(value as T);
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId);
          log.error('Request rejected with error', { requestId, eventType, error: error.message });
          reject(error);
        },
        unsubscribe: () => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
        },
        responseHandler,
      });

      // Send the event to the actor
      if (typeof event === 'string') {
        const eventObj = { type: event } as GitEvent;
        log.debug('Sending string event to git-actor', { requestId, eventType, eventObj });
        this.actor.send(eventObj);
      } else {
        log.debug('Sending event object to git-actor', { requestId, eventType, event });
        this.actor.send(event);
      }

      // Log actor state after sending event
      const snapshot = this.actor.getSnapshot();
      log.debug('Actor state after sending event', {
        requestId,
        eventType,
        currentState: snapshot.value,
        actorStatus: this.actor.status,
      });

      log.debug('Event sent to git-actor', { requestId, eventType });
    });
  }

  /**
   * Handle responses from git-actor events
   */
  private handleResponse(response: GitResponse): void {
    const pendingCount = this.pendingRequests.size;
    log.debug('Handling git-actor response', {
      responseType: response.type,
      pendingRequests: pendingCount,
    });

    // Find matching pending requests and resolve them
    for (const [requestId, request] of this.pendingRequests.entries()) {
      try {
        if (request.responseHandler) {
          const result = request.responseHandler(response);
          if (result !== undefined) {
            log.debug('Response matched and resolved request', {
              requestId,
              responseType: response.type,
            });
            request.resolve(result);
            this.pendingRequests.delete(requestId);
            return; // Only resolve one request per response
          }
        }
      } catch (error) {
        log.error('Error in response handler', { requestId, responseType: response.type, error });
        request.reject(error as Error);
        this.pendingRequests.delete(requestId);
      }
    }

    // Handle error responses
    if (response.type === 'GIT_ERROR') {
      log.error('Git error response received', {
        error: response.error,
        pendingRequests: pendingCount,
      });
      for (const [requestId, request] of this.pendingRequests.entries()) {
        request.reject(new Error(response.error));
        this.pendingRequests.delete(requestId);
      }
    }
  }

  /**
   * Generate unique request ID for tracking
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
