/**
 * Git Actor CLI Integration Helper - Actor-Web Framework
 *
 * Provides promise-based interface to git-actor for CLI commands
 * Replaces GitOperations with event-driven actor pattern
 * Uses proper event subscription with framework's ActorRef system
 */

// Import directly from source files to avoid testing utilities
import { Logger } from '../../../../src/core/dev-mode.js';
import {
  createGitActor,
  type GitActor,
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
    this.actor.start();

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
    // For save.ts, we need staged files for commit
    // This is a placeholder - we'll use git.diff in the actor
    return [];
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
    // Subscribe to all events from the git-actor
    this.actor.subscribe((response: GitResponse) => {
      log.debug('Received git-actor response', { responseType: response.type });
      // Handle the response for any pending requests
      this.handleResponse(response);
    });
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
        this.actor.send({ type: event } as GitEvent);
      } else {
        this.actor.send(event);
      }

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
