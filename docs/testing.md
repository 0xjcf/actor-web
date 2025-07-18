# Testing Documentation

> **Package**: `@actor-core/testing`  
> **Status**: Developer Tool  
> **Use Case**: Unit testing, integration testing, behavior verification

## Overview

The testing package provides specialized utilities for testing actor-based systems. It includes test actors, mocking capabilities, and assertion helpers designed specifically for the asynchronous, message-driven nature of actors.

## Installation

```bash
npm install --save-dev @actor-core/testing
```

## Core Concepts

### Testing Challenges with Actors
- **Asynchronous Behavior**: Actors process messages asynchronously
- **Message Ordering**: Need to verify message sequences
- **State Isolation**: Each actor has private state
- **Time-Based Logic**: Many actors use timers and delays

### Testing Approach
- **Deterministic Testing**: Control time and message ordering
- **Behavior Verification**: Test message handling, not implementation
- **Isolation**: Test actors independently with mocks
- **Integration Testing**: Verify actor interactions

## API Reference

### `createTestActor(behavior, options?)`

Creates an actor optimized for testing with additional inspection capabilities.

```typescript
function createTestActor<T>(
  behavior: ActorBehavior<T>,
  options?: {
    id?: string;
    type?: string;
    input?: unknown;
    autoStart?: boolean;
    clock?: TestClock;
  }
): TestActor<T>
```

**Parameters:**
- `behavior`: XState machine defining actor behavior
- `options.id`: Actor identifier for testing
- `options.autoStart`: Start actor immediately (default: true)
- `options.clock`: Test clock for controlling time

### `TestActor<T>`

```typescript
interface TestActor<T> extends ActorRef<T> {
  // Standard ActorRef methods plus:
  
  // State inspection
  getState(): State<T>;
  getSnapshot(): Snapshot<T>;
  getContext(): Context<T>;
  
  // Message tracking
  getReceivedMessages(): Message[];
  getSentMessages(): Message[];
  clearMessages(): void;
  
  // Waiting for conditions
  waitFor(predicate: (state: State<T>) => boolean, timeout?: number): Promise<void>;
  waitForMessage(type: string, timeout?: number): Promise<Message>;
  waitForSnapshot(predicate: (snapshot: Snapshot<T>) => boolean): Promise<void>;
  
  // Test utilities
  reset(): void;
  flush(): Promise<void>;
  advanceTime(ms: number): void;
}
```

### Testing Utilities

```typescript
// Expect an actor to receive a specific message
function expectActorToReceive<T>(
  actor: TestActor<T>,
  message: Partial<Message>,
  timeout?: number
): Promise<void>;

// Expect an actor to reach a specific state
function expectActorState<T>(
  actor: TestActor<T>,
  stateName: string,
  timeout?: number
): Promise<void>;

// Create a mock event store
function createMockEventStore(): MockEventStore;

// Create a test clock for controlling time
function createTestClock(): TestClock;
```

## Usage Examples

### Basic Actor Testing

```typescript
import { createTestActor } from '@actor-core/testing';
import { createMachine, assign } from 'xstate';
import { describe, it, expect } from 'vitest';

describe('Counter Actor', () => {
  const counterMachine = createMachine({
    id: 'counter',
    initial: 'active',
    context: { count: 0 },
    states: {
      active: {
        on: {
          INCREMENT: {
            actions: assign({
              count: ({ context }) => context.count + 1
            })
          },
          DECREMENT: {
            actions: assign({
              count: ({ context }) => context.count - 1
            })
          },
          RESET: {
            actions: assign({ count: 0 })
          }
        }
      }
    }
  });

  it('should increment count', async () => {
    const actor = createTestActor(counterMachine);
    
    // Initial state
    expect(actor.getContext().count).toBe(0);
    
    // Send message
    actor.send({ type: 'INCREMENT' });
    await actor.flush();
    
    // Verify state change
    expect(actor.getContext().count).toBe(1);
  });

  it('should handle multiple messages', async () => {
    const actor = createTestActor(counterMachine);
    
    // Send multiple messages
    actor.send({ type: 'INCREMENT' });
    actor.send({ type: 'INCREMENT' });
    actor.send({ type: 'DECREMENT' });
    
    await actor.flush();
    
    expect(actor.getContext().count).toBe(1);
    
    // Verify message history
    const received = actor.getReceivedMessages();
    expect(received).toHaveLength(3);
    expect(received[0].type).toBe('INCREMENT');
  });
});
```

### Testing Async Behavior

