# Test Audit Report - Actor Core Runtime

## Executive Summary

This audit identifies violations of TESTING-GUIDE.md principles and provides recommendations for improvement.

### Key Issues Found:
1. **Timing Dependencies**: Multiple tests use `setTimeout` which makes tests flaky
2. **Implementation Details**: Some tests rely on internal timing rather than observable behavior
3. **Coverage Gaps**: Overall coverage is 73.6% - some critical paths untested

## Detailed Findings

### 1. Timing-Dependent Tests

#### ❌ VIOLATION: graceful-shutdown.test.ts
- **Line 123**: `await new Promise(resolve => setTimeout(resolve, 100))`
- **Lines 168, 173**: Shutdown handlers with arbitrary delays
- **Line 230**: onStop handler with 200ms delay
- **Lines 310, 337**: Processing simulation with timeouts

**Issue**: These tests rely on specific timing which can fail in different environments.

**Solution**: Test the behavior, not the timing:
```typescript
// Instead of timing-based tests, use state-based tests
it('should handle actors still processing messages during shutdown', async () => {
  const behavior: ActorBehavior = {
    initialState: { processing: false, completed: false },
    onMessage: async (msg, state) => {
      if (msg.type === 'PROCESS') {
        // Return state indicating processing started
        return { ...state, processing: true };
      }
      if (msg.type === 'COMPLETE') {
        // Return state indicating processing completed
        return { ...state, processing: false, completed: true };
      }
      return state;
    },
  };
  
  // Test the state transitions, not the timing
});
```

#### ❌ VIOLATION: event-emission.test.ts
- **Lines 106, 184, 280, 319, 368**: Event propagation delays

**Issue**: Tests assume events need time to propagate, but this is an implementation detail.

**Solution**: Use proper synchronization:
```typescript
// Use observable pattern properly
const events: ActorMessage[] = [];
const subscription = actor.subscribe('EMIT:*').subscribe(event => {
  events.push(event);
});

// Send message and check immediately - no timing needed
actor.send({ type: 'INCREMENT' });

// If truly async, use proper promises
await actor.send({ type: 'INCREMENT' }).then(() => {
  expect(events).toHaveLength(1);
});
```

#### ❌ VIOLATION: capability-security.test.ts
- **Line 348**: Capability expiration test

**Issue**: Testing time-based expiration with real time.

**Solution**: Use test doubles or controllable time:
```typescript
// Use a time provider that can be controlled in tests
const capability = new Capability({
  permissions: ['read'],
  expiry: timeProvider.now() + 100,
});

// Advance time programmatically
timeProvider.advance(150);
expect(capability.isValid()).toBe(false);
```

### 2. Implementation Details in Tests

#### ❌ VIOLATION: runtime-adapter.test.ts
- **Lines 44, 65, 308, 320, 567-594**: Direct testing of setTimeout/clearTimeout

**Issue**: These test the adapter's internal implementation, not its behavior.

**Solution**: Test the adapter's public API and observable effects.

### 3. Test Coverage Analysis

| Test File | Coverage | Key Gaps |
|-----------|----------|----------|
| actor-proxy.test.ts | ✅ Good | Error handling paths |
| ask-pattern.test.ts | ⚠️ Unknown | Timeout scenarios |
| capability-security.test.ts | ⚠️ Has timing issues | Revocation flows |
| discriminated-messages.test.ts | ⚠️ Unknown | Message validation |
| event-emission.test.ts | ✅ 97.76% | Edge cases |
| event-sourcing.test.ts | ⚠️ Has timing issues | Replay scenarios |
| graceful-shutdown.test.ts | ❌ Many timing issues | State-based testing |
| runtime-adapter.test.ts | ❌ Implementation details | Behavior testing |
| virtual-actor-system.test.ts | ⚠️ Unknown | Distribution scenarios |

### 4. Anti-Patterns Found

1. **Testing Implementation Details**
   - runtime-adapter tests check internal timer IDs
   - Some tests verify exact timing rather than outcomes

2. **Flaky Timing Tests**
   - Arbitrary delays that may fail under load
   - Race conditions in event propagation tests

3. **Missing Behavior Tests**
   - Focus on HOW rather than WHAT
   - Missing edge cases and error scenarios

## Recommendations

### Immediate Actions (P0)

1. **Remove ALL setTimeout from tests**
   - Replace with state-based testing
   - Use proper promises and async patterns
   - Implement controllable time providers where needed

2. **Refactor implementation-detail tests**
   - Focus on public API behavior
   - Remove tests that check internal state

### Short-term Actions (P1)

1. **Implement test utilities**
   ```typescript
   // Create deterministic test helpers
   export function waitForState(actor, expectedState) {
     return new Promise(resolve => {
       const sub = actor.observe(state => {
         if (state === expectedState) {
           sub.unsubscribe();
           resolve();
         }
       });
     });
   }
   ```

2. **Add missing test coverage**
   - Error handling paths
   - Edge cases
   - Concurrent operations

### Long-term Actions (P2)

1. **Establish test patterns library**
   - Document approved testing patterns
   - Create reusable test fixtures
   - Build test DSL for common scenarios

2. **Implement property-based testing**
   - For message ordering guarantees
   - For supervision strategies
   - For concurrent operations

## Test Refactoring Priority

1. **graceful-shutdown.test.ts** - Critical, many violations
2. **event-emission.test.ts** - High usage, timing issues
3. **runtime-adapter.test.ts** - Implementation detail tests
4. **capability-security.test.ts** - Time-based tests
5. **event-sourcing.test.ts** - Minor timing issues

## Success Criteria

- [ ] Zero setTimeout calls in test files
- [ ] All tests pass consistently (no flakes)
- [ ] Coverage > 80% for all modules
- [ ] Tests follow TESTING-GUIDE.md principles
- [ ] Behavior-focused test descriptions
- [ ] No implementation details in tests

## Next Steps

1. Create issue for each test file refactoring
2. Implement test utilities module
3. Update TESTING-GUIDE.md with new patterns
4. Add pre-commit hooks to prevent setTimeout in tests