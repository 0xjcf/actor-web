# Implementation Prompt: Reactive Observers Test Refactoring

## 📋 **Context and Problem Statement**

### **Current State**
The `src/core/reactive-observers.test.ts` file has **25+ TypeScript errors** preventing 100% TESTING-GUIDE.md compliance. The file violates core testing principles by using partial mock objects instead of real framework APIs.

### **Root Cause Analysis**
**Type System Incompatibility**: The test file attempts to bridge two incompatible type systems:

```typescript
// ❌ CURRENT ISSUE: Type mismatch
const actor = createActorRef(machine);           // Returns: ActorSnapshot<unknown>
const snapshot = actor.getSnapshot();
const template = (state: SnapshotFrom<Machine>) // Expects: MachineSnapshot<Context, Event, ...>

// ❌ CURRENT PATTERN: Mock objects violating TESTING-GUIDE.md
const mockState = { context: { count: 5 } };    // Missing 10+ required properties
template(mockState);                             // TypeScript error
```

### **TESTING-GUIDE.md Violations**
1. **Mock vs Real API**: Uses `{ context: {...} }` instead of real snapshots [[memory:3217178]]
2. **Type Safety**: Multiple `any` type coercions would be needed [[memory:3217191]]
3. **Behavior vs Implementation**: Tests template implementation instead of component behavior

---

## 🎯 **Implementation Objectives**

### **Primary Goals**
1. **Zero TypeScript Errors**: Achieve strict type compliance
2. **TESTING-GUIDE.md Alignment**: Use real framework APIs throughout
3. **Maintain Zero `any` Types**: Follow strict type safety guidelines [[memory:3217191]]
4. **Behavior-Focused Testing**: Test component behavior, not template implementation

### **Success Criteria**
```bash
# ✅ All tests pass
pnpm test src/core/reactive-observers.test.ts

# ✅ Zero TypeScript errors
pnpm tsc --noEmit src/core/reactive-observers.test.ts

# ✅ Zero linting violations
pnpm lint src/core/reactive-observers.test.ts
```

---

## 🔧 **Technical Analysis**

### **Error Categories**

#### **1. Type Incompatibility (25 instances)**
```typescript
// Error: Missing properties from MachineSnapshot
Argument of type '{ context: { count: number } }' is not assignable to parameter of type 'MachineSnapshot<...>'
Missing properties: status, output, error, machine, and 10 more.
```

#### **2. Undefined References (2 instances)**
```typescript
// Error: Undefined utilities
Cannot find name 'performanceTestUtils'
```

#### **3. Property Access Errors**
```typescript
// Error: Unknown properties on events
Object literal may only specify known properties, and 'value' does not exist in type 'BaseEventObject'
```

### **Architecture Constraints**
- **Framework Consistency**: Must use Actor-Web's `createActorRef()` system
- **Type Safety**: Zero `any` types allowed [[memory:3217191]]
- **Testing Standards**: Must follow TESTING-GUIDE.md principles [[memory:3217178]]
- **Backward Compatibility**: Cannot break existing Actor-Web APIs

---

## 💡 **Solution Strategies**

### **Strategy 1: Type Adapter Layer (Recommended)**
Create a bridge between Actor-Web and XState type systems:

```typescript
// Core adapter function
function createTestSnapshot<TContext>(
  machine: AnyStateMachine,
  context: TContext,
  value?: string
): SnapshotFrom<typeof machine> {
  const actor = createActorRef(machine);
  actor.start();
  
  // Update context through events if needed
  // Return properly typed snapshot
  return actor.getSnapshot() as SnapshotFrom<typeof machine>;
}

// Usage in tests
const snapshot = createTestSnapshot(machine, { count: 5 });
expect(template(snapshot).html).toContain('Count: 5');
```

### **Strategy 2: Component-Level Testing**
Focus on component behavior instead of template testing:

```typescript
it('should react to state changes', async () => {
  const Component = createComponent({ machine, template });
  const element = document.createElement('test-component');
  testEnv.container.appendChild(element);
  
  // Test component behavior, not template output
  const componentInstance = element.getComponentInstance();
  componentInstance.send({ type: 'INCREMENT' });
  
  await waitFor(() => {
    expect(element.textContent).toContain('Count: 1');
  });
});
```

### **Strategy 3: Template Function Refactoring**
Update templates to use Actor-Web native types:

```typescript
// Instead of: (state: SnapshotFrom<Machine>) => RawHTML
// Use: (state: ActorSnapshot<unknown>) => RawHTML

const template = (state: ActorSnapshot<unknown>): RawHTML => {
  const context = state.context as { count: number }; // Safe assertion
  return html`<div>Count: ${context.count}</div>`;
};
```

---

## 🚀 **Implementation Plan**

### **Phase 1: Infrastructure Setup**
1. **Create Type Adapters**
   ```typescript
   // src/testing/snapshot-adapters.ts
   export function createMachineSnapshot<T>(...)
   export function adaptActorSnapshot<T>(...)
   ```

2. **Update Test Utilities**
   ```typescript
   // Add to actor-test-utils.ts
   export function createReactiveTestActor<T>(...)
   export function waitForTemplateChange(...)
   ```

### **Phase 2: Event Type Definitions**
```typescript
// Define proper event types for each test machine
type FormEvent = 
  | { type: 'UPDATE_EMAIL'; value: string }
  | { type: 'UPDATE_PASSWORD'; value: string };

type ModalEvent =
  | { type: 'OPEN'; message: string }
  | { type: 'CLOSE' };
```

### **Phase 3: Test Refactoring**
Systematically update each test following this pattern:

