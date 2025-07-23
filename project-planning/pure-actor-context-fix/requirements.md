# Project Requirements: Pure Actor Context Fix

## Problem Statement

The current implementation of `defineBehavior()` and `onMessage` handlers violates pure actor model principles by exposing a `context` parameter alongside the XState `machine` parameter. This creates two separate contexts:

1. **Behavior context**: A mutable actor-level state that shouldn't exist in pure actor model
2. **Machine context**: The XState machine's state (the only legitimate state container)

This dual-context approach:
- Confuses developers about where state should live
- Violates actor encapsulation principles
- Deviates from the original OTP design specification
- Is inconsistent with Erlang gen_server patterns where callbacks don't expose mutable state
- Creates potential for state synchronization bugs

The framework should follow pure actor principles where ALL state lives in the XState machine, and behaviors are purely stateless message transformers.

## Success Criteria

### Primary Success Criteria
- [ ] **Remove context parameter**: The `onMessage` handler signature contains only `message`, `machine`, and `dependencies`
- [ ] **Remove behavior context**: No actor-level context storage outside of XState machines
- [ ] **Type safety maintained**: All changes preserve TypeScript type safety with zero `any` types
- [ ] **Tests pass**: All existing tests continue to pass after refactoring
- [ ] **Documentation aligned**: API documentation matches implementation

### Secondary Success Criteria
- [ ] **Migration path clear**: Existing code using context parameter has clear migration guidance
- [ ] **Examples updated**: All example code uses the corrected pattern
- [ ] **Performance neutral**: No performance degradation from the changes
- [ ] **Error messages helpful**: Clear errors guide developers to use machine.getSnapshot().context

## Constraints

### Technical Constraints
- Must maintain backward compatibility where possible
- Cannot break existing component behaviors that rely on current implementation
- Must work with current XState v5 integration
- Changes must be incremental and testable

### Timeline Constraints
- Implementation should be completed within 1 week
- Must not block ongoing OTP implementation work

### Resource Constraints
- Single developer implementation
- Limited to changes within actor-core-runtime package

## Stakeholder Needs

### Framework Users
- **Need**: Clear, unambiguous state management patterns
- **Benefit**: Reduced confusion about where state belongs
- **Impact**: Easier to reason about actor behavior

### Framework Maintainers
- **Need**: Consistency with actor model principles
- **Benefit**: Easier to maintain and evolve the framework
- **Impact**: Reduced support burden from confused developers

### Future Developers
- **Need**: Framework that follows established distributed systems patterns
- **Benefit**: Knowledge transfer from other actor systems (Erlang, Akka)
- **Impact**: Faster onboarding for experienced developers

## Non-Requirements

### Out of Scope
- [ ] **XState changes**: We will NOT modify how XState machines work
- [ ] **Message format changes**: ActorMessage structure remains unchanged
- [ ] **Actor lifecycle changes**: Start/stop/supervision patterns unchanged
- [ ] **Component API changes**: createComponent API remains stable
- [ ] **Performance optimizations**: This is purely a correctness fix

### Future Considerations (Not This Phase)
- Advanced state persistence patterns
- Distributed state synchronization
- State versioning and migrations
- Performance monitoring of state access

## Migration Impact

### Breaking Changes
- `onMessage` handler signature changes (removal of context parameter)
- Behavior configurations that define initial context will need updates
- Tests that mock behaviors with context will need refactoring

### Compatibility Strategy
- Provide codemod for automatic migration where possible
- Clear deprecation warnings in current version
- Migration guide with before/after examples
- Temporary compatibility layer if needed

## Validation Criteria

### Acceptance Tests
1. OTP counter example works without context parameter
2. All framework tests pass
3. Component behaviors work correctly
4. Type checking catches context usage attempts
5. Error messages guide to correct pattern

### Quality Metrics
- Zero TypeScript errors
- Zero linting warnings
- 100% test coverage maintained
- No performance regression
- Clear migration documentation

---

**Approval Required**: This requirements document must be reviewed and approved before proceeding to the design phase. 