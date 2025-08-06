# 🎭 Actor-Web Framework

> **Pure Actor Model for JavaScript/TypeScript** - Build resilient, distributed systems with location-transparent actors, inspired by Erlang/OTP

[![Pure Actor Model](https://img.shields.io/badge/Pure%20Actor%20Model-100%25%20Compliant-green)](https://github.com/0xjcf/actor-web)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue)](https://www.typescriptlang.org/)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-brightgreen)](./package.json)

## 🚀 Why Actor-Web?

JavaScript lacks built-in primitives for actor-based concurrency and fault tolerance. **Actor-Web** brings Erlang/OTP's battle-tested patterns to JavaScript with:

- **🎯 Pure Actor Model** - No shared state, message-only communication
- **🌍 Location Transparency** - Actors work identically local or distributed
- **🛡️ Fault Tolerance** - Supervisor trees with "let it crash" philosophy
- **📦 Zero Dependencies** - Lightweight, pure TypeScript implementation
- **🔄 Unified API** - Single `defineActor()` for all patterns

## ⚡ Quick Start

```bash
npm install @actor-core/runtime
```

```typescript
import { createActorSystem, defineActor } from '@actor-core/runtime';

// Define an actor with the unified API
const counterActor = defineActor<{ type: 'INCREMENT' | 'GET_COUNT' }>()
  .withContext({ count: 0 })
  .onMessage(({ message, actor }) => {
    const { count } = actor.getSnapshot().context;
    
    switch (message.type) {
      case 'INCREMENT':
        return {
          context: { count: count + 1 },
          emit: [{ type: 'COUNT_CHANGED', newValue: count + 1 }]
        };
        
      case 'GET_COUNT':
        return { reply: { count } };
    }
  });
  // Note: .build() is called automatically by the framework

// Create and use the actor system
const system = await createActorSystem({ nodeAddress: 'localhost:0' });
await system.start();

const counter = await system.spawn(counterActor, { id: 'counter-1' });

await counter.send({ type: 'INCREMENT' });
const { count } = await counter.ask({ type: 'GET_COUNT' });
console.log(count); // 1
```

## 🏛️ Core Principles

### Pure Actor Model Compliance

This framework **strictly** follows the pure actor model:

- ✅ **Message-Only Communication** - No shared state or direct method calls
- ✅ **Location Transparency** - Same API for local and distributed actors
- ✅ **Asynchronous Processing** - No blocking operations
- ✅ **Fault Isolation** - Actor failures don't cascade
- ✅ **JSON Serialization** - All messages are network-ready

### What We DON'T Support (By Design)

- ❌ **No Effects** - No async functions or side effects in actors
- ❌ **No Singletons** - No global state or shared instances
- ❌ **No Timeouts** - Use actor-based scheduling instead
- ❌ **No Direct State Access** - Only through messages

## 📚 Key Features

### 1. Unified Actor API

One API for all actor patterns - no need to choose between different builder types:

```typescript
// Stateless actor (pure message router)
const routerActor = defineActor<RouterMessage>()
  .onMessage(({ message }) => {
    return { emit: [{ type: 'ROUTED', to: message.target }] };
  });

// Stateful actor (with context)
const accountActor = defineActor<AccountMessage>()
  .withContext({ balance: 0 })
  .onMessage(({ message, actor }) => {
    // Handle deposits, withdrawals, etc.
  });

// State machine actor (with XState)
const orderActor = defineActor<OrderMessage>()
  .withMachine(orderStateMachine)
  .onMessage(({ message, actor }) => {
    // Handle based on current state
  });
```

### 2. OTP-Style Return Patterns

Following Erlang/Elixir conventions:

```typescript
// Update context (like {:noreply, new_state})
return { context: { count: newCount } };

// Reply to ask pattern (like {:reply, response, new_state})
return { 
  context: { processed: true },
  reply: { status: 'success' }
};

// Emit events (broadcast to subscribers)
return {
  emit: [
    { type: 'USER_CREATED', userId },
    { type: 'EMAIL_QUEUED', email }
  ]
};
```

### 3. Test Synchronization

Built-in utilities for deterministic testing:

```typescript
// Enable synchronous message processing
system.enableTestMode();

// Send messages - processed immediately!
await actor.send({ type: 'INCREMENT' });

// Or wait for all actors to process messages
await system.flush();

// Collect and verify events
const collector = await system.spawn(createEventCollectorBehavior());
await system.subscribe(actor, { 
  subscriber: collector,
  events: ['COUNT_CHANGED']
});
```

### 4. Supervision Trees

Erlang-style fault tolerance:

```typescript
// Define a supervisor declaratively (Erlang/Elixir OTP style)
const supervisorBehavior = createSupervisor({
  strategy: 'one-for-one',      // 'one-for-all' | 'rest-for-one'
  children: [
    { id: 'worker-1', behavior: workerBehavior },
    { id: 'worker-2', behavior: workerBehavior },
    { id: 'db-pool', behavior: databaseActor }
  ],
  maxRestarts: 3,
  restartWindow: 60000  // 1 minute
});

// Spawn the supervisor (which automatically starts all children)
const supervisor = await system.spawn(supervisorBehavior, { 
  id: 'main-supervisor' 
});
```

## 🔧 Advanced Patterns

### State-Based Behavior (XState Integration)

```typescript
const trafficLightActor = defineActor<{ type: 'TIMER' | 'EMERGENCY' }>()
  .withMachine(trafficLightMachine)
  .onMessage(({ message, actor }) => {
    const snapshot = actor.getSnapshot();
    
    // Use state.matches for conditional behavior
    if (message.type === 'EMERGENCY' && snapshot.matches('green')) {
      return {
        emit: [{ type: 'SWITCHING_TO_RED' }]
      };
    }
    
    // Let the state machine handle normal transitions
    actor.send(message);
  });
```

### Ask Pattern (Request/Response)

```typescript
// IMPORTANT: External resources (DB, APIs) must be wrapped in dedicated actors
// This maintains actor isolation and enables location transparency

// Create a database actor that manages its own connection pool
const databaseActor = defineActor<
  | { type: 'QUERY'; sql: string; params?: any[] }
  | { type: 'INSERT'; table: string; data: Record<string, any> }
  | { type: 'INIT_POOL'; config: any }
>()
  .withContext({ 
    isInitialized: false,
    // In real implementation, you'd store pool reference here
    // But remember: context must be JSON-serializable
    poolConfig: null as any
  })
  .onMessage(({ message, actor }) => {
    const { isInitialized } = actor.getSnapshot().context;
    
    switch (message.type) {
      case 'INIT_POOL':
        // Store configuration, actual pool creation happens in onStart
        return {
          context: { 
            isInitialized: true,
            poolConfig: message.config 
          },
          emit: [{ type: 'DATABASE_INITIALIZED' }]
        };
        
      case 'QUERY':
        if (!isInitialized) {
          return { 
            reply: { error: 'Database not initialized' }
          };
        }
        
        // In a real implementation, you would:
        // 1. Send message to a worker actor that owns the actual connection
        // 2. Use correlation to match the response
        // 3. Return the result via reply
        
        // For this example, we simulate the async query result
        return {
          reply: { 
            rows: [
              { id: 1, name: 'Alice' },
              { id: 2, name: 'Bob' }
            ],
            rowCount: 2
          },
          emit: [{ 
            type: 'QUERY_EXECUTED',
            sql: message.sql,
            timestamp: Date.now()
          }]
        };
        
      case 'INSERT':
        if (!isInitialized) {
          return { 
            reply: { error: 'Database not initialized' }
          };
        }
        
        // Simulate insert with generated ID
        const newId = Date.now();
        return {
          reply: { 
            id: newId,
            ...message.data
          },
          emit: [{
            type: 'RECORD_INSERTED',
            table: message.table,
            id: newId
          }]
        };
    }
  })
  .onStart(() => {
    // This is where you'd actually create the connection pool
    // But remember: no direct external calls here either!
    // Instead, emit a message that a worker actor handles
    console.log('Database actor started');
  })
  .onStop(() => {
    // Cleanup would also be message-based
    console.log('Database actor stopped');
  });

// Usage: Database operations through actor messages
const system = await createActorSystem({ nodeAddress: 'localhost:0' });
await system.start();

const dbActor = await system.spawn(databaseActor, { id: 'database' });

// Initialize the database connection
await dbActor.send({ 
  type: 'INIT_POOL',
  config: { 
    host: 'localhost',
    database: 'myapp',
    max: 20 
  }
});

// Query data using ask pattern
const queryResult = await dbActor.ask({ 
  type: 'QUERY', 
  sql: 'SELECT * FROM users WHERE active = $1',
  params: [true]
});

if ('error' in queryResult) {
  console.error('Query failed:', queryResult.error);
} else {
  console.log('Active users:', queryResult.rows);
}

// Insert data
const newUser = await dbActor.ask({
  type: 'INSERT',
  table: 'users',
  data: { name: 'Charlie', email: 'charlie@example.com' }
});

console.log('Created user:', newUser);
```

## 📦 Packages

- **`@actor-core/runtime`** - Core actor system implementation
- **`@actor-core/testing`** - Testing utilities and mocks
- **`@agent-workflow/cli`** - CLI tools for development

## 🚫 Common Anti-Patterns

```typescript
// ❌ NEVER: Direct external calls in actors
const myActor = defineActor()
  .onMessage(async ({ message }) => {
    await database.save(data);  // VIOLATION! Breaks actor isolation
    await fetch('/api/endpoint'); // VIOLATION! Not message-based
  });

// ✅ CORRECT: Create dedicated actors for external systems
const databaseActor = defineActor<{ type: 'SAVE'; data: any }>()
  .onMessage(async ({ message }) => {
    // This actor's sole responsibility is database interaction
    await database.save(message.data);
    return { emit: [{ type: 'DATA_SAVED', id: message.data.id }] };
  });

// Then send messages to it
return { emit: [{ type: 'SAVE', data }] };

// ❌ NEVER: Shared state or singletons
const globalCache = new Map();  // VIOLATION!
class MySingleton {
  static instance = new MySingleton(); // VIOLATION!
}

// ✅ CORRECT: State as actor context
const cacheActor = defineActor<{ type: 'GET' | 'SET'; key: string; value?: any }>()
  .withContext({ cache: new Map() })
  .onMessage(({ message, actor }) => {
    const { cache } = actor.getSnapshot().context;
    if (message.type === 'GET') {
      return { reply: cache.get(message.key) };
    }
    // Return new context with updated cache
    const newCache = new Map(cache);
    newCache.set(message.key, message.value);
    return { context: { cache: newCache } };
  });

// ❌ NEVER: Direct state access
const count = actor.getSnapshot().context.value;  // VIOLATION!

// ✅ CORRECT: Use ask pattern
const { value } = await actor.ask({ type: 'GET_VALUE' });

// ❌ NEVER: Blocking operations
const actor = defineActor()
  .onMessage(({ message }) => {
    const result = someSyncBlockingOperation(); // VIOLATION!
    while (condition) { /* busy wait */ }       // VIOLATION!
  });

// ✅ CORRECT: All operations must be async and message-based
const actor = defineActor()
  .onMessage(({ message }) => {
    // Delegate to another actor or return immediately
    return { emit: [{ type: 'PROCESS_ASYNC', data: message.data }] };
  });
```

## 🧪 Testing

```typescript
import { createActorSystem, createEventCollectorBehavior } from '@actor-core/runtime';

describe('Counter Actor', () => {
  it('should increment and emit events', async () => {
    const system = await createActorSystem();
    system.enableTestMode(); // Synchronous processing
    
    const counter = await system.spawn(counterActor);
    const collector = await system.spawn(createEventCollectorBehavior());
    
    await system.subscribe(counter, {
      subscriber: collector,
      events: ['COUNT_CHANGED']
    });
    
    await counter.send({ type: 'INCREMENT' });
    
    const events = await collector.ask({ type: 'GET_EVENTS' });
    expect(events.collectedEvents).toHaveLength(1);
    expect(events.collectedEvents[0]).toMatchObject({
      type: 'COUNT_CHANGED',
      newValue: 1
    });
  });
});
```

## 📖 Documentation

- [API Reference](./docs/API.md)
- [Runtime Package](./packages/actor-core-runtime/README.md)
- [CLI Package](./packages/agent-workflow-cli/README.md)

## 🤝 Contributing

We welcome contributions! Please ensure:

1. **No `any` types** - Use proper TypeScript types
2. **Pure actor model** - No shared state or side effects
3. **Test coverage** - All features must have tests
4. **Documentation** - Update docs for API changes

```bash
# Clone and setup
git clone https://github.com/0xjcf/actor-web-architecture
cd actor-web-architecture
pnpm install

# Run tests
pnpm test

# Build all packages
pnpm build

# Run in dev mode
pnpm dev
```

## 📜 License

MIT © [José Flores](https://github.com/0xjcf)

---

Built with ❤️ following Erlang/OTP principles for the JavaScript ecosystem