# Architecture Guide

> **Framework**: Actor-Web Framework  
> **Version**: 1.0.0  
> **Philosophy**: Pure actor model with location transparency

## Overview

The Actor-Web Framework implements a pure actor model for building resilient, scalable applications. This guide explains the architectural decisions, patterns, and principles that guide the framework's design.

## Core Principles

### 1. Pure Actor Model
- **Everything is an Actor**: All stateful components are actors
- **Message-Only Communication**: No shared state or direct method calls
- **Location Transparency**: Actors can be local or remote without code changes
- **Supervision Hierarchy**: Parent actors supervise their children

### 2. Type Safety
- **Zero `any` Types**: Full TypeScript type safety throughout
- **Compile-Time Validation**: Catch errors before runtime
- **Type-Safe Messages**: Message types are enforced at compile time

### 3. Minimal API Surface
- **Essential Features Only**: Core exports only what's necessary
- **Progressive Disclosure**: Advanced features in separate packages
- **Familiar Patterns**: Builds on XState and RxJS patterns

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Application Layer                   │
├─────────────────────────────────────────────────────┤
│                   Actor System                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │   Actor A   │  │   Actor B   │  │   Actor C   │ │
│  │ ┌─────────┐ │  │ ┌─────────┐ │  │ ┌─────────┐ │ │
│  │ │ Mailbox │ │  │ │ Mailbox │ │  │ │ Mailbox │ │ │
│  │ └─────────┘ │  │ └─────────┘ │  │ └─────────┘ │ │
│  │ ┌─────────┐ │  │ ┌─────────┐ │  │ ┌─────────┐ │ │
│  │ │  State  │ │  │ │  State  │ │  │ │  State  │ │ │
│  │ │ Machine │ │  │ │ Machine │ │  │ │ Machine │ │ │
│  │ └─────────┘ │  │ └─────────┘ │  │ └─────────┘ │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
├─────────────────────────────────────────────────────┤
│                  Message Router                      │
├─────────────────────────────────────────────────────┤
│                Runtime Platform                      │
│         (Browser / Node.js / Workers)                │
└─────────────────────────────────────────────────────┘
```

## Actor Lifecycle

### 1. Creation
```typescript
// Actor creation flow
createActorRef(behavior)
  → Allocate mailbox
  → Initialize state machine
  → Register in actor system
  → Return ActorRef
```

### 2. Message Processing
```typescript
// Message flow
actor.send(message)
  → Enqueue in mailbox
  → Schedule processing
  → Dequeue message
  → Process in state machine
  → Update state
  → Trigger side effects
```

### 3. Supervision
```typescript
// Supervision tree
Root Supervisor
  ├─ System Actors
  │   ├─ Logger Actor
  │   └─ Metrics Actor
  └─ Application Actors
      ├─ User Actors
      └─ Service Actors
```

## Message Passing

### Mailbox Design
Each actor has a bounded mailbox with configurable strategies:

```typescript
interface MailboxConfig {
  capacity: number;              // Maximum messages
  strategy: 'drop-oldest' |      // Drop old messages
           'drop-newest' |       // Drop new messages
           'suspend';            // Apply backpressure
}
```

### Message Ordering
- **FIFO Guarantee**: Messages from one actor to another arrive in order
- **No Global Ordering**: No ordering guarantee across different senders
- **Causality Preservation**: Causal relationships are preserved

### Backpressure
Automatic backpressure when mailboxes fill:

```typescript
// Backpressure flow
Mailbox Full
  → Suspend sender
  → Process messages
  → Resume sender when space available
```

## State Management

### XState Integration
Actors use XState machines for behavior:

```typescript
const behavior = createMachine({
  // State configuration
  initial: 'idle',
  states: {
    idle: {
      on: { START: 'active' }
    },
    active: {
      // Nested states, actions, guards
    }
  }
});

const actor = createActorRef(behavior);
```

### State Isolation
- Each actor owns its state completely
- No shared mutable state between actors
- State changes only through message processing

### Event Sourcing (Optional)
For actors requiring persistence:

```typescript
EventSourcedActor
  → Receive command
  → Generate events
  → Persist events
  → Apply events to state
  → Emit response
```

## Location Transparency

### Local Actors
Actors in the same process communicate directly:

```typescript
Local Actor A → Message → Local Actor B
              (direct reference)
```

### Remote Actors
Actors across boundaries communicate through transport:

```typescript
Browser Actor → Serialize → Transport → Deserialize → Server Actor
                         (WebSocket/HTTP)
```

### Virtual Actors
Orleans-style virtual actors with automatic lifecycle:

```typescript
getActor(type, id)
  → Check cache
  → If not active:
    → Determine placement
    → Activate on node
    → Load state
  → Return reference