```typescript
// ✅ BEFORE: Mock objects (violates TESTING-GUIDE.md)
const mockState = { context: { count: 5 } };
expect(template(mockState).html).toContain('Count: 5');

// ✅ AFTER: Real framework behavior
const actor = createReactiveTestActor(machine, { count: 5 });
const snapshot = actor.getSnapshot();
expect(template(snapshot).html).toContain('Count: 5');
```

### **Phase 4: Performance Testing**
```typescript
// Option A: Implement real performance utilities
export const performanceTestUtils = {
  expectPerformant: async (fn: () => void, maxMs: number) => { ... },
  measureRenderTime: async (fn: () => void, iterations: number) => { ... }
};

// Option B: Remove performance tests (simpler)
// Delete performance test sections if not essential
```

---

## 📝 **Implementation Steps**

### **Step 1: Assessment**
```bash
# Count current errors
pnpm tsc --noEmit src/core/reactive-observers.test.ts | grep "error" | wc -l

# Identify error patterns
pnpm tsc --noEmit src/core/reactive-observers.test.ts | grep "is not assignable"
```

### **Step 2: Create Adapters**
```typescript
// File: src/testing/reactive-test-adapters.ts
export class ReactiveTestAdapter<TContext, TEvent> {
  constructor(private machine: AnyStateMachine) {}
  
  createSnapshot(context: TContext, value?: string): SnapshotFrom<typeof this.machine> {
    // Implementation that bridges type systems
  }
  
  updateState(event: TEvent): SnapshotFrom<typeof this.machine> {
    // Implementation for state transitions
  }
}
```

### **Step 3: Progressive Refactoring**
1. **Start with simplest test** (state-driven reactivity)
2. **Apply adapter pattern**
3. **Verify TypeScript compliance**
4. **Move to next test**
5. **Repeat until all tests pass**

### **Step 4: Validation**
```bash
# Ensure zero TypeScript errors
pnpm tsc --noEmit

# Ensure all tests pass
pnpm test src/core/reactive-observers.test.ts

# Verify TESTING-GUIDE.md compliance
# - Real APIs used ✅
# - Proper types used ✅
# - Behavior testing ✅
# - Zero any types ✅
```

---

## 🎯 **Deliverables**

### **Code Artifacts**
1. **`src/testing/reactive-test-adapters.ts`**: Type adapter utilities
2. **Updated `src/core/reactive-observers.test.ts`**: Fully compliant test file
3. **Performance utilities** (if implementing Strategy 4A)

### **Documentation**
1. **Testing patterns documentation**: How to test reactive components
2. **Type adapter usage guide**: When and how to use adapters
3. **Migration guide**: For other files with similar issues

### **Verification Results**
```bash
✅ TypeScript: 0 errors (was 25+)
✅ Tests: All passing (32/32)
✅ Linting: 0 violations
✅ TESTING-GUIDE.md: 100% compliant
```

---

## ⚠️ **Constraints and Considerations**

### **Technical Constraints**
- **Zero `any` types allowed** [[memory:3217191]]
- **Must use real framework APIs** [[memory:3217178]]
- **Cannot break existing Actor-Web patterns**
- **Must maintain backward compatibility**

### **Testing Standards**
- **Follow scoped logging pattern**: `const log = Logger.namespace('MODULE_TEST')`
- **Use relative imports**: `import { ... } from './module.js'`
- **Focus on behavior testing**: Test outcomes, not implementation
- **Proper async handling**: Use `await` for lifecycle operations

### **Performance Considerations**
- **Type adapters should be lightweight**
- **Avoid complex type transformations in hot paths**
- **Consider caching for repeated snapshot creation**

---

## 🚀 **Success Metrics**

### **Quantitative Goals**
- **TypeScript errors**: 25+ → 0
- **Test coverage**: Maintain 100%
- **Performance**: No degradation in test execution time
- **Type safety**: Zero `any` type usage

### **Qualitative Goals**
- **Code clarity**: Tests should be easy to understand
- **Maintainability**: Patterns should be reusable
- **Framework alignment**: Should feel native to Actor-Web
- **Future-proofing**: Solution should scale to other test files

---

## 📚 **Resources and Context**

### **Related Files**
- `docs/TESTING-GUIDE.md`: Testing standards and principles
- `src/testing/actor-test-utils.ts`: Existing test utilities
- `src/core/create-actor-ref.ts`: Actor-Web core API
- `@avoid-any-type.mdc`: Type safety guidelines

### **Working Examples**
- `src/core/aria-observer.test.ts`: Properly implemented reactive testing
- `src/core/actor-ref-counter.test.ts`: Real API usage patterns
- Other Phase 1-3 compliant files for reference patterns

### **Memory Context**
- [[memory:3217178]]: Use real framework API instead of mocks
- [[memory:3217191]]: Prevent casting to any types and follow guidelines
- [[memory:3220572]]: Test files should follow TESTING-GUIDE.md

---

## 🎯 **Next Actions**

1. **Start with Step 1**: Assess current error state
2. **Choose Strategy**: Recommend Strategy 1 (Type Adapter Layer)
3. **Create infrastructure**: Build adapter utilities first
4. **Progressive refactoring**: Update tests one by one
5. **Validation**: Ensure all criteria met

**Priority**: High - This is the final piece for 100% TESTING-GUIDE.md compliance across the Actor-Web Framework testing suite.

**Estimated Effort**: 4-6 hours for complete implementation
**Risk Level**: Medium - Type system work requires careful handling
**Dependencies**: None - Can proceed immediately

---

*This prompt provides complete context for addressing the reactive-observers.test.ts technical debt while maintaining all established patterns and constraints.* 