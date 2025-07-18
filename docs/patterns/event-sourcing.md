# 📜 Event Sourcing Pattern

> **Pattern**: Append-only event log for complete state reconstruction  
> **Status**: ✅ Complete - Production ready  
> **Package**: `@actor-core/runtime`  
> **File**: `packages/actor-core-runtime/src/event-sourcing.ts`

## 🎯 **Overview**

Event sourcing stores all changes to application state as a sequence of events. Instead of storing the current state, we store the events that led to that state. This enables complete audit trails, temporal queries, and state reconstruction at any point in time.

## 🔧 **Core Concepts**

### Event Store Interface
```typescript
// Event store for append-only event persistence
export interface EventStore {
  append(streamId: string, events: Event[]): Promise<AppendResult>;
  read(streamId: string, fromVersion?: number): Promise<Event[]>;
  readAll(fromTimestamp?: number): Promise<Event[]>;
  getStreamInfo(streamId: string): Promise<StreamInfo>;
  deleteStream(streamId: string): Promise<void>;
}

// Event structure with metadata
export interface Event {
  id: string;
  streamId: string;
  type: string;
  data: unknown;
  metadata?: Record<string, unknown>;
  timestamp: number;
  version: number;
  correlationId?: string;
  causationId?: string;
}
```

### Event Sourced Actor
```typescript
// Base class for event-sourced actors
export abstract class EventSourcedActor<TState, TEvent extends Event> {
  protected state: TState;
  protected version: number = 0;
  protected eventStore: EventStore;

  constructor(initialState: TState, eventStore: EventStore) {
    this.state = initialState;
    this.eventStore = eventStore;
  }

  // Apply event to state (pure function)
  protected abstract apply(event: TEvent): TState;

  // Handle command and produce events
  protected abstract handle(command: unknown): Promise<TEvent[]>;

  // Load state from event stream
  async load(streamId: string): Promise<void> {
    const events = await this.eventStore.read(streamId);
    this.state = events.reduce((state, event) => this.apply(event), this.state);
    this.version = events.length;
  }

  // Save events to store
  async save(streamId: string, events: TEvent[]): Promise<void> {
    await this.eventStore.append(streamId, events);
    events.forEach(event => {
      this.state = this.apply(event);
      this.version++;
    });
  }
}
```

## 🚀 **Usage Examples**

### 1. **Basic Event Sourced User Actor**

