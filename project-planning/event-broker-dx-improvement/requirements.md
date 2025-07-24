# Project Requirements: Event Broker DX Improvement

## Problem Statement

The current Event Broker implementation in Actor-Web Framework requires **4x more code** compared to direct actor subscriptions, creating a significant barrier to adoption for distributed event handling. Developers must manually handle `SUBSCRIBE`, `PUBLISH`, `UNSUBSCRIBE`, and `TOPIC_EVENT` messages with complex nested switch statements, lacking type safety and creating verbose boilerplate that obscures business logic.

While the Event Broker provides critical distributed capabilities (location transparency, persistence, audit trails), its current API complexity forces developers to choose between simple local subscriptions that don't scale or complex distributed patterns that harm productivity.

## Success Criteria

- [ ] **50%+ code reduction** for Event Broker usage compared to current implementation
- [ ] **Type-safe topics and payloads** with compile-time validation
- [ ] **Zero runtime dependencies** - pure TypeScript patterns only
- [ ] **Maintain pure actor model** - all communication via messages
- [ ] **Progressive complexity** - simple cases stay simple, complex cases remain possible
- [ ] **Seamless migration path** - existing code continues to work
- [ ] **Location transparency preserved** - same API for local and distributed events
- [ ] **Quality Gates**:
  - [ ] Comprehensive test coverage (90%+ for new code)
  - [ ] Type safety compliance (zero `any` types)
  - [ ] Regression prevention in place

## Constraints

- **Technical**: 
  - Must preserve pure actor model principles (no shared state, message-only communication)
  - Cannot introduce runtime dependencies or external libraries
  - Must work with existing XState v5 integration
  - Must maintain backward compatibility with current Event Broker messages
  
- **Timeline**: 
  - Initial implementation within 2 weeks
  - Full migration guide and examples within 3 weeks
  
- **Resources**: 
  - Single developer with actor model expertise
  - Access to research findings from multiple AI models
  
- **Quality**: 
  - Zero tolerance for type casting or `any` types
  - Strict TypeScript compliance
  - All patterns must be testable and debuggable

## Stakeholder Needs

### Framework Users (Developers)
- **Need**: Simple, intuitive API for pub/sub that "just works"
- **Current Pain**: Too much boilerplate, easy to make mistakes with strings/types
- **Benefit**: Faster development, fewer bugs, cleaner code

### Framework Maintainers
- **Need**: Maintainable patterns that don't break actor model principles  
- **Current Pain**: Supporting two separate event systems (ActorEventBus + EventBroker)
- **Benefit**: Unified architecture, easier to debug and extend

### Application End Users
- **Need**: Responsive, reliable applications
- **Current Pain**: Potential for event handling bugs due to complexity
- **Benefit**: More stable applications with better cross-tab/distributed features

## Non-Requirements

### Explicit Exclusions:
- **NOT** replacing the actor model with traditional pub/sub
- **NOT** adding Observable/RxJS patterns 
- **NOT** implementing a full message queue system (Kafka-style)
- **NOT** adding runtime proxy objects that break actor isolation
- **NOT** supporting non-JSON serializable event payloads
- **NOT** automatic event replay/event sourcing (separate concern)
- **NOT** changing how XState machines work internally

### Design Decisions Already Made:
- Event Broker remains an actor (not a singleton service)
- Messages remain the fundamental communication primitive
- TypeScript is the implementation language (no code generation)
- Web Components continue to use the existing component behavior system

## Additional Context from Research

### Key Insights from Research Reports:

1. **Type Safety is Critical** (all 4 reports unanimously agree)
   - Template literal types + discriminated unions eliminate string errors
   - Compile-time validation prevents runtime failures
   
2. **Facade Pattern Success** (Akka, Orleans, Erlang/OTP)
   - Hide SUBSCRIBE/PUBLISH complexity behind simple API
   - Maintain message passing under the hood
   
3. **Progressive Complexity** (Claude report, validated by Kimi)
   - Level 1: Simple subscribe/publish API
   - Level 2: Configuration-driven features
   - Level 3: Advanced raw message access
   
4. **XState v5 Integration Patterns** (Kimi report emphasis)
   - Use entry/exit actions for subscription lifecycle
   - Leverage XState v5 invoke pattern for subscription management (replaces activities)
   - Guards and state transitions for post-callback event handling
   
5. **Question: Do we need .subscribe()?**
   - Currently have .tell() (fire-and-forget) and .ask() (request-response)
   - Could model subscriptions as: SUBSCRIBE via .tell(), receive events via messages
   - But research shows all successful frameworks add a subscription abstraction
   - Pure actor model doesn't mean poor developer experience

## Definition of Complete

The Event Broker DX improvement is complete when:
- Developers can write pub/sub code that's as simple as local subscriptions
- Type errors are caught at compile time, not runtime
- The learning curve for distributed events matches local events  
- Documentation shows clear migration path from current to new API
- All existing Event Broker features remain accessible
- Performance benchmarks show no significant overhead 