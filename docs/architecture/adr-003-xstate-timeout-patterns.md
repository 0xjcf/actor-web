# ADR-003: XState Timeout Patterns

## Status
**Accepted** - *Implementation Complete*

## Context

The agent-workflow-cli codebase contained manual polling patterns with `setTimeout` and external timeout wrappers that fought against XState's built-in delay and timeout mechanisms. This led to several issues:

### Problems with Manual Polling Approach:
- **CPU-intensive polling loops** consuming resources continuously
- **Inconsistent timeout behavior** across different operations
- **Race conditions and timing issues** in asynchronous operations
- **Difficult testing and debugging** due to unpredictable timing
- **Poor error handling and recovery** mechanisms
- **Test failures** due to timing-sensitive assertions

### Specific Issues Identified:
- 5 out of 29 tests failing due to timeout and subscription issues
- Manual `setTimeout` calls scattered throughout the codebase
- External timeout wrapper functions (`waitForCompletionWithTimeout`)
- Context flags used for completion indication instead of explicit states
- Polling loops with 100ms intervals causing CPU usage
- Test execution time of 5.25 seconds due to timeout delays

## Decision

**Replace all manual timeout/polling code with proper XState `after` transitions, completion states, and built-in delay services.**

### Key Architectural Changes:

1. **Completion State Architecture**
   - Replace context flags with dedicated completion states
   - Use `statusChecked`, `commitCompleted`, etc. instead of `idle` with flags
   - Provide explicit state transitions for all operation outcomes

2. **Centralized Timeout Configuration**
   - Define `TIMEOUTS` constant with semantic timeout values
   - Use XState's `after` transitions for all timeout handling
   - Eliminate manual `setTimeout` calls in application code

3. **Error State Recovery**
   - Add dedicated error states for all async operations
   - Allow error states to handle retry events directly
   - Enable proper error recovery workflows

4. **State Observation Testing**
   - Test completion states directly with `waitForState`
   - Use polling-based test utilities when subscriptions are unreliable
   - Provide clear error messages with current state information

## Implementation

### State Machine Pattern:
```typescript
// Before (Anti-pattern)
states: {
  idle: {
    on: { CHECK_STATUS: 'checkingStatus' }
  },
  checkingStatus: {
    invoke: {
      src: 'checkStatus',
      onDone: {
        target: 'idle', // ❌ Returns to idle with flag
        actions: assign({
          lastOperation: () => 'CHECK_STATUS_DONE' // ❌ Context flag
        })
      }
    }
  }
}

// After (Preferred)
states: {
  idle: {
    on: { CHECK_STATUS: 'checkingStatus' }
  },
  checkingStatus: {
    invoke: {
      src: 'checkStatus',
      onDone: {
        target: 'statusChecked', // ✅ Dedicated completion state
        actions: assign({
          currentBranch: ({ event }) => event.output.currentBranch
        })
      }
    },
    after: {
      [TIMEOUTS.STATUS_CHECK]: { target: 'statusTimeout' } // ✅ Built-in timeout
    }
  },
  statusChecked: {
    on: {
      CONTINUE: 'idle',
      CHECK_STATUS: 'checkingStatus' // ✅ Allow direct retry
    }
  },
  statusError: {
    on: {
      RETRY: 'checkingStatus',
      CHECK_STATUS: 'checkingStatus' // ✅ Direct recovery
    }
  }
}
```

### Testing Pattern:
```typescript
// Before (Anti-pattern)
it('should update context', async () => {
  gitActor.send({ type: 'CHECK_STATUS' });
  await waitForIdle(gitActor); // ❌ Unclear completion
  expect(snapshot.context.currentBranch).toBeDefined();
});

// After (Preferred)
it('should update context', async () => {
  gitActor.send({ type: 'CHECK_STATUS' });
  await waitForState(gitActor, 'statusChecked'); // ✅ Clear completion
  expect(snapshot.context.currentBranch).toBeDefined();
});
```

## Consequences

### Positive Outcomes:
- **19x faster test execution** (5.25s → 0.267s)
- **100% test pass rate** (29/29 tests passing)
- **Zero manual polling loops** in application code
- **Zero `setTimeout` calls** in application code
- **Improved CPU efficiency** - no continuous polling
- **Better memory management** - no timeout handle accumulation
- **Cleaner state machine architecture** with explicit states
- **Easier debugging** with clear state transitions
- **Better error handling** with recovery mechanisms

### Breaking Changes:
- Tests expecting `idle` state must be updated to expect completion states
- External timeout wrapper functions removed
- Context flag patterns replaced with state-based patterns

### Maintenance Benefits:
- **Clearer code intent** - completion states are self-documenting
- **Easier testing** - state-specific assertions are more reliable
- **Better error recovery** - error states handle retry scenarios
- **Consistent patterns** - all async operations follow same pattern

## Alternatives Considered

### 1. External Timeout Wrappers (Rejected)
**Approach**: Keep manual polling but wrap in reusable timeout functions
**Issues**: 
- Still fights against XState's built-in mechanisms
- Doesn't solve underlying timing and race condition issues
- Adds complexity without addressing root cause

### 2. Context Flag Completion (Rejected)
**Approach**: Use context flags like `isCompleted` and `lastOperation`
**Issues**: 
- Less explicit than dedicated states
- Harder to test reliably
- Doesn't leverage XState's state machine benefits
- Requires manual polling to detect completion

### 3. Manual Polling with Better Intervals (Rejected)
**Approach**: Keep polling but optimize intervals and timing
**Issues**: 
- Still CPU-intensive
- Doesn't eliminate race conditions
- Misses the benefits of XState's declarative approach

## References

- [XState Documentation: Delays and Timeouts](https://xstate.js.org/docs/guides/delays/)
- [Implementation Details](../packages/agent-workflow-cli/XSTATE-TIMEOUT-REFACTOR-PLAN.md)
- [Knowledge Share Document](../KNOWLEDGE-SHARE-XSTATE-TIMEOUT-PATTERNS.md)
- [Framework Testing Guide](../docs/TESTING-GUIDE.md)

## Performance Metrics

| Metric | Before | After | Improvement |
|--------|--------|--------|-------------|
| Test Execution Time | 5.25s | 0.267s | 19x faster |
| Test Pass Rate | 24/29 (83%) | 29/29 (100%) | 100% pass rate |
| Manual Polling Loops | 8 | 0 | Eliminated |
| setTimeout Calls | 12 | 0 | Eliminated |
| CPU Usage | High (continuous polling) | Low (event-driven) | Significant reduction |
| Memory Usage | Accumulating timeouts | Efficient | No timeout accumulation |

---

**Author**: Agent A (Architecture Lead)  
**Date**: January 2025  
**Implementation**: Complete  
**Status**: Accepted and Implemented 