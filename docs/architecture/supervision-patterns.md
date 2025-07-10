# ADR-002: Actor Supervision Patterns

## Status
Accepted

## Context
Fault tolerance is crucial for resilient actor systems. The Actor-SPA framework needs supervision strategies that:
- Handle actor failures gracefully
- Prevent cascading failures
- Support different failure recovery patterns
- Maintain system stability under errors
- Provide visibility into system health

## Decision
We implement a supervision system with three core strategies, starting with restart-on-failure in Phase 1.

### Supervision Strategies

#### 1. Restart-on-Failure (Phase 1)
```typescript
{
  strategy: 'restart-on-failure',
  maxRestarts: 3,
  restartWindow: 60000, // 1 minute
  restartDelay: 1000    // 1 second
}
```
- Attempts to restart failed actors
- Configurable restart limits within time windows
- Exponential backoff option for future enhancement

#### 2. Stop-on-Failure (Phase 2)
```typescript
{
  strategy: 'stop-on-failure',
  onFailure: (actor, error) => { /* cleanup */ }
}
```
- Immediately stops failed actors
- Useful for non-critical or replaceable actors
- Prevents resource leaks from repeated failures

#### 3. Escalate (Phase 2)
```typescript
{
  strategy: 'escalate'
}
```
- Propagates failure to parent supervisor
- Enables hierarchical failure handling
- Parent decides how to handle child failures

### Supervision Tree Structure

```
Root Supervisor
├── Service Supervisor (all-for-one)
│   ├── API Actor
│   ├── Cache Actor
│   └── Logger Actor
└── UI Supervisor (one-for-one)
    ├── Navigation Actor
    ├── Form Actor
    └── Modal Actor
```

### Implementation Details

1. **Failure Detection**
   - Monitor actor status changes
   - Catch unhandled promise rejections
   - Track error states in snapshots

2. **Restart Mechanics**
   - Preserve actor ID across restarts
   - Clear internal state on restart
   - Re-establish child relationships
   - Emit restart events for monitoring

3. **Metrics & Monitoring**
   ```typescript
   interface SupervisionMetrics {
     onRestart: (actor, error, attempt) => void;
     onFailure: (actor, error) => void;
     onRecover: (actor) => void;
   }
   ```

## Consequences

### Positive
- Automatic recovery from transient failures
- Isolation prevents system-wide crashes
- Configurable strategies for different use cases
- Observable health metrics
- Hierarchical failure handling

### Negative
- Complexity in supervisor implementation
- Potential for restart loops if not configured properly
- Memory overhead for tracking supervised actors
- Learning curve for supervision patterns

### Neutral
- Similar to Erlang/Akka supervision models
- Requires careful strategy selection per actor type

## Usage Examples

### Basic Supervision
```typescript
const supervisor = new Supervisor({
  strategy: 'restart-on-failure',
  maxRestarts: 3,
  restartWindow: 60000
});

const apiActor = spawn(apiBehavior);
supervisor.supervise(apiActor);
```

### Hierarchical Supervision
```typescript
const rootSupervisor = spawn(rootSupervisorBehavior);

const uiSupervisor = rootSupervisor.spawn(uiSupervisorBehavior, {
  supervision: 'one-for-one'
});

const formActor = uiSupervisor.spawn(formBehavior, {
  supervision: 'restart-on-failure'
});
```

## Best Practices

1. **Strategy Selection**
   - Use restart-on-failure for recoverable errors
   - Use stop-on-failure for corrupt state
   - Use escalate for critical system failures

2. **Restart Limits**
   - Set reasonable limits to prevent infinite loops
   - Consider exponential backoff for network errors
   - Monitor restart frequency

3. **Error Boundaries**
   - Group related actors under same supervisor
   - Isolate experimental features
   - Separate critical from non-critical paths

## Future Enhancements

1. **Phase 2: Additional Strategies**
   - One-for-one: Restart only failed child
   - All-for-one: Restart all children on any failure
   - Custom strategies via plugins

2. **Phase 3: Advanced Features**
   - Circuit breaker pattern
   - Bulkhead isolation
   - Adaptive restart delays
   - Persistent supervision state

## References
- [Erlang Supervisor Behavior](https://www.erlang.org/doc/design_principles/sup_princ.html)
- [Akka Supervision](https://doc.akka.io/docs/akka/current/typed/fault-tolerance.html)
- [Let It Crash Philosophy](https://wiki.c2.com/?LetItCrash)