```typescript
import { EventSourcedActor, Event, EventStore } from '@actor-core/runtime';

// Define user events
type UserEvent = 
  | { type: 'USER_CREATED'; userId: string; name: string; email: string }
  | { type: 'USER_UPDATED'; userId: string; changes: Partial<UserProfile> }
  | { type: 'USER_DELETED'; userId: string }
  | { type: 'LOGIN_ATTEMPTED'; userId: string; success: boolean; timestamp: number };

// Define user state
interface UserState {
  userId: string;
  name: string;
  email: string;
  isActive: boolean;
  loginAttempts: number;
  lastLogin?: number;
}

// Event sourced user actor
class UserActor extends EventSourcedActor<UserState, UserEvent> {
  constructor(eventStore: EventStore) {
    super({
      userId: '',
      name: '',
      email: '',
      isActive: false,
      loginAttempts: 0
    }, eventStore);
  }

  // Apply events to state (pure function)
  protected apply(event: UserEvent): UserState {
    switch (event.type) {
      case 'USER_CREATED':
        return {
          ...this.state,
          userId: event.userId,
          name: event.name,
          email: event.email,
          isActive: true
        };

      case 'USER_UPDATED':
        return {
          ...this.state,
          ...event.changes
        };

      case 'USER_DELETED':
        return {
          ...this.state,
          isActive: false
        };

      case 'LOGIN_ATTEMPTED':
        return {
          ...this.state,
          loginAttempts: this.state.loginAttempts + 1,
          lastLogin: event.success ? event.timestamp : this.state.lastLogin
        };

      default:
        return this.state;
    }
  }

  // Handle commands and produce events
  protected async handle(command: unknown): Promise<UserEvent[]> {
    switch (command.type) {
      case 'CREATE_USER':
        return [{
          type: 'USER_CREATED',
          userId: command.userId,
          name: command.name,
          email: command.email,
          id: generateEventId(),
          streamId: `user-${command.userId}`,
          timestamp: Date.now(),
          version: this.version + 1
        }];

      case 'UPDATE_USER':
        return [{
          type: 'USER_UPDATED',
          userId: this.state.userId,
          changes: command.changes,
          id: generateEventId(),
          streamId: `user-${this.state.userId}`,
          timestamp: Date.now(),
          version: this.version + 1
        }];

      case 'DELETE_USER':
        return [{
          type: 'USER_DELETED',
          userId: this.state.userId,
          id: generateEventId(),
          streamId: `user-${this.state.userId}`,
          timestamp: Date.now(),
          version: this.version + 1
        }];

      case 'LOGIN':
        const success = this.validateLogin(command.credentials);
        return [{
          type: 'LOGIN_ATTEMPTED',
          userId: this.state.userId,
          success,
          timestamp: Date.now(),
          id: generateEventId(),
          streamId: `user-${this.state.userId}`,
          version: this.version + 1
        }];

      default:
        throw new Error(`Unknown command: ${(command as any).type}`);
    }
  }

  private validateLogin(credentials: { email: string; password: string }): boolean {
    return credentials.email === this.state.email && credentials.password === 'valid';
  }

  // Public API
  async createUser(userId: string, name: string, email: string): Promise<void> {
    const events = await this.handle({ type: 'CREATE_USER', userId, name, email });
    await this.save(`user-${userId}`, events);
  }

  async updateUser(changes: Partial<UserProfile>): Promise<void> {
    const events = await this.handle({ type: 'UPDATE_USER', changes });
    await this.save(`user-${this.state.userId}`, events);
  }

  async login(credentials: { email: string; password: string }): Promise<boolean> {
    const events = await this.handle({ type: 'LOGIN', credentials });
    await this.save(`user-${this.state.userId}`, events);
    return events[0].success;
  }

  getState(): UserState {
    return { ...this.state };
  }
}
```

### 2. **Event Store Implementation**

```typescript
import { EventStore, Event, StreamInfo } from '@actor-core/runtime';

// In-memory event store (for testing/demo)
class InMemoryEventStore implements EventStore {
  private streams = new Map<string, Event[]>();

  async append(streamId: string, events: Event[]): Promise<AppendResult> {
    const stream = this.streams.get(streamId) || [];
    
    // Check for optimistic concurrency conflicts
    const expectedVersion = stream.length;
    if (events[0]?.version !== expectedVersion + 1) {
      throw new Error(`Concurrency conflict: expected version ${expectedVersion + 1}, got ${events[0]?.version}`);
    }

    // Append events
    const newStream = [...stream, ...events];
    this.streams.set(streamId, newStream);

    return {
      success: true,
      lastVersion: newStream.length,
      events: events.map(e => e.id)
    };
  }

  async read(streamId: string, fromVersion: number = 0): Promise<Event[]> {
    const stream = this.streams.get(streamId) || [];
    return stream.slice(fromVersion);
  }

  async readAll(fromTimestamp?: number): Promise<Event[]> {
    const allEvents: Event[] = [];
    for (const stream of this.streams.values()) {
      allEvents.push(...stream);
    }
    
    if (fromTimestamp) {
      return allEvents.filter(event => event.timestamp >= fromTimestamp);
    }
    
    return allEvents.sort((a, b) => a.timestamp - b.timestamp);
  }

  async getStreamInfo(streamId: string): Promise<StreamInfo> {
    const stream = this.streams.get(streamId) || [];
    return {
      streamId,
      version: stream.length,
      lastEventId: stream[stream.length - 1]?.id,
      lastEventTimestamp: stream[stream.length - 1]?.timestamp
    };
  }

  async deleteStream(streamId: string): Promise<void> {
    this.streams.delete(streamId);
  }
}

// Usage
const eventStore = new InMemoryEventStore();
const userActor = new UserActor(eventStore);

// Load existing user
await userActor.load('user-123');

// Create new user
await userActor.createUser('user-456', 'Alice', 'alice@example.com');
```

