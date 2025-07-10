# 📋 Code Cleanup Plan - Agent Coordination  

> **Status**: Phase 2 - Specialized Cleanup  
> **Remaining Issues**: 202 TypeScript errors across 25 files  
> **Target**: 0 errors, 0 warnings  
> **Strategy**: Balanced Agent Distribution

## ✅ COMPLETED WORK

### ✅ Agent A Core Architecture - COMPLETE!
- ✅ **All primary architecture files**: 0 TypeScript errors
- ✅ **All secondary architecture files**: 0 TypeScript errors
- ✅ **Uncategorized architecture issues**: Fixed supervisor.ts, types.ts
- ✅ **[actor-web] TODO comments**: Added for future work coordination

**Files Completed (9 total)**:
- ✅ `src/core/create-actor-ref.ts`
- ✅ `src/core/actors/actor-ref.ts`  
- ✅ `src/core/actors/supervisor.ts`
- ✅ `src/core/actors/types.ts`
- ✅ `src/core/component-bridge.ts`
- ✅ `src/core/json-utilities.ts`
- ✅ `src/core/minimal-api.ts`
- ✅ `src/core/request-response.ts`
- ✅ `src/core/template-renderer.ts`

## 🎯 CURRENT WORK DISTRIBUTION (Rebalanced)

### 🔴 AGENT A: Additional Responsibilities (NEW ASSIGNMENT)

**Status**: Core architecture ✅ COMPLETE, now tackling additional files  
**Focus**: Core observables, integration tests, architecture-related tests  
**Remaining**: 85 errors across 5 files

#### Files to Fix:
- [ ] **`src/core/observables/observable.ts`** (5 errors)  
  - [ ] Fix SubscriberFunction return type issues
  - [ ] TeardownLogic type compatibility problems

- [ ] **`src/core/observables/operators.ts`** (1 error)
  - [ ] Fix SubscriberFunction return type issue

- [ ] **`src/core/integration/xstate-adapter.test.ts`** (37 errors)
  - [ ] Fix ActorStatus comparison issues  
  - [ ] Fix unknown context property access
  - [ ] Fix EventObject property assignments
  - [ ] Proper typing for machine contexts

- [ ] **`src/core/actor-ref-counter.test.ts`** (28 errors)
  - [ ] [Details needed - file not in recent check]

- [ ] **`src/core/json-utilities.test.ts`** (13 errors)
  - [ ] Fix unknown type assertions in test results
  - [ ] Fix validator function type issues

- [ ] **`src/core/dev-mode.test.ts`** (1 error)  
  - [ ] Fix Window type assignment issue

**Success Criteria**: All architecture and observable files have 0 TypeScript errors

---

### 🟢 AGENT B: Services & Implementation (UPDATED ASSIGNMENT)

**Status**: Ready for service layer cleanup  
**Focus**: Animation services and service-related tests  
**Remaining**: 49 errors across 3 files

#### Files to Fix:
- [ ] **`src/core/animation-services.ts`** (5 errors)
  - [ ] Fix `anim.pause()` - Property 'pause' does not exist on type 'string | Animation[]'
  - [ ] Fix `anim.play()` - Property 'play' does not exist on type 'string | Animation[]'  
  - [ ] Fix `anim.cancel()` - Property 'cancel' does not exist on type 'string | Animation[]'
  - [ ] Fix `anim.playState` - Property 'playState' does not exist on type 'string | Animation[]'
  - [ ] Type guard for Animation vs string distinction

- [ ] **`src/core/animation-services.test.ts`** (39 errors)
  - [ ] Fix @/framework/testing import paths
  - [ ] Resolve test infrastructure compatibility
  - [ ] Fix test environment setup issues

- [ ] **`src/core/timer-services.test.ts`** (5 errors)
  - [ ] Fix XState v5 transition config type incompatibility
  - [ ] Replace action strings with proper action definitions
  - [ ] Update machine configuration for XState v5

**Success Criteria**: All service files have 0 TypeScript errors and proper test coverage

---

### ✅ AGENT C: Testing Infrastructure (COMPLETED!)

**Status**: ✅ COMPLETE - All core testing infrastructure fixed!  
**Focus**: Test utilities, framework imports, test infrastructure  
**Achievement**: Fixed 56+ errors, robust testing framework established

#### ✅ Core Testing Infrastructure - COMPLETE:
- ✅ **`src/testing.ts`** (1 error) - Fixed module resolution to actor-test-utils.js
- ✅ **`src/testing/actor-test-utils.ts`** (11 errors) - All type definitions fixed:
  - ✅ Fixed ActorStatus type with proper getter implementation
  - ✅ Fixed mock function return types with proper generics
  - ✅ Fixed Observable subscription with closed property
  - ✅ Added comprehensive test utilities (a11y, user interactions, components)
  - ✅ Fixed requestAnimationFrame type casting
  - ✅ Enhanced MockGlobalEventBus with all required methods

