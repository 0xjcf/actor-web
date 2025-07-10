# 📋 Code Cleanup Plan - Agent Coordination

> **Status**: Active  
> **Total Issues**: 203 (from Agent C's audit)  
> **Target**: 0 errors, 0 warnings  
> **Strategy**: Divide & Conquer

## 🚨 CRITICAL FIXES (All Agents - Phase 0)

**MUST BE COMPLETED FIRST** - These block TypeScript compilation:

### Agent A: TypeScript Compilation Errors
- [ ] **File**: `src/core/persistence.test.ts` (lines 186-190, 1029)
- [ ] **Issue**: Malformed syntax in test object literals
- [ ] **Fix**: Restore proper object syntax in test case
- [ ] **Priority**: 🔴 CRITICAL - Blocks build

### Agent B: Context Mutation Bug  
- [ ] **File**: `src/core/create-actor-ref.ts` (line 435)
- [ ] **Issue**: `delete context.pendingResponses` mutates XState context
- [ ] **Fix**: Use `context = { ...context, pendingResponses: undefined }`
- [ ] **Priority**: 🔴 CRITICAL - Breaks ask pattern

## 🟡 PHASE 1: Auto-Fixable Issues

**Run AFTER critical fixes are completed:**

```bash
# Safe auto-fixes (any agent can run)
pnpm lint --fix

# Unsafe auto-fixes (review required)  
pnpm lint --fix --unsafe
```

**Expected**: ~50-100 issues auto-resolved (import sorting, formatting, etc.)

## 🔵 PHASE 2: Agent-Specific Work

### 🔵 AGENT A: Core Architecture Files (8-10 files)

**Focus**: Actor system core, component bridge, utilities

#### Primary Files:
- [ ] `src/core/create-actor-ref.ts` (8+ issues)
  - [ ] Replace forEach with for...of (line 425)
  - [ ] Fix unused parameter `eventType` (line 354)
  - [ ] Remove delete operator usage

- [ ] `src/core/actors/actor-ref.ts` (3+ issues)  
  - [ ] Fix unused type parameter `TEmitted` (line 99)
  - [ ] Clean up type definitions

- [ ] `src/core/component-bridge.ts` (2+ issues)
  - [ ] Fix confusing void type (line 74) → use `undefined`
  - [ ] Review type safety

#### Secondary Files:
- [ ] `src/core/json-utilities.ts`
- [ ] `src/core/minimal-api.ts` 
- [ ] `src/core/request-response.ts`
- [ ] `src/core/template-renderer.ts`

**Success Criteria**: All core actor system files have 0 linter errors

---

### 🟢 AGENT B: Services & Implementation (12-15 files)

**Focus**: Animation, accessibility, persistence, reactive systems

#### Primary Files:
- [ ] `src/core/animation-services.ts` (15+ issues)
  - [ ] Replace 8 forEach loops with for...of (lines 502, 503, 507, 508, 513, 514, 523, 524)
  - [ ] Optimize nested forEach patterns
  - [ ] Review performance implications

- [ ] `src/core/accessibility-services.ts` (10+ issues)
  - [ ] Replace forEach with for...of (line 200)
  - [ ] Fix accessibility attribute handling
  - [ ] Ensure ARIA compliance

- [ ] `src/core/persistence.ts` (5+ issues)
  - [ ] Fix import organization
  - [ ] Remove unused imports
  - [ ] Type safety improvements

#### Secondary Files:
- [ ] `src/core/reactive-event-bus.ts`
- [ ] `src/core/reactive-observers.ts` 
- [ ] `src/core/timer-services.ts`
- [ ] `src/core/focus-management.ts`
- [ ] `src/core/keyboard-navigation.ts`
- [ ] `src/core/global-event-delegation.ts`

**Success Criteria**: All service files have 0 linter errors, optimal performance patterns

---

### 🟠 AGENT C: Testing & ARIA Integration (15-20 files)

**Focus**: Test files, ARIA system, dev tooling

#### Primary Files:
- [ ] `src/core/persistence.test.ts` (multiple issues)
  - [ ] Fix import paths from `@/framework/testing`
  - [ ] Restore missing test utilities
  - [ ] Fix service call syntax errors

- [ ] `src/core/aria-observer.ts` (8+ issues)
  - [ ] Replace forEach with for...of (lines 262, 283)
  - [ ] Optimize DOM observation patterns
  - [ ] Ensure accessibility performance

- [ ] `src/core/aria-integration.ts` (6+ issues)  
  - [ ] Replace 3 forEach loops with for...of (lines 114, 123, 247, 312)
  - [ ] Optimize ARIA attribute processing
  - [ ] State change announcement efficiency

- [ ] `src/core/dev-mode.test.ts` (7+ issues)
  - [ ] Replace `any` types with specific types (lines 56, 66, 70, 76)
  - [ ] Fix global object type safety
  - [ ] Improve test type definitions

#### Secondary Files:
- [ ] All `.test.ts` files in `src/core/`
- [ ] `src/core/accessibility-utilities.test.ts`
- [ ] `src/core/aria-integration.test.ts`
- [ ] `src/testing/` directory improvements

**Success Criteria**: All test files pass, ARIA system optimized, dev tooling robust

## 🔄 COORDINATION POINTS

### After Each Phase:
1. **Commit Progress**: `git add . && git commit -m "feat(cleanup): [agent] phase X complete"`
2. **Push to Branch**: `git push origin feature/code-cleanup-[agent]`
3. **Status Update**: Mark completed todos and report issues

### Integration Strategy:
```bash
# Each agent works on their own branch
git checkout -b feature/code-cleanup-agent-a  # Agent A
git checkout -b feature/code-cleanup-agent-b  # Agent B  
git checkout -b feature/code-cleanup-agent-c  # Agent C

# Regular syncing via integration branch
git checkout feature/actor-ref-integration
git pull origin feature/actor-ref-integration
git checkout feature/code-cleanup-agent-[x]
git rebase feature/actor-ref-integration
```

## 📊 SUCCESS METRICS

### Baseline (Current):
- **TypeScript Errors**: 8 (1 file)
- **Linter Errors**: 137 errors + 10 warnings (59 files)
- **Total Issues**: 203

### Target (Clean Slate):
- **TypeScript Errors**: 0 ✅
- **Linter Errors**: 0 ✅  
- **Linter Warnings**: 0 ✅
- **Files with Issues**: 0/59 ✅

### Verification Commands:
```bash
# Must all pass
pnpm typecheck     # 0 TypeScript errors
pnpm lint          # 0 linter errors/warnings  
pnpm test          # All tests passing
pnpm build         # Clean build
```

## 🚀 EXECUTION ORDER

1. **Phase 0**: Critical fixes (Agents A & B in parallel)
2. **Phase 1**: Auto-fixes (any agent)
3. **Phase 2**: Specialized cleanup (all agents in parallel)
4. **Integration**: Merge all branches → test → deploy

**Estimated Timeline**: 2-4 hours total with parallel execution

---

*This plan ensures all agents can work efficiently without conflicts while maintaining code quality and system functionality.* 