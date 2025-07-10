# ADR-001: ActorRef Interface Design

## Status
Accepted

## Context
The Actor-SPA framework needs a core abstraction for actors that:
- Hides internal actor state to enforce message-passing
- Provides a minimal yet functional API for actor communication
- Supports request/response patterns with timeouts
- Enables reactive UI bindings through observables
- Allows supervision and fault tolerance
- Remains compatible with XState v5 while being extensible

## Decision
We will implement an ActorRef interface that serves as the primary abstraction for all actor interactions. The interface includes:

### Core Methods
- `send(event)` - Fire-and-forget message passing
- `ask(query)` - Request/response with Promise-based API and timeout
- `observe(selector)` - Reactive state observation via minimal Observable
- `spawn(behavior, options)` - Child actor creation with supervision
- `start/stop/restart` - Lifecycle management

### Key Design Choices

1. **Generic Type Parameters**
   ```typescript
   ActorRef<TEvent, TEmitted, TSnapshot>
   ```
   - Allows type-safe event handling and state observation
   - TSnapshot enables custom snapshot types beyond basic context

2. **Minimal Observable**
   - Custom implementation with RxJS compatibility via Symbol.observable
   - Reduces bundle size while maintaining interoperability
   - Initial operators: map, filter, tap (sufficient for MVP)

3. **UUID-based Correlation**
   - Simple UUID v4 for request IDs
   - Causation ID hooks included for future observability
   - Timeout handling at ActorRef level for consistent behavior

4. **Supervision Strategy**
   - Initial implementation: restart-on-failure
   - Configurable max restarts and time windows
   - Metrics hooks for monitoring without embedded logic

5. **XState Wrapper First**
   - Initial implementation wraps XState v5 interpreter
   - Generic interface allows future implementations (workers, remote)
   - Preserves existing createComponent compatibility

## Consequences

### Positive
- Clean separation between actor internals and public API
- Type-safe message passing and state observation
- Built-in fault tolerance through supervision
- Performance monitoring hooks without overhead
- Future-proof for distributed actors

### Negative
- Additional abstraction layer over XState
- Learning curve for developers familiar with direct XState usage
- Initial implementation limited to single-process actors

### Neutral
- Observable implementation duplicates some RxJS functionality
- Correlation ID system is simple but sufficient for MVP

## Implementation Notes

1. **Phase 1 Scope**
   - Core ActorRef interface
   - XState adapter implementation
   - Restart-on-failure supervision
   - Basic request/response with timeouts

2. **Future Enhancements**
   - Additional supervision strategies (one-for-one, all-for-one)
   - Worker and remote actor implementations
   - Advanced correlation with causation chains
   - Full RxJS operator compatibility

## Alternatives Considered

1. **Direct XState Exposure**
   - Rejected: Couples framework to specific implementation
   - Would make distributed actors difficult

2. **Full RxJS Dependency**
   - Rejected: Too heavy for core framework
   - Minimal observable sufficient for MVP

3. **Synchronous State Access**
   - Rejected: Breaks actor model principles
   - Would prevent distribution/isolation

## References
- [Actor Model](https://en.wikipedia.org/wiki/Actor_model)
- [XState v5 Actors](https://stately.ai/docs/actors)
- [Akka Supervision](https://doc.akka.io/docs/akka/current/typed/fault-tolerance.html)
- [RxJS Observables](https://rxjs.dev/guide/observable)