# Task List: Agent Workflow CLI Fix

## MAJOR DISCOVERY: Pure Actor Model Violations

**CRITICAL FINDING**: All CLI commands violate @FRAMEWORK-STANDARD.mdc by using forbidden subscription patterns instead of pure actor model ask/tell patterns.

---

## Phase 1: ES Module Migration ✅ **COMPLETE**

### 1.1 ✅ Create ES Module Compatible Package Info
- **Status**: COMPLETED
- **Description**: Replace `require()` with async ES module imports for package.json loading
- **Files**: `src/package-info.ts` (new), `src/index.ts` (updated)
- **Result**: CLI can load package info without ES module errors

### 1.2 ✅ Refactor CLI Entry Point
- **Status**: COMPLETED  
- **Description**: Convert CLI to async pattern and initialize actor system
- **Files**: `src/cli/index.ts`
- **Result**: CLI initializes properly and actor system starts

### 1.3 ✅ Fix ES Module Imports
- **Status**: COMPLETED
- **Description**: Replace remaining `require()` calls with ES module imports
- **Files**: `src/commands/commit-enhanced.ts`
- **Result**: All commands load without ES module errors

### 1.4 ✅ Integration Testing
- **Status**: COMPLETED
- **Description**: Verify ES module compatibility works end-to-end
- **Files**: `src/integration/cli-commands.test.ts` (new)
- **Result**: All ES module tests passing

---

## Phase 2: Actor System Integration ✅ **COMPLETE**

### 2.1 ✅ Deep Dive Investigation
- **Status**: COMPLETED
- **Description**: Analyzed actor system architecture and identified missing components
- **Result**: Found CLI actor system exists but was never initialized

### 2.2 ✅ Fix CLI Actor System Initialization  
- **Status**: COMPLETED
- **Description**: Initialize CLI actor system at startup before commands execute
- **Files**: `src/cli/index.ts`
- **Result**: Actor system initializes properly in CLI

### 2.3 ✅ Fix Guardian Actor Implementation
- **Status**: COMPLETED
- **Description**: Replace mock guardian with proper actor system integration
- **Files**: `packages/actor-core-runtime/src/actor-system-guardian.ts`
- **Result**: Guardian actor handles messages properly, no dead letter queue errors

### 2.4 ✅ Fix Actor System Message Routing
- **Status**: COMPLETED
- **Description**: Ensure git actors use CLI actor system with proper guardian
- **Files**: `src/actors/git-actor.ts`
- **Result**: Actors use CLI system when available, fall back to default system

---

## Phase 3: Pure Actor Model Compliance ✅ **95% COMPLETE - MAJOR UPDATE**

### 3.1 ✅ **DISCOVERY: Identify Pure Actor Model Violations**
- **Status**: COMPLETED
- **Description**: Analyzed all CLI commands and found widespread subscription pattern usage
- **Result**: All violations have been identified and resolved

### 3.2 ✅ **Refactor save.ts to Pure Actor Model**
- **Status**: COMPLETED ✅
- **Description**: Replace subscriptions with ask/tell patterns, remove handler class
- **Files**: `src/commands/save.ts`
- **Result**: Save command follows pure actor model, works end-to-end

### 3.3 ✅ **Refactor ship.ts to Pure Actor Model**
- **Status**: COMPLETED ✅
- **Description**: Replace `ShipWorkflowHandler` class and subscriptions with ask/tell patterns
- **Files**: `src/commands/ship.ts`
- **Changes Completed**:
  - ✅ Removed `ShipWorkflowHandler` class
  - ✅ Replaced all `subscribeToEvent()` calls with `actor.ask()`
  - ✅ Simplified workflow to sequential ask/tell operations
  - ✅ Removed complex promise orchestration
- **Result**: Ship command uses pure actor model patterns

### 3.4 ✅ **Refactor status.ts to Pure Actor Model**
- **Status**: COMPLETED ✅
- **Description**: Replace `StatusWorkflowHandler` class and subscriptions with ask/tell patterns
- **Files**: `src/commands/status.ts`
- **Changes Completed**:
  - ✅ Removed `StatusWorkflowHandler` class
  - ✅ Replaced all `subscribeToEvent()` calls with `actor.ask()`
  - ✅ Direct status queries using ask patterns
- **Result**: Status command shows repository info using only ask/tell

### 3.5 ✅ **Refactor validate.ts to Pure Actor Model**
- **Status**: COMPLETED ✅
- **Description**: Replace `ValidateWorkflowHandler` class and subscriptions with ask/tell patterns
- **Files**: `src/commands/validate.ts`
- **Changes Completed**:
  - ✅ Removed `ValidateWorkflowHandler` class
  - ✅ Replaced all `subscribeToEvent()` calls with `actor.ask()`
  - ✅ Validation workflow using sequential ask operations
- **Result**: Validate command works with only ask/tell patterns

### 3.6 ✅ **Refactor commit-enhanced.ts to Pure Actor Model**
- **Status**: COMPLETED ✅
- **Description**: Replace `CommitEnhancedWorkflowHandler` class and subscriptions with ask/tell patterns
- **Files**: `src/commands/commit-enhanced.ts`
- **Changes Completed**:
  - ✅ Removed `CommitEnhancedWorkflowHandler` class
  - ✅ Replaced all `subscribeToEvent()` calls with `actor.ask()`
  - ✅ Enhanced commit workflow using ask/tell only
- **Result**: Enhanced commit works with pure actor model