```

## Fault Tolerance

### Supervision Strategies

1. **Restart**: Restart failed child with fresh state
2. **Resume**: Ignore failure and continue
3. **Stop**: Stop the failed actor permanently
4. **Escalate**: Propagate failure to parent

```typescript
const supervisor = createActorRef(machine, {
  supervisionStrategy: {
    maxRestarts: 3,
    withinMs: 60000,
    strategy: 'restart'
  }
});
```

### Error Boundaries
Errors are contained within actor boundaries:

```typescript
Actor Error
  → Caught by supervisor
  → Apply strategy
  → Log for monitoring
  → System continues
```

## Performance Optimization

### Actor Directory Cache
High-performance actor lookup:

```typescript
class ActorDirectory {
  private cache: LRUCache<string, ActorRef>;
  private index: Map<string, ActorMetadata>;
  
  lookup(id: string): ActorRef | null {
    // 90%+ cache hit rate in production
    return this.cache.get(id) || this.findAndCache(id);
  }
}
```

### Message Batching
Efficient message processing:

```typescript
// Process messages in batches
while (mailbox.hasMessages() && batch.size < MAX_BATCH) {
  batch.add(mailbox.dequeue());
}
processMessageBatch(batch);
```

### Memory Management
- **Bounded Mailboxes**: Prevent unbounded growth
- **Actor Pooling**: Reuse actor instances
- **Automatic Cleanup**: Garbage collect inactive actors

## Platform Integration

### Browser Environment
```typescript
// Main thread actors
UI Components → Actor System → State Updates → DOM

// Web Worker actors
Heavy Computation → Worker Actor → Result Message → UI Actor
```

### Node.js Environment
```typescript
// Server actors
HTTP Request → Gateway Actor → Service Actors → Response

// Cluster mode
Master Process → Worker Processes → Actor Distribution
```

### Universal Rendering
```typescript
// SSR flow
Server Render → Serialize State → Hydrate Client → Resume Actors
```

## Security Model

### Capability-Based Security
No ambient authority - all permissions are explicit:

```typescript
// Capability chain
Root Capability
  → Delegate with restrictions
  → Further delegation
  → Leaf capability with minimal permissions
```

### Message Validation
All messages are validated at boundaries:

```typescript
External Message
  → Validate schema
  → Check permissions
  → Transform to internal format
  → Process safely
```

## Monitoring and Observability

### Metrics Collection
```typescript
interface ActorMetrics {
  messagesReceived: Counter;
  messagesProcessed: Counter;
  processingTime: Histogram;
  mailboxSize: Gauge;
  errors: Counter;
}
```

### Distributed Tracing
```typescript
// Trace context propagation
Message {
  type: 'USER_ACTION',
  traceId: '123',
  spanId: '456',
  parentSpanId: '789'
}
```

### Health Checks
```typescript
// Actor health
ActorHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastMessage: timestamp;
  errorRate: number;
  responseTime: number;
}
```

## Design Patterns

### 1. Aggregate Pattern
Group related actors under a parent:
```typescript
UserAggregate
  ├─ ProfileActor
  ├─ PreferencesActor
  └─ NotificationActor
```

### 2. Saga Pattern
Coordinate distributed transactions:
```typescript
OrderSaga
  → Reserve inventory
  → Process payment
  → Confirm order
  → (Compensate on failure)
```

### 3. Event Sourcing + CQRS
Separate write and read models:
```typescript
Commands → Write Actor → Events → Projections → Read Models
```

### 4. Circuit Breaker
Protect against cascading failures:
```typescript
ExternalServiceActor
  → Track failures
  → Open circuit after threshold
  → Retry after cooldown
```

## Migration Path

### From Redux/MobX
```typescript
// Before: Redux
dispatch(updateUser({ name: 'Alice' }));

// After: Actors
userActor.send({ type: 'UPDATE_NAME', name: 'Alice' });
```

### From Direct Function Calls
```typescript
// Before: Direct calls
const result = await userService.getProfile(userId);

// After: Actor messages
const result = await userActor.ask({ type: 'GET_PROFILE' });
```

### From Microservices
```typescript
// Before: HTTP microservices
const response = await fetch(`/api/users/${userId}`);

// After: Virtual actors
const user = await system.getActor('user', userId);
const profile = await user.ask({ type: 'GET_PROFILE' });
```

## Future Considerations

### Planned Features
1. **Persistent Actors**: Automatic state persistence
2. **Actor Clustering**: Multi-node coordination
3. **Stream Processing**: Reactive streams integration
4. **WebAssembly Actors**: High-performance actors

### Extension Points
The framework provides extension points for:
- Custom transports
- Message serializers
- Supervision strategies
- Persistence providers
- Monitoring integrations

## Conclusion

The Actor-Web Framework provides a solid foundation for building resilient, scalable applications using the actor model. By adhering to these architectural principles and patterns, you can build systems that are:

- **Fault-tolerant**: Isolated failures with supervision
- **Scalable**: Location-transparent actors
- **Maintainable**: Clear boundaries and message contracts
- **Type-safe**: Full TypeScript support
- **Performant**: Optimized message passing and caching

For implementation details, see the [API Reference](./API.md). For examples, visit the [Examples Directory](../examples/).