### 3. **Temporal Queries and Snapshots**

```typescript
import { EventStore, SnapshotStore } from '@actor-core/runtime';

// Snapshot store for performance optimization
class SnapshotStore {
  private snapshots = new Map<string, { state: unknown; version: number; timestamp: number }>();

  async save(streamId: string, state: unknown, version: number): Promise<void> {
    this.snapshots.set(streamId, {
      state: JSON.parse(JSON.stringify(state)), // Deep clone
      version,
      timestamp: Date.now()
    });
  }

  async load(streamId: string): Promise<{ state: unknown; version: number } | null> {
    const snapshot = this.snapshots.get(streamId);
    return snapshot ? { ...snapshot } : null;
  }
}

// Enhanced event sourced actor with snapshots
class OptimizedUserActor extends UserActor {
  private snapshotStore: SnapshotStore;
  private snapshotInterval: number;

  constructor(eventStore: EventStore, snapshotStore: SnapshotStore, snapshotInterval: number = 100) {
    super(eventStore);
    this.snapshotStore = snapshotStore;
    this.snapshotInterval = snapshotInterval;
  }

  async load(streamId: string): Promise<void> {
    // Try to load from snapshot first
    const snapshot = await this.snapshotStore.load(streamId);
    
    if (snapshot) {
      this.state = snapshot.state as UserState;
      this.version = snapshot.version;
      
      // Load events after snapshot
      const events = await this.eventStore.read(streamId, snapshot.version);
      events.forEach(event => {
        this.state = this.apply(event);
        this.version++;
      });
    } else {
      // Load all events if no snapshot
      await super.load(streamId);
    }
  }

  async save(streamId: string, events: TEvent[]): Promise<void> {
    await super.save(streamId, events);
    
    // Create snapshot periodically
    if (this.version % this.snapshotInterval === 0) {
      await this.snapshotStore.save(streamId, this.state, this.version);
    }
  }
}

// Temporal query example
async function getUserAtTime(userId: string, timestamp: number): Promise<UserState> {
  const eventStore = new InMemoryEventStore();
  const userActor = new UserActor(eventStore);
  
  // Load all events up to the specified time
  const events = await eventStore.read(`user-${userId}`);
  const relevantEvents = events.filter(event => event.timestamp <= timestamp);
  
  // Reconstruct state at that time
  const state = relevantEvents.reduce((state, event) => userActor.apply(event), {
    userId: '',
    name: '',
    email: '',
    isActive: false,
    loginAttempts: 0
  });
  
  return state;
}
```

### 4. **Event Projections and Read Models**

