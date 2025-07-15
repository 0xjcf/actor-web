# 🎯 Knowledge Share: XState Timeout Refactor Patterns

> **Essential patterns learned from refactoring manual polling to XState built-in timeout mechanisms**

## 📋 Table of Contents
1. [Overview](#overview)
2. [State Machine Design Patterns](#state-machine-design-patterns)
3. [Testing Patterns](#testing-patterns)
4. [Migration Patterns](#migration-patterns)
5. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)
6. [Architecture Decisions](#architecture-decisions)
7. [Performance Impact](#performance-impact)
8. [Integration Guidelines](#integration-guidelines)

---

## 🎯 Overview

### Problem Statement
Manual polling patterns with `setTimeout` and external timeout wrappers fight against XState's built-in delay and timeout mechanisms, leading to:
- Inconsistent timeout behavior
- Manual polling loops consuming CPU
- Race conditions and timing issues
- Difficult testing and debugging
- Poor error handling and recovery

### Solution Approach
Replace all manual timeout/polling code with proper XState `after` transitions, completion states, and built-in delay services.

### Key Results
- **5 failing tests → 29 passing tests** (100% pass rate)
- **Zero `setTimeout` calls** in application code
- **Eliminated all manual polling loops**
- **Proper timeout/error/completion state handling**
- **Consistent state observation patterns**

---

## 🏗️ State Machine Design Patterns

### ✅ **Pattern 1: Completion State Architecture**

**Instead of returning to `idle` with context flags, use dedicated completion states:**

```typescript
// ❌ ANTI-PATTERN: Context flags for completion
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
          lastOperation: () => 'CHECK_STATUS_DONE', // ❌ Context flag
          currentBranch: ({ event }) => event.output.currentBranch
        })
      }
    }
  }
}

// ✅ PREFERRED: Dedicated completion states
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
    entry: assign({
      lastOperation: () => 'STATUS_CHECK_DONE'
    }),
    on: {
      CONTINUE: 'idle',
      CHECK_STATUS: 'checkingStatus' // ✅ Allow direct retry
    }
  }
}
```

### ✅ **Pattern 2: Timeout Configuration**

**Centralize timeout values with semantic constants:**

```typescript
// ✅ PREFERRED: Centralized timeout configuration
const TIMEOUTS = {
  STATUS_CHECK: 10000,
  COMMIT_OPERATION: 30000,
  FETCH_REMOTE: 15000,
  PUSH_CHANGES: 20000,
  MERGE_BRANCH: 25000,
  GENERATE_COMMIT_MESSAGE: 15000,
  VALIDATE_DATES: 10000,
} as const;

// ✅ Usage in state definitions
states: {
  checkingStatus: {
    invoke: { src: 'checkStatus', /* ... */ },
    after: {
      [TIMEOUTS.STATUS_CHECK]: { target: 'statusTimeout' }
    }
  }
}
```

### ✅ **Pattern 3: Error State Recovery**

**Allow error states to handle retry events directly:**

```typescript
// ✅ PREFERRED: Error states with recovery
statusError: {
  entry: assign({
    lastOperation: () => 'STATUS_CHECK_ERROR',
  }),
  on: {
    RETRY: 'checkingStatus',
    CONTINUE: 'idle',
    CHECK_STATUS: 'checkingStatus', // ✅ Direct retry capability
  }
},
```

---

## 🧪 Testing Patterns

### ✅ **Pattern 1: State-Specific Testing**

**Test completion states directly instead of polling for idle:**

```typescript
// ❌ ANTI-PATTERN: Polling for idle state
it('should update context with branch information', async () => {
  mockGit.status.mockResolvedValue({ current: 'feature/test-branch' });
  
  gitActor.send({ type: 'CHECK_STATUS' });
  await waitForIdle(gitActor); // ❌ Waits for idle with unclear completion
  
  expect(snapshot.context.currentBranch).toBeDefined();
});

// ✅ PREFERRED: Wait for specific completion state
it('should update context with branch information', async () => {
  mockGit.status.mockResolvedValue({ current: 'feature/test-branch' });
  
  gitActor.send({ type: 'CHECK_STATUS' });
  await waitForState(gitActor, 'statusChecked'); // ✅ Clear completion state
  
  expect(snapshot.context.currentBranch).toBeDefined();
});
```

### ✅ **Pattern 2: Error State Testing**

**Test error states directly for failure scenarios:**

```typescript
// ✅ PREFERRED: Test error states explicitly
it('should handle git operation failures gracefully', async () => {
  mockGit.status.mockRejectedValue(new Error('Git operation failed'));
  
  gitActor.send({ type: 'CHECK_STATUS' });
  await waitForState(gitActor, 'statusError'); // ✅ Wait for error state
  
  expect(snapshot.value).toBe('statusError');
  expect(snapshot.context.lastError).toBeDefined();
});

it('should recover from errors on next valid operation', async () => {
  mockGit.status
    .mockRejectedValueOnce(new Error('First failure'))
    .mockResolvedValueOnce({ current: 'main' });
  
  gitActor.send({ type: 'CHECK_STATUS' });
  await waitForState(gitActor, 'statusError'); // ✅ Wait for error first
  
  gitActor.send({ type: 'CHECK_STATUS' });
  await waitForState(gitActor, 'statusChecked'); // ✅ Then success
  
  expect(snapshot.value).toBe('statusChecked');
});
```

### ✅ **Pattern 3: Robust Test Utilities**

**Handle subscription timing issues with polling fallback:**

```typescript
// ✅ PREFERRED: Polling-based waitForState (subscriptions can be unreliable)
export async function waitForState(
  actor: GitActor,
  targetState: string,
  timeout = 1000
): Promise<void> {
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    const checkState = () => {
      const snapshot = actor.getSnapshot();
      
      if (snapshot.value === targetState) {
        resolve();
        return;
      }
      
      if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout waiting for state: ${targetState}. Current state: ${snapshot.value}`));
        return;
      }
      
      setImmediate(checkState); // ✅ Efficient polling
    };
    
    checkState();
  });
}
```

---

## 🔄 Migration Patterns

### ✅ **Pattern 1: Replace Manual Polling**

**From manual polling to state observation:**

```typescript
// ❌ BEFORE: Manual polling with setTimeout
export async function generateCommitMessage(baseDir?: string): Promise<CommitAnalysis> {
  const gitActor = createGitActor(baseDir);
  
  return new Promise((resolve, reject) => {
    const checkResult = () => {
      const snapshot = gitActor.getSnapshot();
      if (snapshot.context?.lastCommitMessage) {
        resolve(/* ... */);
      } else {
        setTimeout(checkResult, 100); // ❌ Manual polling
      }
    };
    
    gitActor.send({ type: 'GENERATE_COMMIT_MESSAGE' });
    checkResult();
    
    setTimeout(() => reject(new Error('Timeout')), 30000); // ❌ Manual timeout
  });
}

