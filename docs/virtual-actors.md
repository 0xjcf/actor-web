# Virtual Actors Documentation

> **Package**: `@actor-core/virtual`  
> **Status**: Advanced Feature  
> **Use Case**: Distributed systems, multi-node deployments, web workers

## Overview

Virtual actors provide Orleans-style location transparency and automatic lifecycle management. They enable building distributed systems where actors can be transparently located across different nodes, processes, or web workers.

## Installation

```bash
npm install @actor-core/virtual
```

## Core Concepts

### Location Transparency
Virtual actors can exist anywhere in your distributed system. The virtual actor system handles:
- Actor placement and discovery
- Automatic activation/deactivation
- Message routing across boundaries
- State persistence and recovery

### Automatic Lifecycle
Unlike regular actors that must be explicitly created and destroyed, virtual actors are:
- Created on-demand when first accessed
- Deactivated after periods of inactivity
- Reactivated transparently when needed
- Persisted across system restarts

## API Reference

### `createVirtualActorSystem(config)`

Creates a virtual actor system that manages actor lifecycle and distribution.

```typescript
function createVirtualActorSystem(config: {
  nodeId: string;
  maxActors?: number;
  cacheSize?: number;
  healthCheckInterval?: number;
  placementStrategy?: 'round-robin' | 'local-first' | 'consistent-hash';
}): VirtualActorSystem
```

**Parameters:**
- `nodeId`: Unique identifier for this node in the cluster
- `maxActors`: Maximum number of active actors (default: 10000)
- `cacheSize`: Actor reference cache size (default: 1000)
- `healthCheckInterval`: Milliseconds between health checks (default: 30000)
- `placementStrategy`: How to distribute actors across nodes

### `VirtualActorSystem`

```typescript
interface VirtualActorSystem {
  // Register an actor type with its behavior
  registerActorType(type: string, behavior: ActorBehavior<unknown>): void;
  
  // Get or create a virtual actor
  getActor<T>(type: string, id: string): Promise<VirtualActorRef<T>>;
  
  // System monitoring
  getMetrics(): SystemMetrics;
  getCacheStats(): CacheStats;
  
  // Lifecycle
  shutdown(): Promise<void>;
}
```

### `VirtualActorRef<T>`

Virtual actor references extend regular actor references with distributed capabilities:

```typescript
interface VirtualActorRef<T> extends ActorRef<T> {
  // All ActorRef methods (send, ask, etc.)
  
  // Additional virtual actor methods
  deactivate(): Promise<void>;
  getState(): Promise<unknown>;
}
```

## Usage Examples

### Basic Setup

```typescript
import { createVirtualActorSystem } from '@actor-core/virtual';
import { createMachine } from 'xstate';

// Define actor behavior
const userMachine = createMachine({
  id: 'user',
  initial: 'active',
  context: {
    profile: null,
    lastSeen: null
  },
  states: {
    active: {
      on: {
        UPDATE_PROFILE: {
          actions: assign({
            profile: (_, event) => event.profile,
            lastSeen: () => new Date()
          })
        },
        GET_PROFILE: {
          actions: sendParent((context) => ({
            type: 'PROFILE_RESPONSE',
            profile: context.profile
          }))
        }
      }
    }
  }
});

// Create virtual actor system
const system = createVirtualActorSystem({
  nodeId: 'server-1',
  maxActors: 5000,
  placementStrategy: 'consistent-hash'
});

// Register actor types
system.registerActorType('user', userMachine);

// Use virtual actors
async function updateUserProfile(userId: string, profile: any) {
  const user = await system.getActor('user', userId);
  user.send({ type: 'UPDATE_PROFILE', profile });
}

async function getUserProfile(userId: string) {
  const user = await system.getActor('user', userId);
  return await user.ask({ type: 'GET_PROFILE' });
}
```

### Web Workers Example

