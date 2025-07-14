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
 * Setup global mocks for testing environment
 */
export function setupGlobalMocks(): MockGlobalEventBus {
  // Mock DOM APIs that are commonly used in tests
  if (typeof global !== 'undefined') {
    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn((_index: number) => null),
    };
    Object.defineProperty(global, 'localStorage', { value: localStorageMock });

    // Mock sessionStorage
    Object.defineProperty(global, 'sessionStorage', { value: localStorageMock });

    // Mock requestAnimationFrame
    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      return setTimeout(() => callback(Date.now()), 16);
    });

    // Mock cancelAnimationFrame
    global.cancelAnimationFrame = vi.fn((id: number) => {
      clearTimeout(id);
    });

    // Mock IntersectionObserver
    global.IntersectionObserver = vi.fn(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
      unobserve: vi.fn(),
    })) as unknown as typeof IntersectionObserver;

    // Mock ResizeObserver
    global.ResizeObserver = vi.fn(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
      unobserve: vi.fn(),
    })) as unknown as typeof ResizeObserver;
  }

  // Return a mock global event bus
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    clear: vi.fn(),
  };
}

/**
 * Performance testing utilities
 */
export const performanceTestUtils = {
  measureExecutionTime: async (fn: () => void | Promise<void>): Promise<number> => {
    const start = performance.now();
    await fn();
    return performance.now() - start;
  },

  expectToCompleteWithin: (timeMs: number) => ({
    toCompleteWithin: async (fn: () => void | Promise<void>) => {
      const executionTime = await performanceTestUtils.measureExecutionTime(fn);
      if (executionTime > timeMs) {
        throw new Error(
          `Expected function to complete within ${timeMs}ms, but took ${executionTime}ms`
        );
      }
    },
  }),

  expectPerformant: async (fn: () => void | Promise<void>, maxTimeMs = 100): Promise<void> => {
    const executionTime = await performanceTestUtils.measureExecutionTime(fn);
    if (executionTime > maxTimeMs) {
      throw new Error(
        `Expected function to be performant (within ${maxTimeMs}ms), but took ${executionTime}ms`
      );
    }
  },

  measureRenderTime: async (
    fn: () => void | Promise<void>
  ): Promise<{
    executionTime: number;
    renderTime: number;
    totalTime: number;
  }> => {
    const startTime = performance.now();
    await fn();
    const executionTime = performance.now() - startTime;

    // Wait for next frame to measure render time
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const renderTime = performance.now() - startTime - executionTime;

    return {
      executionTime,
      renderTime,
      totalTime: executionTime + renderTime,
    };
  },
};

/**
 * Accessibility testing utilities
 */
export const a11yTestUtils = {
  expectAriaLabel: (element: Element, expectedLabel: string) => {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel !== expectedLabel) {
      throw new Error(`Expected aria-label="${expectedLabel}", got "${ariaLabel}"`);
    }
  },

  expectRole: (element: Element, expectedRole: string) => {
    const role = element.getAttribute('role');
    if (role !== expectedRole) {
      throw new Error(`Expected role="${expectedRole}", got "${role}"`);
    }
  },

  expectFocusable: (element: Element) => {
    const tabIndex = element.getAttribute('tabindex');
    const isFocusable = tabIndex !== null && tabIndex !== '-1';
    if (!isFocusable) {
      throw new Error(`Expected element to be focusable, but tabindex="${tabIndex}"`);
    }
  },

  expectAccessible: (element: Element, expectedAttributes?: Record<string, string>) => {
    if (expectedAttributes) {
      // Check specific attributes if provided
      for (const [key, expectedValue] of Object.entries(expectedAttributes)) {
        // Convert camelCase to kebab-case for attributes
        const attributeName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
        // Handle aria-* attributes properly
        const ariaAttributeName = attributeName.startsWith('aria')
          ? attributeName.replace(/^aria/, 'aria-')
          : attributeName;

        const actualValue = element.getAttribute(ariaAttributeName);
        if (actualValue !== expectedValue) {
          throw new Error(`Expected ${ariaAttributeName}="${expectedValue}", got "${actualValue}"`);
        }
      }
    } else {
      // Check that element has some accessibility attributes
      const hasAriaLabel = element.getAttribute('aria-label') !== null;
      const hasAriaLabelledBy = element.getAttribute('aria-labelledby') !== null;
      const hasTitle = element.getAttribute('title') !== null;
      const hasRole = element.getAttribute('role') !== null;

      if (!hasAriaLabel && !hasAriaLabelledBy && !hasTitle && !hasRole) {
        throw new Error(
          'Expected element to have accessibility attributes (aria-label, aria-labelledby, title, or role)'
        );
      }
    }
  },

  expectKeyboardAccessible: (element: Element, _options?: { checkTabIndex?: boolean }) => {
    // Check that element is keyboard accessible
    const tabIndex = element.getAttribute('tabindex');
    const tagName = element.tagName.toLowerCase();
    const isInteractiveElement = ['button', 'input', 'select', 'textarea', 'a'].includes(tagName);
    const hasTabIndex = tabIndex !== null && tabIndex !== '-1';

    if (!isInteractiveElement && !hasTabIndex) {
      throw new Error(
        `Expected element to be keyboard accessible (interactive element or proper tabindex), but got ${tagName} with tabindex="${tabIndex}"`
      );
    }
  },

  expectLabelled: (element: Element, expectedLabel?: string) => {
    const ariaLabel = element.getAttribute('aria-label');
    const ariaLabelledBy = element.getAttribute('aria-labelledby');
    const title = element.getAttribute('title');

    const hasLabel = ariaLabel || ariaLabelledBy || title;
    if (!hasLabel) {
      throw new Error('Expected element to have a label (aria-label, aria-labelledby, or title)');
    }

    if (expectedLabel && ariaLabel !== expectedLabel) {
      throw new Error(`Expected label "${expectedLabel}", got "${ariaLabel}"`);
    }
  },
};