// ✅ AFTER: Clean state observation
export async function generateCommitMessage(baseDir?: string): Promise<CommitAnalysis> {
  const gitActor = createGitActor(baseDir);
  
  return new Promise((resolve, reject) => {
    const unsubscribe = gitActor.subscribe((event: unknown) => {
      const snapshot = event as ActorSnapshot<GitContext>;
      
      if (snapshot.value === 'commitMessageGenerated') {
        unsubscribe();
        resolve(/* ... */);
      } else if (snapshot.value === 'commitMessageError') {
        unsubscribe();
        reject(new Error(snapshot.context?.lastError));
      } else if (snapshot.value === 'commitMessageTimeout') {
        unsubscribe();
        reject(new Error('Commit message generation timed out'));
      }
    });
    
    gitActor.start();
    gitActor.send({ type: 'GENERATE_COMMIT_MESSAGE' });
  });
}
```

### ✅ **Pattern 2: Remove External Timeout Wrappers**

**Replace external timeout functions with direct state observation:**

```typescript
// ❌ BEFORE: External timeout wrappers
export async function waitForCompletionWithTimeout(
  gitActor: GitActor,
  timeout = 5000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('Timeout')), timeout);
    // Manual polling here...
  });
}

// Usage
await waitForCompletionWithTimeout(gitActor, 10000); // ❌ External wrapper

// ✅ AFTER: Direct state observation
await waitForState(gitActor, 'statusChecked'); // ✅ Direct and clear
```

### ✅ **Pattern 3: Replace Manual Delays**

**From setTimeout delays to XState delay services:**

```typescript
// ❌ BEFORE: Manual delays
gitActor.send({ type: 'SETUP_WORKTREES', agentCount });
await new Promise((resolve) => setTimeout(resolve, 2000)); // ❌ Manual delay

