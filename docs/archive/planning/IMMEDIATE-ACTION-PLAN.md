# 🚨 Immediate Action Plan: Pure Actor Model Foundation

> **Priority**: HIGH - Foundation solid, component integration nearly complete  
> **Timeline**: 1 week to finish Phase 2, 4 weeks for Phase 3  
> **Status**: Phase 1 COMPLETE ✅ - Phase 2 80% complete - Phase 3 planned  
> **Last Updated**: 2025-01-20

## ✅ COMPLETED: Phase 1 Foundation Repair

### ✅ Week 0-1: Type System & Critical Fixes (COMPLETED)
**Status**: ALL COMPLETE ✅

**Completed Action Items**:
- ✅ **Fixed all TypeScript compilation errors** (0 errors)
- ✅ **Fixed all linter issues** (0 errors, 0 warnings)  
- ✅ **All tests passing** (100% green)
- ✅ **Guardian actor working** with message-based operations
- ✅ **Actor spawn/stop/lookup functionality** implemented
- ✅ **Type system unified** (ActorPID as single reference type)
- ✅ **Import/export issues resolved**
- ✅ **Supervision strategy types** made consistent

**Key Achievements**:
- Zero `any` types in codebase (pure type safety achieved)
- Guardian actor functioning as system kernel
- Message-based actor operations working
- Supervision hierarchy properly implemented
- All architectural foundations solid

## 🎯 Phase 2: Web Component Integration (CURRENT PHASE)

### ✅ Day 1-3: Component-as-Actor Design (COMPLETE)

**Goal**: Design how `createComponent()` works with pure actor model

Following our architecture docs:

```typescript
// Each component becomes an actor with XState + behavior
const TodoComponent = createComponent({
  machine: todoMachine,        // XState handles UI logic
  template: todoTemplate,      // Template function (unchanged)
  
  behavior: defineBehavior({   // ✅ NEW: Unified API with actors!
    // Component-specific handler signature
    onMessage: async ({ message, machine, dependencies, emit }) => {
      if (message.type === 'STATE_CHANGED') {
        // React to XState transitions
        const state = machine.getSnapshot();
        if (state.matches('saving')) {
          // Handle external communication
          await dependencies.backend.ask({
            type: 'SAVE_DATA',
            payload: state.context.formData
          });
        }
      }
    },
    
    // Component-specific configuration  
    dependencies: {
      backend: 'actor://system/backend',
      storage: 'actor://system/storage'
    },
    mailbox: { capacity: 100 },
    supervision: { strategy: 'restart' }
  })
});
```

**Completed Items** ✅:
1. ✅ **Created ComponentActorConfig interface** 
2. ✅ **Implemented defineBehavior function** for unified API  
3. ✅ **Designed component actor behavior** (wraps XState + DOM)
4. ✅ **Implemented component mailbox** for DOM events → messages
5. ✅ **Created XState machine bridge** for state change messages  
6. ⏳ **Design dependency injection** for actor-to-actor communication (partial - TODO remains)

### 🔨 Day 4-6: Component API Unification (IN PROGRESS)

**Goal**: Implement unified `defineBehavior()` API for components

**Current Status**:
- ✅ Actors use `defineBehavior({ onMessage: ... })` 
- ✅ Components accept `behavior` property from `defineBehavior()`
- ✅ `defineBehavior()` function fully implemented
- ❌ ComponentBehaviorConfig interface not yet created
- ❌ Component-specific behavior overload not yet added

**Unified Solution**:
```typescript
// 🔌 Behavior ― defined consistently with actors
const formBehavior = defineBehavior({
  // Component-specific handler signature
  onMessage: ({ message, machine, dependencies, emit }) => { ... },
  
  // Component-specific configuration  
  dependencies: { backend: 'actor://system/backend' },
  mailbox: { capacity: 100 },
  supervision: { strategy: 'restart' }
});

// 🌟 Component Creation ― unified API
const formComponent = createComponent({
  machine: formMachine,
  template: formTemplate,
  behavior: formBehavior  // ✅ Consistent with actor API!
});
```

