# XState Timeout Refactor Implementation Plan

## 📋 **Executive Summary**

This document outlines the comprehensive refactoring of timeout/delay mechanisms in the agent-workflow-cli package to align with XState best practices. Currently, the codebase uses manual polling, setTimeout calls, and external timeout wrappers, which fights against XState's built-in delay and timeout mechanisms.

**Goal**: Replace all manual timeout/polling code with proper XState `after` transitions, state observation, and built-in delay services.

## 🚨 **Current Problems**

### **1. Anti-Pattern: Manual Polling**
```typescript
// ❌ CURRENT: Manual polling in index.ts
const checkResult = () => {
  const snapshot = gitActor.getSnapshot();
  if (snapshot.context?.lastCommitMessage) {
    resolve(/* ... */);
  } else {
    setTimeout(checkResult, 100); // Manual polling!
  }
};
```

### **2. Anti-Pattern: External Timeout Wrappers**
```typescript
// ❌ CURRENT: External timeout wrappers
export async function waitForCompletionWithTimeout(gitActor: GitActor, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('Timeout')), timeout);
    // Manual polling here too...
  });
}
```

### **3. Anti-Pattern: Missing Machine Timeouts**
```typescript
// ❌ CURRENT: No timeout protection in states
checkingStatus: {
  invoke: {
    src: 'checkStatus',
    onDone: { target: 'idle' },
    onError: { target: 'idle' }
  }
  // No timeout handling!
}
```

## 🎯 **Desired End State**

### **1. Proper XState Timeout States**
```typescript
// ✅ TARGET: Built-in XState timeouts
checkingStatus: {
  invoke: {
    src: 'checkStatus',
    onDone: { target: 'statusChecked' },
    onError: { target: 'statusError' }
  },
  after: {
    10000: { target: 'statusTimeout' }
  }
}
```

### **2. Pure State Observation**
```typescript
// ✅ TARGET: Clean state observation
const subscription = gitActor.subscribe((snapshot) => {
  if (snapshot.value === 'statusChecked') {
    resolve(snapshot.context.status);
  } else if (snapshot.value === 'statusError') {
    reject(new Error(snapshot.context.lastError));
  } else if (snapshot.value === 'statusTimeout') {
    reject(new Error('Operation timed out'));
  }
});
```

### **3. Declarative Timeout Configuration**
```typescript
// ✅ TARGET: Configurable timeouts
const timeouts = {
  STATUS_CHECK: 10000,
  COMMIT_OPERATION: 30000,
  FETCH_REMOTE: 15000,
  PUSH_CHANGES: 20000
};
```

## 🔄 **Implementation Phases**

### **Phase 1: GitActor Machine Architecture** ⚡ HIGH PRIORITY

**Duration**: 2-3 hours  
**Risk Level**: Medium  
**Dependencies**: None  

#### **1.1 Add Timeout States**
- **File**: `packages/agent-workflow-cli/src/actors/git-actor.ts`
- **Changes**:
  - Add `after` transitions to all async states
  - Add dedicated timeout states (`statusTimeout`, `commitTimeout`, etc.)
  - Add timeout configuration constants

#### **1.2 Add Completion States**
- **Current**: Operations return to `idle` with context flags
- **Target**: Dedicated completion states (`statusChecked`, `commitCompleted`, etc.)
- **Benefit**: Clean state observation without context polling

#### **1.3 Implementation Steps**
```typescript
// Step 1: Add timeout configuration
const TIMEOUTS = {
  STATUS_CHECK: 10000,
  COMMIT_OPERATION: 30000,
  FETCH_REMOTE: 15000,
  PUSH_CHANGES: 20000,
  MERGE_BRANCH: 25000,
  GENERATE_COMMIT_MESSAGE: 15000,
  VALIDATE_DATES: 10000,
} as const;

// Step 2: Update state definitions
states: {
  idle: { /* ... */ },
  
  checkingStatus: {
    invoke: {
      src: 'checkStatus',
      onDone: { target: 'statusChecked' },
      onError: { target: 'statusError' }
    },
    after: {
      [TIMEOUTS.STATUS_CHECK]: { target: 'statusTimeout' }
    }
  },
  
  statusChecked: {
    entry: assign({
      lastOperation: () => 'STATUS_CHECK_DONE',
      currentBranch: ({ event }) => event.output.currentBranch,
      agentType: ({ event }) => event.output.agentType,
    }),
    on: {
      CONTINUE: 'idle',
      // Allow immediate next operations
      CHECK_REPO: 'checkingRepo',
      COMMIT_CHANGES: 'committingChanges',
    }
  },
  
  statusError: {
    entry: assign({
      lastError: ({ event }) => event.error.message,
      lastOperation: () => 'STATUS_CHECK_ERROR',
    }),
    on: {
      RETRY: 'checkingStatus',
      CONTINUE: 'idle',
    }
  },
  
  statusTimeout: {
    entry: assign({
      lastError: () => 'Status check timed out',
      lastOperation: () => 'STATUS_CHECK_TIMEOUT',
    }),
    on: {
      RETRY: 'checkingStatus',
      CONTINUE: 'idle',
    }
  },
  
  // Repeat for all async operations...
}
```