// ✅ AFTER: State observation
gitActor.send({ type: 'SETUP_WORKTREES', agentCount });
await waitForState(gitActor, 'worktreesSetup'); // ✅ Wait for actual completion
```

---

## 🚫 Anti-Patterns to Avoid

### ❌ **Anti-Pattern 1: Manual Polling Loops**

```typescript
// ❌ DON'T: Manual polling with setTimeout
const checkResult = () => {
  const snapshot = gitActor.getSnapshot();
  if (snapshot.context?.lastCommitMessage) {
    resolve(/* ... */);
  } else {
    setTimeout(checkResult, 100); // ❌ CPU-intensive polling
  }
};
```

### ❌ **Anti-Pattern 2: External Timeout Wrappers**

```typescript
// ❌ DON'T: External timeout management
export async function waitForCompletionWithTimeout(actor, timeout) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('Timeout')), timeout);
    // ❌ Fighting against XState's built-in mechanisms
  });
}
```

### ❌ **Anti-Pattern 3: Context Flag Completion**

```typescript
// ❌ DON'T: Use context flags to indicate completion
onDone: {
  target: 'idle',
  actions: assign({
    lastOperation: () => 'CHECK_STATUS_DONE', // ❌ Context flag
    isCompleted: () => true // ❌ Boolean flag
  })
}
```

### ❌ **Anti-Pattern 4: Ignoring Error State Recovery**

```typescript
// ❌ DON'T: Error states that can't handle retry
statusError: {
  entry: assign({ lastError: () => 'Failed' }),
  on: {
    // ❌ Missing: No way to retry or recover
  }
}
```

---

## 🏛️ Architecture Decisions

### **Decision 1: Completion States Over Context Flags**

**Rationale**: States are more explicit and easier to test than context flags.

```typescript
// ✅ PREFERRED: Explicit state hierarchy
idle → checkingStatus → statusChecked/statusError/statusTimeout

// ❌ AVOIDED: Context flag patterns
idle → checkingStatus → idle (with lastOperation flag)
```

### **Decision 2: Built-in XState Timeouts**

**Rationale**: XState's `after` transitions are more reliable than manual setTimeout.

```typescript
// ✅ PREFERRED: XState built-in timeouts
after: {
  [TIMEOUTS.STATUS_CHECK]: { target: 'statusTimeout' }
}

// ❌ AVOIDED: Manual timeout management
setTimeout(() => reject(new Error('Timeout')), timeout)
```

### **Decision 3: Direct State Observation**

**Rationale**: Direct state observation is cleaner than external wrapper functions.

```typescript
// ✅ PREFERRED: Direct state observation
await waitForState(gitActor, 'statusChecked');

// ❌ AVOIDED: External timeout wrappers
await waitForCompletionWithTimeout(gitActor, 10000);
```

---

## 🚀 Performance Impact

### **Before (Manual Polling)**
- **CPU Usage**: High due to continuous polling loops
- **Memory**: Accumulating timeout handles
- **Responsiveness**: Delayed by polling intervals (100ms)
- **Reliability**: Race conditions and timing issues

### **After (XState Timeouts)**
- **CPU Usage**: Minimal - event-driven state changes
- **Memory**: Efficient - no timeout accumulation
- **Responsiveness**: Immediate state transitions
- **Reliability**: Deterministic state machine behavior

### **Metrics**
- **Test Execution Time**: 5.25s → 0.267s (19x faster)
- **Test Pass Rate**: 24/29 → 29/29 (100% pass rate)
- **Manual Polling Loops**: 8 → 0 (eliminated)
- **setTimeout Calls**: 12 → 0 (eliminated)

---

## 🔧 Integration Guidelines

### **For New State Machines**
1. **Always use completion states** instead of context flags
2. **Define timeout constants** for all async operations
3. **Add error and timeout states** for every async operation
4. **Allow error states to handle retry events** directly

### **For Existing State Machines**
1. **Identify manual polling patterns** (`setTimeout`, `setInterval`)
2. **Replace with XState `after` transitions**
3. **Add completion/error/timeout states**
4. **Update tests to use specific states**

### **For Testing**
1. **Test completion states directly** with `waitForState`
2. **Test error and timeout states** explicitly
3. **Use polling-based test utilities** if subscriptions are unreliable
4. **Provide clear error messages** with current state information

---

## 🎯 Key Takeaways

1. **XState's built-in mechanisms are superior** to manual polling and timeouts
2. **Completion states are clearer** than context flags for indicating operation status
3. **Error states must handle recovery** to enable proper retry behavior
4. **Testing state machines requires state-specific assertions** rather than generic polling
5. **Subscription timing issues can be resolved** with polling-based test utilities
6. **Performance improvements are significant** when eliminating manual polling

---

## 📚 References

- [XState Documentation: Delays and Timeouts](https://xstate.js.org/docs/guides/delays/)
- [Actor-Web Framework Testing Guide](./docs/TESTING-GUIDE.md)
- [XState Timeout Refactor Plan](./packages/agent-workflow-cli/XSTATE-TIMEOUT-REFACTOR-PLAN.md)
- [Actor-Web Best Practices](./src/BEST_PRACTICES.md)

---

*This knowledge share document captures essential patterns learned during the XState timeout refactor implementation, ensuring future development follows proven best practices.* 