**Implementation Tasks**:
- [ ] Create `ComponentBehaviorConfig` interface
- [x] Extend `defineBehavior` with component overload  
- [x] Refactor `createComponent()` implementation
- [ ] Update component examples throughout codebase
- [ ] Create migration guide from raw behavior objects

### ✅ Day 7-9: Message Transport Foundation (PARTIALLY COMPLETE)

**Goal**: Basic transport layer for location transparency

**Completed Items**:
1. ✅ **Local transport** (direct memory, same process)
2. ✅ **Message serialization** (JSON for now, MessagePack later)
3. ✅ **Basic routing** (address → transport selection)
4. ❌ **Transport interface** (send/receive messages) - TODO remains

### ✅ Day 10-12: Component Actor Implementation (COMPLETE)

**Goal**: Implement the component-as-actor pattern

**Completed Items** ✅:
1. ✅ **Component actor class** that wraps XState machines
2. ✅ **DOM event → message conversion** (for `send` attributes)
3. ✅ **State change → render messages** (for reactive updates)
4. ✅ **External message handling** (for cross-actor communication)

### 🔥 Phase 2.4: Runtime Fan-Out Shortcut (NEW - HIGH PRIORITY)

**Goal**: Eliminate duplicate `machine.send()` + `emit()` boilerplate while maintaining semantic clarity

**Problem**: Current component handlers require two calls for domain events:
```typescript
// ❌ Current: Verbose and error-prone
onMessage({ message, machine, emit }) {
  if (machine.matches('savingDone')) {
    emit({ type: 'FORM_SAVED', id: message.id });        // Broadcast to world
    machine.send({ type: 'SAVE_SUCCESS' });              // Update local state
  }
}
```

**Solution**: Runtime automatically fans out returned events to both pipelines:
```typescript
// ✅ New: One line, crash-safe, type-safe
onMessage({ message, machine }) {
  if (machine.matches('savingDone')) {
    return { type: 'FORM_SAVED', id: message.id };       // Runtime handles both!
  }
}
```

**Implementation Strategy**:
1. **Public API**: Handler can return `DomainEvent` union type
2. **Runtime Logic**: Automatically stores state + event atomically, then fans out to both `machine.send()` and `emit()`
3. **Backward Compatibility**: Existing `emit()` calls continue working
4. **Type Safety**: Union types prevent invalid events from triggering fan-out

**Benefits**:
- 💡 **50% less boilerplate** - one line instead of two
- 🔒 **Same atomicity** - uses transactional outbox for crash safety  
- 🚀 **Zero breaking changes** - existing code unchanged
- 📊 **Better observability** - runtime tags auto-fan-out events

**Week 3 Implementation Tasks**:
- [x] **Day 15**: Design `DomainEvent` union type system ✅ **COMPLETE**
- [x] **Day 16**: Implement runtime fan-out logic in component actor ✅ **COMPLETE** 
- [ ] **Day 17**: Add `emitAndSend()` helper for imperative style
- [ ] **Day 18**: Create migration examples and documentation
- [ ] **Day 19**: Add comprehensive tests for fan-out scenarios

**✅ Current Status**: **Day 2 Complete** - Core runtime integration working perfectly!
- Enhanced ComponentBehaviorConfig interface supports fan-out return types
- Component actors automatically detect and process fan-out events  
- Automatic routing to both `machine.send()` and `emit()` implemented
- Full backward compatibility maintained (336/336 tests passing)
- Working example demonstrating 50% code reduction available

## 🎯 Phase 3: Reliability & Durability (Week 4-7)

### 🔴 Phase 3.1: Transactional Outbox Pattern

**Enhanced Integration**: Runtime Fan-Out Shortcut builds directly on the transactional outbox:

