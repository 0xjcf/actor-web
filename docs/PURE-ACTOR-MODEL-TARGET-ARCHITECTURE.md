# 🎯 Pure Actor Model Target Architecture

> **Status**: Target Architecture (Post-Migration)  
> **Last Updated**: 2025-07-20  
> **Purpose**: Complete architectural vision for the pure actor model framework

## 📋 Executive Summary

The Actor-Web Framework is evolving from a hybrid model to a **pure actor model** where:
- **ALL** communication happens through asynchronous message passing
- **NO** shared state or direct function calls between actors
- **FULL** location transparency - actors can run anywhere
- **COMPLETE** fault tolerance through supervision hierarchies

## 🏗️ Core Architecture Components

### 1. Guardian Actor (System Kernel)

The **Guardian Actor** is the root of the supervision hierarchy and the system kernel:

```typescript
// The Guardian is the first actor created and supervises all others
interface GuardianActor {
  // Manages actor lifecycle
  spawn(behavior: ActorBehavior, options: SpawnOptions): Promise<ActorPID>;
  stop(pid: ActorPID): Promise<void>;
  
  // Handles system-level failures
  handleFailure(childPid: ActorPID, error: Error): Promise<void>;
  
  // System shutdown
  shutdown(): Promise<void>;
}
```

**Key Responsibilities:**
- Root supervisor for all user actors
- System actor management (event actor, scheduler, metrics)
- Global failure handling and recovery
- Graceful system shutdown

### 2. Actor PID (Process Identifier)

Replaces the legacy ActorRef with a pure, location-transparent reference:

```typescript
interface ActorPID {
  readonly address: ActorAddress;  // Location-transparent address
  
  // Message passing only - no direct state access
  send(message: ActorMessage): Promise<void>;
  ask<TResponse>(message: ActorMessage, timeout?: number): Promise<TResponse>;
  
  // Lifecycle
  stop(): Promise<void>;
  isAlive(): Promise<boolean>;
  
  // Monitoring
  getStats(): Promise<ActorStats>;
  watch(watcher: ActorPID): void;
}

interface ActorAddress {
  readonly id: string;           // Unique actor ID
  readonly type: string;         // Actor type/role
  readonly node?: string;        // Physical location (optional)
  readonly path: string;         // Hierarchical path
}
```

### 3. Message Transport Layer

Handles serialization and routing across different environments:

```typescript
interface MessageTransport {
  // Pluggable transports for different environments
  send(from: ActorAddress, to: ActorAddress, message: ActorMessage): Promise<void>;
  
  // Transport types
  local: LocalTransport;        // Same process (direct memory)
  worker: WorkerTransport;      // Web Workers (postMessage)
  websocket: WebSocketTransport;// Cross-machine (network)
  ipc: IPCTransport;           // Electron/Tauri (IPC)
}

// All messages must be serializable
interface ActorMessage {
  type: string;
  payload: JsonValue;           // JSON-serializable only
  sender?: ActorAddress;
  correlationId?: string;
  timestamp: number;
  version: string;
}
```

### 4. Distributed Actor Directory

Replaces singleton registry with distributed, cached directory:

```typescript
interface DistributedActorDirectory {
  // Registration with replication
  register(name: string, address: ActorAddress): Promise<void>;
  unregister(name: string): Promise<void>;
  
  // Lookup with caching (90%+ cache hit target)
  lookup(name: string): Promise<ActorAddress | undefined>;
  discover(pattern: string): Promise<ActorAddress[]>;
  
  // Cluster coordination
  sync(nodes: string[]): Promise<void>;
  getTopology(): Promise<ClusterTopology>;
}
```

### 5. Mailbox & Message Processing

Each actor has its own bounded mailbox:

```typescript
interface ActorMailbox {
  // Bounded capacity with overflow strategies
  capacity: number;
  strategy: 'drop-oldest' | 'drop-newest' | 'suspend';
  
  // Message operations
  enqueue(message: ActorMessage): boolean;
  dequeue(): ActorMessage | undefined;
  isEmpty(): boolean;
  size(): number;
}

// Event-driven processing (NO setTimeout loops)
interface MessageProcessor {
  // Process one message at a time
  processNext(actor: ActorInstance): Promise<void>;
  
  // Triggered by message arrival, not polling
  onMessageAvailable: EventEmitter;
}
```

### 6. Supervision Hierarchy

Fault tolerance through "let it crash" philosophy:

```typescript
interface SupervisionStrategy {
  maxRestarts: number;
  withinMs: number;
  onFailure: (error: Error, actor: ActorPID) => SupervisionDirective;
}

enum SupervisionDirective {
  RESTART = 'restart',       // Restart the failed actor
  STOP = 'stop',            // Stop the failed actor
  ESCALATE = 'escalate',    // Escalate to parent supervisor
  RESUME = 'resume'         // Ignore and continue
}

// Supervision tree example
Guardian
  ├─ System Supervisor
  │   ├─ Event Actor
  │   ├─ Scheduler Actor
  │   └─ Metrics Actor
  └─ User Supervisor
      ├─ Application Actors
      └─ Service Actors
```

## 🔄 Message Flow Architecture

### Direct Actor-to-Actor Messaging (Primary Pattern)

```typescript
// Direct messaging - NO event bus needed
actorA.send({
  type: 'REQUEST_DATA',
  payload: { query: 'users' }
});

// Ask pattern for request/response
const response = await actorB.ask({
  type: 'GET_STATUS',
  payload: null
}, { timeout: 5000 });
```

### Event Actor for Pub/Sub (When Needed)

The Event Actor replaces the traditional event bus:

```typescript
// Subscribe through the Event Actor
eventActor.send({
  type: 'SUBSCRIBE',
  payload: {
    eventType: 'USER_UPDATED',
    subscriber: myActor.address
  }
});

// Publish through the Event Actor
eventActor.send({
  type: 'PUBLISH',
  payload: {
    eventType: 'USER_UPDATED',
    data: { userId: '123', name: 'John' }
  }
});
```

**Key Differences from Event Bus:**
- Event Actor is supervised and can fail/restart
- Subscriptions are messages, not function callbacks
- Works across process boundaries
- Can implement backpressure and filtering

## 🌐 Location Transparency

### Actor Addressing

```typescript
// Hierarchical addressing scheme
"actor://guardian/system/event-actor"
"actor://guardian/user/git-actor-123"
"actor://cluster-node-2/service/auth-actor"

// Pattern matching for discovery
"actor://*/user/git-actor-*"  // Find all git actors
```

### Transparent Communication

```typescript
// Same API whether actor is local or remote
const gitActor = await actorSystem.lookup("actor://*/user/git-actor-main");

// This works regardless of where gitActor runs:
// - Same process
// - Web Worker
// - Different machine
await gitActor.send({
  type: 'GIT_COMMIT',
  payload: { message: 'feat: add new feature' }
});
```

## 🚦 Actor State Management

### XState Integration

Each actor's behavior is defined by an XState machine:

```typescript
const gitActorBehavior = createMachine({
  id: 'git-actor',
  initial: 'idle',
  context: {
    // Actor's private state - NEVER shared
    repository: null,
    branches: []
  },
  states: {
    idle: {
      on: {
        INITIALIZE: {
          target: 'loading',
          actions: 'loadRepository'
        }
      }
    },
    // ... more states
  }
});

// Actor creation
const gitActor = await guardian.spawn(gitActorBehavior, {
  name: 'git-actor-main',
  supervision: {
    strategy: 'restart',
    maxRestarts: 3
  }
});
```

## ❌ What Gets Removed

### 1. Event Bus ❌
- **Replaced by**: Event Actor for pub/sub, direct messaging for point-to-point
- **Why**: Event buses don't work across process boundaries

### 2. Singleton Registry ❌
- **Replaced by**: Distributed Actor Directory
- **Why**: Singletons only work in single process