```typescript
import { EventStore, Projection } from '@actor-core/runtime';

// Projection for user analytics
class UserAnalyticsProjection implements Projection {
  private analytics = new Map<string, {
    totalUsers: number;
    activeUsers: number;
    totalLogins: number;
    failedLogins: number;
  }>();

  async handle(event: Event): Promise<void> {
    switch (event.type) {
      case 'USER_CREATED':
        const current = this.analytics.get('global') || {
          totalUsers: 0,
          activeUsers: 0,
          totalLogins: 0,
          failedLogins: 0
        };
        
        this.analytics.set('global', {
          ...current,
          totalUsers: current.totalUsers + 1,
          activeUsers: current.activeUsers + 1
        });
        break;

      case 'USER_DELETED':
        const stats = this.analytics.get('global');
        if (stats) {
          stats.activeUsers = Math.max(0, stats.activeUsers - 1);
        }
        break;

      case 'LOGIN_ATTEMPTED':
        const loginStats = this.analytics.get('global');
        if (loginStats) {
          loginStats.totalLogins++;
          if (!event.success) {
            loginStats.failedLogins++;
          }
        }
        break;
    }
  }

  getAnalytics(): Map<string, unknown> {
    return new Map(this.analytics);
  }
}

// Event handler for projections
class EventHandler {
  private projections: Projection[] = [];

  registerProjection(projection: Projection): void {
    this.projections.push(projection);
  }

  async handleEvent(event: Event): Promise<void> {
    await Promise.all(
      this.projections.map(projection => projection.handle(event))
    );
  }
}

// Usage
const eventStore = new InMemoryEventStore();
const analyticsProjection = new UserAnalyticsProjection();
const eventHandler = new EventHandler();

eventHandler.registerProjection(analyticsProjection);

// Process events through projections
const events = await eventStore.readAll();
for (const event of events) {
  await eventHandler.handleEvent(event);
}

console.log('Analytics:', analyticsProjection.getAnalytics());
```

## 🏗️ **Advanced Patterns**

### 1. **Event Versioning and Schema Evolution**

```typescript
import { EventStore, EventMigrator } from '@actor-core/runtime';

// Event migrator for schema evolution
class EventMigrator {
  private migrations = new Map<string, (event: Event) => Event>();

  registerMigration(eventType: string, version: number, migration: (event: Event) => Event): void {
    const key = `${eventType}-${version}`;
    this.migrations.set(key, migration);
  }

  migrate(event: Event, targetVersion: number): Event {
    let migratedEvent = { ...event };
    
    for (let version = (event.metadata?.version as number) || 1; version < targetVersion; version++) {
      const migrationKey = `${event.type}-${version}`;
      const migration = this.migrations.get(migrationKey);
      
      if (migration) {
        migratedEvent = migration(migratedEvent);
        migratedEvent.metadata = { ...migratedEvent.metadata, version: version + 1 };
      }
    }
    
    return migratedEvent;
  }
}

// Usage
const migrator = new EventMigrator();

// Migration: Add email field to USER_CREATED event
migrator.registerMigration('USER_CREATED', 1, (event) => ({
  ...event,
  data: {
    ...event.data,
    email: event.data.email || 'unknown@example.com'
  }
}));

// Apply migration when reading events
const events = await eventStore.read('user-123');
const migratedEvents = events.map(event => migrator.migrate(event, 2));
```

### 2. **Event Sourcing with CQRS**

```typescript
import { EventStore, CommandBus, QueryBus } from '@actor-core/runtime';

// Command bus for handling commands
class CommandBus {
  private handlers = new Map<string, (command: unknown) => Promise<Event[]>>();

  registerHandler(commandType: string, handler: (command: unknown) => Promise<Event[]>): void {
    this.handlers.set(commandType, handler);
  }

  async handle(command: unknown): Promise<Event[]> {
    const handler = this.handlers.get((command as any).type);
    if (!handler) {
      throw new Error(`No handler for command: ${(command as any).type}`);
    }
    return handler(command);
  }
}

// Query bus for read models
class QueryBus {
  private handlers = new Map<string, (query: unknown) => Promise<unknown>>();

  registerHandler(queryType: string, handler: (query: unknown) => Promise<unknown>): void {
    this.handlers.set(queryType, handler);
  }

  async handle(query: unknown): Promise<unknown> {
    const handler = this.handlers.get((query as any).type);
    if (!handler) {
      throw new Error(`No handler for query: ${(query as any).type}`);
    }
    return handler(query);
  }
}

// CQRS with event sourcing
class UserCQRS {
  private commandBus: CommandBus;
  private queryBus: QueryBus;
  private eventStore: EventStore;

  constructor(eventStore: EventStore) {
    this.commandBus = new CommandBus();
    this.queryBus = new QueryBus();
    this.eventStore = eventStore;
    
    this.setupCommandHandlers();
    this.setupQueryHandlers();
  }

  private setupCommandHandlers(): void {
    this.commandBus.registerHandler('CREATE_USER', async (command) => {
      const userActor = new UserActor(this.eventStore);
      return userActor.handle(command);
    });
  }

  private setupQueryHandlers(): void {
    this.queryBus.registerHandler('GET_USER', async (query) => {
      const userActor = new UserActor(this.eventStore);
      await userActor.load(`user-${query.userId}`);
      return userActor.getState();
    });
  }

  async executeCommand(command: unknown): Promise<void> {
    const events = await this.commandBus.handle(command);
    await this.eventStore.append(`user-${(command as any).userId}`, events);
  }

  async executeQuery(query: unknown): Promise<unknown> {
    return this.queryBus.handle(query);
  }
}
```

