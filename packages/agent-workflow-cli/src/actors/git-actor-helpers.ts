/**
 * @module agent-workflow-cli/actors/git-actor-helpers
 * @description Reactive helper utilities for working with GitActor in CLI commands
 * @author Agent A - CLI Actor Migration (Actor Model Compliant)
 */

import type { ActorSnapshot } from '@actor-core/runtime';
import { waitForCompletion } from '../test-utils';
import type { GitActor, GitContext } from './git-actor';

// ============================================================================
// REACTIVE STATE OBSERVATION UTILITIES
// ============================================================================

/**
 * Creates a reactive observer for actor state changes
 * Returns a subscription that automatically cleans up
 */
export function createStateObserver<T>(
  actor: GitActor,
  selector: (snapshot: ActorSnapshot<GitContext>) => T,
  callback: (value: T) => void
) {
  return actor.observe(selector).subscribe(callback);
}

/**
 * Creates a reactive observer for context changes
 * Returns a subscription that automatically cleans up
 */
export function createContextObserver<T>(
  actor: GitActor,
  selector: (context: GitContext) => T,
  callback: (value: T) => void
) {
  return actor.observe((snapshot) => selector(snapshot.context)).subscribe(callback);
}

/**
 * Creates a reactive observer for error state
 * Automatically handles error notifications
 */
export function createErrorObserver(actor: GitActor, onError: (error: string) => void) {
  return createContextObserver(
    actor,
    (context) => context.lastError,
    (error) => {
      if (error) {
        onError(error);
      }
    }
  );
}

// ============================================================================
// REACTIVE WORKFLOW HELPERS
// ============================================================================

/**
 * Reactive workflow for checking repository status
 * Uses message-based communication and state observation
 */
export async function checkRepositoryStatus(actor: GitActor): Promise<{
  isGitRepo: boolean;
  currentBranch?: string;
  agentType?: string;
}> {
  return new Promise((resolve, reject) => {
    // Create error observer
    const errorObserver = createErrorObserver(actor, (error) => {
      cleanup();
      reject(new Error(error));
    });

    // Create state observer for workflow progression
    const stateObserver = createStateObserver(
      actor,
      (snapshot) => snapshot.value,
      (state) => {
        if (state === 'repoChecked') {
          // Repository check completed, now check status
          actor.send({ type: 'CHECK_STATUS' });
        } else if (state === 'statusChecked') {
          // Both checks completed, extract results
          const contextObserver = createContextObserver(
            actor,
            (context) => ({
              isGitRepo: context.isGitRepo,
              currentBranch: context.currentBranch,
              agentType: context.agentType,
            }),
            (result) => {
              contextObserver.unsubscribe();
              cleanup();
              resolve({
                isGitRepo: result.isGitRepo ?? false,
                currentBranch: result.currentBranch,
                agentType: result.agentType,
              });
            }
          );
        }
      }
    );

    const cleanup = () => {
      errorObserver.unsubscribe();
      stateObserver.unsubscribe();
    };

    // Start the workflow
    actor.send({ type: 'CHECK_REPO' });
  });
}

/**
 * Reactive workflow for staging and committing changes
 * Uses message-based communication throughout
 */
export async function stageAndCommit(actor: GitActor, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Create error observer
    const errorObserver = createErrorObserver(actor, (error) => {
      cleanup();
      reject(new Error(error));
    });

    // Create state observer for workflow progression
    const stateObserver = createStateObserver(
      actor,
      (snapshot) => snapshot.value,
      (state) => {
        if (state === 'stagingCompleted') {
          // Staging completed, now commit
          actor.send({ type: 'COMMIT_CHANGES', message });
        } else if (state === 'commitCompleted') {
          // Commit completed, extract hash
          const contextObserver = createContextObserver(
            actor,
            (context) => context.lastCommitHash,
            (hash) => {
              if (hash) {
                contextObserver.unsubscribe();
                cleanup();
                resolve(hash);
              }
            }
          );
        }
      }
    );

    const cleanup = () => {
      errorObserver.unsubscribe();
      stateObserver.unsubscribe();
    };

    // Start the workflow
    actor.send({ type: 'ADD_ALL' });
  });
}

/**
 * Reactive workflow for fetching and checking integration status
 * Uses message-based communication and reactive state observation
 */
export async function checkIntegrationStatus(
  actor: GitActor,
  integrationBranch: string
): Promise<{ ahead: number; behind: number }> {
  return new Promise((resolve, reject) => {
    // Create error observer
    const errorObserver = createErrorObserver(actor, (error) => {
      cleanup();
      reject(new Error(error));
    });

    // Create state observer for workflow progression
    const stateObserver = createStateObserver(
      actor,
      (snapshot) => snapshot.value,
      (state) => {
        if (state === 'integrationStatusChecked') {
          // Integration status checked, extract results
          const contextObserver = createContextObserver(
            actor,
            (context) => context.integrationStatus,
            (status) => {
              if (status) {
                contextObserver.unsubscribe();
                cleanup();
                resolve({ ahead: status.ahead, behind: status.behind });
              }
            }
          );
        }
      }
    );

    const cleanup = () => {
      errorObserver.unsubscribe();
      stateObserver.unsubscribe();
    };

    // Start the workflow
    actor.send({ type: 'GET_INTEGRATION_STATUS', integrationBranch });
  });
}

