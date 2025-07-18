# Event Sourcing Documentation

> **Package**: `@actor-core/persistence`  
> **Status**: Advanced Feature  
> **Use Case**: Audit trails, state recovery, temporal queries, CQRS

## Overview

Event sourcing enables actors to persist their state as a sequence of events rather than storing snapshots. This provides complete audit trails, enables time-travel debugging, and supports complex event-driven architectures.

## Installation

```bash
npm install @actor-core/persistence
```

## Core Concepts

### Event Sourcing Principles
- **Events as Source of Truth**: State is derived from replaying events
- **Immutability**: Events are append-only and never modified
- **Audit Trail**: Complete history of all state changes
- **Temporal Queries**: Query state at any point in time

### Benefits
- Complete audit log of all changes
- Ability to replay events for debugging
- Support for temporal queries
- Natural fit with CQRS patterns
- Easy to implement undo/redo

## API Reference

### `createEventStore(config)`

Creates an event store for persisting actor events.

```typescript
function createEventStore(config: {
  provider: 'memory' | 'redis' | 'postgres' | 'dynamodb';
  connectionString?: string;
  snapshotInterval?: number;
  retentionPolicy?: {
    maxEvents?: number;
    maxAge?: number; // milliseconds
    maxSnapshots?: number;
  };
}): EventStore
```

**Parameters:**
- `provider`: Storage backend for events
- `connectionString`: Connection details for the provider
- `snapshotInterval`: Events between snapshots (default: 100)
- `retentionPolicy`: How long to keep events and snapshots

### `EventStore`

```typescript
interface EventStore {
  // Append events to a stream
  append(streamId: string, events: Event[], expectedVersion?: number): Promise<AppendResult>;
  
  // Read events from a stream
  read(streamId: string, fromVersion?: number, toVersion?: number): Promise<Event[]>;
  
  // Read all events (for projections)
  readAll(fromPosition?: number): Promise<Event[]>;
  
  // Stream management
  getStreamInfo(streamId: string): Promise<StreamInfo>;
  deleteStream(streamId: string): Promise<void>;
  
  // Snapshots
  saveSnapshot(streamId: string, snapshot: Snapshot): Promise<void>;
  getSnapshot(streamId: string): Promise<Snapshot | null>;
}
```

### `EventSourcedActor`

Base class for implementing event-sourced actors.

```typescript
abstract class EventSourcedActor<TState, TEvent extends Event> {
  protected state: TState;
  protected version: number;
  
  constructor(
    protected readonly streamId: string,
    protected readonly eventStore: EventStore,
    initialState: TState
  );
  
  // Apply an event to current state
  protected abstract apply(event: TEvent): TState;
  
  // Handle a command and return events
  protected abstract handle(command: unknown): Promise<TEvent[]>;
  
  // Load actor state from event store
  async load(): Promise<void>;
  
  // Process a command
  async process(command: unknown): Promise<void>;
  
  // Get current state
  getState(): TState;
  
  // Get specific version of state
  getStateAtVersion(version: number): Promise<TState>;
}
```

### Event Types

```typescript
interface Event {
  type: string;
  timestamp: number;
  version: number;
  data: unknown;
  metadata?: EventMetadata;
}

interface EventMetadata {
  correlationId?: string;
  causationId?: string;
  userId?: string;
  [key: string]: unknown;
}
```

## Usage Examples

### Basic Event-Sourced Actor

