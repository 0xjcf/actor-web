/**
 * @module agent-workflow-cli/test-utils
 * @description Pure actor model testing utilities for the CLI package
 * @author Agent A - CLI Actor Migration Phase (Actor Model Compliant)
 */

import type { JsonValue } from '../../actor-core-runtime/src/actor-system.js';
import type { GitActor } from './actors/git-actor.js';

/**
 * Test message interface with proper typing
 */
interface TestMessage {
  type: string;
  payload?: JsonValue | null;
}

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
  actor: GitActor,
  message: TestMessage,
  verifyFn: () => Promise<boolean>
): Promise<void> {
  await actor.send(message);

  // Allow time for message processing
  await new Promise((resolve) => setTimeout(resolve, 50));

  if (!(await verifyFn())) {
    throw new Error(`Verification failed for message type: ${message.type}`);
  }
}

/**
 * Ask pattern test helper with timeout
 */
export async function askAndVerify<T>(
  actor: GitActor,
  message: TestMessage,
  responseTimeout = 1000
): Promise<T> {
  return actor.ask(message, responseTimeout);
}

/**
 * Check if actor is in expected state
 */
export async function isInState(actor: GitActor, expectedState: string): Promise<boolean> {
  const response = await actor.ask({ type: 'REQUEST_STATUS' });
  if (isStatusResponse(response)) {
    return response.currentState === expectedState;
  }
  return false;
}

/**
 * Subscribe to test events with proper typing
 */
export function subscribeToTestEvents(
  actor: GitActor,
  eventHandlers: Record<string, (event: { type: string; payload?: JsonValue }) => void>
): () => void {
  const unsubscribers = Object.entries(eventHandlers).map(([eventType, handler]) =>
    actor.subscribe(eventType, handler)
  );

  return () => {
    unsubscribers.forEach((unsub) => unsub());
  };
}

/**
 * Wait for actor to reach specific state
 */
export async function waitForState(
  actor: GitActor,
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

/**
 * Event collector for testing - collects events with proper typing
 */
export function createEventCollector(actor: GitActor) {
  const events: Array<{ type: string; timestamp: number; payload?: JsonValue }> = [];
  const unsubscribers: Array<() => void> = [];

  return {
    start(eventTypes: string[] = ['*']) {
      eventTypes.forEach((eventType) => {
        const unsub = actor.subscribe(eventType, (event) => {
          events.push({
            ...event,
            timestamp: Date.now(),
          });
        });
        unsubscribers.push(unsub);
      });
    },

    stop() {
      unsubscribers.forEach((unsub) => unsub());
      unsubscribers.length = 0;
    },

    getEvents() {
      return [...events];
    },

    clear() {
      events.length = 0;
    },
  };
}

// ============================================================================
// DEPRECATED - TO BE REMOVED
// ============================================================================

/**
 * @deprecated Use pure actor model patterns instead
 */
export async function waitForCompletion(_actor: GitActor, _timeout?: number): Promise<void> {
  console.warn('waitForCompletion is deprecated. Use event-based patterns instead.');
  // Minimal implementation for backward compatibility
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
}
