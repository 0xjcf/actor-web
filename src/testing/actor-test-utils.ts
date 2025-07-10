/**
 * @module framework/testing/actor-test-utils
 * @description Test utilities and helpers for testing ActorRef implementations
 * @author Agent C - 2025-01-10
 */

import { vi } from 'vitest';
import type { AnyStateMachine, EventObject } from 'xstate';
import type { ActorRef, ActorRefOptions } from '../core/actors/actor-ref';
import type { ActorSnapshot, SupervisionStrategy } from '../core/actors/types';
import type { Observable, Observer } from '../core/observables/observable';

/**
 * Mock ActorRef for testing
 */
export interface MockActorRef<TEvent extends EventObject = EventObject>
  extends ActorRef<TEvent, unknown, ActorSnapshot> {
  // Test helpers
  getSentEvents: () => TEvent[];
  getObserverCount: () => number;
  getSpawnedChildren: () => MockActorRef<EventObject>[];
  simulateStateChange: (snapshot: Partial<ActorSnapshot>) => void;
  simulateError: (error: Error) => void;
  // Make status mutable for testing
  status: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
}

/**
 * Create a mock ActorRef for testing
 */
export function createMockActorRef<T extends EventObject = EventObject>(
  id = 'test-actor',
  options?: Partial<ActorRefOptions>
): MockActorRef<T> {
  const sentEvents: T[] = [];
  const observers = new Set<Observer<unknown>>();
  const spawnedChildren: MockActorRef<EventObject>[] = [];
  let currentSnapshot: ActorSnapshot = {
    context: {},
    value: 'idle',
    status: 'running',
    error: undefined,
  };
  let status: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error' = 'running';

  const mockRef: MockActorRef<T> = {
    id,
    status,
    parent: options?.parent,
    supervision: options?.supervision,

    send: vi.fn((event: T) => {
      sentEvents.push(event);
      options?.metrics?.onMessage?.(event);
    }),

    ask: vi.fn(async (query: unknown) => {
      return new Promise((resolve, _reject) => {
        setTimeout(() => {
          resolve({ type: 'RESPONSE', data: query });
        }, 50);
      });
    }) as <TQuery, TResponse>(query: TQuery, options?: unknown) => Promise<TResponse>,

    observe: vi.fn(<TSelected>(selector: (snapshot: ActorSnapshot) => TSelected) => {
      const mockObservable: Observable<TSelected> = {
        subscribe: (
          observerOrNext: Observer<TSelected> | ((value: TSelected) => void),
          error?: (error: Error) => void,
          complete?: () => void
        ) => {
          const observer: Observer<TSelected> =
            typeof observerOrNext === 'function'
              ? { next: observerOrNext, error, complete }
              : observerOrNext;

          observers.add(observer);

          // Emit initial value
          try {
            const value = selector(currentSnapshot);
            observer.next?.(value);
          } catch (error) {
            observer.error?.(error as Error);
          }

          // Return subscription with closed property
          return {
            closed: false,
            unsubscribe: () => {
              observers.delete(observer);
            },
          };
        },
        [Symbol.observable]: function () {
          return this;
        },
      };
      return mockObservable;
    }) as <TSelected>(selector: (snapshot: ActorSnapshot) => TSelected) => Observable<TSelected>,

    spawn: vi.fn(
      (
        _behavior: AnyStateMachine,
        spawnOptions?: { id?: string; supervision?: SupervisionStrategy }
      ) => {
        const childId = spawnOptions?.id || `${id}.child-${spawnedChildren.length}`;
        const childRef = createMockActorRef(childId, {
          parent: mockRef as MockActorRef<EventObject>,
          supervision: spawnOptions?.supervision || options?.supervision,
        });
        spawnedChildren.push(childRef);
        return childRef as MockActorRef<EventObject>;
      }
    ),

    // New required methods from ActorRef interface
    stopChild: vi.fn(async (childId: string) => {
      const childIndex = spawnedChildren.findIndex((child) => child.id === childId);
      if (childIndex !== -1) {
        await spawnedChildren[childIndex].stop();
        spawnedChildren.splice(childIndex, 1);
      }
    }),

    getChildren: vi.fn(() => {
      const childrenMap = new Map<string, MockActorRef<EventObject>>();
      for (const child of spawnedChildren) {
        childrenMap.set(child.id, child);
      }
      return childrenMap as ReadonlyMap<string, ActorRef<EventObject, unknown>>;
    }),

    matches: vi.fn((_statePath: string) => {
      // Simple mock implementation - always returns false for now
      return false;
    }),

    accepts: vi.fn((eventType: string) => {
      // Simple mock implementation - accepts any non-empty string
      return typeof eventType === 'string' && eventType.length > 0;
    }),

    start: vi.fn(() => {
      status = 'running';
      mockRef.status = status;
    }),

    stop: vi.fn(async () => {
      status = 'stopped';
      mockRef.status = status;
      // Stop all children
      await Promise.all(spawnedChildren.map((child) => child.stop()));
    }),

    restart: vi.fn(async () => {
      await mockRef.stop();
      mockRef.start();
    }),

    getSnapshot: vi.fn(() => currentSnapshot),

    // Test helpers
    getSentEvents: () => [...sentEvents],
    getObserverCount: () => observers.size,
    getSpawnedChildren: () => [...spawnedChildren],

    simulateStateChange: (snapshot: Partial<ActorSnapshot>) => {
      currentSnapshot = { ...currentSnapshot, ...snapshot };
      for (const observer of Array.from(observers)) {
        try {
          // Re-run selectors with new snapshot
          const selector = (s: ActorSnapshot) => s;
          const value = selector(currentSnapshot);
          observer.next?.(value);
        } catch (error) {
          observer.error?.(error as Error);
        }
      }
      options?.metrics?.onStateChange?.(currentSnapshot);
    },

    simulateError: (error: Error) => {
      status = 'error';
      mockRef.status = status;
      currentSnapshot = { ...currentSnapshot, status: 'error', error };
      for (const observer of Array.from(observers)) {
        observer.error?.(error);
      }
      options?.metrics?.onError?.(error);
    },
  };

  return mockRef;
}