```typescript
// main.ts
import { createVirtualActorSystem } from '@actor-core/virtual';
import { WebWorkerTransport } from '@actor-core/virtual/transports';

const system = createVirtualActorSystem({
  nodeId: 'main-thread',
  transport: new WebWorkerTransport()
});

// Register actors that should run in workers
system.registerActorType('compute', computeMachine, {
  placement: 'worker'
});

// worker.ts
import { createVirtualActorWorker } from '@actor-core/virtual/worker';

const worker = createVirtualActorWorker();
worker.start();
```

### Multi-Node Deployment

```typescript
// Node 1
const system1 = createVirtualActorSystem({
  nodeId: 'node-1',
  cluster: {
    seeds: ['node-2:8080', 'node-3:8080'],
    port: 8080
  }
});

// Node 2
const system2 = createVirtualActorSystem({
  nodeId: 'node-2',
  cluster: {
    seeds: ['node-1:8080', 'node-3:8080'],
    port: 8080
  }
});

// Actors can be accessed from any node
const user = await system1.getActor('user', 'user-123');
// or
const sameUser = await system2.getActor('user', 'user-123');
```

## State Persistence

Virtual actors can persist their state across restarts:

```typescript
import { createVirtualActorSystem } from '@actor-core/virtual';
import { RedisStateProvider } from '@actor-core/virtual/providers';

const system = createVirtualActorSystem({
  nodeId: 'server-1',
  stateProvider: new RedisStateProvider({
    host: 'localhost',
    port: 6379
  })
});

// Actor state is automatically persisted
system.registerActorType('user', userMachine, {
  persistState: true,
  persistInterval: 5000 // Save every 5 seconds
});
```

## Monitoring and Metrics

```typescript
// Get system metrics
const metrics = system.getMetrics();
console.log(`Active actors: ${metrics.activeActors}`);
console.log(`Messages/sec: ${metrics.messageThroughput}`);

// Get cache statistics
const cacheStats = system.getCacheStats();
console.log(`Cache hit rate: ${cacheStats.hitRate}%`);

// Monitor actor lifecycle
system.on('actorActivated', ({ type, id }) => {
  console.log(`Actor ${type}/${id} activated`);
});

system.on('actorDeactivated', ({ type, id }) => {
  console.log(`Actor ${type}/${id} deactivated`);
});
```

## Best Practices

### 1. Stateless Design
Design actors to be stateless or ensure state can be persisted:
```typescript
// Good: State in context
const machine = createMachine({
  context: { count: 0 },
  // ...
});

// Bad: External state
let count = 0; // This won't persist!
```

### 2. Idempotent Messages
Virtual actors may receive duplicate messages during failover:
```typescript
// Good: Idempotent update
UPDATE_BALANCE: {
  actions: assign({
    balance: ({event}) => event.newBalance
  })
}

// Bad: Non-idempotent
INCREMENT_BALANCE: {
  actions: assign({
    balance: ({context}) => context.balance + 1
  })
}
```

### 3. Timeout Handling
Always set timeouts for cross-node communication:
```typescript
const response = await user.ask(
  { type: 'GET_PROFILE' },
  { timeout: 5000 } // 5 second timeout
);
```

### 4. Graceful Shutdown
```typescript
// Gracefully shutdown system
process.on('SIGTERM', async () => {
  await system.shutdown();
  process.exit(0);
});
```

## Performance Considerations

- **Actor Grain Size**: Keep actors focused on a single entity
- **Message Size**: Keep messages small (< 1MB)
- **Cache Tuning**: Adjust cache size based on working set
- **Placement Strategy**: Choose based on your access patterns
  - `local-first`: Minimize network calls
  - `round-robin`: Even distribution
  - `consistent-hash`: Stable placement

## Limitations

- Virtual actors are eventually consistent
- No support for actor-to-actor transactions
- Message delivery is at-most-once by default
- State persistence adds latency

## See Also

- [Core API Reference](./API.md)
- [Event Sourcing](./event-sourcing.md) - For event-sourced virtual actors
- [Examples](../examples/virtual-actors/)