# 🚨 Agent A - Critical Next Actions

> **Current Status**: 105 test failures - **Code Quality Crisis**  
> **Priority**: Fix foundation before building new features  
> **Sprint**: Emergency Stabilization → Phase 1 Implementation

## 🎯 Immediate Crisis Plan

### Phase 0: Stabilize Test Suite (URGENT - 1-2 days)

**Current State**: 105 failed tests / 619 total = **17% failure rate**

#### 🔥 Critical Issues Identified

| Issue Category | Count | Impact | Priority |
|---------------|-------|--------|----------|
| **Template Renderer Type Errors** | ~8 tests | XState v5 callback signature changes | P0 |
| **Timer Services Callback Issues** | ~20 tests | XState v5 breaking changes | P0 |
| **Global Event Delegation DOM** | ~4 errors | DOM mocking/cleanup issues | P1 |
| **Animation Services Tests** | Unknown | Likely XState v5 related | P1 |

#### 🏃‍♂️ Emergency Actions (Today)

**Step 1: Fix XState v5 Callback Signatures** ⏱️ 2-3 hours
```typescript
// Problem: XState v5 changed callback signatures
// Before (XState v4):
expect(handler).toHaveBeenCalledWith(expect.objectContaining({
  event: expect.objectContaining({ type: 'TICK' })
}));

// After (XState v5):
expect(handler).toHaveBeenCalledWith(
  expect.objectContaining({
    event: expect.objectContaining({ type: 'TICK' })
  }),
  undefined // Additional parameter XState v5 adds
);
```

**Action**: Update all test expectations to match XState v5 callback signature.

**Step 2: Fix Template Type Issues** ⏱️ 1-2 hours
```typescript
// Problem: template.includes is not a function
// Root cause: Template return type is not string

// Investigation needed in:
- src/testing/actor-test-utils.ts:775
- expectTemplateContains function
- Template renderer return types
```

**Action**: Fix template renderer return type consistency.

**Step 3: DOM Mocking Cleanup** ⏱️ 1 hour
```typescript
// Problem: originalEvent.target.matches is not a function
// Root cause: DOM mocking not properly set up

// Fix in global-event-delegation tests:
- Add proper DOM element mocking
- Ensure .matches() method exists on mock targets
```

---

## ⚡ Phase 1: Foundation Repair (2-3 days)

### Task 1: Address All TODO Comments
**Current**: 14 TODO comments → **Target**: 0

#### High-Priority TODOs (Block new features):
```bash
# P0: Core ActorRef functionality
src/core/actors/actor-ref.ts:  _TEmitted = unknown, // [actor-web] TODO: Implement event emission system

# P0: Supervision configuration  
src/core/create-actor-ref.ts:  maxRestarts: 3, // [actor-web] TODO: Make supervision limits configurable

# P1: Message processing
src/core/create-actor-ref.ts:  // [actor-web] TODO: Implement proper event acceptance checking
```

**Action Plan**:
1. **Event Emission System** (4 hours) - Implement `TEmitted` support as per implementation plan
2. **Configurable Supervision** (2 hours) - Make supervision limits configurable
3. **Event Acceptance** (3 hours) - Add proper event validation
4. **Convert remaining TODOs** (2 hours) - Either implement or create proper GitHub issues

### Task 2: Eliminate `any` Types
**Current**: Unknown count → **Target**: 0 in src/

```bash
# Analysis command:
npx tsc --noEmit --strict --noImplicitAny src/**/*.ts

# Expected areas:
- XState v5 type compatibility
- Event handler signatures  
- Generic constraints
```

**Action**: Systematic replacement with proper types or `unknown`.

### Task 3: Enhanced Error Messages
**Current**: Generic errors → **Target**: Actionable context

```typescript
// Create ActorError class:
export class ActorError extends Error {
  constructor(
    public code: string,
    message: string,
    public context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'ActorError';
  }
}
```

---

## 🏗️ Phase 2: Implement Event Emission (3-4 days)

**Dependencies**: Phase 1 complete, all tests passing

### Implementation Sequence:

#### 2.1: Actor Event Bus (Day 1)
- **File**: `src/core/actor-event-bus.ts`
- **Goal**: Typed event emission system
- **Test Coverage**: 95%+ for new code

#### 2.2: Extended ActorRef Interface (Day 2)  
- **File**: `src/core/actor-ref.ts`
- **Goal**: Add `TEmitted` generic support
- **Breaking Change**: Yes, but backward compatible with `never`

#### 2.3: createActorRef Integration (Day 3)
- **File**: `src/core/create-actor-ref.ts`  
- **Goal**: Wire event bus into actor creation
- **Performance**: <1ms emission latency

#### 2.4: Comprehensive Testing (Day 4)
- **Files**: All related test files
- **Goal**: Integration testing across actor communication
- **Coverage**: 95%+ overall

---

## 📋 Success Criteria Checklist

### Phase 0 Complete ✅
- [ ] All 105 test failures fixed
- [ ] Test suite runs green (0 failures)
- [ ] No unhandled errors in test output
- [ ] CI/CD pipeline passes

### Phase 1 Complete ✅  
- [ ] 0 `[actor-web] TODO` comments in codebase
- [ ] 0 `any` types in src/ (confirmed via `tsc --strict`)
- [ ] All errors use `ActorError` with actionable context
- [ ] Type coverage report shows 100%

### Phase 2 Complete ✅
- [ ] Event emission system functional and tested
- [ ] `TEmitted` support working with type safety
- [ ] Performance targets met (<1ms emission, <200ms spawn)
- [ ] Integration tests demonstrate cross-actor communication

---

## 🛠️ Development Workflow

### Daily Commands
```bash
# Start of day
pnpm aw:status                 # Check agent state
pnpm test                      # Verify current test state

# During development  
pnpm test:watch                # Continuous testing
pnpm typecheck                 # Type verification
pnpm lint:fix                  # Auto-fix issues

# End of day
pnpm test:coverage             # Coverage check
pnpm aw:save                   # Commit progress
```

### Progress Tracking
```bash
# TODO count
grep -r "\[actor-web\] TODO" src/ --include="*.ts" | wc -l

# Test failures  
pnpm test | grep "FAIL" | wc -l

# Type issues
npx tsc --noEmit --strict 2>&1 | grep "error" | wc -l
```

---

## 🚨 Blocking Issues

### Before Starting New Features:
1. **Test Suite Must Be Green** - Cannot build on broken foundation
2. **All TODOs Resolved** - Technical debt will compound
3. **Zero `any` Types** - Type safety is non-negotiable
4. **Performance Baselines** - Need measurements before optimization

### Risk Mitigation:
- **Time-box each phase** - Don't let perfect be enemy of good
- **Incremental commits** - Save progress frequently with `pnpm aw:save`
- **Parallel work streams** - Some TODO fixes can happen alongside test fixes
- **Communication** - Update other agents on breaking changes

---

## 🎯 Next Session Focus

**Immediate Action**: Fix the most critical XState v5 test failures

**Commands to Run**:
```bash
# 1. Focus on timer services first (biggest failure cluster)
pnpm test src/core/timer-services.test.ts

# 2. Fix template renderer next (clear type issue)  
pnpm test src/core/template-renderer.test.ts

# 3. Tackle global event delegation (DOM issue)
pnpm test src/core/global-event-delegation.test.ts
```

**Success Metric**: Reduce test failures from 105 → <50 in first session

---

_**Agent A Priority**: Stabilize foundation → Enable feature development_  
_**Status**: Emergency mode - Code quality crisis requires immediate attention_  
_**Next Review**: After test suite stabilization (target: 48 hours)** 