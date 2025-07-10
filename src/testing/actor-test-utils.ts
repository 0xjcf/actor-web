/**
 * @module framework/testing/actor-test-utils
 * @description Test utilities and helpers for testing ActorRef implementations
 * @author Agent C - 2025-01-10
 */

import { vi, expect } from 'vitest';
import type { AnyStateMachine, EventObject } from 'xstate';
import type { ActorRef, ActorRefOptions, ActorStatus, AskOptions } from '../core/actors/actor-ref';
import type { ActorSnapshot, SupervisionStrategy } from '../core/actors/types';
import type { Observable, Observer, Subscription } from '../core/observables/observable';

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
    status: 'active',
    error: undefined,
  };
  let status: ActorStatus = 'running';

  const mockRef: MockActorRef<T> = {
    id,
    get status() { return status; },
    parent: options?.parent,
    supervision: options?.supervision,

    send: vi.fn((event: T) => {
      sentEvents.push(event);
      options?.metrics?.onMessage?.(event);
    }),

    ask: vi.fn().mockImplementation(async <TQuery, TResponse>(query: TQuery, _options?: AskOptions): Promise<TResponse> => {
      return new Promise<TResponse>((resolve) => {
        setTimeout(() => {
          resolve({ type: 'RESPONSE', data: query } as unknown as TResponse);
        }, 50);
      });
    }),

    observe: vi.fn().mockImplementation(<TSelected>(selector: (snapshot: ActorSnapshot) => TSelected): Observable<TSelected> => {
      let closed = false;
      
      const createSubscription = (observer: Observer<TSelected>): Subscription => {
        observers.add(observer as Observer<unknown>);

        // Emit initial value
        try {
          const value = selector(currentSnapshot);
          observer.next?.(value);
        } catch (error) {
          observer.error?.(error as Error);
        }

        // Return subscription
        return {
          unsubscribe: () => {
            observers.delete(observer as Observer<unknown>);
            closed = true;
          },
          get closed() { return closed; }
        };
      };

      const mockObservable: Observable<TSelected> = {
        subscribe(
          observerOrNext?: Observer<TSelected> | ((value: TSelected) => void),
          error?: (error: Error) => void,
          complete?: () => void
        ): Subscription {
          let observer: Observer<TSelected>;
          if (typeof observerOrNext === 'function') {
            observer = { next: observerOrNext, error, complete };
          } else if (observerOrNext) {
            observer = observerOrNext;
          } else {
            observer = { next: () => {} };
          }
          return createSubscription(observer);
        },
        [Symbol.observable]() { return this; }
      };
      return mockObservable;
    }),

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

    start: vi.fn(() => {
      status = 'running';
    }),

    stop: vi.fn(async () => {
      status = 'stopped';
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
      observers.forEach((observer) => {
        try {
          // Re-run selectors with new snapshot
          const selector = (s: ActorSnapshot) => s;
          const value = selector(currentSnapshot);
          observer.next?.(value);
        } catch (error) {
          observer.error?.(error as Error);
        }
      });
      options?.metrics?.onStateChange?.(currentSnapshot);
    },

    simulateError: (error: Error) => {
      status = 'error';
      currentSnapshot = { ...currentSnapshot, status: 'error', error };
      observers.forEach((observer) => {
        observer.error?.(error);
      });
      options?.metrics?.onError?.(error);
    },

    // Additional methods required by ActorRef interface
    stopChild: vi.fn(async (childId: string) => {
      const child = spawnedChildren.find(c => c.id === childId);
      if (child) {
        await child.stop();
        const index = spawnedChildren.indexOf(child);
        if (index > -1) {
          spawnedChildren.splice(index, 1);
        }
      }
    }),

    getChildren: vi.fn(() => {
      const childrenMap = new Map<string, ActorRef<EventObject, unknown>>();
      spawnedChildren.forEach(child => {
        childrenMap.set(child.id, child as ActorRef<EventObject, unknown>);
      });
      return childrenMap as ReadonlyMap<string, ActorRef<EventObject, unknown>>;
    }),

    matches: vi.fn((statePath: string) => {
      const stateValue = currentSnapshot.value;
      if (typeof stateValue === 'string') {
        return stateValue === statePath;
      }
      // For nested states, this is a simplified implementation
      return false;
    }),

    accepts: vi.fn((_eventType: string) => {
      // Mock implementation - always return true for testing
      return true;
    }),
  };

  return mockRef;
}

