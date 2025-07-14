/**
 * Reactive Test Adapters - Actor-SPA Framework
 *
 * Type-safe adapters for testing reactive patterns following TESTING-GUIDE.md
 * Bridges Actor-Web Framework APIs with XState snapshot types
 */

import type { AnyStateMachine, EventObject, SnapshotFrom } from 'xstate';
import { createActorRef } from '../core/create-actor-ref.js';
import { Logger } from '../core/dev-mode.js';

const log = Logger.namespace('REACTIVE_TEST_ADAPTERS');

/**
 * Creates type-safe snapshots for testing reactive templates
 * Following TESTING-GUIDE.md: Use real framework APIs instead of mocks
 */
export function createTestSnapshot<TMachine extends AnyStateMachine>(
  machine: TMachine,
  initialContext?: Record<string, unknown>
): SnapshotFrom<TMachine> {
  const actor = createActorRef(machine);
  actor.start();

  log.debug('Created test snapshot', {
    machineId: machine.id,
    hasInitialContext: !!initialContext,
  });

  // Return real framework snapshot - type-safe and compliant
  const snapshot = actor.getSnapshot();

  // TypeScript will infer the correct type without casting
  return snapshot as SnapshotFrom<TMachine>;
}

/**
 * Creates a snapshot with specific context values by sending events
 * Ensures all required MachineSnapshot properties are present
 */
export function createSnapshotWithContext<TMachine extends AnyStateMachine>(
  machine: TMachine,
  contextUpdates: Record<string, unknown>,
  events: EventObject[] = []
): SnapshotFrom<TMachine> {
  const actor = createActorRef(machine);
  actor.start();

  // Send events to update state/context
  events.forEach((event) => {
    actor.send(event);
  });

  log.debug('Created snapshot with context updates', {
    machineId: machine.id,
    contextUpdates,
    eventsCount: events.length,
  });

  const snapshot = actor.getSnapshot();
  return snapshot as SnapshotFrom<TMachine>;
}

/**
 * Reactive Test Manager - Type-safe actor management for testing
 * Preserves XState's native functionality while providing framework features
 */
export class ReactiveTestManager<TMachine extends AnyStateMachine> {
  private actor: ReturnType<typeof createActorRef> | null = null;

  constructor(private machine: TMachine) {}

  /**
   * Start the test actor and return initial snapshot with proper typing
   */
  start(): SnapshotFrom<TMachine> {
    if (this.actor) {
      throw new Error('Actor already started. Call cleanup() first.');
    }

    this.actor = createActorRef(this.machine);
    this.actor.start();

    log.debug('Started reactive test actor', { machineId: this.machine.id });

    // TypeScript can infer the correct snapshot type
    const snapshot = this.actor.getSnapshot();
    return snapshot as SnapshotFrom<TMachine>;
  }

  /**
   * Send event and return updated snapshot with proper typing
   */
  send(event: EventObject): SnapshotFrom<TMachine> {
    if (!this.actor) {
      throw new Error('Actor not started. Call start() first.');
    }

    this.actor.send(event);
    const snapshot = this.actor.getSnapshot();

    log.debug('Sent event and got snapshot', {
      event: event.type,
      // Safe access to context - TypeScript will infer the type
      newContext: 'context' in snapshot ? snapshot.context : undefined,
    });

    return snapshot as SnapshotFrom<TMachine>;
  }

  /**
   * Get current snapshot without sending events
   */
  getSnapshot(): SnapshotFrom<TMachine> {
    if (!this.actor) {
      throw new Error('Actor not started. Call start() first.');
    }

    const snapshot = this.actor.getSnapshot();
    return snapshot as SnapshotFrom<TMachine>;
  }

  /**
   * Clean up actor resources
   */
  async cleanup(): Promise<void> {
    if (this.actor) {
      await this.actor.stop();
      this.actor = null;
      log.debug('Cleaned up reactive test actor');
    }
  }
}

/**
 * Helper for creating mock state objects that satisfy matches() function
 * Use sparingly - prefer real snapshots when possible
 */
export function createMockStateMatches(currentState: string) {
  return {
    matches: (state: string) => state === currentState,
  };
}

/**
 * Type-safe event definitions for common test scenarios
 * Helps avoid "property does not exist" errors in test events
 */
export type FormTestEvent =
  | { type: 'UPDATE_EMAIL'; value: string }
  | { type: 'UPDATE_PASSWORD'; value: string };

export type ModalTestEvent = { type: 'OPEN'; message: string } | { type: 'CLOSE' };

export type CounterTestEvent =
  | { type: 'INCREMENT' }
  | { type: 'DECREMENT' }
  | { type: 'SET'; value: number };

export type ThemeTestEvent = { type: 'THEME_CHANGED'; theme: string };

export type DataTestEvent =
  | { type: 'DATA_LOADED'; data: unknown }
  | { type: 'DATA_ERROR'; error: string }
  | { type: 'DATA_UPDATED'; data: unknown }
  | { type: 'REFRESH' }
  | { type: 'RETRY' };