#### **1.4 Testing Strategy**
```typescript
// Test timeout behavior
it('should timeout status check after 10 seconds', async () => {
  // Mock long-running operation
  mockGit.status.mockImplementation(() => new Promise(() => {}));
  
  gitActor.start();
  gitActor.send({ type: 'CHECK_STATUS' });
  
  // Wait for timeout state
  await waitForState(gitActor, 'statusTimeout', 15000);
  
  const snapshot = gitActor.getSnapshot();
  expect(snapshot.value).toBe('statusTimeout');
  expect(snapshot.context.lastError).toBe('Status check timed out');
});
```

### **Phase 2: Remove Manual Polling** 🎯 CRITICAL

**Duration**: 1-2 hours  
**Risk Level**: Low  
**Dependencies**: Phase 1 complete  

#### **2.1 Fix index.ts Functions**
- **File**: `packages/agent-workflow-cli/src/index.ts`
- **Functions**: `generateIntelligentCommitMessage`, `validateDocumentationDates`

#### **2.2 Implementation**
```typescript
// ✅ AFTER: Clean state observation
export async function generateIntelligentCommitMessage(baseDir?: string): Promise<CommitAnalysis> {
  const { createGitActor } = await import('./actors/git-actor.js');
  const gitActor = createGitActor(baseDir);

  return new Promise((resolve, reject) => {
    const subscription = gitActor.subscribe((snapshot) => {
      if (snapshot.value === 'commitMessageGenerated') {
        gitActor.stop();
        resolve({
          type: snapshot.context.commitConfig.type,
          scope: snapshot.context.commitConfig.scope,
          description: snapshot.context.commitConfig.description,
          workCategory: snapshot.context.commitConfig.workCategory,
          agentType: snapshot.context.agentType,
          files: snapshot.context.changedFiles || [],
          projectTag: snapshot.context.commitConfig.projectTag,
        });
      } else if (snapshot.value === 'commitMessageError') {
        gitActor.stop();
        reject(new Error(snapshot.context.lastError));
      } else if (snapshot.value === 'commitMessageTimeout') {
        gitActor.stop();
        reject(new Error('Commit message generation timed out'));
      }
    });

    gitActor.start();
    gitActor.send({ type: 'GENERATE_COMMIT_MESSAGE' });
  });
}
```

#### **2.3 Validation**
- Remove all `setTimeout` calls from `index.ts`
- Remove manual polling loops
- Ensure clean subscription-based observation

### **Phase 3: Eliminate Helper Function Timeouts** 🔧 MEDIUM PRIORITY

**Duration**: 1 hour  
**Risk Level**: Low  
**Dependencies**: Phase 1 & 2 complete  

#### **3.1 Remove External Timeout Wrappers**
- **File**: `packages/agent-workflow-cli/src/actors/git-actor-helpers.ts`
- **Remove**: `waitForCompletionWithTimeout` function
- **Replace**: Direct state observation in calling code

#### **3.2 Update Command Functions**
- **File**: `packages/agent-workflow-cli/src/commands/commit-enhanced.ts`
- **Replace**: All `waitForCompletionWithTimeout` calls with state observation

```typescript
// ❌ BEFORE: External timeout wrapper
await waitForCompletionWithTimeout(gitActor, 10000);

// ✅ AFTER: Direct state observation
await new Promise((resolve, reject) => {
  const subscription = gitActor.subscribe((snapshot) => {
    if (snapshot.value === 'commitCompleted') {
      resolve();
    } else if (snapshot.value === 'commitError' || snapshot.value === 'commitTimeout') {
      reject(new Error(snapshot.context.lastError));
    }
  });
});
```

### **Phase 4: Refactor Test Utilities** 🧪 LOW PRIORITY

**Duration**: 1 hour  
**Risk Level**: Low  
**Dependencies**: Phase 1-3 complete  

#### **4.1 Update Test Utils**
- **File**: `packages/agent-workflow-cli/src/test-utils.ts`
- **Replace**: Polling-based `waitFor` functions with XState testing utilities

#### **4.2 Implementation**
```typescript
// ✅ AFTER: XState-aligned testing
export async function waitForState(
  actor: { subscribe: (fn: Function) => { unsubscribe: () => void } },
  targetState: string,
  timeout = 1000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      subscription.unsubscribe();
      reject(new Error(`Timeout waiting for state: ${targetState}`));
    }, timeout);

    const subscription = actor.subscribe((snapshot) => {
      if (snapshot.value === targetState) {
        clearTimeout(timeoutId);
        subscription.unsubscribe();
        resolve();
      }
    });
  });
}
```

### **Phase 5: Add Advanced Git Command Delays** 🚀 ENHANCEMENT

**Duration**: 30 minutes  
**Risk Level**: Very Low  
**Dependencies**: Phase 1-4 complete  