/**
 * Test environment for actor tests
 */
export interface TestEnvironment {
  actors: Map<string, MockActorRef>;
  container: HTMLElement;
  cleanup: () => void;
  getActor: (id: string) => MockActorRef | undefined;
  getAllActors: () => MockActorRef[];
}

/**
 * Create a test environment for managing multiple actors
 */
export function createTestEnvironment(): TestEnvironment {
  const actors = new Map<string, MockActorRef>();
  
  // Create a test container
  const container = document.createElement('div');
  container.setAttribute('data-testid', 'test-container');
  document.body.appendChild(container);

  return {
    actors,
    container,

    cleanup: () => {
      // Stop all actors
      actors.forEach((actor) => {
        if (actor.status === 'running') {
          actor.stop();
        }
      });
      actors.clear();
      
      // Clean up DOM
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

    Object.entries(expected).forEach(([key, value]) => {
      if ((actual as Record<string, unknown>)[key] !== value) {
        throw new Error(
          `Event mismatch at index ${index}: ` +
            `expected ${key}=${value}, got ${key}=${(actual as Record<string, unknown>)[key]}`
        );
      }
    });
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
    subscribe(
      observerOrNext?: Observer<T> | ((value: T) => void),
      error?: (error: Error) => void,
      complete?: () => void
    ): Subscription {
      let observer: Observer<T>;
      if (typeof observerOrNext === 'function') {
        observer = { next: observerOrNext, error, complete };
      } else if (observerOrNext) {
        observer = observerOrNext;
      } else {
        observer = { next: () => {} };
      }

      observers.add(observer);
      
      let closed = false;
      return {
        unsubscribe: () => {
          observers.delete(observer);
          closed = true;
        },
        get closed() { return closed; }
      };
    },
    [Symbol.observable]() { return this; }
  };

  return {
    observable,
    emit: (value: T) => {
      observers.forEach((observer) => observer.next?.(value));
    },
    error: (error: Error) => {
      observers.forEach((observer) => observer.error?.(error));
    },
    complete: () => {
      observers.forEach((observer) => observer.complete?.());
    },
  };
}


/**
 * Performance test utilities
 */
export const performanceTestUtils = {
  /**
   * Assert that a function executes within a time limit
   */
  expectPerformant: async (fn: () => void | Promise<void>, maxMs: number) => {
    const start = performance.now();
    await fn();
    const duration = performance.now() - start;
    if (duration > maxMs) {
      throw new Error(`Performance test failed: ${duration}ms > ${maxMs}ms`);
    }
  },
  
  /**
   * Measure execution time
   */
  measure: async (fn: () => void | Promise<void>): Promise<number> => {
    const start = performance.now();
    await fn();
    return performance.now() - start;
  },
  
  /**
   * Measure render time
   */
  measureRenderTime: async (
    fn: () => void | Promise<void>, 
    iterations: number = 1
  ): Promise<{ average: number; max: number; min: number; total: number; samples: number[] }> => {
    const samples: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      // Wait for next animation frame to ensure render is complete
      await new Promise(resolve => requestAnimationFrame(resolve));
      samples.push(performance.now() - start);
    }
    
    const total = samples.reduce((a, b) => a + b, 0);
    const average = total / samples.length;
    const max = Math.max(...samples);
    const min = Math.min(...samples);
    
    return { average, max, min, total, samples };
  }
};

/**
 * Setup global mocks for testing
 */