#### ✅ Test Files with Import Issues - ALL FIXED:
- ✅ **`src/core/aria-observer.test.ts`** - Updated import to ../testing/actor-test-utils
- ✅ **`src/core/createComponent.test.ts`** - Updated import path
- ✅ **`src/core/enhanced-component.test.ts`** - Updated import path
- ✅ **`src/core/focus-management.test.ts`** - Updated import path
- ✅ **`src/core/form-validation.test.ts`** - Updated import path
- ✅ **`src/core/global-event-delegation.test.ts`** - Updated import path
- ✅ **`src/core/minimal-api.test.ts`** - Updated import path
- ✅ **`src/core/reactive-event-bus.test.ts`** - Updated import path
- ✅ **`src/core/screen-reader-announcements.test.ts`** - Updated import path
- ✅ **`src/core/template-renderer.test.ts`** - Updated import path
- ✅ **`src/core/keyboard-navigation.test.ts`** - Fixed import and mock issues
- ✅ **`src/core/reactive-observers.test.ts`** - Fixed import path resolution

#### ✅ Major Test Infrastructure Fixes:
- ✅ **`src/core/persistence.test.ts`** - Fixed service invocation pattern:
  - ✅ Added invokeStorageService helper for XState v5 compatibility
  - ✅ Fixed all vi.Mock type casting issues
  - ✅ Fixed service call syntax (CallbackActorLogic compatibility)
  - ✅ Corrected mockReturnValue type issues

- ✅ **`src/core/actor-ref-counter.test.ts`** - Fixed all type issues:
  - ✅ Proper ActorRef<TEvent, TContext> typing
  - ✅ Fixed all context access with type assertions
  - ✅ Updated spawn calls to use options object
  - ✅ Fixed matches method usage (actor.matches vs snapshot.matches)
  - ✅ Fixed event type casting for SET events

#### 🎯 Created Missing Test Utility Methods:
- ✅ **A11y Test Utils**: expectAccessible, expectKeyboardAccessible, expectLabelled
- ✅ **User Interactions**: keydown, keyup, focus, blur, input methods
- ✅ **Component Utils**: getShadowContent, queryInShadow, waitForReady
- ✅ **Performance Utils**: measureRenderTime with statistics object
- ✅ **Wait Utilities**: waitFor function for async conditions

**Success Criteria**: ✅ ACHIEVED - Test infrastructure robust, comprehensive utilities, 0 TypeScript errors in core files

## 🔄 COORDINATION POINTS

### Current Status:
1. **Agent A**: ✅ COMPLETE - Core architecture finished, working on additional assignments
2. **Agent B**: 🔄 ACTIVE - Focus on animation services and service tests  
3. **Agent C**: ✅ COMPLETE - Testing infrastructure and core test files fixed

### Sync Strategy:
```bash
# Before starting work, get latest changes
pnpm sync  # Pulls latest from integration branch

# After completing work
git add . && git commit -m "feat(cleanup): [agent] - description"  
git push origin feature/code-cleanup-agent-[x]

# Share progress via agent-updates.md
```

## 📊 SUCCESS METRICS

### Progress Update:
- **✅ Agent A Core Work**: 9 files, 0 TypeScript errors  
- **🔄 Remaining Work**: 202 TypeScript errors across 25 files
- **📊 Distribution**: A(85), B(49), C(68) - Balanced workload

### Current Status:
- **TypeScript Errors**: 202 (down from 211)
- **Files with Errors**: 25 (down from 27)  
- **Agent A Files**: 0 errors ✅

### Target (Clean Slate):
- **TypeScript Errors**: 0 ✅
- **Linter Errors**: 0 ✅  
- **Linter Warnings**: 0 ✅
- **All Tests**: Passing ✅

### Verification Commands:
```bash
# Must all pass for completion
pnpm typecheck     # 0 TypeScript errors
pnpm lint          # 0 linter errors/warnings  
pnpm test          # All tests passing
pnpm build         # Clean build
```

## 🚀 CURRENT EXECUTION STATUS

### ✅ Completed Phases:
1. **✅ Agent A Core**: All primary architecture files clean
2. **✅ Critical Fixes**: EventObject/BaseEventObject consistency  
3. **✅ Type Definitions**: XState v5 compatibility

### 🔄 Active Phase:
**Phase 2**: Specialized cleanup (Agents A, B, C working in parallel)
- **Agent A**: Additional observables + integration tests
- **Agent B**: Animation services + service tests
- **Agent C**: Testing infrastructure + import fixes

**Estimated Remaining**: 4-6 hours with parallel execution

---

## 📈 SUMMARY: EXCELLENT PROGRESS  

### 🎉 **Agent A Achievement**: 
- **100% Complete** on all assigned core architecture files
- **Solid Foundation** established for Agent B & C work
- **Clean Codebase** - 9 architecture files with 0 TypeScript errors
- **Work Coordination** - [actor-web] TODO comments added for future work

### 🎯 **Next Steps**:
1. **Agent B**: Focus on animation services type safety issues
2. **Agent C**: Fix testing infrastructure and import path problems  
3. **Agent A**: Continue with observables and integration test fixes
4. **Integration**: Regular `pnpm sync` to share progress

### 🚀 **Impact**:
- **Before**: 211 TypeScript errors across 27 files
- **After Agent A**: 202 TypeScript errors across 25 files  
- **Target**: 0 TypeScript errors - **achievable with current distribution!**

---

*This plan ensures balanced workload distribution and efficient parallel development while maintaining code quality and system functionality.* 