/**
 * Mock global event bus interface
 */
export interface MockGlobalEventBus {
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
}

/**
 * Component testing utilities for shadow DOM
 */
export const componentUtils = {
  getShadowContent: (element: Element): ShadowRoot | null => {
    if ('shadowRoot' in element) {
      return element.shadowRoot as ShadowRoot;
    }
    return null;
  },

  queryInShadow: (element: Element, selector: string): Element | null => {
    const shadowRoot = componentUtils.getShadowContent(element);
    if (shadowRoot) {
      return shadowRoot.querySelector(selector);
    }
    return null;
  },

  queryAllInShadow: (element: Element, selector: string): Element[] => {
    const shadowRoot = componentUtils.getShadowContent(element);
    if (shadowRoot) {
      return Array.from(shadowRoot.querySelectorAll(selector));
    }
    return [];
  },
};

/**
 * User interaction utilities for testing (enhanced)
 */
export const userInteractions = {
  click: (element: Element) => {
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
  },

  input: (element: Element, value: string) => {
    if ('value' in element) {
      (element as HTMLInputElement).value = value;
    }
    const event = new Event('input', {
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
  },

  keyDown: (element: Element, key: string) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
  },

  // Alias for compatibility
  keydown: (element: Element, key: string) => {
    userInteractions.keyDown(element, key);
  },

  focus: (element: Element) => {
    if ('focus' in element && typeof element.focus === 'function') {
      element.focus();
    }
    const event = new FocusEvent('focus', {
      bubbles: true,
    });
    element.dispatchEvent(event);
  },

  blur: (element: Element) => {
    if ('blur' in element && typeof element.blur === 'function') {
      element.blur();
    }
    const event = new FocusEvent('blur', {
      bubbles: true,
    });
    element.dispatchEvent(event);
  },
};

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
 * Enhanced TestEnvironment with additional properties that tests expect
 */
export interface TestEnvironment {
  actors: Map<string, MockActorRef>;
  cleanup: () => void;
  getActor: (id: string) => MockActorRef | undefined;
  getAllActors: () => MockActorRef[];
  // Additional properties that some tests expect
  container: HTMLElement;
}

/**
 * Create enhanced test environment with container element
 */
export function createTestEnvironment(): TestEnvironment {
  const actors = new Map<string, MockActorRef>();

  // Create a mock container element
  const container = document.createElement('div');
  container.id = 'test-container';
  document.body.appendChild(container);

  return {
    actors,
    container,

    cleanup: () => {
      // Stop all actors
      for (const actor of Array.from(actors.values())) {
        if (actor.status === 'running') {
          actor.stop();
        }
      }
      actors.clear();

      // Clean up container
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
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

/**
 * Template testing utilities for HTML template testing
 */
export const templateTestUtils = {
  expectTemplateContent: (template: string, expectedContent: string) => {
    if (!template.includes(expectedContent)) {
      throw new Error(`Expected template to contain "${expectedContent}", but got: ${template}`);
    }
  },

  expectTemplateStructure: (template: string, expectedTags: string[]) => {
    for (const tag of expectedTags) {
      const tagPattern = new RegExp(`<${tag}[^>]*>`, 'i');
      if (!tagPattern.test(template)) {
        throw new Error(`Expected template to contain <${tag}> tag, but got: ${template}`);
      }
    }
  },

  expectTemplateAttributes: (template: string, expectedAttributes: Record<string, string>) => {
    for (const [attr, value] of Object.entries(expectedAttributes)) {
      const attrPattern = new RegExp(`${attr}\\s*=\\s*["']${value}["']`, 'i');
      if (!attrPattern.test(template)) {
        throw new Error(`Expected template to contain ${attr}="${value}", but got: ${template}`);
      }
    }
  },

  expectTemplateContains: (template: string | { html: string }, expectedParts: string[]) => {
    const templateString = typeof template === 'string' ? template : template.html;
    for (const part of expectedParts) {
      if (!templateString.includes(part)) {
        throw new Error(`Expected template to contain "${part}", but got: ${templateString}`);
      }
    }
  },

  expectTemplateNotContains: (template: string | { html: string }, unexpectedContent: string) => {
    const templateString = typeof template === 'string' ? template : template.html;
    if (templateString.includes(unexpectedContent)) {
      throw new Error(
        `Expected template NOT to contain "${unexpectedContent}", but got: ${templateString}`
      );
    }
  },

  expectEscaped: (template: string | { html: string }, originalContent: string) => {
    const templateString = typeof template === 'string' ? template : template.html;
    // Check that dangerous content is properly escaped
    const escapedContent = originalContent
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    if (!templateString.includes(escapedContent) && templateString.includes(originalContent)) {
      throw new Error(
        `Expected "${originalContent}" to be escaped in template, but found unescaped content`
      );
    }
  },
};