export function setupGlobalMocks(): MockGlobalEventBus {
  // Mock window.crypto if not available
  if (typeof window !== "undefined" && !window.crypto) {
    Object.defineProperty(window, "crypto", {
      value: {
        randomUUID: () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        getRandomValues: (arr: Uint8Array) => {
          for (let i = 0; i < arr.length; i++) {
            arr[i] = Math.floor(Math.random() * 256);
          }
          return arr;
        }
      },
      writable: true
    });
  }
  
  // Mock requestAnimationFrame if not available
  if (typeof window !== "undefined" && !window.requestAnimationFrame) {
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      return setTimeout(() => callback(Date.now()), 16) as unknown as number;
    };
    window.cancelAnimationFrame = (id: number) => {
      clearTimeout(id);
    };
  }
  
  // Create and return mock event bus
  const eventListeners = new Map<string, Set<Function>>();
  
  const mockEventBus: MockGlobalEventBus = {
    send: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue({}),
    subscribe: vi.fn(),
    on: vi.fn().mockImplementation((event: string, handler: Function) => {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, new Set());
      }
      eventListeners.get(event)!.add(handler);
      return () => eventListeners.get(event)?.delete(handler);
    }),
    off: vi.fn().mockImplementation((event: string, handler: Function) => {
      eventListeners.get(event)?.delete(handler);
    }),
    // Additional helper for testing
    emit: (event: string, data?: unknown) => {
      const listeners = eventListeners.get(event);
      if (listeners) {
        listeners.forEach(listener => listener(data));
      }
    },
    clear: () => {
      eventListeners.clear();
      mockEventBus.send.mockClear();
      mockEventBus.getSnapshot.mockClear();
      mockEventBus.subscribe.mockClear();
      mockEventBus.on?.mockClear();
      mockEventBus.off?.mockClear();
    }
  };
  
  // Mock window.eventBus if needed
  if (typeof window !== 'undefined') {
    (window as unknown as { eventBus: MockGlobalEventBus }).eventBus = mockEventBus;
  }
  
  return mockEventBus;
}

/**
 * Mock global event bus interface
 */
export interface MockGlobalEventBus {
  send: ReturnType<typeof vi.fn>;
  getSnapshot: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  emit?: (event: string, data?: unknown) => void;
  on?: ReturnType<typeof vi.fn>;
  off?: ReturnType<typeof vi.fn>;
  clear?: () => void;
}


/**
 * Accessibility test utilities
 */
export const a11yTestUtils = {
  /**
   * Check if element is accessible
   */
  isAccessible: (element: Element): boolean => {
    const role = element.getAttribute("role");
    const ariaLabel = element.getAttribute("aria-label");
    const ariaLabelledBy = element.getAttribute("aria-labelledby");
    return !!(role || ariaLabel || ariaLabelledBy);
  },
  
  /**
   * Get accessible name
   */
  getAccessibleName: (element: Element): string => {
    return element.getAttribute("aria-label") || element.textContent || "";
  },
  
  /**
   * Expect element to be accessible with proper ARIA attributes
   */
  expectAccessible: (element: Element, options?: {
    role?: string;
    label?: string;
    description?: string;
    state?: Record<string, string>;
    [key: string]: string | Record<string, string> | undefined; // Allow any aria-* attributes
  }) => {
    if (options) {
      Object.entries(options).forEach(([key, value]) => {
        if (key === 'role' && typeof value === 'string') {
          expect(element.getAttribute('role')).toBe(value);
        } else if (key === 'label' && typeof value === 'string') {
          expect(element.getAttribute('aria-label')).toBe(value);
        } else if (key === 'description' && typeof value === 'string') {
          expect(element.getAttribute('aria-description')).toBe(value);
        } else if (key === 'state' && typeof value === 'object') {
          Object.entries(value).forEach(([attr, val]) => {
            expect(element.getAttribute(`aria-${attr}`)).toBe(val);
          });
        } else if (key.startsWith('aria') && typeof value === 'string') {
          // Handle camelCase aria attributes (e.g., ariaLabel -> aria-label)
          const ariaAttr = key.replace(/([A-Z])/g, '-$1').toLowerCase();
          expect(element.getAttribute(ariaAttr)).toBe(value);
        }
      });
    }
  },
  
  /**
   * Expect element to be keyboard accessible
   */
  expectKeyboardAccessible: (element: Element, options?: {
    tabindex?: string;
    focusable?: boolean;
  }) => {
    const tabindex = element.getAttribute('tabindex');
    if (options?.tabindex !== undefined) {
      expect(tabindex).toBe(options.tabindex);
    }
    if (options?.focusable) {
      expect(tabindex === '0' || tabindex === null).toBe(true);
    }
  },
  
  /**
   * Expect element to be properly labelled
   */
  expectLabelled: (element: Element, expectedLabel?: string) => {
    const ariaLabel = element.getAttribute('aria-label');
    const ariaLabelledBy = element.getAttribute('aria-labelledby');
    
    // If no expected label provided, just check that element is labelled
    if (!expectedLabel) {
      const hasLabel = !!(ariaLabel || ariaLabelledBy);
      expect(hasLabel).toBe(true);
      return;
    }
    
    // Check label matches expected value
    if (ariaLabel) {
      expect(ariaLabel).toBe(expectedLabel);
    } else if (ariaLabelledBy) {
      const labelElement = document.getElementById(ariaLabelledBy);
      expect(labelElement?.textContent).toBe(expectedLabel);
    } else {
      throw new Error('Element has no aria-label or aria-labelledby');
    }
  }
};