```typescript
// Runtime implementation using Phase 3's atomic operations
async function runOnMessage(handler, ctx) {
  const result = await handler(ctx);
  const fanOutEvent = isDomainEvent(result) ? result : null;

  await durableStore.transaction(async tx => {
    // A. Persist state changes atomically
    if (ctx.pendingStateChanges.length) {
      const nextState = applyEvents(ctx.snapshot, ctx.pendingStateChanges);
      await tx.saveActorState(ctx.actorId, nextState);
    }
    // B. Persist outbound event
    if (fanOutEvent) {
      await tx.saveToOutbox(ctx.actorId, fanOutEvent);
    }
  });

  // C. Apply changes to live machine + broadcast
  ctx.pendingStateChanges.forEach(evt => ctx.machine._apply(evt));
  if (fanOutEvent) ctx.emit(fanOutEvent);
}
```

**Goal**: Solve dual-write bugs by ensuring state changes and events are atomic

**Problem**: Components update UI state and emit events separately, causing:
- Lost events after crashes
- Duplicate analytics 
- Inconsistent system state

**Solution**: Built-in transactional outbox that:
- Persists state + events atomically
- Guarantees exactly-once delivery
- Survives crashes and offline scenarios

### Week 4: Core Infrastructure
**Action Items**:
1. **DurableStore interface** with atomic operations
2. **IndexedDB implementation** for browsers
3. **SQLite implementation** for Node/Electron
4. **In-memory fallback** with metrics warnings
5. **Atomic putStateAndEvent() API**

### Week 5: Runtime Integration
**Action Items**:
1. **Intercept emit() calls** to route through outbox
2. **OutboxForwarder worker** for background processing
3. **Single-instance locking** to prevent duplicates
4. **Event idempotency** (UUID v7 + originActor)
5. **Component lifecycle hooks** for persistence

### Week 6: Developer Experience
**Action Items**:
1. **configureOutbox() API** for customization
2. **Metrics hooks** for monitoring
3. **Dev-tools panel** showing pending events
4. **oncePerEvent() helper** for idempotent consumers
5. **Documentation & migration guide**

### Week 7: Testing & Optimization
**Action Items**:
1. **E2E test suite** with offline/crash scenarios
2. **Performance optimization** (≤4KB gzipped)
3. **Cross-browser testing** (all major browsers)
4. **Graceful degradation** for quota limits
5. **PWA sample upgrade** (Lighthouse ≥95)

## 🎯 Success Criteria

### ✅ Phase 1 (Foundation) - COMPLETE
- [x] Zero TypeScript compilation errors
- [x] Zero linter errors  
- [x] Guardian actor working with message-based operations
- [x] Basic actor spawn/stop/lookup functionality
- [x] All existing tests passing
- [x] Pure type safety (no `any` types)

### 📋 Phase 2 (Components) - 85% COMPLETE
- [x] `createComponent()` working with `defineBehavior()` API
- [x] XState machines properly bridged to actor system
- [x] DOM events converted to actor messages
- [x] Basic cross-actor communication working
- [x] Component examples functional
- [ ] **Runtime Fan-Out Shortcut implemented** (NEW - HIGH PRIORITY)
- [ ] ComponentBehaviorConfig interface (remaining)
- [ ] Complete transport abstraction (partial)
- [ ] Full documentation and examples (remaining)

### 📋 Phase 3 (Reliability) - PLANNED
- [ ] Zero dual-write bugs in production
- [ ] Exactly-once event delivery despite crashes
- [ ] Atomic state + event persistence (**Enhanced by Fan-Out Shortcut**)
- [ ] ≤4KB bundle size impact
- [ ] ≤2s P99 reconnect latency
- [ ] Cross-browser support
- [ ] Developer-friendly API (**Significantly improved by Fan-Out**)
- [ ] Comprehensive testing

## 📚 Related Documentation

- **[API-ROADMAP.md](./API-ROADMAP.md)** - Comprehensive API evolution plan from v0.x to v1.0 and enterprise features
- **[API-ROADMAP-SUMMARY.md](./API-ROADMAP-SUMMARY.md)** - Key insights from API research