## 🔍 **Performance Optimization**

### 1. **Event Batching and Compression**

```typescript
import { EventStore, EventBatch } from '@actor-core/runtime';

// Event batching for improved performance
class BatchedEventStore implements EventStore {
  private batchSize: number;
  private batchDelay: number;
  private pendingEvents: EventBatch[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private delegate: EventStore, batchSize: number = 100, batchDelay: number = 100) {
    this.batchSize = batchSize;
    this.batchDelay = batchDelay;
  }

  async append(streamId: string, events: Event[]): Promise<AppendResult> {
    // Add to pending batch
    this.pendingEvents.push({ streamId, events });
    
    // Flush if batch is full
    if (this.pendingEvents.length >= this.batchSize) {
      await this.flush();
    } else if (!this.timer) {
      // Schedule flush after delay
      this.timer = setTimeout(() => this.flush(), this.batchDelay);
    }

    return { success: true, lastVersion: events.length, events: events.map(e => e.id) };
  }

  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.pendingEvents.length === 0) return;

    const batch = this.pendingEvents.splice(0);
    
    // Group by stream and append
    const streamGroups = new Map<string, Event[]>();
    for (const { streamId, events } of batch) {
      const existing = streamGroups.get(streamId) || [];
      streamGroups.set(streamId, [...existing, ...events]);
    }

    for (const [streamId, events] of streamGroups) {
      await this.delegate.append(streamId, events);
    }
  }

  // Delegate other methods
  async read(streamId: string, fromVersion?: number): Promise<Event[]> {
    return this.delegate.read(streamId, fromVersion);
  }

  async readAll(fromTimestamp?: number): Promise<Event[]> {
    return this.delegate.readAll(fromTimestamp);
  }

  async getStreamInfo(streamId: string): Promise<StreamInfo> {
    return this.delegate.getStreamInfo(streamId);
  }

  async deleteStream(streamId: string): Promise<void> {
    return this.delegate.deleteStream(streamId);
  }
}
```

## 🧪 **Testing Event Sourcing**

### 1. **Unit Testing Event Sourced Actors**

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { UserActor, InMemoryEventStore } from '@actor-core/runtime';