```typescript
describe('Async Actor', () => {
  const asyncMachine = createMachine({
    id: 'async',
    initial: 'idle',
    states: {
      idle: {
        on: {
          FETCH: 'loading'
        }
      },
      loading: {
        invoke: {
          src: async () => {
            const response = await fetch('/api/data');
            return response.json();
          },
          onDone: {
            target: 'success',
            actions: assign({
              data: (_, event) => event.data
            })
          },
          onError: 'failure'
        }
      },
      success: {},
      failure: {}
    }
  });

  it('should handle successful fetch', async () => {
    // Mock fetch
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ value: 42 })
      })
    );

    const actor = createTestActor(asyncMachine);
    
    actor.send({ type: 'FETCH' });
    
    // Wait for specific state
    await actor.waitFor(state => state.matches('success'));
    
    expect(actor.getContext().data).toEqual({ value: 42 });
  });

  it('should handle fetch failure', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

    const actor = createTestActor(asyncMachine);
    
    actor.send({ type: 'FETCH' });
    
    await actor.waitFor(state => state.matches('failure'));
    
    expect(actor.getState().value).toBe('failure');
  });
});
```

### Testing Time-Based Logic

```typescript
import { createTestClock } from '@actor-core/testing';

describe('Timer Actor', () => {
  const timerMachine = createMachine({
    id: 'timer',
    initial: 'idle',
    context: { elapsed: 0 },
    states: {
      idle: {
        on: {
          START: 'running'
        }
      },
      running: {
        invoke: {
          src: () => (callback) => {
            const interval = setInterval(() => {
              callback({ type: 'TICK' });
            }, 1000);
            
            return () => clearInterval(interval);
          }
        },
        on: {
          TICK: {
            actions: assign({
              elapsed: ({ context }) => context.elapsed + 1
            })
          },
          STOP: 'idle'
        }
      }
    }
  });

  it('should track elapsed time', async () => {
    const clock = createTestClock();
    const actor = createTestActor(timerMachine, { clock });
    
    actor.send({ type: 'START' });
    
    // Advance time
    clock.advance(3000); // 3 seconds
    await actor.flush();
    
    expect(actor.getContext().elapsed).toBe(3);
    
    // Stop timer
    actor.send({ type: 'STOP' });
    clock.advance(2000);
    await actor.flush();
    
    // Should not increment after stopping
    expect(actor.getContext().elapsed).toBe(3);
  });
});
```

### Testing Actor Communication

```typescript
describe('Actor Communication', () => {
  it('should handle parent-child communication', async () => {
    const childMachine = createMachine({
      id: 'child',
      initial: 'active',
      states: {
        active: {
          on: {
            PING: {
              actions: sendParent({ type: 'PONG' })
            }
          }
        }
      }
    });

    const parentMachine = createMachine({
      id: 'parent',
      initial: 'active',
      context: { pongs: 0 },
      states: {
        active: {
          invoke: {
            id: 'child',
            src: childMachine
          },
          on: {
            SEND_PING: {
              actions: send({ type: 'PING' }, { to: 'child' })
            },
            PONG: {
              actions: assign({
                pongs: ({ context }) => context.pongs + 1
              })
            }
          }
        }
      }
    });

    const parent = createTestActor(parentMachine);
    
    parent.send({ type: 'SEND_PING' });
    await parent.flush();
    
    expect(parent.getContext().pongs).toBe(1);
    
    // Verify message flow
    const sent = parent.getSentMessages();
    expect(sent.find(m => m.type === 'PING')).toBeDefined();
  });
});
```

### Testing with Mocks

```typescript
import { createMockEventStore } from '@actor-core/testing';

describe('Event Sourced Actor', () => {
  it('should persist events', async () => {
    const mockStore = createMockEventStore();
    
    const actor = createTestActor(eventSourcedMachine, {
      services: {
        eventStore: mockStore
      }
    });
    
    actor.send({ type: 'CREATE_USER', name: 'Alice' });
    await actor.flush();
    
    // Verify events were stored
    expect(mockStore.getEvents('user-123')).toContainEqual({
      type: 'UserCreated',
      data: { name: 'Alice' }
    });
    
    // Verify append was called
    expect(mockStore.appendCalls).toHaveLength(1);
    expect(mockStore.appendCalls[0]).toMatchObject({
      streamId: 'user-123',
      events: [{ type: 'UserCreated' }]
    });
  });
});
```

### Integration Testing