/**
 * User interaction utilities
 */
export const userInteractions = {
  /**
   * Click an element
   */
  click: (element: Element) => {
    const event = new MouseEvent("click", { bubbles: true });
    element.dispatchEvent(event);
  },
  
  /**
   * Type text into an input
   */
  type: (element: HTMLInputElement, text: string) => {
    element.value = text;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  },
  
  /**
   * Press a key
   */
  pressKey: (element: Element, key: string) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true });
    element.dispatchEvent(event);
  },
  
  /**
   * Trigger keydown event
   */
  keydown: (target: Element | Document, key: string, options?: KeyboardEventInit) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, ...options });
    target.dispatchEvent(event);
  },
  
  /**
   * Trigger keyup event
   */
  keyup: (element: Element, key: string, options?: KeyboardEventInit) => {
    const event = new KeyboardEvent("keyup", { key, bubbles: true, ...options });
    element.dispatchEvent(event);
  },
  
  /**
   * Focus an element
   */
  focus: (element: HTMLElement) => {
    element.focus();
    element.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  },
  
  /**
   * Blur an element
   */
  blur: (element: HTMLElement) => {
    element.blur();
    element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  },
  
  /**
   * Trigger input event
   */
  input: (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
};

/**
 * Wait utilities
 */
export async function waitFor<T>(
  fn: () => T | Promise<T>,
  options: { timeout?: number; interval?: number } = {}
): Promise<T> {
  const { timeout = 1000, interval = 50 } = options;
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    try {
      const result = await fn();
      if (result) return result;
    } catch {
      // Continue waiting
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Component utilities
 */
export const componentUtils = {
  /**
   * Mount a component to the DOM
   */
  mount: (component: Element, container: Element) => {
    container.appendChild(component);
  },
  
  /**
   * Unmount a component
   */
  unmount: (component: Element) => {
    component.remove();
  },
  
  /**
   * Get shadow DOM content
   */
  getShadowContent: (element: Element): ShadowRoot | null => {
    return (element as HTMLElement).shadowRoot;
  },
  
  /**
   * Query within shadow DOM
   */
  queryInShadow: <T extends Element = Element>(element: Element, selector: string): T | null => {
    const shadow = (element as HTMLElement).shadowRoot;
    if (!shadow) return null;
    return shadow.querySelector<T>(selector);
  },
  
  /**
   * Query all within shadow DOM
   */
  queryAllInShadow: <T extends Element = Element>(element: Element, selector: string): NodeListOf<T> => {
    const shadow = (element as HTMLElement).shadowRoot;
    if (!shadow) return document.querySelectorAll<T>('never-match');
    return shadow.querySelectorAll<T>(selector);
  },
  
  /**
   * Wait for component to be ready
   */
  waitForReady: async (element: Element, timeout = 1000): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if ((element as any).componentReady) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Component not ready within timeout');
  }
};