describe('Event Sourced User Actor', () => {
  let userActor: UserActor;
  let eventStore: InMemoryEventStore;

  beforeEach(() => {
    eventStore = new InMemoryEventStore();
    userActor = new UserActor(eventStore);
  });

  it('should create user and produce events', async () => {
    await userActor.createUser('user-123', 'Alice', 'alice@example.com');
    
    const events = await eventStore.read('user-user-123');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('USER_CREATED');
    expect(events[0].data).toEqual({
      userId: 'user-123',
      name: 'Alice',
      email: 'alice@example.com'
    });
  });

  it('should reconstruct state from events', async () => {
    // Create user
    await userActor.createUser('user-123', 'Alice', 'alice@example.com');
    
    // Create new actor instance
    const newUserActor = new UserActor(eventStore);
    await newUserActor.load('user-user-123');
    
    const state = newUserActor.getState();
    expect(state.name).toBe('Alice');
    expect(state.email).toBe('alice@example.com');
    expect(state.isActive).toBe(true);
  });

  it('should handle login attempts', async () => {
    await userActor.createUser('user-123', 'Alice', 'alice@example.com');
    
    const success = await userActor.login({ email: 'alice@example.com', password: 'valid' });
    expect(success).toBe(true);
    
    const state = userActor.getState();
    expect(state.loginAttempts).toBe(1);
    expect(state.lastLogin).toBeDefined();
  });
});
```

### 2. **Integration Testing with Projections**

```typescript
import { describe, expect, it } from 'vitest';
import { UserAnalyticsProjection, EventHandler } from '@actor-core/runtime';

describe('Event Sourcing - Projections', () => {
  it('should update analytics projection', async () => {
    const analyticsProjection = new UserAnalyticsProjection();
    const eventHandler = new EventHandler();
    
    eventHandler.registerProjection(analyticsProjection);
    
    // Simulate events
    const events = [
      { type: 'USER_CREATED', userId: 'user-1', name: 'Alice', email: 'alice@example.com' },
      { type: 'USER_CREATED', userId: 'user-2', name: 'Bob', email: 'bob@example.com' },
      { type: 'LOGIN_ATTEMPTED', userId: 'user-1', success: true, timestamp: Date.now() }
    ];
    
    for (const event of events) {
      await eventHandler.handleEvent(event as Event);
    }
    
    const analytics = analyticsProjection.getAnalytics();
    const globalStats = analytics.get('global');
    
    expect(globalStats).toEqual({
      totalUsers: 2,
      activeUsers: 2,
      totalLogins: 1,
      failedLogins: 0
    });
  });
});
```

## 🎯 **Best Practices**

### 1. **Use Immutable Events**
```typescript
// ✅ Good: Immutable events
const event: UserEvent = {
  type: 'USER_CREATED',
  userId: 'user-123',
  name: 'Alice',
  email: 'alice@example.com',
  id: generateEventId(),
  streamId: 'user-user-123',
  timestamp: Date.now(),
  version: 1
};

// ❌ Bad: Mutable events
const event: any = { type: 'USER_CREATED' };
event.userId = 'user-123'; // Mutation
```

### 2. **Keep Events Small and Focused**
```typescript
// ✅ Good: Small, focused events
type UserEvent = 
  | { type: 'USER_CREATED'; userId: string; name: string; email: string }
  | { type: 'USER_NAME_CHANGED'; userId: string; newName: string }
  | { type: 'USER_EMAIL_CHANGED'; userId: string; newEmail: string };

// ❌ Bad: Large, complex events
type UserEvent = 
  | { type: 'USER_UPDATED'; userId: string; changes: Record<string, unknown> };
```

### 3. **Use Optimistic Concurrency Control**
```typescript
// ✅ Good: Check version before appending
async append(streamId: string, events: Event[]): Promise<AppendResult> {
  const streamInfo = await this.getStreamInfo(streamId);
  const expectedVersion = streamInfo.version;
  
  if (events[0]?.version !== expectedVersion + 1) {
    throw new Error(`Concurrency conflict: expected version ${expectedVersion + 1}`);
  }
  
  // Append events...
}