/**
 * Test environment for actor tests
 */
export interface TestEnvironment {
  actors: Map<string, MockActorRef>;
  cleanup: () => void;
  getActor: (id: string) => MockActorRef | undefined;
  getAllActors: () => MockActorRef[];
}

/**
 * Create a test environment for managing multiple actors
 */
export function createTestEnvironment(): TestEnvironment {
  const actors = new Map<string, MockActorRef>();

  return {
    actors,

    cleanup: () => {
      // Stop all actors
      for (const actor of Array.from(actors.values())) {
        if (actor.status === 'running') {
          actor.stop();
        }
      }
      actors.clear();
    },

    getActor: (id: string) => actors.get(id),

    getAllActors: () => Array.from(actors.values()),
  };
}

/**
 * Wait for an actor to reach a specific state
 */
export async function waitForState(
  actorRef: ActorRef<EventObject>,
  targetState: string,
  timeout = 1000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      subscription.unsubscribe();
      reject(new Error(`Timeout waiting for state: ${targetState}`));
    }, timeout);

    const subscription = actorRef
      .observe((snapshot) => snapshot.value)
      .subscribe((state) => {
        if (state === targetState) {
          clearTimeout(timeoutId);
          subscription.unsubscribe();
          resolve();
        }
      });
  });
}

/**
 * Collect all events sent to an actor
 */
export function collectEvents<T extends EventObject>(
  actorRef: ActorRef<T>
): { events: T[]; stop: () => void } {
  const events: T[] = [];
  const originalSend = actorRef.send.bind(actorRef);

  actorRef.send = (event: T) => {
    events.push(event);
    originalSend(event);
  };

  return {
    events,
    stop: () => {
      actorRef.send = originalSend;
    },
  };
}

/**
 * Create a supervisor mock for testing supervision
 */
export function createMockSupervisor(strategy: SupervisionStrategy = 'restart-on-failure') {
  const supervisedActors = new Set<ActorRef<EventObject>>();
  const restartCalls: Array<{ actor: ActorRef<EventObject>; error: Error; attempt: number }> = [];
  const failureCalls: Array<{ actor: ActorRef<EventObject>; error: Error }> = [];

  return {
    strategy,
    supervisedActors,
    restartCalls,
    failureCalls,

    supervise: vi.fn((actor: ActorRef<EventObject>) => {
      supervisedActors.add(actor);
    }),

    handleFailure: vi.fn((error: Error, actor: ActorRef<EventObject>) => {
      if (strategy === 'restart-on-failure') {
        const attempt = restartCalls.filter((r) => r.actor === actor).length + 1;
        restartCalls.push({ actor, error, attempt });
        actor.restart();
      } else if (strategy === 'stop-on-failure') {
        failureCalls.push({ actor, error });
        actor.stop();
      }
    }),

    getRestartCount: (actor: ActorRef<EventObject>) => {
      return restartCalls.filter((r) => r.actor === actor).length;
    },
  };
}

/**
 * Assert that an actor has received specific events
 */
export function assertEventsReceived<T extends EventObject>(
  actor: MockActorRef<T>,
  expectedEvents: Array<Partial<T>>
): void {
  const sentEvents = actor.getSentEvents();

  expectedEvents.forEach((expected, index) => {
    const actual = sentEvents[index];
    if (!actual) {
      throw new Error(`Expected event at index ${index} but found none`);
    }

    for (const [key, value] of Object.entries(expected)) {
      if ((actual as Record<string, unknown>)[key] !== value) {
        throw new Error(
          `Event mismatch at index ${index}: ` +
            `expected ${key}=${value}, got ${key}=${(actual as Record<string, unknown>)[key]}`
        );
      }
    }
  });
}

/**
 * Create a test observable that can be manually controlled
 */
export function createTestObservable<T>(): {
  observable: Observable<T>;
  emit: (value: T) => void;
  error: (error: Error) => void;
  complete: () => void;
} {
  const observers = new Set<Observer<T>>();

  const observable: Observable<T> = {
    subscribe: (
      observerOrNext: Observer<T> | ((value: T) => void),
      error?: (error: Error) => void,
      complete?: () => void
    ) => {
      const observer: Observer<T> =
        typeof observerOrNext === 'function'
          ? { next: observerOrNext, error, complete }
          : observerOrNext;

      observers.add(observer);

      return {
        closed: false,
        unsubscribe: () => {
          observers.delete(observer);
        },
      };
    },
    [Symbol.observable]: function () {
      return this;
    },
  };

  return {
    observable,
    emit: (value: T) => {
      for (const observer of Array.from(observers)) {
        observer.next?.(value);
      }
    },
    error: (error: Error) => {
      for (const observer of Array.from(observers)) {
        observer.error?.(error);
      }
    },
    complete: () => {
      for (const observer of Array.from(observers)) {
        observer.complete?.();
      }
    },
  };
}
