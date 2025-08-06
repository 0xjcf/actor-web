/**
 * @module agent-workflow-cli/test-utils
 * @description Pure actor model testing utilities for the CLI package
 * @author Agent A - CLI Actor Migration Phase (Actor Model Compliant)
 */

import type { ActorRef } from '@actor-core/runtime';
import type { ActorMessage } from '../../actor-core-runtime/src/actor-system.js';

/**
 * Type guard for status response
 */
function isStatusResponse(response: unknown): response is { currentState: string } {
  return (
    typeof response === 'object' &&
    response !== null &&
    'currentState' in response &&
    typeof (response as { currentState: unknown }).currentState === 'string'
  );
}

/**
 * Send a message and verify outcome with retry logic
 */
export async function sendAndVerify(
  actor: ActorRef,
  message: ActorMessage,
  verifyFn: () => Promise<boolean>
): Promise<void> {
  actor.send(message);

  // Allow time for message processing
  await new Promise((resolve) => setTimeout(resolve, 50));

  if (!(await verifyFn())) {
    throw new Error(`Verification failed for message type: ${message?.type ?? 'unknown'}`);
  }
}

/**
 * Check if actor is in expected state
 */
export async function isInState(actor: ActorRef, expectedState: string): Promise<boolean> {
  const response = await actor.ask({ type: 'REQUEST_STATUS' });
  if (isStatusResponse(response)) {
    return response.currentState === expectedState;
  }
  return false;
}

/**
 * Wait for actor to reach specific state
 */
export async function waitForState(
  actor: ActorRef,
  expectedState: string,
  maxWait = 2000,
  checkInterval = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    if (await isInState(actor, expectedState)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }

  throw new Error(`Actor did not reach state "${expectedState}" within ${maxWait}ms`);
}

// ============================================================================
// MODERN ACTOR-BASED EVENT COLLECTION
// ============================================================================

/**
 * Create an event collector using the framework's spawnEventCollector
 * This is the recommended pattern for pure actor model compliance
 *
 * @example
 * ```typescript
 * import { getCLIActorSystem } from './core/cli-actor-system.js';
 *
 * const cliSystem = getCLIActorSystem();
 * const actorSystem = cliSystem.getActorSystem();
 *
 * // Create event collector
 * const collector = await actorSystem.spawnEventCollector({
 *   id: 'test-collector',
 *   autoStart: true
 * });
 *
 * // Get collected events
 * const response = await collector.ask({ type: 'GET_EVENTS' });
 * log.debug('Events:', response.events);
 * ```
 */
export function getEventCollectionPattern() {
  return {
    instructions: 'Use system.spawnEventCollector() for proper actor-based event collection',
    example: 'See JSDoc example above for proper usage pattern',
  };
}

// ============================================================================
// SPECIFIC TEST HELPERS FOR GIT ACTOR MESSAGES
// ============================================================================

/**
 * Helper to create properly typed git messages
 */
export const createGitMessage = {
  requestStatus: () => ({ type: 'REQUEST_STATUS' }),

  checkStatus: () => ({ type: 'CHECK_STATUS' }),

  getIntegrationStatus: () => ({ type: 'GET_INTEGRATION_STATUS' }),

  validateDates: () => ({ type: 'VALIDATE_DATES' }),

  commitChanges: (message: string) => ({ type: 'COMMIT_CHANGES', message }),
};