```typescript
describe('Actor System Integration', () => {
  it('should process order workflow', async () => {
    // Create test actors
    const orderActor = createTestActor(orderMachine);
    const inventoryActor = createTestActor(inventoryMachine);
    const paymentActor = createTestActor(paymentMachine);
    
    // Wire up communication
    orderActor.on('CHECK_INVENTORY', (event) => {
      inventoryActor.send(event);
    });
    
    inventoryActor.on('INVENTORY_CHECKED', (event) => {
      orderActor.send(event);
    });
    
    // Start workflow
    orderActor.send({
      type: 'PLACE_ORDER',
      items: ['item-1', 'item-2'],
      total: 100
    });
    
    // Wait for completion
    await orderActor.waitFor(state => state.matches('completed'));
    
    // Verify final state
    expect(orderActor.getContext().status).toBe('confirmed');
    expect(inventoryActor.getContext().reserved).toContain('item-1');
    expect(paymentActor.getContext().processed).toBe(true);
  });
});
```

### Snapshot Testing

```typescript
describe('Snapshot Testing', () => {
  it('should match expected snapshots', async () => {
    const actor = createTestActor(complexMachine);
    
    // Perform series of actions
    actor.send({ type: 'INITIALIZE' });
    actor.send({ type: 'CONFIGURE', settings: { theme: 'dark' } });
    actor.send({ type: 'ACTIVATE' });
    
    await actor.flush();
    
    // Snapshot entire state
    expect(actor.getSnapshot()).toMatchSnapshot('after-activation');
    
    // Or test specific properties
    expect(actor.getSnapshot()).toMatchObject({
      value: 'active',
      context: {
        initialized: true,
        settings: { theme: 'dark' }
      }
    });
  });
});
```

## Testing Patterns

### 1. Arrange-Act-Assert
Structure tests clearly:
```typescript
it('should handle user login', async () => {
  // Arrange
  const actor = createTestActor(authMachine);
  const credentials = { username: 'alice', password: 'secret' };
  
  // Act
  actor.send({ type: 'LOGIN', credentials });
  await actor.waitFor(state => !state.matches('authenticating'));
  
  // Assert
  expect(actor.getState().value).toBe('authenticated');
  expect(actor.getContext().user).toEqual({ username: 'alice' });
});
```

### 2. Test Behavior, Not Implementation
Focus on observable behavior:
```typescript
// Good: Test behavior
it('should retry failed requests', async () => {
  const actor = createTestActor(apiMachine);
  let attempts = 0;
  
  // Mock failing then succeeding
  global.fetch = vi.fn(() => {
    attempts++;
    if (attempts < 3) {
      return Promise.reject(new Error('Network error'));
    }
    return Promise.resolve({ ok: true });
  });
  
  actor.send({ type: 'FETCH_DATA' });
  await actor.waitFor(state => state.matches('success'));
  
  expect(attempts).toBe(3);
});

// Bad: Testing internal state
it('should set retryCount to 2', () => {
  // Don't test internal implementation details
});
```

### 3. Isolate Actors
Test actors in isolation:
```typescript
it('should send notification', async () => {
  const notificationService = vi.fn();
  
  const actor = createTestActor(userMachine, {
    services: {
      sendNotification: notificationService
    }
  });
  
  actor.send({ type: 'COMPLETE_PROFILE' });
  await actor.flush();
  
  expect(notificationService).toHaveBeenCalledWith({
    type: 'profile_completed',
    userId: expect.any(String)
  });
});
```

### 4. Use Test Helpers
Create domain-specific helpers:
```typescript
// Test helper
async function loginUser(actor: TestActor, username: string) {
  actor.send({
    type: 'LOGIN',
    credentials: { username, password: 'test' }
  });
  await actor.waitFor(state => state.matches('authenticated'));
}

// Use in tests
it('should access protected resource', async () => {
  const actor = createTestActor(appMachine);
  
  await loginUser(actor, 'alice');
  
  actor.send({ type: 'ACCESS_PROTECTED' });
  await actor.flush();
  
  expect(actor.getContext().hasAccess).toBe(true);
});
```

## Best Practices

### 1. Deterministic Tests
- Use test clocks for time control
- Mock external dependencies
- Control message ordering
- Avoid race conditions

### 2. Clear Test Names
```typescript
// Good
it('should transition to error state when API call fails')
it('should retry up to 3 times before giving up')

// Bad
it('should work')
it('test error handling')
```

### 3. Test Edge Cases
- Empty states
- Error conditions
- Timeout scenarios
- Concurrent messages

### 4. Performance Testing
```typescript
it('should handle high message throughput', async () => {
  const actor = createTestActor(performantMachine);
  const messageCount = 10000;
  
  const start = performance.now();
  
  for (let i = 0; i < messageCount; i++) {
    actor.send({ type: 'PROCESS', id: i });
  }
  
  await actor.flush();
  
  const duration = performance.now() - start;
  const throughput = messageCount / (duration / 1000);
  
  expect(throughput).toBeGreaterThan(1000); // msgs/sec
});
```

## See Also

- [Core API Reference](./API.md)
- [Architecture Guide](./architecture.md)
- [Examples](../examples/testing/)