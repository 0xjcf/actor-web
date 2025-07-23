/**
 * @module agent-workflow-cli/actors/git-actor-helpers
 * @description Pure actor model helper utilities for working with GitActor in CLI commands
 * @author Agent A - CLI Actor Migration (Actor Model Compliant)
 */

import type { ActorMessage, JsonValue } from '@actor-core/runtime';
import type { GitActor, GitEmittedEvent } from './git-actor';

// ============================================================================
// PURE ACTOR MODEL EVENT SUBSCRIPTIONS
// ============================================================================

/**
 * Subscribe to a specific event type from the actor
 * Pure event-based communication
 */
export function subscribeToEvent<T extends GitEmittedEvent['type']>(
  actor: GitActor,
  eventType: T,
  handler: (event: Extract<GitEmittedEvent, { type: T }>) => void
): () => void {
  return actor.subscribe(eventType, (message: ActorMessage) => {
    // The payload contains the actual event data
    const eventData = message.payload as Extract<GitEmittedEvent, { type: T }>;
    handler(eventData);
  });
}

/**
 * Subscribe to error events from the actor
 * Pure event-based error handling
 */
export function subscribeToErrors(
  actor: GitActor,
  handler: (operation: string, error: string) => void
): () => void {
  return actor.subscribe('GIT_OPERATION_FAILED', (message: ActorMessage) => {
    // The payload contains the actual event data
    const eventData = message.payload as Extract<GitEmittedEvent, { type: 'GIT_OPERATION_FAILED' }>;
    if (
      eventData &&
      typeof eventData === 'object' &&
      'operation' in eventData &&
      'error' in eventData
    ) {
      handler(eventData.operation as string, eventData.error as string);
    }
  });
}

/**
 * Subscribe to state change events
 * Pure event-based state monitoring
 */
export function subscribeToStateChanges(
  actor: GitActor,
  handler: (newState: string, previousState: string) => void
): () => void {
  return actor.subscribe('GIT_STATE_CHANGED', (message: ActorMessage) => {
    // The payload contains the actual event data
    const eventData = message.payload as Extract<GitEmittedEvent, { type: 'GIT_STATE_CHANGED' }>;
    if (eventData && typeof eventData === 'object' && 'from' in eventData && 'to' in eventData) {
      handler(eventData.to as string, eventData.from as string);
    }
  });
}

/**
 * Subscribe to multiple event types at once
 * Returns a cleanup function that unsubscribes from all events
 */
export function subscribeToMultipleEvents(
  actor: GitActor,
  handlers: Partial<Record<GitEmittedEvent['type'], (event: GitEmittedEvent) => void>>
): () => void {
  const unsubscribers = Object.entries(handlers).map(([eventType, handler]) => {
    if (!handler) return () => {};
    return actor.subscribe(eventType, (message: ActorMessage) => {
      const eventData = message.payload as GitEmittedEvent;
      handler(eventData);
    });
  });

  return () => {
    unsubscribers.forEach((unsub) => unsub());
  };
}

// ============================================================================
// PURE ACTOR MODEL COMMAND PATTERNS
// ============================================================================

/**
 * Send a command and wait for a specific event response
 * Pure actor model pattern without polling
 */
export async function sendCommandAndWaitForEvent<T extends GitEmittedEvent>(
  actor: GitActor,
  command: { type: string; payload?: JsonValue },
  eventType: T['type']
): Promise<T> {
  return new Promise((resolve) => {
    const unsubscribe = actor.subscribe(eventType, (message: ActorMessage) => {
      unsubscribe();
      // Extract the event data from the message payload
      const eventData = message.payload as T;
      resolve(eventData);
    });

    // Send command
    actor.send(command);
  });
}

/**
 * Send a command and collect all events until a completion event
 * Pure actor model pattern for workflow testing
 */
export async function sendCommandAndCollectEvents(
  actor: GitActor,
  command: { type: string; payload?: JsonValue },
  completionEventType: GitEmittedEvent['type']
): Promise<GitEmittedEvent[]> {
  const events: GitEmittedEvent[] = [];

  return new Promise((resolve) => {
    // Subscribe to all events
    const unsubscribe = actor.subscribe('*', (message: ActorMessage) => {
      // Extract event data from message payload
      const eventData = message.payload as GitEmittedEvent;
      events.push(eventData);

      // Check if this is the completion event
      if (message.type === completionEventType) {
        unsubscribe();
        resolve(events);
      }
    });

    // Send command
    actor.send(command);
  });
}

// ============================================================================
// PURE ACTOR MODEL STATUS HELPERS
// ============================================================================

/**
 * Get current actor status using ask pattern
 * Pure message passing approach
 */
export async function getActorStatus(actor: GitActor): Promise<{
  isGitRepo?: boolean;
  currentBranch?: string;
  agentType?: string;
  uncommittedChanges?: boolean;
  lastError?: string;
}> {
  const response = await actor.ask({ type: 'REQUEST_STATUS' });
  // Validate the response structure
  if (response && typeof response === 'object') {
    return response as {
      isGitRepo?: boolean;
      currentBranch?: string;
      agentType?: string;
      uncommittedChanges?: boolean;
      lastError?: string;
    };
  }
  return {};
}

/**
 * Get branch information using ask pattern
 * Pure message passing approach
 */
export async function getBranchInfo(actor: GitActor): Promise<{
  currentBranch?: string;
  agentType?: string;
  integrationStatus?: { ahead: number; behind: number };
}> {
  const response = await actor.ask({ type: 'REQUEST_BRANCH_INFO' });
  // Validate the response structure
  if (response && typeof response === 'object') {
    return response as {
      currentBranch?: string;
      agentType?: string;
      integrationStatus?: { ahead: number; behind: number };
    };
  }
  return {};
}

/**
 * Get commit status using ask pattern
 * Pure message passing approach
 */
export async function getCommitStatus(actor: GitActor): Promise<{
  lastCommitHash?: string;
  lastCommitMessage?: string;
}> {
  const response = await actor.ask({ type: 'REQUEST_COMMIT_STATUS' });
  // Validate the response structure
  if (response && typeof response === 'object') {
    return response as {
      lastCommitHash?: string;
      lastCommitMessage?: string;
    };
  }
  return {};
}

// ============================================================================
// PURE ACTOR MODEL WORKFLOW HELPERS
// ============================================================================

/**
 * Execute a git workflow and track its progress through events
 * Pure actor model approach
 */
export function createWorkflowTracker(actor: GitActor) {
  const events: GitEmittedEvent[] = [];
  let unsubscribe: (() => void) | null = null;

  return {
    start() {
      unsubscribe = actor.subscribe('*', (message: ActorMessage) => {
        // Extract event data from message payload
        const eventData = message.payload as GitEmittedEvent;
        events.push(eventData);
      });
    },

    stop() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },

    getEvents() {
      return [...events];
    },

    hasEvent(eventType: GitEmittedEvent['type']) {
      return events.some((e) => e.type === eventType);
    },

    getEvent<T extends GitEmittedEvent['type']>(
      eventType: T
    ): Extract<GitEmittedEvent, { type: T }> | undefined {
      return events.find((e) => e.type === eventType) as
        | Extract<GitEmittedEvent, { type: T }>
        | undefined;
    },

    clear() {
      events.length = 0;
    },
  };
}