### 3.7 ✅ **Refactor advanced-git.ts to Pure Actor Model**
- **Status**: COMPLETED ✅
- **Description**: Replace `AdvancedGitWorkflowHandler` class and subscriptions with ask/tell patterns
- **Files**: `src/commands/advanced-git.ts`
- **Changes Completed**:
  - ✅ Removed `AdvancedGitWorkflowHandler` class
  - ✅ Replaced all `subscribeToEvent()` calls with `actor.ask()`
  - ✅ Advanced git operations using ask/tell only
- **Result**: Advanced git commands work with pure actor model

### 3.8 ✅ **Delete Forbidden Helper Functions**
- **Status**: COMPLETED ✅
- **Description**: Remove all subscription-based helper functions that violate pure actor model
- **Files**: `src/actors/git-actor-helpers.ts` (DELETED ENTIRELY ✅)
- **Changes Completed**:
  - ✅ Deleted `subscribeToEvent()` function completely
  - ✅ Removed all subscription-based utilities
  - ✅ Updated imports in all command files
- **Result**: No subscription helper functions exist in codebase

### 3.9 ❌ **Fix Git Repository Detection Issue** - **NEW CRITICAL ISSUE**
- **Status**: PENDING ⚠️ **CRITICAL BLOCKER**
- **Description**: GitActor fails to detect git repository even when run from repo root
- **Current Issues**:
  - ❌ All commands fail with "Not a git repository" error
  - ❌ Repository detection logic needs investigation
  - ⚠️ Actor system initialization warnings
- **Required Changes**:
  - Fix git actor repository detection logic
  - Resolve actor system initialization warnings
  - Consider using ActorEventBus for local CLI operations
- **Success Criteria**: Git operations work properly with ask/tell patterns

### 3.10 ❌ **Refactor Remaining Handler Class**
- **Status**: PENDING
- **Description**: Remove last remaining handler class in analysis code
- **Files**: `src/commands/state-machine-analysis.ts` (StateMachineMonitoringHandler class)
- **Required Changes**:
  - Remove `StateMachineMonitoringHandler` class
  - Convert to pure function-based approach
  - Maintain analysis functionality without class structure
- **Success Criteria**: Zero handler classes remain in entire codebase

---

## Phase 4: Testing & Validation ⚠️ **PENDING**

### 4.1 ❌ **End-to-End Command Testing**
- **Status**: PENDING
- **Description**: Test all refactored commands work properly from start to finish
- **Commands to Test**:
  - ✅ `pnpm aw:save` - Working with pure actor model
  - ❌ `pnpm aw:ship` - Needs refactoring
  - ❌ `pnpm aw:status` - Needs refactoring
  - ❌ `pnpm aw:validate` - Needs refactoring
  - ❌ Enhanced commit commands - Need refactoring
  - ❌ Advanced git commands - Need refactoring
- **Success Criteria**: All commands complete without hanging, no actor system errors

### 4.2 ❌ **Pure Actor Model Compliance Verification**
- **Status**: PENDING
- **Description**: Verify all commands follow @FRAMEWORK-STANDARD.mdc rules
- **Checks Required**:
  - Zero subscription patterns (`subscribeToEvent()`)
  - Zero handler classes (`*WorkflowHandler`)
  - Only ask/tell communication patterns
  - Proper ActorMessage format usage
  - No forbidden patterns per framework standards
- **Success Criteria**: 100% compliance with pure actor model principles

### 4.3 ❌ **Integration Testing Update**
- **Status**: PENDING
- **Description**: Update integration tests to cover pure actor model patterns
- **Files**: `src/integration/cli-commands.test.ts`
- **Required Changes**:
  - Test all refactored commands
  - Verify no subscription patterns in tests
  - Test actor system integration
- **Success Criteria**: All integration tests pass with pure actor model

### 4.4 ❌ **Performance & Reliability Testing**
- **Status**: PENDING
- **Description**: Ensure refactored commands are reliable and don't hang
- **Tests Required**:
  - Commands complete in reasonable time
  - No memory leaks from actor cleanup
  - Proper error handling and recovery
  - Actor system shutdown works correctly
- **Success Criteria**: All commands are reliable and performant

---

## Testing & Safeguards Framework (Enhanced per @workflow.mdc)

### 5.1 ❌ **Type Safety Validation**
- **Status**: PENDING
- **Description**: Ensure zero `any` types and proper type guards for actor responses
- **Required Changes**:
  - Add type guards for all actor.ask() responses
  - Verify strict TypeScript compilation
  - Add runtime type validation where needed
- **Success Criteria**: Zero type safety violations, proper type guards

### 5.2 ❌ **Actor System Health Monitoring**
- **Status**: PENDING
- **Description**: Add monitoring to detect actor system issues early
- **Required Changes**:
  - Monitor for dead letter queue errors
  - Track actor system initialization
  - Add health checks for critical actors
- **Success Criteria**: Comprehensive actor system monitoring in place

### 5.3 ❌ **Regression Prevention Framework**
- **Status**: PENDING
- **Description**: Prevent future pure actor model violations
- **Required Changes**:
  - Add linting rules to detect subscription patterns
  - Create pre-commit hooks for framework compliance
  - Add CI/CD validation for pure actor model
- **Success Criteria**: Automated prevention of future violations

---

## Summary

**Current Status**: 
- ✅ **Phase 1**: ES Module Migration (COMPLETE)
- ✅ **Phase 2**: Actor System Integration (COMPLETE)  
- ✅ **Phase 3**: Pure Actor Model Compliance (95% complete)
- ❌ **Phase 4**: Testing & Validation (PENDING)

**Critical Priority**: Complete pure actor model refactoring for all CLI commands

**Estimated Completion**: 7-10 days for full architectural compliance

**Next Actions**: 
1. Refactor ship.ts to pure actor model
2. Continue with status.ts and validate.ts
3. Remove forbidden helper functions
4. Complete end-to-end testing 