## 🚨 Risk Mitigation

### Low-Risk Items (Foundation Solid)
1. ✅ **Type system complexity** - RESOLVED: Clean, simple types implemented
2. **XState integration complexity** - Start with basic bridging, enhance later
3. **Message serialization performance** - Optimize after basic functionality works
4. **Component API consistency** - HIGH PRIORITY: Unify with `defineBehavior()`

### Medium-Risk Items (Phase 3)
1. **IndexedDB quota limits** - Graceful fallback to memory with metrics
2. **Safari background eviction** - Keep transactions <10ms
3. **Duplicate delivery edge cases** - Idempotency keys as safety net

### Decision Points Made
1. ✅ **ActorRef vs ActorPID**: DECIDED - ActorPID chosen, ActorRef removed
2. ✅ **Guardian implementation**: DECIDED - Message-based implementation complete
3. **Transport strategy**: Start local-only, add distribution incrementally  
4. **Component API**: PRIORITY - Unify with `defineBehavior()` for consistency

## 🛠️ Implementation Strategy

### ✅ Start Simple (COMPLETE)
- ✅ Begin with local actors only (no distribution)
- ✅ Use JSON serialization (optimize later)
- ✅ Implement basic supervision (restart only)
- 📋 Focus on component-actor integration (CURRENT)

### Iterate & Enhance
- Add transport types incrementally
- Improve message serialization
- Enhance supervision strategies  
- Optimize performance after functionality works

### Test-Driven
- ✅ Write tests for each component
- ✅ Test supervision scenarios
- ✅ Test cross-actor communication
- 📋 Test component-actor integration (NEXT)

## 📋 Daily Execution

### Each Day
1. **Start**: Review previous day's work
2. **Focus**: Work on single todo item at a time
3. **Test**: Ensure changes don't break existing functionality
4. **Commit**: Small, working commits with clear messages
5. **Update**: Mark todos complete, add new issues as discovered

### Each Week
1. **Review**: Assess progress against success criteria
2. **Adjust**: Modify plan based on discoveries
3. **Communicate**: Share progress and blockers
4. **Plan**: Set priorities for following week

---

**Next Action**: 🎯 **OTP-Style Counter Implementation** - Build the Erlang OTP patterns for JavaScript/TypeScript. Focus on making the research counter example work end-to-end with `createActor()`, `defineBehavior()`, and Message Plan DSL! 🚀

### 🎯 New Priority: Erlang OTP for the Web

Based on the research, we're pivoting to implement **OTP-style actor patterns** that directly map Erlang/OTP concepts to JavaScript/TypeScript:

**Target API** (from research):
```typescript
// 1. State machine (replaces Erlang recursive state)
const counterMachine = createMachine({
  context: { count: 0 },
  states: {
    alive: {
      on: {
        INCREMENT: { actions: assign({ count: ctx => ctx.count + 1 }) }
      }
    }
  }
});

// 2. Behavior (like OTP gen_server)
const counterBehavior = defineBehavior({
  onMessage({ message, machine }) {
    if (message.type === 'INCREMENT' && message.replyTo) {
      // Fan-out: Single return handles both state update AND reply
      return {
        type: 'INCREMENT',              // Fan-out sends to machine
        replyTo: message.replyTo,       // Runtime handles reply
        currentCount: machine.getSnapshot().context.count
      };
    }
    return; // Wildcard clause
  }
});

// 3. Spawn and use like Erlang
const counter = createActor({ machine: counterMachine, behavior: counterBehavior }).start();
const count = await counter.ask({ type: 'INCREMENT', replyTo: self });
```

**Implementation Focus**: 
- **Fan-Out Integration**: Leverage existing fan-out for automatic state updates
- **Domain Event Replies**: Extend fan-out to handle `replyTo` patterns
- `defineBehavior()` API (like gen_server callbacks)
- `createActor()` API (spawn processes)  
- Ask pattern with automatic correlation IDs
- XState integration for state management 