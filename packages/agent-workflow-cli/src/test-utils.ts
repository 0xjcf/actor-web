/**
 * @module agent-workflow-cli/test-utils
 * @description Consolidated testing utilities for the CLI package
 * @author Agent A - CLI Actor Migration Phase
 */

import type { GitActor } from './actors/git-actor.js';

/**
 * Wait for a condition to be true or timeout
 * This is kept for generic use cases but should be avoided in favor of state observation
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 1000,
  intervalMs = 10
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

/**
 * Wait for an actor to reach a specific state using XState state observation
 * Updated to use polling since subscriptions don't work properly in test environment
 */
export async function waitForState(
  actor: GitActor,
  targetState: string,
  timeout = 1000
): Promise<void> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkState = () => {
      const snapshot = actor.getSnapshot();

      if (snapshot.value === targetState) {
        resolve();
        return;
      }

      if (Date.now() - startTime > timeout) {
        reject(
          new Error(`Timeout waiting for state: ${targetState}. Current state: ${snapshot.value}`)
        );
        return;
      }

      // Check again in the next tick
      setImmediate(checkState);
    };

    checkState();
  });
}

/**
 * Wait for an actor to reach idle state (common pattern)
 * Updated to work with the new completion state architecture
 */
export async function waitForIdle(actor: GitActor, timeout = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timeout waiting for operation to complete'));
    }, timeout);

    const unsubscribe = actor.subscribe((event: unknown) => {
      const snapshot = event as { value: string };

      // Check for completion states (operation finished successfully)
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
        'idle', // Still include idle for backward compatibility
      ];

      // Check for error states (operation finished with error)
      const errorStates = [
        'statusError',
        'repoError',
        'uncommittedChangesError',
        'stagingError',
        'commitError',
        'integrationStatusError',
        'changedFilesError',
        'fetchError',
        'pushError',
        'mergeError',
        'commitMessageError',
        'datesValidationError',
      ];

      // Check for timeout states (operation timed out)
      const timeoutStates = [
        'statusTimeout',
        'repoTimeout',
        'uncommittedChangesTimeout',
        'stagingTimeout',
        'commitTimeout',
        'integrationStatusTimeout',
        'changedFilesTimeout',
        'fetchTimeout',
        'pushTimeout',
        'mergeTimeout',
        'commitMessageTimeout',
        'datesValidationTimeout',
      ];

      if (
        completionStates.includes(snapshot.value) ||
        errorStates.includes(snapshot.value) ||
        timeoutStates.includes(snapshot.value)
      ) {
        clearTimeout(timeoutId);
        unsubscribe();
        resolve();
      }
    });
  });
}

/**
 * Wait for an actor to complete its current operation
 * Now uses proper completion states instead of polling for idle
 */
export async function waitForCompletion(actor: GitActor, timeout = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timeout waiting for completion'));
    }, timeout);

    const unsubscribe = actor.subscribe((event: unknown) => {
      const snapshot = event as { value: string };

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
      ];

      // Check for any error state
      const errorStates = [
        'statusError',
        'repoError',
        'uncommittedChangesError',
        'stagingError',
        'commitError',
        'integrationStatusError',
        'changedFilesError',
        'fetchError',
        'pushError',
        'mergeError',
        'commitMessageError',
        'datesValidationError',
      ];

      // Check for any timeout state
      const timeoutStates = [
        'statusTimeout',
        'repoTimeout',
        'uncommittedChangesTimeout',
        'stagingTimeout',
        'commitTimeout',
        'integrationStatusTimeout',
        'changedFilesTimeout',
        'fetchTimeout',
        'pushTimeout',
        'mergeTimeout',
        'commitMessageTimeout',
        'datesValidationTimeout',
      ];

      if (
        completionStates.includes(snapshot.value) ||
        errorStates.includes(snapshot.value) ||
        timeoutStates.includes(snapshot.value)
      ) {
        clearTimeout(timeoutId);
        unsubscribe();
        resolve();
      }
    });
  });
}

/**
 * Wait for multiple states - useful for testing complex workflows
 */
export async function waitForStates(
  actor: GitActor,
  targetStates: string[],
  timeout = 1000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timeout waiting for states: ${targetStates.join(', ')}`));
    }, timeout);

    const unsubscribe = actor.subscribe((event: unknown) => {
      const snapshot = event as { value: string };
      if (targetStates.includes(snapshot.value)) {
        clearTimeout(timeoutId);
        unsubscribe();
        resolve(snapshot.value);
      }
    });
  });
}