#### **5.1 Replace Manual Delays**
- **File**: `packages/agent-workflow-cli/src/commands/advanced-git.ts`
- **Replace**: `setTimeout(resolve, 500)` with XState delay services

#### **5.2 Implementation**
```typescript
// ✅ AFTER: XState delay service
import { createDelayService } from '@actor-web/core';

const delayMachine = createMachine({
  id: 'gitCommandDelay',
  actors: {
    delay: createDelayService(),
  },
  initial: 'waiting',
  states: {
    waiting: {
      invoke: {
        src: 'delay',
        input: { delay: 500 },
        onDone: { target: 'ready' }
      }
    },
    ready: {
      type: 'final'
    }
  }
});
```

## 📊 **Success Criteria**

### **Code Quality Metrics**
- [ ] **Zero `setTimeout` calls** in non-test code
- [ ] **Zero manual polling loops** 
- [ ] **All async operations have timeout states**
- [ ] **Clean state observation patterns**
- [ ] **No external timeout wrappers**

### **Functional Requirements**
- [ ] **All existing functionality preserved**
- [ ] **Consistent timeout behavior**
- [ ] **Proper error handling for timeouts**
- [ ] **Better testability**
- [ ] **Improved debugging experience**

### **Performance Improvements**
- [ ] **Reduced CPU usage** (no polling)
- [ ] **Faster response times** (immediate state changes)
- [ ] **Better memory management** (no timeout accumulation)

## 🧪 **Testing Strategy**

### **Unit Tests**
- Test timeout behavior for each state
- Test state transitions on success/error/timeout
- Test subscription cleanup
- Test error message accuracy

### **Integration Tests**
- Test complete workflows with timeouts
- Test timeout recovery mechanisms
- Test concurrent operations

### **Performance Tests**
- Measure CPU usage before/after
- Measure memory usage patterns
- Test timeout accuracy

## ⚠️ **Risk Mitigation**

### **High Risk**: Machine Architecture Changes
- **Mitigation**: Implement incrementally, test each state
- **Rollback**: Keep original code until full verification
- **Validation**: Comprehensive state transition tests

### **Medium Risk**: Breaking Existing API**
- **Mitigation**: Maintain backward compatibility in public APIs
- **Rollback**: Wrapper functions for deprecated APIs
- **Validation**: Integration tests for all command functions

### **Low Risk**: Test Utility Changes**
- **Mitigation**: Update tests incrementally
- **Rollback**: Keep old test utilities until migration complete
- **Validation**: Ensure all tests pass with new utilities

## 🎯 **Implementation Checklist**

### **Pre-Implementation**
- [ ] Review current timeout usage audit
- [ ] Set up feature branch for refactoring
- [ ] Ensure all existing tests pass
- [ ] Document current behavior for reference

### **Phase 1: GitActor Machine**
- [ ] Add timeout constants
- [ ] Add timeout states for all async operations
- [ ] Add completion states for all operations
- [ ] Update state transitions
- [ ] Add timeout-specific error handling
- [ ] Test timeout behavior for each state
- [ ] Verify all existing functionality preserved

### **Phase 2: Remove Manual Polling**
- [ ] Update `generateIntelligentCommitMessage`
- [ ] Update `validateDocumentationDates`
- [ ] Remove all setTimeout calls from index.ts
- [ ] Add proper subscription cleanup
- [ ] Test state observation patterns
- [ ] Verify no polling loops remain

### **Phase 3: Eliminate Helper Timeouts**
- [ ] Remove `waitForCompletionWithTimeout`
- [ ] Update commit-enhanced.ts
- [ ] Update all command functions
- [ ] Test direct state observation
- [ ] Verify no external timeout wrappers

### **Phase 4: Refactor Test Utilities**
- [ ] Update waitForState implementation
- [ ] Update waitForIdle implementation
- [ ] Remove polling from test utils
- [ ] Update all test files
- [ ] Verify all tests pass

### **Phase 5: Advanced Git Commands**
- [ ] Replace setTimeout in advanced-git.ts
- [ ] Implement XState delay services
- [ ] Test delay behavior
- [ ] Verify command timing preserved

### **Post-Implementation**
- [ ] Full integration testing
- [ ] Performance benchmarking
- [ ] Documentation updates
- [ ] Code review and approval
- [ ] Deployment and monitoring

## 📝 **Notes and Considerations**

### **XState Best Practices**
- Use `after` transitions for all timeouts
- Use dedicated completion states instead of context flags
- Use proper error states for different failure modes
- Use XState testing utilities for state observation

### **Backward Compatibility**
- Maintain existing public APIs during transition
- Provide migration path for external consumers
- Document breaking changes clearly

### **Future Enhancements**
- Consider configurable timeout values
- Add timeout retry mechanisms
- Implement exponential backoff for retries
- Add timeout monitoring and metrics

---

## 🚀 **Ready to Begin**

This plan provides a comprehensive roadmap for refactoring all timeout/delay code to use proper XState patterns. Each phase builds on the previous one, ensuring a smooth transition while maintaining functionality.

**Next Step**: Begin Phase 1 - GitActor Machine Architecture refactoring. 