```typescript
import { EventSourcedActor, createEventStore } from '@actor-core/persistence';
import { createActorRef } from '@actor-core/runtime';

// Define events
type BankAccountEvent =
  | { type: 'AccountOpened'; accountId: string; initialBalance: number }
  | { type: 'MoneyDeposited'; amount: number }
  | { type: 'MoneyWithdrawn'; amount: number }
  | { type: 'AccountClosed' };

// Define state
interface BankAccountState {
  accountId: string;
  balance: number;
  isOpen: boolean;
}

// Implement event-sourced actor
class BankAccountActor extends EventSourcedActor<BankAccountState, BankAccountEvent> {
  protected apply(event: BankAccountEvent): BankAccountState {
    switch (event.type) {
      case 'AccountOpened':
        return {
          accountId: event.accountId,
          balance: event.initialBalance,
          isOpen: true
        };
      
      case 'MoneyDeposited':
        return {
          ...this.state,
          balance: this.state.balance + event.amount
        };
      
      case 'MoneyWithdrawn':
        return {
          ...this.state,
          balance: this.state.balance - event.amount
        };
      
      case 'AccountClosed':
        return {
          ...this.state,
          isOpen: false
        };
    }
  }
  
  protected async handle(command: unknown): Promise<BankAccountEvent[]> {
    switch (command.type) {
      case 'OpenAccount':
        return [{
          type: 'AccountOpened',
          accountId: command.accountId,
          initialBalance: command.initialBalance
        }];
      
      case 'Deposit':
        if (!this.state.isOpen) {
          throw new Error('Account is closed');
        }
        return [{
          type: 'MoneyDeposited',
          amount: command.amount
        }];
      
      case 'Withdraw':
        if (!this.state.isOpen) {
          throw new Error('Account is closed');
        }
        if (this.state.balance < command.amount) {
          throw new Error('Insufficient funds');
        }
        return [{
          type: 'MoneyWithdrawn',
          amount: command.amount
        }];
      
      case 'CloseAccount':
        if (this.state.balance !== 0) {
          throw new Error('Cannot close account with balance');
        }
        return [{
          type: 'AccountClosed'
        }];
      
      default:
        throw new Error(`Unknown command: ${command.type}`);
    }
  }
}

// Usage
const eventStore = createEventStore({ provider: 'memory' });

const account = new BankAccountActor(
  'account-123',
  eventStore,
  { accountId: '', balance: 0, isOpen: false }
);

await account.load(); // Load existing events
await account.process({ type: 'OpenAccount', accountId: 'account-123', initialBalance: 100 });
await account.process({ type: 'Deposit', amount: 50 });

console.log(account.getState()); // { accountId: 'account-123', balance: 150, isOpen: true }
```

### Integration with XState

```typescript
import { createMachine, assign } from 'xstate';
import { createEventStore } from '@actor-core/persistence';
import { createActorRef } from '@actor-core/runtime';

// Create event-sourced XState machine
const createEventSourcedMachine = (streamId: string, eventStore: EventStore) => {
  return createMachine({
    id: 'eventSourced',
    initial: 'loading',
    context: {
      streamId,
      version: 0,
      state: null
    },
    states: {
      loading: {
        invoke: {
          src: async () => {
            const events = await eventStore.read(streamId);
            return events;
          },
          onDone: {
            target: 'ready',
            actions: assign({
              state: (_, event) => {
                // Replay events to build state
                return event.data.reduce((state, evt) => {
                  // Apply event logic
                  return applyEvent(state, evt);
                }, initialState);
              },
              version: (_, event) => event.data.length
            })
          }
        }
      },
      ready: {
        on: {
          COMMAND: {
            actions: async (context, event) => {
              const events = handleCommand(context.state, event);
              await eventStore.append(
                context.streamId,
                events,
                context.version
              );
            }
          }
        }
      }
    }
  });
};

// Create actor with event sourcing
const actor = createActorRef(
  createEventSourcedMachine('user-123', eventStore)
);
```

### Projections and Read Models

```typescript
import { createEventStore, Projection } from '@actor-core/persistence';

// Define a projection
class UserStatisticsProjection implements Projection {
  private stats = new Map<string, UserStats>();
  
  async handle(event: Event): Promise<void> {
    switch (event.type) {
      case 'UserRegistered':
        this.stats.set(event.data.userId, {
          userId: event.data.userId,
          loginCount: 0,
          lastLogin: null
        });
        break;
        
      case 'UserLoggedIn':
        const stats = this.stats.get(event.data.userId);
        if (stats) {
          stats.loginCount++;
          stats.lastLogin = event.timestamp;
        }
        break;
    }
  }
  
  getStats(userId: string): UserStats | undefined {
    return this.stats.get(userId);
  }
  
  getAllStats(): UserStats[] {
    return Array.from(this.stats.values());
  }
}

// Run projection
const eventStore = createEventStore({ provider: 'postgres' });
const projection = new UserStatisticsProjection();

// Process all events
const events = await eventStore.readAll();
for (const event of events) {
  await projection.handle(event);
}

// Subscribe to new events
eventStore.subscribe(async (event) => {
  await projection.handle(event);
});
```

