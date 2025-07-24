# CLI Fix Design Document

## MAJOR ARCHITECTURAL DISCOVERY UPDATE

### ✅ SUCCESS: ES Module Issue Completely Resolved
The primary ES module error has been **completely fixed**:
- ❌ **Before**: `ReferenceError: require is not defined in ES module scope`
- ✅ **After**: CLI executes without ES module errors

### ✅ SUCCESS: Actor System Integration Fixed
Guardian actor and system initialization issues have been **completely resolved**:
- ❌ **Before**: Guardian actor missing, dead letter queue errors
- ✅ **After**: Actor system initializes properly, no more dead letter queue errors

### ❌ CRITICAL DISCOVERY: Entire CLI Violates Pure Actor Model

**MAJOR ARCHITECTURAL VIOLATION**: All CLI commands use **forbidden subscription patterns** instead of pure actor model principles defined in @FRAMEWORK-STANDARD.mdc.

### Root Cause Analysis

1. **ES Module Fix Successful** ✅
   - Package info loading now works with ES modules
   - CLI entry point successfully initializes
   - Version and help commands work perfectly

2. **Actor System Integration Fixed** ✅
   - Guardian actor properly initialized and operational
   - System event actor working correctly
   - No more dead letter queue errors

3. **🔴 CRITICAL: Pure Actor Model Violations** ❌
   - **ALL CLI commands use forbidden subscription patterns**
   - **Complex class-based handlers instead of pure functions**
   - **Event-driven workflows instead of ask/tell patterns**
   - **Violates @FRAMEWORK-STANDARD.mdc core principles**

## FORBIDDEN PATTERNS FOUND EVERYWHERE

### ❌ Current Architecture (VIOLATES FRAMEWORK-STANDARD)

```typescript
// ❌ FORBIDDEN: Subscription-based event handling
const unsubscribe = subscribeToEvent(this.actor, 'GIT_REPO_STATUS_CHANGED', (event) => {
  // Complex event subscription logic
});

// ❌ FORBIDDEN: Class-based workflow handlers
class SaveWorkflowHandler {
  async executeSave() {
    // Complex orchestration with subscriptions
  }
}

// ❌ FORBIDDEN: Complex promise orchestration with events
const changesPromise = new Promise((resolve) => {
  const unsubscribe = subscribeToEvent(actor, 'GIT_UNCOMMITTED_CHANGES_DETECTED', (event) => {
    unsubscribe();
    resolve(event.hasChanges);
  });
});
```

### ✅ Required Pure Actor Model Architecture

```typescript
// ✅ CORRECT: Simple ask/tell patterns
export async function saveCommand(customMessage?: string) {
  const gitActor = createGitActor(repoRoot);
  
  // Ask pattern for request/response
  const repoStatus = await gitActor.ask<{ isGitRepo: boolean }>({
    type: 'REQUEST_STATUS'
  });
  
  // Simple sequential operations
  await gitActor.ask({ type: 'ADD_ALL' });
  await gitActor.ask({ type: 'COMMIT_CHANGES', payload: { message } });
}
```

## AFFECTED COMMANDS (ALL NEED REFACTORING)

### Commands Analysis

1. **✅ save.ts** - **FIXED** - Now uses pure ask/tell patterns
2. **❌ ship.ts** - Uses `ShipWorkflowHandler` class with subscriptions
3. **❌ status.ts** - Uses `StatusWorkflowHandler` class with subscriptions
4. **❌ validate.ts** - Uses `ValidateWorkflowHandler` class with subscriptions
5. **❌ commit-enhanced.ts** - Uses `CommitEnhancedWorkflowHandler` class with subscriptions
6. **❌ advanced-git.ts** - Uses `AdvancedGitWorkflowHandler` class with subscriptions
7. **❌ git-actor-helpers.ts** - **DELETE ENTIRE FILE** - Provides forbidden `subscribeToEvent()` functions

## REVISED SOLUTION APPROACH

### Phase 1: ES Module Migration ✅ COMPLETE
- [x] Create async package info loading
- [x] Remove all require() calls
- [x] Convert CLI to async pattern
- [x] Verify basic CLI functionality

### Phase 2: Actor System Fix ✅ COMPLETE
- [x] Fix guardian actor initialization
- [x] Resolve dead letter queue issues
- [x] Ensure proper actor system bootstrap

### Phase 3: Pure Actor Model Compliance ❌ CRITICAL PRIORITY

**Comprehensive Refactoring Required:**

1. **Refactor ALL Commands to Pure Functions**
   ```typescript
   // Before: Class-based handlers
   class SaveWorkflowHandler { ... }
   
   // After: Simple functions with ask/tell
   export async function saveCommand() { ... }
   ```

