# 🧪 Actor-Web Testing Guide

> **Essential guide for writing tests in the Actor-Web framework**

## 📋 Table of Contents
1. [Testing Philosophy](#testing-philosophy)
2. [Test Organization](#test-organization)
3. [Writing Behavior Tests](#writing-behavior-tests)
4. [Test Utilities](#test-utilities)
5. [Common Patterns](#common-patterns)
6. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)
7. [Performance Testing](#performance-testing)
8. [Integration Testing](#integration-testing)

---

## 🎯 Testing Philosophy

### Core Principles

1. **Test Behavior, Not Implementation**
   - Focus on WHAT the code does, not HOW it does it
   - Tests should survive refactoring of the implementation
   - Use the public API, avoid testing private methods

2. **Follow AAA Pattern**
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

3. **Test Names Describe Behavior**
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
  it('should respond to queries within timeout', async () => {
    const actor = createActorRef(queryMachine);
    actor.start();
    
    // Set up the actor to handle queries
    actor.send({ type: 'ENABLE_QUERY_HANDLING' });
    
    const response = await actor.ask(
      { type: 'GET_DATA', key: 'user' },
      { timeout: 1000 }
    );
    
    expect(response.type).toBe('DATA_RESPONSE');
    expect(response.data).toBeDefined();
  });
  
  it('should timeout when no response received', async () => {
    const actor = createActorRef(machine);
    actor.start();
    
    await expect(
      actor.ask({ type: 'QUERY' }, { timeout: 100 })
    ).rejects.toThrow(TimeoutError);
  });
  
  it('should handle concurrent queries with correlation IDs', async () => {
    const actor = createActorRef(queryMachine);
    actor.start();
    
    const queries = Array.from({ length: 3 }, (_, i) => 
      actor.ask({ type: 'QUERY', id: i }, { timeout: 1000 })
    );
    
    const responses = await Promise.all(queries);
    
    // Each response should have correct correlation
    responses.forEach((response, i) => {
      expect(response.queryId).toBe(i);
    });
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

*Remember: Good tests enable refactoring with confidence. Focus on behavior, not implementation!*