### 3. Direct Function Calls ❌
```typescript
// ❌ OLD: Direct function calls
const gitActor = lookupGitActor('main');
const status = gitActor.getStatus();  // Synchronous, local only

// ✅ NEW: Message passing
const gitActor = await directory.lookup('git-actor-main');
const status = await gitActor.ask({ type: 'GET_STATUS' });
```

### 4. Timer-Based Message Processing ❌
```typescript
// ❌ OLD: Polling with setTimeout
setTimeout(() => this.processMessages(), 0);

// ✅ NEW: Event-driven processing
mailbox.on('message', () => processor.processNext());
```

### 5. Observable State ❌
```typescript
// ❌ OLD: Direct state observation
actor.observe(state => state.value);

// ✅ NEW: State queries via messages
const state = await actor.ask({ type: 'GET_STATE' });
```

## 🎯 Benefits of Pure Actor Model

### 1. True Distribution
- Actors can run anywhere without code changes
- Seamless scaling across cores and machines
- Natural microservice boundaries

### 2. Fault Tolerance
- Supervision trees handle failures automatically
- "Let it crash" philosophy prevents error propagation
- System self-heals through restarts

### 3. Performance
- 10,000+ messages/second throughput
- No shared state contention
- Natural parallelism through actor isolation

### 4. Mental Model
- Everything is an actor that processes messages
- No hidden state or side effects
- Predictable, debuggable behavior

## 📊 Implementation Phases

### Phase 1: Core Infrastructure (Current)
- [x] Basic actor system structure
- [ ] Fix type system (ActorPID vs ActorRef)
- [ ] Implement Guardian Actor
- [ ] Message serialization

### Phase 2: Distribution Support
- [ ] Transport adapters (Worker, WebSocket)
- [ ] Distributed directory with caching
- [ ] Location-transparent messaging
- [ ] Cross-process supervision

### Phase 3: Advanced Features
- [ ] Event sourcing for persistence
- [ ] Actor clustering and sharding
- [ ] Advanced supervision patterns
- [ ] Performance optimizations

## 🔍 Example: Complete System

```typescript
// 1. Initialize the actor system
const actorSystem = await ActorSystem.create({
  name: 'my-app',
  guardian: {
    supervision: {
      strategy: 'one-for-one',
      maxRestarts: 5,
      withinMs: 60000
    }
  }
});

// 2. Spawn application actors
const gitActor = await actorSystem.spawn(gitActorBehavior, {
  name: 'git-actor',
  mailbox: { capacity: 1000, strategy: 'drop-oldest' }
});

const uiActor = await actorSystem.spawn(uiActorBehavior, {
  name: 'ui-actor',
  transport: 'worker'  // Run in Web Worker
});

// 3. Message-based interaction
await gitActor.send({
  type: 'INITIALIZE',
  payload: { repository: '/path/to/repo' }
});

// 4. Request/Response with ask pattern
const branches = await gitActor.ask({
  type: 'GET_BRANCHES'
}, { timeout: 5000 });

// 5. Cross-actor communication (location transparent)
await uiActor.send({
  type: 'UPDATE_BRANCHES',
  payload: { branches }
});

// 6. Graceful shutdown
await actorSystem.shutdown();
```

## ✅ Success Criteria

The pure actor model is complete when:

1. **Zero direct function calls** between actors
2. **All actors communicate via messages** only
3. **Location transparency** verified across environments
4. **Supervision hierarchy** protects all actors
5. **Distributed directory** achieves 90%+ cache hits
6. **Performance targets** met (10K+ msg/sec)
7. **No shared state** anywhere in the system
8. **Event-driven processing** (no polling loops)

---

*This document represents the target architecture. See [ROADMAP.md](./ROADMAP.md) for implementation timeline and [PURE-ACTOR-MODEL-ANALYSIS.md](./PURE-ACTOR-MODEL-ANALYSIS.md) for migration details.* 