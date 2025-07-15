/**
 * @module agent-workflow-cli/test-utils
 * @description Actor-compliant testing utilities for the CLI package
 * @author Agent A - CLI Actor Migration Phase (Actor Model Compliant)
 */

import type { GitActor } from './actors/git-actor.js';

// ============================================================================
// ACTOR-COMPLIANT UTILITY FUNCTIONS
// ============================================================================

/**
 * Wait for a condition to be true using reactive patterns
 * Replaces manual polling with Promise-based approach
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 1000,
  intervalMs = 10
): Promise<void> {
  return new Promise((resolve, reject) => {
    let isResolved = false;
    let timeoutId: NodeJS.Timeout;

    // Create timeout promise using Promise-based approach
    const timeoutPromise = new Promise<never>((_, timeoutReject) => {
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          timeoutReject(new Error(`Condition not met within ${timeoutMs}ms`));
        }
      }, timeoutMs);
    });

    // Create condition checking promise
    const conditionPromise = new Promise<void>((conditionResolve) => {
      const check = async () => {
        if (isResolved) return;

        try {
          const result = await condition();
          if (result && !isResolved) {
            isResolved = true;
            clearTimeout(timeoutId);
            conditionResolve();
            return;
          }
        } catch {
          // Continue checking on error
        }

        if (!isResolved) {
          // Use Promise-based delay instead of setTimeout
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
          await check();
        }
      };

      check();
    });

    // Race between condition and timeout
    Promise.race([conditionPromise, timeoutPromise]).then(resolve).catch(reject);
  });
}

/**
 * Wait for an actor to reach a specific state using reactive observation
 * Uses proper actor pattern with observe() instead of polling
 */
export async function waitForState(
  actor: GitActor,
  targetState: string,
  timeout = 1000
): Promise<void> {
  return new Promise((resolve, reject) => {
    let isResolved = false;
    let timeoutId: NodeJS.Timeout;

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, timeoutReject) => {
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          stateObserver.unsubscribe();
          timeoutReject(new Error(`Timeout waiting for state: ${targetState} (${timeout}ms)`));
        }
      }, timeout);
    });

    // Use reactive observation instead of polling
    const stateObserver = actor
      .observe((snapshot) => snapshot.value)
      .subscribe((state) => {
        if (state === targetState && !isResolved) {
          isResolved = true;
          clearTimeout(timeoutId);
          stateObserver.unsubscribe();
          resolve();
        }
      });

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
 * Wait for an actor to complete current operation and return to idle
 * Uses reactive observation with timeout handling
 */
export async function waitForIdle(actor: GitActor, timeout = 1000): Promise<void> {
  return waitForState(actor, 'idle', timeout);
}

/**
 * Wait for an actor to complete its current operation using reactive observation
 * Uses proper actor pattern with observe() instead of manual timeout management
 */
export async function waitForCompletion(actor: GitActor, timeout = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    let isResolved = false;
    let timeoutId: NodeJS.Timeout;

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, timeoutReject) => {
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          completionObserver.unsubscribe();
          timeoutReject(new Error(`Timeout waiting for completion (${timeout}ms)`));
        }
      }, timeout);
    });

    // Use reactive observation to detect completion states
    const completionObserver = actor
      .observe((snapshot) => snapshot.value)
      .subscribe((state) => {
        // Check for any completion state
        const completionStates = [
          'statusChecked',
          'repoChecked',
          'uncommittedChangesChecked',
          'stagingCompleted',
          'commitCompleted',
          'integrationStatusChecked',
          'changedFilesChecked',
          'fetchCompleted',
          'pushCompleted',
          'mergeCompleted',
          'commitMessageGenerated',
          'datesValidated',
          'worktreesSetup',
          'worktreeChecked',
          'branchCreated',
          'lastCommitChecked',
          'idle', // Include idle as a completion state
        ];

        if (completionStates.includes(state as string) && !isResolved) {
          isResolved = true;
          clearTimeout(timeoutId);
          completionObserver.unsubscribe();
          resolve();
        }
      });

    // Race between completion and timeout
    Promise.race([
      new Promise<void>((completionResolve) => {
        // This will resolve when completion is reached (handled by observer above)
        const checkResolved = () => {
          if (isResolved) completionResolve();
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
 * Wait for multiple states using reactive observation - useful for testing complex workflows
 * Uses proper actor pattern with observe() instead of manual timeout management
 */
export async function waitForStates(
  actor: GitActor,
  targetStates: string[],
  timeout = 1000
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
          stateObserver.unsubscribe();
          timeoutReject(
            new Error(`Timeout waiting for states: ${targetStates.join(', ')} (${timeout}ms)`)
          );
        }
      }, timeout);
    });

    // Use reactive observation to detect target states
    const stateObserver = actor
      .observe((snapshot) => snapshot.value)
      .subscribe((state) => {
        if (targetStates.includes(state as string) && !isResolved) {
          isResolved = true;
          resolvedState = state as string;
          clearTimeout(timeoutId);
          stateObserver.unsubscribe();
          resolve(resolvedState);
        }
      });

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

// ============================================================================
// LEGACY COMPATIBILITY (DEPRECATED)
// ============================================================================

/**
 * @deprecated Use waitForState() instead
 * This function will be removed in next version
 */
export async function waitForStateChange(
  actor: GitActor,
  targetState: string,
  timeout = 1000
): Promise<void> {
  return waitForState(actor, targetState, timeout);
}

/**
 * @deprecated Use waitForCompletion() instead
 * This function will be removed in next version
 */
export async function waitForOperationComplete(actor: GitActor, timeout = 1000): Promise<void> {
  return waitForCompletion(actor, timeout);
}
