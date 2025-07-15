/**
 * @module agent-workflow-cli/test-utils
 * @description Consolidated testing utilities for the CLI package
 * @author Agent A - CLI Actor Migration Phase
 */

/**
 * Wait for a condition to be true or timeout
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
 * Wait for an actor to reach a specific state
 */
export async function waitForState(
  actor: { getSnapshot: () => { value: unknown } },
  targetState: string,
  timeout = 1000
): Promise<void> {
  return waitFor(() => {
    const snapshot = actor.getSnapshot();
    return snapshot.value === targetState;
  }, timeout);
}

/**
 * Wait for an actor to reach idle state (common pattern)
 */
export async function waitForIdle(
  actor: { getSnapshot: () => { value: unknown } },
  timeout = 1000
): Promise<void> {
  return waitForState(actor, 'idle', timeout);
}

/**
 * Wait for an actor to complete its current operation
 * Alias for waitForIdle for backwards compatibility
 */
export async function waitForCompletion(
  actor: { getSnapshot: () => { value: unknown } },
  timeout = 1000
): Promise<void> {
  return waitForIdle(actor, timeout);
}