2. **Replace ALL Subscriptions with Ask/Tell**
   ```typescript
   // Before: Event subscriptions
   subscribeToEvent(actor, 'EVENT_TYPE', callback)
   
   // After: Direct ask patterns
   await actor.ask({ type: 'REQUEST_TYPE' })
   ```

3. **Remove Complex Event Orchestration**
   ```typescript
   // Before: Promise-based event coordination
   const promise = new Promise(resolve => {
     subscribeToEvent(actor, 'EVENT', resolve);
   });
   
   // After: Simple sequential ask patterns
   const result = await actor.ask({ type: 'GET_RESULT' });
   ```

4. **Delete Forbidden Helper Functions**
   - Remove `git-actor-helpers.ts` entirely
   - Remove all `subscribeToEvent()` functions
   - Remove all class-based workflow handlers

### Implementation Plan

```typescript
// Template for ALL command refactoring:
export async function commandName(params?: CommandParams) {
  console.log(chalk.blue('🎯 Command Name'));
  
  const repoRoot = await findRepoRoot();
  const gitActor = createGitActor(repoRoot);
  
  try {
    gitActor.start();
    
    // ✅ PURE ACTOR MODEL: Simple ask/tell sequence
    const step1 = await gitActor.ask<StepResult>({ type: 'STEP_1' });
    
    if (step1.condition) {
      await gitActor.ask({ type: 'STEP_2', payload: step1.data });
    }
    
    const final = await gitActor.ask<FinalResult>({ type: 'FINAL_STEP' });
    
    console.log(chalk.green('✅ Command completed successfully!'));
  } catch (error) {
    console.error(chalk.red('❌ Command failed:'), error);
    process.exit(1);
  } finally {
    await gitActor.stop();
  }
}
```

## FRAMEWORK-STANDARD COMPLIANCE

### Required Changes Per @FRAMEWORK-STANDARD.mdc

1. **✅ Pure Actor Model - No Exceptions**
   - Replace ALL subscriptions with ask/tell patterns
   - Remove ALL class-based handlers
   - Use ONLY asynchronous message passing

2. **✅ Type Safety - Zero Tolerance for `any`**
   - Maintain strict TypeScript types
   - Use proper type guards for responses

3. **✅ Message Format - Strict Structure**
   - All ask/tell calls use proper ActorMessage format
   - Consistent message types and payloads

4. **✅ No Observable Patterns**
   - Remove ALL subscription-based patterns
   - Use ONLY pure event subscriptions if needed

## Updated Success Criteria

### Functional Requirements
- ✅ ES Module compatibility (ACHIEVED)
- ✅ Actor system integration (ACHIEVED)  
- ❌ **Pure Actor Model compliance** (CRITICAL PRIORITY)
- ❌ All CLI commands work end-to-end
- ❌ No hanging or incomplete operations

### Technical Requirements
- ✅ TypeScript compilation clean
- ✅ Actor system properly initialized
- ❌ **Zero subscription patterns** (CRITICAL)
- ❌ **Zero handler classes** (CRITICAL)
- ❌ **Only ask/tell communication** (CRITICAL)

## IMPLEMENTATION TIMELINE

### Week 1: Core Command Refactoring
- Day 1: ✅ **save.ts** (COMPLETED)
- Day 2: **ship.ts** refactoring
- Day 3: **status.ts** and **validate.ts** refactoring
- Day 4: **commit-enhanced.ts** refactoring
- Day 5: **advanced-git.ts** refactoring

### Week 2: Cleanup and Testing
- Day 6: Delete `git-actor-helpers.ts` and cleanup
- Day 7: End-to-end testing of all commands
- Day 8: Integration testing and bug fixes
- Day 9: Final validation and documentation
- Day 10: Project completion and handoff

## RISK MITIGATION

### High Risk Areas
1. **Complex Command Logic** - Some commands have intricate workflows
   - **Mitigation**: Break into simple ask/tell sequences
2. **Git Actor Compatibility** - Actor responses may need adjustment
   - **Mitigation**: Test each command individually as refactored
3. **Message Format Changes** - Actor may expect different message formats
   - **Mitigation**: Verify actor message handling for each command type

### Quality Assurance
- Test each refactored command immediately
- Verify no hanging or incomplete operations
- Ensure proper error handling and cleanup
- Validate against @FRAMEWORK-STANDARD.mdc compliance

---

**Status**: ES Module ✅ + Actor System ✅ + Pure Actor Model ❌ **CRITICAL**  
**Next Priority**: Complete pure actor model refactoring of all CLI commands  
**Timeline**: 7-10 days for comprehensive architectural compliance 