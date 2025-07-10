# ADR-002: Actor Registry & Addressing System

## Status
Proposed

## Context
The Actor-Web framework currently manages actors with simple IDs and parent-child relationships. As we move toward distributed actors (Web Workers, remote hosts, edge environments), we need a unified system for:
- Actor discovery across different locations
- Location-transparent message routing
- Dynamic actor addressing that survives migrations
- Pattern-based actor lookups

The research report correctly identifies this as a critical gap for achieving the "actors anywhere" vision.

## Decision

### Actor Addressing Scheme
We will implement a hierarchical URI-based addressing system:

```typescript
// Format: protocol://system/path/to/actor
"actor://main/auth/session"
"worker://background/data-processor"
"remote://edge-server/cache/user-123"
"actor://main/ui/dashboard/widget-*"  // Pattern matching
```

### Core Registry Interface
```typescript
export interface ActorRegistry {
  // Registration
  register(address: ActorAddress, ref: ActorRef): void;
  unregister(address: ActorAddress): void;
  
  // Discovery
  lookup(address: ActorAddress): ActorRef | undefined;
  discover(pattern: string): ActorRef[];
  exists(address: ActorAddress): boolean;
  
  // Routing
  route(message: Message, from: ActorAddress, to: ActorAddress): Promise<void>;
  
  // Monitoring
  list(namespace?: string): ActorAddress[];
  getMetrics(address: ActorAddress): ActorMetrics;
}

export interface ActorAddress {
  protocol: 'actor' | 'worker' | 'remote' | 'service';
  system: string;
  path: string[];
  
  toString(): string;
  matches(pattern: string): boolean;
  parent(): ActorAddress | null;
}
```

### Location Transparency
The registry abstracts actor location, enabling seamless communication:

```typescript
// Sender doesn't know if receiver is local, in worker, or remote
const authActor = registry.lookup("actor://main/auth");
authActor.send({ type: 'LOGIN', credentials });

// Registry handles routing based on actual location
// If auth actor moves to worker, addressing stays the same
```

### Transport Adapters
```typescript
export interface TransportAdapter {
  canHandle(address: ActorAddress): boolean;
  send(message: Message, to: ActorAddress): Promise<void>;
  connect(address: ActorAddress): Promise<Connection>;
}

// Built-in adapters
class LocalTransport implements TransportAdapter { }
class WorkerTransport implements TransportAdapter { }
class WebSocketTransport implements TransportAdapter { }
class ServiceWorkerTransport implements TransportAdapter { }
```

### Actor Migration Support
```typescript
export interface MigratableActorRef extends ActorRef {
  migrate(to: ActorAddress): Promise<void>;
  checkpoint(): ActorCheckpoint;
  restore(checkpoint: ActorCheckpoint): Promise<void>;
}

// Example: Migrate actor from main thread to worker
const processor = registry.lookup("actor://main/processor");
await processor.migrate("worker://background/processor");
// Address updates automatically, existing references still work
```

## Implementation Strategy

### Phase 1: Local Registry (Q1 2026)
- Basic registry with local actor management
- Hierarchical addressing
- Pattern-based discovery
- Integration with existing ActorRef

### Phase 2: Worker Transport (Q2 2026)
- Worker transport adapter
- Serialization/deserialization
- Shared memory optimization
- Worker pool management

### Phase 3: Remote Transport (Q3 2026)
- WebSocket/HTTP transport
- Service discovery
- Connection management
- Fault tolerance

### Phase 4: Advanced Features (Q4 2026)
- Actor migration
- Load balancing
- Circuit breakers
- Distributed supervision

## Consequences

### Positive
- **Location Transparency**: Actors can communicate regardless of location
- **Scalability**: Easy to distribute actors across workers/servers
- **Flexibility**: Actors can be migrated without breaking references
- **Discovery**: Pattern-based lookups enable dynamic architectures
- **Future-Proof**: Extensible for new transport types

### Negative
- **Complexity**: Additional abstraction layer
- **Performance**: Potential overhead for local actor communication
- **Debugging**: Harder to trace distributed message flows
- **Migration**: Requires careful state serialization

### Mitigation Strategies
- **Performance**: Fast-path optimization for local actors
- **Debugging**: Enhanced DevTools with distributed tracing
- **Migration**: Comprehensive testing framework for state transfer

## Example Usage

```typescript
// System initialization
const registry = new ActorRegistry();
registry.addTransport(new LocalTransport());
registry.addTransport(new WorkerTransport());

// Spawn and register actors
const authActor = spawn(authMachine);
registry.register("actor://main/auth", authActor);

// Spawn in worker with same addressing pattern
const heavyActor = spawnInWorker(heavyMachine);
registry.register("worker://background/processor", heavyActor);

// Discovery
const uiActors = registry.discover("actor://main/ui/*");
const allWorkers = registry.discover("worker://**");

// Transparent communication
const auth = registry.lookup("actor://main/auth");
const processor = registry.lookup("worker://background/processor");

// They communicate the same way regardless of location
auth.send({ type: 'PROCESS_REQUEST', data });
processor.send({ type: 'START_WORK', config });
```

## References
- Erlang OTP naming and registration
- Akka actor paths and addresses
- Orleans virtual actors
- Service mesh patterns (Istio/Linkerd)

## Decision Record
- **Proposed**: 2024-01-10
- **Accepted**: [Pending]
- **Implemented**: [Future] 