# Project Requirements: Actor System API Migration

## Problem Statement

The current actor system implementation (`actor-system-impl.ts`) is incompatible with the new pure actor model API defined in the `ActorBehavior` interface. This creates a fundamental mismatch where:

1. **Pure ActorBehavior interface** expects `onMessage` handlers with `machine` and `dependencies` parameters following pure actor model principles
2. **Current actor system** still calls `onMessage` with legacy `context` parameter and doesn't handle `MessagePlan` responses
3. **Ask pattern failures** occur because the system can't properly correlate business message responses with pending ask() calls
4. **Test timeouts** happen consistently with `defineBehavior` + `system.spawn` combinations
5. **Location transparency violations** exist with direct method calls for subscription and discovery that won't work in distributed scenarios

This mismatch prevents the framework from fully adopting the pure actor model, blocking the OTP implementation and causing widespread test failures. The solution is to migrate the actor system completely to the pure actor model, removing all context-based legacy patterns.

## Success Criteria

### Primary Success Criteria
- [ ] **Pure Actor API**: Actor system implementation matches the pure `ActorBehavior` interface exactly
- [ ] **Business Message Correlation**: System correctly correlates business message responses to ask() calls using correlationId
- [ ] **Ask Pattern Working**: `actor.ask()` calls receive responses from actors using business message types (not 'RESPONSE')
- [ ] **Message-Based Communication**: All actor interactions use messages, no direct method calls for distributed operations
- [ ] **Tests Pass**: All runtime tests pass without timeouts or API mismatches
- [ ] **Type Safety**: Zero `any` types, full TypeScript compliance

### Secondary Success Criteria
- [ ] **Context Removal**: Complete elimination of context-based `onMessage` patterns
- [ ] **Performance**: No degradation in message processing throughput
- [ ] **Migration Complete**: All existing behaviors updated to pure actor model
- [ ] **Framework Transparency**: 'RESPONSE' type remains internal framework detail, never exposed to actors
- [ ] **Event Broker Actor**: Core system includes supervised event broker actor for topic-based pub/sub
- [ ] **Actor Discovery**: Support both ephemeral PID-passing and well-known name registration patterns
- [ ] **Location Transparency**: Subscription and discovery work identically for local and distributed actors
- [ ] **Supervision Integration**: Event broker and discovery services properly integrated with supervision hierarchy

## Constraints

### Technical Constraints
- Must maintain compatibility with XState v5 integration
- Must work with current `CorrelationManager` implementation
- Changes must be testable and incrementally deployable
- Must follow pure actor model principles (no `setTimeout`, no shared mutable state, no context)
- Existing behaviors using context must be migrated to pure actor model
- Actors must only work with business message types, never framework-internal types

### Framework Constraints
- Must work with both `createActorRef` and `system.spawn` patterns
- Must support all existing ActorRef methods (`send`, `ask`, `observe`, etc.)
- Must integrate with current supervision and lifecycle patterns
- Must strictly enforce framework standards (@FRAMEWORK-STANDARD)
- Framework handles correlation internally, actors only see domain messages

### Timeline Constraints  
- Critical blocker for OTP implementation (high priority)
- Must not delay other ongoing development work
- Should be completed within 1 week for minimal disruption

## Stakeholder Needs

### Test Authors
- **Need**: Tests using `defineBehavior` should work reliably without timeouts
- **Benefit**: Can write tests following the pure actor model patterns
- **Impact**: Eliminates frustration with timing-based test failures

### Framework Users
- **Need**: Consistent API across all actor creation methods
- **Benefit**: Single mental model for actor behavior definition using business messages only
- **Impact**: Easier adoption and fewer conceptual hurdles

### Framework Maintainers
- **Need**: Implementation matches the designed API contract
- **Benefit**: Code is maintainable and follows established patterns
- **Impact**: Reduces technical debt and support burden

### OTP Implementation
- **Need**: Working actor system that supports MessagePlan responses with business message correlation
- **Benefit**: Can complete OTP-style actor patterns as designed
- **Impact**: Enables completion of milestone deliverable

## Non-Requirements

### Out of Scope
- [ ] **XState Machine Changes**: We will NOT modify how XState machines work internally
- [ ] **Message Format Changes**: ActorMessage structure remains unchanged  
- [ ] **Component API Changes**: createComponent continues working as-is
- [ ] **Performance Optimizations**: This is purely a correctness fix
- [ ] **New Features**: Focus only on making existing API work properly

### Future Considerations (Not This Phase)
- Advanced MessagePlan optimizations
- Distributed actor system support
- Enhanced debugging and observability
- Performance monitoring and metrics

## Migration Impact

### Breaking Changes (Definite)
- All actors using context-based `onMessage` must be migrated to pure actor model
- Actor system APIs will change to only support `machine + dependencies` pattern
- Any behaviors relying on mutable context will need refactoring
- Actors must respond with business message types, never 'RESPONSE' types

### Migration Strategy
- Complete migration to pure actor model (no dual API support)
- Update all existing tests to use pure actor patterns
- Remove all context-based behavior definitions
- Comprehensive test coverage to verify pure actor compliance
- Framework handles correlation internally using business message correlationId

### Migration Requirements
- Update all `defineBehavior` calls to use `machine + dependencies` API
- Replace context state with XState machine context access
- Convert context mutations to MessagePlan responses
- Ensure all ask patterns return business message types with correlationId for correlation
- Convert direct method calls (subscribe, discovery) to message-based patterns for location transparency
- Implement core event broker actor with topic-based pub/sub capabilities
- Add both ephemeral and well-known name discovery mechanisms
- Integrate event broker and discovery services with supervision hierarchy

## Validation Criteria

### Functional Tests
1. **Ask Pattern**: `await actor.ask({ type: 'TEST' })` works with `defineBehavior` actors using business message responses
2. **MessagePlan Processing**: All MessagePlan types (DomainEvent, SendInstruction, AskInstruction) execute correctly
3. **API Consistency**: Same behavior whether using `createActorRef` or `system.spawn`
4. **Error Handling**: Clear errors for malformed MessagePlans or API misuse
5. **Lifecycle**: Actor start/stop/supervision works identically to current system
6. **Message-Based Subscription**: Event subscription uses messages (SUBSCRIBE/UNSUBSCRIBE) instead of direct method calls
7. **Event Broker**: Topic-based pub/sub works through dedicated broker actor with wildcard support
8. **Actor Discovery**: Both ephemeral PID-passing and well-known name patterns function correctly
9. **Location Transparency**: Subscription and discovery APIs work identically for local and future distributed scenarios

### Integration Tests  
1. **Runtime Test Suite**: All tests in `packages/actor-core-runtime/src/tests/` pass
2. **Cross-Package**: Integration with actor-core-testing and agent-workflow-cli packages
3. **Component Integration**: Web components using actors continue working
4. **Performance**: Message throughput within 5% of current performance

### Quality Gates
- Zero TypeScript errors across all packages
- Zero linting warnings
- 100% test coverage for new implementation
- No `any` types introduced
- All existing tests pass without modification
- No 'RESPONSE' types exposed to actor behaviors

---

**Requirements Approval Required**: This requirements document must be reviewed for completeness and alignment with framework goals before proceeding to the design phase. 