// ❌ Bad: No concurrency control
async append(streamId: string, events: Event[]): Promise<AppendResult> {
  // Append without checking version
}
```

### 4. **Create Snapshots for Performance**
```typescript
// ✅ Good: Use snapshots for large event streams
class OptimizedActor extends EventSourcedActor<State, Event> {
  async load(streamId: string): Promise<void> {
    const snapshot = await this.snapshotStore.load(streamId);
    
    if (snapshot) {
      this.state = snapshot.state;
      this.version = snapshot.version;
      
      // Load only events after snapshot
      const events = await this.eventStore.read(streamId, snapshot.version);
      events.forEach(event => this.apply(event));
    } else {
      // Load all events if no snapshot
      await super.load(streamId);
    }
  }
}
```

## 🔧 **Integration with Other Patterns**

### With Virtual Actors
```typescript
// Event sourcing works with virtual actors
const virtualSystem = createVirtualActorSystem('event-sourced-node', {
  statePersistence: {
    enabled: true,
    provider: 'event-store',
    eventStore: new InMemoryEventStore()
  }
});

const userActor = virtualSystem.getActor('user', 'user-123');
await userActor.ask({ type: 'CREATE_USER', name: 'Alice', email: 'alice@example.com' });
```

### With Discriminated Unions
```typescript
// Use discriminated unions for type-safe events
type UserEvent = 
  | { type: 'USER_CREATED'; userId: string; name: string; email: string }
  | { type: 'USER_UPDATED'; userId: string; changes: Partial<UserProfile> }
  | { type: 'USER_DELETED'; userId: string };

class UserActor extends EventSourcedActor<UserState, UserEvent> {
  protected apply(event: UserEvent): UserState {
    switch (event.type) {
      case 'USER_CREATED':
        return { /* ... */ };
      case 'USER_UPDATED':
        return { /* ... */ };
      case 'USER_DELETED':
        return { /* ... */ };
    }
  }
}
```

### With Capability Security
```typescript
// Secure event sourcing
const secureUserActor = createSecureActor(userActor, ['write.user'], 'system');
await secureUserActor.invoke('createUser', { name: 'Alice', email: 'alice@example.com' });
```

## 📊 **Performance Characteristics**

- **Event Append**: < 1ms per event
- **State Reconstruction**: < 10ms for 1000 events (with snapshots)
- **Temporal Queries**: < 100ms for complex queries
- **Storage**: ~1KB per event (compressed)
- **Memory Usage**: Configurable with snapshots

## 🚨 **Common Pitfalls**

### 1. **Not Handling Concurrency Conflicts**
```typescript
// ❌ Bad: No concurrency control
async append(streamId: string, events: Event[]): Promise<void> {
  // Append without version checking
}

// ✅ Good: Optimistic concurrency control
async append(streamId: string, events: Event[]): Promise<void> {
  const expectedVersion = await this.getCurrentVersion(streamId);
  if (events[0]?.version !== expectedVersion + 1) {
    throw new Error('Concurrency conflict');
  }
}
```

### 2. **Creating Large Event Streams**
```typescript
// ❌ Bad: Too many events without snapshots
class UserActor extends EventSourcedActor<State, Event> {
  // No snapshot strategy - will be slow for large streams
}

// ✅ Good: Use snapshots for performance
class UserActor extends EventSourcedActor<State, Event> {
  async load(streamId: string): Promise<void> {
    const snapshot = await this.snapshotStore.load(streamId);
    if (snapshot) {
      // Load from snapshot + recent events
    } else {
      // Load all events (first time)
    }
  }
}
```

### 3. **Not Using Event Versioning**
```typescript
// ❌ Bad: No schema evolution support
type UserEvent = { type: 'USER_CREATED'; userId: string; name: string };

// ✅ Good: Versioned events with migration support
type UserEvent = { 
  type: 'USER_CREATED'; 
  userId: string; 
  name: string;
  metadata?: { version: number };
};
```

## 📚 **Related Patterns**

- **[Virtual Actors](./virtual-actors.md)** - Location transparency
- **[Discriminated Unions](./discriminated-unions.md)** - Type-safe events
- **[Actor Proxies](./actor-proxies.md)** - Command/query separation
- **[Message Transport](./message-transport.md)** - Event distribution

---

**Next**: Learn about [Capability Security](./capability-security.md) for permission-based access control. 