### Snapshots for Performance

```typescript
class SnapshotActor extends EventSourcedActor<State, Event> {
  async load(): Promise<void> {
    // Try to load from snapshot first
    const snapshot = await this.eventStore.getSnapshot(this.streamId);
    
    if (snapshot) {
      this.state = snapshot.state;
      this.version = snapshot.version;
      
      // Load events after snapshot
      const events = await this.eventStore.read(
        this.streamId,
        snapshot.version + 1
      );
      
      for (const event of events) {
        this.state = this.apply(event);
        this.version = event.version;
      }
    } else {
      // No snapshot, load all events
      await super.load();
    }
    
    // Save snapshot if needed
    if (this.version % 100 === 0) {
      await this.eventStore.saveSnapshot(this.streamId, {
        version: this.version,
        state: this.state,
        timestamp: Date.now()
      });
    }
  }
}
```

## Event Store Providers

### Memory Provider (Development)
```typescript
const eventStore = createEventStore({
  provider: 'memory'
});
```

### Redis Provider
```typescript
const eventStore = createEventStore({
  provider: 'redis',
  connectionString: 'redis://localhost:6379'
});
```

### PostgreSQL Provider
```typescript
const eventStore = createEventStore({
  provider: 'postgres',
  connectionString: 'postgresql://user:password@localhost:5432/events'
});
```

### DynamoDB Provider
```typescript
const eventStore = createEventStore({
  provider: 'dynamodb',
  connectionString: 'region=us-east-1;table=events'
});
```

## Best Practices

### 1. Event Design
- Keep events small and focused
- Use past tense for event names
- Include all necessary data in events
- Never modify existing events

```typescript
// Good
type OrderEvent = 
  | { type: 'OrderPlaced'; orderId: string; items: Item[]; total: number }
  | { type: 'OrderShipped'; orderId: string; trackingNumber: string }

// Bad
type OrderEvent =
  | { type: 'UpdateOrder'; orderId: string; changes: any } // Too generic
```

### 2. Command Validation
Always validate commands before generating events:
```typescript
protected async handle(command: Command): Promise<Event[]> {
  // Validate command
  if (!isValid(command)) {
    throw new ValidationError('Invalid command');
  }
  
  // Check business rules
  if (!this.canHandle(command)) {
    throw new BusinessError('Cannot process command in current state');
  }
  
  // Generate events
  return this.generateEvents(command);
}
```

### 3. Idempotency
Handle duplicate commands gracefully:
```typescript
protected async handle(command: Command): Promise<Event[]> {
  // Check if command was already processed
  if (this.wasProcessed(command.id)) {
    return []; // No new events
  }
  
  // Process command
  const events = await this.processCommand(command);
  
  // Mark as processed
  this.markProcessed(command.id);
  
  return events;
}
```

### 4. Event Versioning
Plan for event schema evolution:
```typescript
interface EventV1 {
  type: 'UserRegistered';
  version: 1;
  email: string;
}

interface EventV2 {
  type: 'UserRegistered';
  version: 2;
  email: string;
  username: string; // Added field
}

// Handle multiple versions
protected apply(event: Event): State {
  if (event.type === 'UserRegistered') {
    if (event.version === 1) {
      return this.applyV1(event as EventV1);
    } else {
      return this.applyV2(event as EventV2);
    }
  }
}
```

## Performance Optimization

### 1. Use Snapshots
For actors with many events, use snapshots to reduce load time:
```typescript
const eventStore = createEventStore({
  provider: 'postgres',
  snapshotInterval: 100 // Snapshot every 100 events
});
```

### 2. Batch Operations
Batch multiple events when possible:
```typescript
await eventStore.append(streamId, [
  { type: 'ItemAdded', item: 'A' },
  { type: 'ItemAdded', item: 'B' },
  { type: 'ItemAdded', item: 'C' }
]);
```

### 3. Async Projections
Run projections asynchronously to avoid blocking:
```typescript
eventStore.subscribe(async (event) => {
  // Queue for async processing
  await projectionQueue.add(event);
});
```

## See Also

- [Core API Reference](./API.md)
- [Virtual Actors](./virtual-actors.md) - Event-sourced virtual actors
- [Examples](../examples/event-sourcing/)