/**
 * Reactive workflow for generating commit messages
 * Uses message-based communication and reactive observation
 */
export async function generateCommitMessage(actor: GitActor): Promise<string> {
  return new Promise((resolve, reject) => {
    // Create error observer
    const errorObserver = createErrorObserver(actor, (error) => {
      cleanup();
      reject(new Error(error));
    });

    // Create state observer for workflow progression
    const stateObserver = createStateObserver(
      actor,
      (snapshot) => snapshot.value,
      (state) => {
        if (state === 'commitMessageGenerated') {
          // Message generated, extract result
          const contextObserver = createContextObserver(
            actor,
            (context) => context.lastCommitMessage,
            (message) => {
              if (message) {
                contextObserver.unsubscribe();
                cleanup();
                resolve(message);
              }
            }
          );
        }
      }
    );

    const cleanup = () => {
      errorObserver.unsubscribe();
      stateObserver.unsubscribe();
    };

    // Start the workflow
    actor.send({ type: 'GENERATE_COMMIT_MESSAGE' });
  });
}

// ============================================================================
// REACTIVE UTILITY FUNCTIONS
// ============================================================================

/**
 * Wait for actor to complete current operation and return to idle
 * Uses reactive observation instead of polling
 */
export async function waitForIdle(actor: GitActor, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    let isResolved = false;
    let timeoutId: NodeJS.Timeout;

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, timeoutReject) => {
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          timeoutReject(new Error(`Actor did not return to idle within ${timeout}ms`));
        }
      }, timeout);
    });

    const subscription = createStateObserver(
      actor,
      (snapshot) => snapshot.value,
      (state) => {
        if (state === 'idle' && !isResolved) {
          isResolved = true;
          clearTimeout(timeoutId);
          subscription.unsubscribe();
          resolve();
        }
      }
    );

    // Race between state change and timeout
    Promise.race([
      new Promise<void>((stateResolve) => {
        // This will resolve when state is reached (handled by observer above)
        const checkResolved = () => {
          if (isResolved) stateResolve();
          else setTimeout(checkResolved, 10);
        };
        checkResolved();
      }),
      timeoutPromise,
    ])
      .then(resolve)
      .catch(reject);
  });
}

/**
 * Wait for actor to reach any of the specified states
 * Uses reactive observation instead of polling
 */
export async function waitForStates(
  actor: GitActor,
  targetStates: string[],
  timeout = 5000
): Promise<string> {
  return new Promise((resolve, reject) => {
    let isResolved = false;
    let resolvedState: string;
    let timeoutId: NodeJS.Timeout;

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, timeoutReject) => {
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          timeoutReject(new Error(`Actor did not reach target states within ${timeout}ms`));
        }
      }, timeout);
    });

    const subscription = createStateObserver(
      actor,
      (snapshot) => snapshot.value,
      (state) => {
        if (targetStates.includes(state as string) && !isResolved) {
          isResolved = true;
          resolvedState = state as string;
          clearTimeout(timeoutId);
          subscription.unsubscribe();
          resolve(resolvedState);
        }
      }
    );

    // Race between state change and timeout
    Promise.race([
      new Promise<string>((stateResolve) => {
        // This will resolve when target state is reached (handled by observer above)
        const checkResolved = () => {
          if (isResolved) stateResolve(resolvedState);
          else setTimeout(checkResolved, 10);
        };
        checkResolved();
      }),
      timeoutPromise,
    ])
      .then(resolve)
      .catch(reject);
  });
}

/**
 * Check if actor is currently busy (not in idle state)
 * Uses reactive observation for real-time status
 */
export function observeActorBusy(actor: GitActor, onBusyChange: (isBusy: boolean) => void) {
  return createStateObserver(
    actor,
    (snapshot) => snapshot.value,
    (state) => {
      onBusyChange(state !== 'idle');
    }
  );
}

// ============================================================================
// LEGACY COMPATIBILITY (DEPRECATED)
// ============================================================================

/**
 * @deprecated Use checkRepositoryStatus() instead
 * This function will be removed in next version
 */
export function getCurrentBranch(actor: GitActor): Promise<string | undefined> {
  return checkRepositoryStatus(actor).then((result) => result.currentBranch);
}

/**
 * @deprecated Use reactive error observer instead
 * This function will be removed in next version
 */
export function hasError(actor: GitActor): Promise<boolean> {
  return new Promise((resolve) => {
    const subscription = createErrorObserver(actor, (error) => {
      subscription.unsubscribe();
      resolve(!!error);
    });
  });
}

// Re-export utilities from test-utils for backward compatibility
export { waitForCompletion };
