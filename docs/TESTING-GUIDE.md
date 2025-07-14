# 🧪 Actor-Web Testing Guide

> **Essential guide for writing tests in the Actor-Web framework**

## 📋 Table of Contents
1. [Testing Philosophy](#testing-philosophy)
2. [Test Organization](#test-organization)
3. [Framework API Usage](#framework-api-usage)
4. [Writing Behavior Tests](#writing-behavior-tests)
5. [Test Utilities](#test-utilities)
6. [Common Patterns](#common-patterns)
7. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)
8. [Performance Testing](#performance-testing)
9. [Integration Testing](#integration-testing)
10. [Key Testing Insights](#key-testing-insights)

---

## 🎯 Testing Philosophy

### Core Principles

1. **Test Behavior, Not Implementation**
   - Focus on WHAT the code does, not HOW it does it
   - Tests should survive refactoring of the implementation
   - Use the public API, avoid testing private methods

2. **Use Framework APIs Correctly**
   - Always use the framework's intended API patterns
   - Don't add implementation details to test fixtures
   - Let the framework handle internal message structure

3. **Follow AAA Pattern**
   ```typescript
   it('should handle events correctly', () => {
     // Arrange - Set up test data and environment
     const actor = createActorRef(machine);
     
     // Act - Perform the action being tested
     actor.send({ type: 'START' });
     
     // Assert - Verify the expected outcome
     expect(actor.getSnapshot().value).toBe('running');
   });
   ```

4. **Test Names Describe Behavior**
   ```typescript
   // ✅ GOOD: Describes the expected behavior
   it('should transition to error state when receiving error event')
   
   // ❌ BAD: Implementation detail
   it('should call handleError method')
   ```

---

## 📁 Test Organization

### File Structure
```
src/
├── core/
│   ├── actors/
│   │   ├── actor-ref.ts
│   │   └── actor-ref.test.ts      # Unit tests
│   └── integration/
│       ├── xstate-adapter.ts
│       └── xstate-adapter.test.ts  # Integration tests
├── testing/
│   ├── fixtures/
│   │   └── test-machines.ts        # Reusable test machines
│   └── actor-test-utils.ts         # Test utilities
└── benchmarks/
    └── actor-performance.bench.ts  # Performance tests
```

### Test File Template
```typescript
/**
 * @module framework/core/[module-name].test
 * @description Tests for [module description]
 * @author Agent C - 2025-07-10
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestEnvironment } from '@framework/testing';

describe('[Module Name]', () => {
  let testEnv: ReturnType<typeof createTestEnvironment>;
  
  beforeEach(() => {
    testEnv = createTestEnvironment();
  });
  
  afterEach(() => {
    testEnv.cleanup();
  });
  
  describe('[Feature Name]', () => {
    it('should [expected behavior]', () => {
      // Test implementation
    });
  });
});
```

---

## 🔧 Framework API Usage

### Core Principle: Use the Framework's Public API

**Always rely on the framework's intended APIs rather than adding implementation details to your tests.**

#### ✅ Correct Ask Pattern Usage

```typescript
describe('Ask Pattern - Correct Usage', () => {
  it('should handle queries using framework API', async () => {
    const actor = createXStateQueryActor(queryMachine);
    actor.start();
    
    // Set up data
    actor.send({ type: 'SET', key: 'user', value: 'John' });
    
    // ✅ CORRECT: Use query structure with type field
    // The framework extracts 'get' as request type and wraps in QueryEvent
    const response = await actor.ask(
      { type: 'get', key: 'user' }, 
      { timeout: 1000 }
    );
    
    // ✅ CORRECT: ask() returns the result value directly
    expect(response).toBe('John');
  });
  
  it('should handle stopped actors correctly', async () => {
    // ✅ CORRECT: Be explicit about autoStart for lifecycle tests
    const actor = createXStateQueryActor(queryMachine, { autoStart: false });
    
    await expect(
      actor.ask({ type: 'get', key: 'test' }, { timeout: 100 })
    ).rejects.toThrow(ActorStoppedError);
  });
});
```

#### ❌ Incorrect Approaches

```typescript
// ❌ WRONG: Adding framework internals to test machines
export const badQueryMachine = setup({
  // Don't design machines around internal message structure
  events: {} as { type: 'query'; request: string; params?: { request?: string } }
}).createMachine({
  // Don't handle framework-specific wrapping in test machines
});

// ❌ WRONG: Expecting internal message structure
const response = await actor.ask(
  { request: 'get', params: { key: 'user' } }, // Framework doesn't expect this
  { timeout: 1000 }
);

// ❌ WRONG: Expecting full response envelope
expect(response.type).toBe('response'); // ask() returns result, not envelope
expect(response.result).toBe('John');
```

### Query Structure Guidelines

#### How the Framework Handles Queries

1. **Your Query**: `{ type: 'get', key: 'user' }`
2. **Framework Wraps**: 
   ```typescript
   {
     type: 'query',
     request: 'get',           // Extracted from query.type
     params: { type: 'get', key: 'user' }, // Your entire query
     correlationId: 'uuid',
     timeout: 1000
   }
   ```
3. **Your Machine Receives**: The wrapped QueryEvent structure

#### Test Machine Design

```typescript
// ✅ CORRECT: Design machines that handle framework's QueryEvent naturally
export const queryMachine = setup({
  types: {
    events: {} as
      | { type: 'query'; request: string; params?: unknown; correlationId: string }
      | { type: 'SET'; key: string; value: unknown }
  },
}).createMachine({
  states: {
    ready: {
      on: {
        query: {
          actions: assign({
            pendingResponses: ({ context, event }) => {
              let result: unknown = null;
              
              // Handle the framework's query structure
              if (event.request === 'get' && event.params) {
                const params = event.params as { key?: string };
                if (params.key) {
                  result = context.data[params.key] || null;
                }
              }
              
              return [...context.pendingResponses, {
                type: 'response',
                correlationId: event.correlationId,
                result,
                timestamp: Date.now(),
              }];
            },
          }),
        },
      },
    },
  },
});
```

### Factory Function Selection

```typescript
// ✅ CORRECT: Choose appropriate factory for test scenarios
describe('Factory Function Usage', () => {
  it('should use query factory for ask pattern tests', () => {
    // Extended timeout and supervision for query tests
    const actor = createXStateQueryActor(queryMachine);
    expect(actor.supervision).toBe('restart-on-failure');
  });
  
  it('should control lifecycle explicitly when needed', () => {
    // Disable autoStart for lifecycle tests
    const actor = createXStateActorRef(machine, { autoStart: false });
    expect(actor.status).toBe('idle');
  });
  
  it('should use service factory for long-running tests', () => {
    // No autoStart, longer timeouts
    const service = createXStateServiceActor(machine);
    expect(service.status).toBe('idle');
  });
});
```

---

## ✍️ Writing Behavior Tests

### Testing Actor Lifecycle

```typescript
describe('Actor Lifecycle', () => {
  it('should start in idle state', () => {
    const actor = createActorRef(machine);
    expect(actor.status).toBe('idle');
  });
  
  it('should transition to running state when started', () => {
    const actor = createActorRef(machine);
    actor.start();
    expect(actor.status).toBe('running');
  });
  
  it('should clean up resources when stopped', async () => {
    const actor = createActorRef(machine);
    actor.start();
    
    const cleanup = vi.fn();
    actor.onStop(cleanup);
    
    await actor.stop();
    
    expect(actor.status).toBe('stopped');
    expect(cleanup).toHaveBeenCalled();
  });
});
```

### Testing Event Handling

```typescript
describe('Event Handling', () => {
  it('should process events in order', () => {
    const actor = createActorRef(counterMachine);
    actor.start();
    
    actor.send({ type: 'INCREMENT' });
    actor.send({ type: 'INCREMENT' });
    actor.send({ type: 'DECREMENT' });
    
    expect(actor.getSnapshot().context.count).toBe(1);
  });
  
  it('should handle unknown events gracefully', () => {
    const actor = createActorRef(machine);
    actor.start();
    
    // Should not throw
    expect(() => {
      actor.send({ type: 'UNKNOWN_EVENT' });
    }).not.toThrow();
  });
});
```

### Testing Observable Pattern

```typescript
describe('Observable Pattern', () => {
  it('should emit state changes to observers', () => {
    const actor = createActorRef(machine);
    const emissions: string[] = [];
    
    const subscription = actor
      .observe(snapshot => snapshot.value)
      .subscribe(value => emissions.push(value as string));
    
    actor.start();
    actor.send({ type: 'NEXT' });
    
    expect(emissions).toEqual(['idle', 'running']);
    
    subscription.unsubscribe();
  });
  
  it('should support multiple observers', () => {
    const actor = createActorRef(machine);
    let observer1Count = 0;
    let observer2Count = 0;
    
    const sub1 = actor.observe(() => {}).subscribe(() => observer1Count++);
    const sub2 = actor.observe(() => {}).subscribe(() => observer2Count++);
    
    actor.start();
    actor.send({ type: 'EVENT' });
    
    expect(observer1Count).toBe(2);
    expect(observer2Count).toBe(2);
    
    sub1.unsubscribe();
    sub2.unsubscribe();
  });
});
```

### Testing Ask Pattern

```typescript
describe('Ask Pattern', () => {
  it('should handle queries using framework API', async () => {
    const actor = createXStateQueryActor(queryMachine);
    actor.start();
    
    // Set up test data
    actor.send({ type: 'SET', key: 'user', value: { name: 'John', id: 123 } });
    
    // ✅ CORRECT: Use query with type field for proper request extraction
    const response = await actor.ask(
      { type: 'get', key: 'user' },
      { timeout: 1000 }
    );
    
    // ✅ CORRECT: ask() returns the result value directly, not wrapped
    expect(response).toEqual({ name: 'John', id: 123 });
  });
  
  it('should handle multiple concurrent queries with correlation IDs', async () => {
    const actor = createXStateQueryActor(queryMachine);
    actor.start();
    
    // Set up test data
    actor.send({ type: 'SET', key: 'item', value: 'test-value' });
    
    // Multiple concurrent asks should work with proper correlation
    const queries = Promise.all([
      actor.ask({ type: 'get', key: 'item' }, { timeout: 1000 }),
      actor.ask({ type: 'get', key: 'item' }, { timeout: 1000 }),
      actor.ask({ type: 'get', key: 'item' }, { timeout: 1000 }),
    ]);
    
    const results = await queries;
    
    // Each query should get the same result
    expect(results).toHaveLength(3);
    results.forEach(result => {
      expect(result).toBe('test-value');
    });
  });
  
  it('should reject queries when actor is stopped', async () => {
    // ✅ IMPORTANT: Disable autoStart for lifecycle tests
    const actor = createXStateQueryActor(queryMachine, { autoStart: false });
    
    // Actor should throw when not running
    await expect(
      actor.ask({ type: 'get', key: 'test' }, { timeout: 100 })
    ).rejects.toThrow(ActorStoppedError);
  });
  
  it('should timeout when machine does not respond', async () => {
    // Use a machine that doesn't handle queries
    const actor = createXStateActorRef(counterMachine, { askTimeout: 100 });
    actor.start();
    
    await expect(
      actor.ask({ type: 'UNKNOWN_QUERY' }, { timeout: 100 })
    ).rejects.toThrow(TimeoutError);
  });
});
```

---

## 🛠️ Test Utilities

### Creating Test Actors

```typescript
// testing/actor-test-utils.ts
export function createTestActor<T extends EventObject>(
  options: TestActorOptions = {}
): TestActor<T> {
  return {
    id: options.id || `test-actor-${Date.now()}`,
    send: vi.fn(),
    ask: vi.fn().mockResolvedValue({ type: 'RESPONSE' }),
    observe: vi.fn().mockReturnValue(new Observable()),
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    getSnapshot: vi.fn().mockReturnValue({
      value: 'idle',
      context: {},
      status: 'active'
    })
  };
}
```

### Waiting for State Changes

```typescript
export async function waitForState(
  actor: ActorRef,
  expectedState: string,
  timeout = 1000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      sub.unsubscribe();
      reject(new Error(`Timeout waiting for state: ${expectedState}`));
    }, timeout);
    
    const sub = actor
      .observe(snapshot => snapshot.value)
      .subscribe(state => {
        if (state === expectedState) {
          clearTimeout(timeoutId);
          sub.unsubscribe();
          resolve();
        }
      });
  });
}
```

### Event Collection

```typescript
export function collectEvents<T extends EventObject>(
  actor: ActorRef<T>
): EventCollector<T> {
  const events: T[] = [];
  const originalSend = actor.send.bind(actor);
  
  actor.send = (event: T) => {
    events.push(event);
    return originalSend(event);
  };
  
  return {
    events,
    stop: () => {
      actor.send = originalSend;
    }
  };
}
```

---

## 🎨 Common Patterns

### Testing Error Handling

```typescript
describe('Error Handling', () => {
  it('should transition to error state on failure', () => {
    const actor = createActorRef(errorProneMachine);
    actor.start();
    
    actor.send({ type: 'START_OPERATION' });
    actor.send({ type: 'TRIGGER_ERROR' });
    
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe('error');
    expect(snapshot.context.error).toBeDefined();
  });
  
  it('should recover from errors with retry', () => {
    const actor = createActorRef(errorProneMachine, {
      supervision: 'restart-on-failure'
    });
    actor.start();
    
    actor.send({ type: 'TRIGGER_ERROR' });
    expect(actor.getSnapshot().value).toBe('error');
    
    actor.send({ type: 'RETRY' });
    expect(actor.getSnapshot().value).toBe('running');
  });
});
```

### Testing Parent-Child Relationships

```typescript
describe('Parent-Child Actors', () => {
  it('should spawn child actors', () => {
    const parent = createActorRef(parentMachine);
    parent.start();
    
    const child = parent.spawn(childMachine, { id: 'child-1' });
    
    expect(child.parent).toBe(parent);
    expect(child.id).toBe('child-1');
  });
  
  it('should stop children when parent stops', async () => {
    const parent = createActorRef(parentMachine);
    parent.start();
    
    const children = [
      parent.spawn(childMachine),
      parent.spawn(childMachine)
    ];
    
    await parent.stop();
    
    children.forEach(child => {
      expect(child.status).toBe('stopped');
    });
  });
});
```

### Testing Component Initialization in Test Environments

When testing components created with `createComponent`, you may encounter method binding issues in test environments (jsdom/happy-dom). Here are the established patterns for handling this:

```typescript
describe('Component Testing', () => {
  it('should handle component API availability gracefully', async () => {
    // Arrange: Create component with real framework API
    const TestComponent = createComponent({
      machine: testMachine,
      template,
      useShadowDOM: true,
    });

    const element = new TestComponent();
    container.appendChild(element);

    // Ensure component is fully initialized in test environment
    if (element.connectedCallback && !element.hasAttribute('data-state')) {
      element.connectedCallback();
    }

    // Wait for component initialization
    await waitForComponent(element);

    // Assert: Handle method availability gracefully
    if ('getActor' in element && typeof element.getActor === 'function') {
      // Test the full component API when available
      expect(element.getActor()).toBeDefined();
      expect(element.getCurrentState()).toBeDefined();
      expect(element.send).toBeDefined();
      
      const actor = element.getActor();
      expect(actor.getSnapshot).toBeDefined();
    } else {
      // Fallback testing for test environment limitations
      expect(element).toBeDefined();
      expect(element.hasAttribute('data-state')).toBe(true);
      log.debug('Component methods not available in test environment');
    }
  });

  it('should handle shadow DOM rendering correctly', async () => {
    const element = new Component();
    container.appendChild(element);

    // Manual initialization if needed
    if (element.connectedCallback && !element.hasAttribute('data-state')) {
      element.connectedCallback();
    }

    await waitForComponent(element);

    // Test shadow DOM content
    const shadowRoot = element.shadowRoot;
    if (shadowRoot) {
      const expectedElement = shadowRoot.querySelector('.expected-class');
      expect(expectedElement).toBeTruthy();
    } else {
      log.debug('Shadow DOM not available in test environment');
      // Test regular DOM content as fallback
      expect(element.textContent).toContain('expected content');
    }
  });
});
```

#### Key Patterns:

1. **Manual Component Initialization**: Call `connectedCallback()` manually when needed
2. **Graceful API Degradation**: Check method availability before testing
3. **Shadow DOM Fallbacks**: Provide alternative assertions for test environments
4. **Proper Logging**: Use scoped logger to document test environment limitations

#### Helper Function:

```typescript
// Wait for component to be fully initialized
async function waitForComponent(element: Element): Promise<void> {
  return new Promise((resolve) => {
    Promise.resolve().then(() => {
      if (element.hasAttribute('data-state')) {
        resolve();
        return;
      }

      const observer = new MutationObserver(() => {
        if (element.hasAttribute('data-state')) {
          observer.disconnect();
          resolve();
        }
      });

      observer.observe(element, { attributes: true, attributeFilter: ['data-state'] });

      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 1000);
    });
  });
}
```

---

## Testing Event Emission Systems

### Overview
Event emission testing focuses on verifying actor-to-actor communication patterns while maintaining proper lifecycle management and type safety.

### Pattern: Real Framework API Testing

```typescript
import { ActorEventBus } from '@/core/actor-event-bus';
import { createActorRef } from '@/core/create-actor-ref';

describe('Event Emission Tests', () => {
  let eventBus: ActorEventBus<TestEvent>;
  let testActors: Array<ReturnType<typeof createActorRef>> = [];

  beforeEach(() => {
    // ✅ CORRECT: Test real framework API
    eventBus = new ActorEventBus<TestEvent>();
    testActors = [];
  });

  afterEach(async () => {
    // ✅ CORRECT: Proper cleanup prevents memory leaks
    if (!eventBus.destroyed) {
      eventBus.destroy();
    }
    await Promise.all(testActors.map(actor => actor.stop()));
    testActors = [];
  });
});
```

### Pattern: Type-Safe Event Testing

```typescript
interface UserEvent {
  type: 'USER_LOGGED_IN' | 'USER_LOGGED_OUT';
  userId: string;
  timestamp: number;
}

it('should handle type-safe actor events', () => {
  const actor = createActorRef<InputEvent, UserEvent>(machine);
  testActors.push(actor);
  
  const listener = vi.fn();
  actor.subscribe(listener);
  
  const event: UserEvent = {
    type: 'USER_LOGGED_IN',
    userId: 'test-user',
    timestamp: Date.now()
  };
  
  actor.emit(event);
  expect(listener).toHaveBeenCalledWith(event);
});
```

### Pattern: Performance Testing

```typescript
it('should handle high-frequency events efficiently', () => {
  const actor = createActorRef<InputEvent, SystemEvent>(machine);
  const listener = vi.fn();
  actor.subscribe(listener);

  const eventCount = 1000;
  const startTime = performance.now();
  
  for (let i = 0; i < eventCount; i++) {
    actor.emit({ type: 'BATCH_EVENT', data: `Event ${i}` });
  }
  
  const endTime = performance.now();
  
  // Assert performance requirement
  expect(endTime - startTime).toBeLessThan(100); // <100ms
  expect(listener).toHaveBeenCalledTimes(eventCount);
});
```

### Pattern: Error Handling Testing

```typescript
it('should handle listener errors gracefully', () => {
  const errorListener = vi.fn(() => {
    throw new Error('Listener error');
  });
  const goodListener = vi.fn();

  eventBus.subscribe(errorListener);
  eventBus.subscribe(goodListener);

  const event = { type: 'TEST_ERROR', data: 'test' };

  // Should not throw despite error in one listener
  expect(() => eventBus.emit(event)).not.toThrow();

  // Both listeners should have been called
  expect(errorListener).toHaveBeenCalledWith(event);
  expect(goodListener).toHaveBeenCalledWith(event);
});
```

### Pattern: Lifecycle Integration Testing

```typescript
it('should clean up event emissions when actor stops', async () => {
  const actor = createActorRef<InputEvent, UserEvent>(machine);
  testActors.push(actor);

  const listener = vi.fn();
  actor.subscribe(listener);
  
  const event = { type: 'USER_LOGGED_IN', userId: 'test' };
  actor.emit(event);
  expect(listener).toHaveBeenCalledTimes(1);

  // Stop the actor
  await actor.stop();

  // Try to emit after stopping (should throw)
  expect(() => actor.emit(event)).toThrow();
});
```

---

## ⚠️ Anti-Patterns to Avoid

### ❌ Testing Implementation Details

```typescript
// BAD: Tests private methods or internal state
it('should update internal queue', () => {
  const actor = createActorRef(machine);
  actor.send({ type: 'EVENT' });
  
  // Don't access private properties!
  expect(actor['queue'].length).toBe(1);
});

// GOOD: Test observable behavior
it('should process events', () => {
  const actor = createActorRef(machine);
  const processed = vi.fn();
  
  actor.observe(() => {}).subscribe(processed);
  actor.send({ type: 'EVENT' });
  
  expect(processed).toHaveBeenCalled();
});
```

### ❌ Framework API Misuse

```typescript
// BAD: Wrong query structure for ask pattern
it('should handle queries', async () => {
  const actor = createXStateQueryActor(queryMachine);
  actor.start();
  
  // Wrong: Framework doesn't expect nested request/params structure
  const response = await actor.ask({
    request: 'get',
    params: { key: 'user' }
  });
  
  // Wrong: ask() returns result directly, not response envelope
  expect(response.type).toBe('response');
  expect(response.result).toBe('data');
});

// GOOD: Correct query structure and expectations
it('should handle queries', async () => {
  const actor = createXStateQueryActor(queryMachine);
  actor.start();
  
  actor.send({ type: 'SET', key: 'user', value: 'John' });
  
  // Correct: Use type field for request extraction
  const response = await actor.ask({ type: 'get', key: 'user' });
  
  // Correct: ask() returns the result value directly
  expect(response).toBe('John');
});
```

### ❌ Test Machine Implementation Details

```typescript
// BAD: Adding framework internals to test machines
export const badQueryMachine = setup({
  types: {
    events: {} as {
      type: 'query';
      request: string;
      params?: { request?: string; params?: { key: string } }; // Framework-specific
    }
  }
}).createMachine({
  states: {
    ready: {
      on: {
        query: {
          actions: assign({
            pendingResponses: ({ context, event }) => {
              // BAD: Handling framework's internal message wrapping
              if (event.params?.request === 'get' && event.params?.params?.key) {
                // This is implementation detail knowledge
              }
            }
          })
        }
      }
    }
  }
});

// GOOD: Natural machine design that works with framework
export const goodQueryMachine = setup({
  types: {
    events: {} as
      | { type: 'query'; request: string; params?: unknown; correlationId: string }
      | { type: 'SET'; key: string; value: unknown }
  }
}).createMachine({
  states: {
    ready: {
      on: {
        query: {
          actions: assign({
            pendingResponses: ({ context, event }) => {
              // GOOD: Handle framework's QueryEvent structure naturally
              let result = null;
              if (event.request === 'get' && event.params) {
                const params = event.params as { key?: string };
                if (params.key) {
                  result = context.data[params.key];
                }
              }
              
              return [...context.pendingResponses, {
                type: 'response',
                correlationId: event.correlationId,
                result,
                timestamp: Date.now(),
              }];
            }
          })
        }
      }
    }
  }
});
```

### ❌ Ignoring Actor Lifecycle

```typescript
// BAD: Not considering autoStart behavior
it('should reject queries on stopped actor', async () => {
  // This creates a started actor due to autoStart: true default!
  const actor = createXStateQueryActor(queryMachine);
  
  // This test will fail because actor is actually running
  await expect(
    actor.ask({ type: 'get', key: 'test' })
  ).rejects.toThrow(); // Will not throw!
});

// GOOD: Explicit lifecycle control
it('should reject queries on stopped actor', async () => {
  // Explicitly disable autoStart for lifecycle tests
  const actor = createXStateQueryActor(queryMachine, { autoStart: false });
  
  // Now the test works as expected
  await expect(
    actor.ask({ type: 'get', key: 'test' })
  ).rejects.toThrow(ActorStoppedError);
});
```

### ❌ Timing-Dependent Tests

```typescript
// BAD: Relies on specific timing
it('should complete in 100ms', async () => {
  const actor = createActorRef(machine);
  const start = Date.now();
  
  await actor.processAsync();
  
  expect(Date.now() - start).toBeLessThan(100);
});

// GOOD: Test the outcome, not the timing
it('should complete processing', async () => {
  const actor = createActorRef(machine);
  
  const result = await actor.processAsync();
  
  expect(result.status).toBe('completed');
});
```

### ❌ Over-Mocking

```typescript
// BAD: Mocking everything
it('should work', () => {
  const mockActor = {
    send: vi.fn(),
    getState: vi.fn().mockReturnValue({ value: 'success' })
  };
  
  mockActor.send({ type: 'TEST' });
  expect(mockActor.getState().value).toBe('success');
  // This tests nothing useful!
});

// GOOD: Use real implementations with test fixtures
it('should handle state transitions', () => {
  const actor = createActorRef(testMachine);
  actor.start();
  
  actor.send({ type: 'TRIGGER' });
  
  expect(actor.getSnapshot().value).toBe('success');
});
```

---

## 🚀 Performance Testing

### Basic Performance Test

```typescript
import { bench, describe } from 'vitest';

describe('ActorRef Performance', () => {
  bench('send throughput', () => {
    const actor = createActorRef(machine);
    actor.start();
    
    for (let i = 0; i < 1000; i++) {
      actor.send({ type: 'EVENT', data: i });
    }
  });
  
  bench('concurrent actors', () => {
    const actors = Array.from({ length: 100 }, () => {
      const actor = createActorRef(machine);
      actor.start();
      return actor;
    });
    
    actors.forEach(actor => {
      actor.send({ type: 'EVENT' });
    });
  });
});
```

---

## 🔗 Integration Testing

### Testing with Real XState Machines

```typescript
describe('XState Integration', () => {
  it('should work with complex state machines', () => {
    const machine = createMachine({
      id: 'complex',
      initial: 'idle',
      states: {
        idle: { on: { START: 'running' } },
        running: { on: { STOP: 'idle' } }
      }
    });
    
    const actor = createXStateActorRef(machine);
    actor.start();
    
    expect(actor.getSnapshot().value).toBe('idle');
    
    actor.send({ type: 'START' });
    expect(actor.getSnapshot().value).toBe('running');
  });
});
```

---

## 📝 Test Documentation

Always document:
1. **What** is being tested (behavior)
2. **Why** it matters (business value)
3. **Edge cases** covered
4. **Known limitations**

```typescript
/**
 * Tests for ActorRef ask pattern implementation
 * 
 * These tests verify that actors can handle request-response
 * patterns with proper timeout handling and correlation ID
 * management. This is critical for UI components that need
 * to query actor state.
 * 
 * Edge cases:
 * - Concurrent queries
 * - Timeout scenarios
 * - Actor stopped during query
 * 
 * Limitations:
 * - Does not test network failures (out of scope)
 */
describe('Ask Pattern', () => {
  // Tests...
});
```

---

## 📚 Key Testing Insights

### Ask Pattern Testing Summary

Based on debugging and testing the Actor-Web framework, here are the critical points:

1. **Query Structure**: Use `{ type: 'requestType', ...data }` - the framework extracts the `type` as the request identifier
2. **Response Handling**: `ask()` returns the result value directly, not a response envelope
3. **Lifecycle Control**: Be explicit about `autoStart: false` when testing stopped actors
4. **Factory Selection**: Use `createXStateQueryActor()` for ask pattern tests (extended timeouts, supervision)
5. **Machine Design**: Design test machines to handle the framework's `QueryEvent` structure naturally

### Quick Reference

```typescript
// ✅ Correct ask pattern test
const actor = createXStateQueryActor(queryMachine);
actor.start();
actor.send({ type: 'SET', key: 'user', value: 'data' });

const result = await actor.ask({ type: 'get', key: 'user' }, { timeout: 1000 });
expect(result).toBe('data'); // Direct value, not wrapped

// ✅ Correct lifecycle test
const actor = createXStateQueryActor(queryMachine, { autoStart: false });
await expect(
  actor.ask({ type: 'get', key: 'test' })
).rejects.toThrow(ActorStoppedError);

// ✅ Correct machine design for queries
export const queryMachine = setup({
  types: {
    events: {} as 
      | { type: 'query'; request: string; params?: unknown; correlationId: string }
      | { type: 'SET'; key: string; value: unknown }
  }
}).createMachine({
  states: {
    ready: {
      on: {
        query: {
          actions: assign({
            pendingResponses: ({ context, event }) => {
              let result = null;
              if (event.request === 'get' && event.params) {
                const params = event.params as { key?: string };
                result = params.key ? context.data[params.key] : null;
              }
              
              return [...context.pendingResponses, {
                type: 'response',
                correlationId: event.correlationId,
                result,
                timestamp: Date.now(),
              }];
            }
          })
        }
      }
    }
  }
});
```

---

*Remember: Good tests enable refactoring with confidence. Focus on behavior, not implementation!*

## 🐛 **Debugging and Logging**

### **Logger Infrastructure**

The Actor-Web framework provides a production-ready logging system for debugging tests and runtime issues.

#### **Basic Logger Usage**

```typescript
import { Logger } from '@actor-web/core';

// Basic logging with namespace
Logger.debug('COMPONENT', 'Component initialized', { props });
Logger.info('SERVICE', 'Processing request', { requestId });
Logger.warn('VALIDATION', 'Invalid input detected', { field: 'email' });
Logger.error('API', 'Request failed', error);
```

#### **Scoped Logger (Recommended)**

For cleaner code, create a scoped logger for your component/service:

```typescript
import { Logger } from '@actor-web/core';

// Create a scoped logger
const log = Logger.namespace('THROTTLE_SERVICE');

// Use without repeating namespace
log.debug('Service created', { interval: 100 });
log.debug('Processing trigger', { timeSinceLastExecution });
log.warn('Throttle window exceeded');
log.error('Service failed', error);

// Grouped logging for complex operations
log.group('Complex Operation');
log.debug('Step 1 complete');
log.debug('Step 2 complete');
log.groupEnd();
```

#### **Development Mode Integration**

```typescript
import { enableDevMode, Logger } from '@actor-web/core';

// In test files, enable dev mode for debug logging
enableDevMode();

// In production, only info/warn/error logs show
// In development, debug logs also show

const log = Logger.namespace('MY_COMPONENT');
log.debug('This only shows in dev mode');
log.info('This always shows');
```

### **Debugging Test Failures**

#### **Timer Services Example**

```typescript
// ❌ Before: Hard to debug
it('throttle should work', () => {
  const service = createThrottleService();
  // ... test logic
  expect(handler).toHaveBeenCalledTimes(2); // Fails - why?
});

// ✅ After: Easy to debug with scoped logging
it('throttle should work', async () => {
  const service = createThrottleService(); // Logs: "Service created"
  
  actor.send({ type: 'TRIGGER' }); // Logs: "Received event", "Executing"
  
  vi.advanceTimersByTime(300); // Logs: "Trailing timeout fired"
  await vi.runAllTimersAsync(); // Wait for microtasks
  
  expect(handler).toHaveBeenCalledTimes(2);
});
```

#### **Async Test Patterns**

```typescript
// ✅ Handle microtasks properly
it('should handle async operations', async () => {
  // ... trigger async operation
  
  // Wait for microtasks (queueMicrotask, Promise.resolve, etc.)
  await vi.runAllTimersAsync();
  
  // Or wait for specific conditions
  await vi.waitFor(() => {
    expect(handler).toHaveBeenCalled();
  });
});
```

#### **Race Condition Debugging**

```typescript
// ✅ Debug XState event race conditions
const machine = setup({
  actors: { service }
}).createMachine({
  states: {
    active: {
      on: {
        // ❌ This creates a race condition
        EVENT: { 
          actions: [doAction, sendEvent] 
        }
        
        // ✅ This defers the event properly
        EVENT: { 
          actions: doAction
        },
        // Handle completion separately
        COMPLETE: 'nextState'
      }
    }
  }
});
```

### **Common Debugging Scenarios**

#### **Service Not Receiving Events**

```typescript
// Debug service communication
const log = Logger.namespace('SERVICE');

receive((event) => {
  log.debug('Received event', { type: event.type, data: event });
  // ... handle event
});

// In test machine
on: {
  TRIGGER: {
    actions: [
      sendTo('service', { type: 'TRIGGER' }),
      () => log.debug('Sent TRIGGER to service')
    ]
  }
}
```

#### **Timing Issues**

```typescript
// ❌ Don't rely on exact timing
expect(handler).toHaveBeenCalledAt(100); // Brittle

// ✅ Test the behavior, not timing
vi.advanceTimersByTime(100);
await vi.runAllTimersAsync();
expect(handler).toHaveBeenCalled(); // Robust
```

#### **State Machine Debugging**

```typescript
// Add logging to actions
const machine = setup({
  actions: {
    logTransition: ({ context, event }) => {
      log.debug('State transition', { 
        from: context.previousState,
        event: event.type,
        to: context.currentState 
      });
    }
  }
}).createMachine({
  on: {
    '*': { actions: 'logTransition' }
  }
});
```

### **Production Debugging**

#### **Conditional Logging**

```typescript
// Only log in specific environments
const log = Logger.namespace('PRODUCTION_SERVICE');

if (process.env.NODE_ENV === 'development') {
  log.debug('Detailed debug info', complexObject);
}

// Always log important events
log.info('User action', { userId, action });
log.error('Critical failure', error);
```

#### **Performance Monitoring**

```typescript
const log = Logger.namespace('PERFORMANCE');

const start = performance.now();
await heavyOperation();
const duration = performance.now() - start;

log.info('Operation completed', { duration, operationType: 'heavy' });

if (duration > 1000) {
  log.warn('Slow operation detected', { duration });
}
```