# 🏗️ Agent A (Architecture) - Implementation Plan

> **Agent Role**: Architecture & Core Framework Implementation  
> **Current Focus**: Phase 1 - ActorRef API Implementation  
> **Progress**: 40% → Target: 100%

## 🎯 Current Sprint: Complete ActorRef Core

### ✅ Already Complete
- ✅ Core ActorRef Interface 
- ✅ Correlation ID tracking
- ✅ Request/Response patterns
- ✅ Basic XState v5 integration

### 🚀 Sprint Goals

| Priority | Task | Estimated Effort | Dependencies |
|----------|------|-----------------|--------------|
| **P0** | Event emission (`TEmitted` support) | 3-5 hours | None |
| **P0** | Graceful shutdown mechanism | 4-6 hours | Event emission |
| **P1** | Message interceptors | 2-4 hours | Event emission |
| **P1** | Cleanup hooks | 2-3 hours | Graceful shutdown |
| **P2** | Resource tracking | 3-4 hours | Cleanup hooks |
| **P2** | Basic supervision strategies | 6-8 hours | All above |

---

## 📋 Implementation Sequence

### 1. Event Emission System (`TEmitted` Support)

**Goal**: Enable actors to emit typed events for cross-actor communication

#### Current State Analysis
```typescript
// Current ActorRef interface lacks TEmitted support
interface ActorRef<TContext, TEvents> {
  send: (event: TEvents) => void;
  // Missing: emit capability for external events
}
```

#### Target Implementation
```typescript
interface ActorRef<TContext, TEvents, TEmitted = never> {
  send: (event: TEvents) => void;
  emit: (event: TEmitted) => void;
  subscribe: (listener: (event: TEmitted) => void) => () => void;
}
```

#### Implementation Steps

**Step 1.1: Extend ActorRef Interface**
```typescript
// File: src/core/actor-ref.ts
export interface ActorRef<TContext, TEvents, TEmitted = never> {
  // Existing methods
  send: (event: TEvents) => void;
  getSnapshot: () => TContext;
  
  // New emission methods
  emit: (event: TEmitted) => void;
  subscribe: (listener: (event: TEmitted) => void) => Unsubscribe;
  
  // Enhanced type information
  readonly id: string;
  readonly status: 'running' | 'stopped' | 'error';
}

type Unsubscribe = () => void;
```

**Step 1.2: Event Bus Integration**
```typescript
// File: src/core/actor-event-bus.ts
export class ActorEventBus<TEmitted> {
  private listeners = new Set<(event: TEmitted) => void>();
  
  emit(event: TEmitted): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // [actor-web] TODO: Route to dead letter queue
        console.error('Event listener error:', error);
      }
    }
  }
  
  subscribe(listener: (event: TEmitted) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  clear(): void {
    this.listeners.clear();
  }
}
```

**Step 1.3: Update createActorRef Implementation**
```typescript
// File: src/core/create-actor-ref.ts
export function createActorRef<TContext, TEvents, TEmitted = never>(
  machine: StateMachine<TContext, TEvents>,
  options: ActorRefOptions = {}
): ActorRef<TContext, TEvents, TEmitted> {
  const eventBus = new ActorEventBus<TEmitted>();
  const actor = createActor(machine, options);
  
  return {
    // Existing implementation
    send: actor.send,
    getSnapshot: () => actor.getSnapshot().context,
    
    // New emission implementation
    emit: eventBus.emit.bind(eventBus),
    subscribe: eventBus.subscribe.bind(eventBus),
    
    // Enhanced properties
    id: options.id || generateActorId(),
    get status() {
      const state = actor.getSnapshot();
      return state.status === 'active' ? 'running' :
             state.status === 'done' ? 'stopped' : 'error';
    }
  };
}
```

#### Testing Strategy
```typescript
// File: src/core/actor-ref.test.ts
describe('ActorRef Event Emission', () => {
  it('should emit typed events to subscribers', () => {
    interface EmittedEvents {
      type: 'USER_ACTION';
      payload: { userId: string };
    }
    
    const actorRef = createActorRef<Context, Events, EmittedEvents>(machine);
    
    const events: EmittedEvents[] = [];
    const unsubscribe = actorRef.subscribe(event => events.push(event));
    
    actorRef.emit({ type: 'USER_ACTION', payload: { userId: '123' } });
    
    expect(events).toHaveLength(1);
    expect(events[0].payload.userId).toBe('123');
    
    unsubscribe();
  });
});
```

---

### 2. Graceful Shutdown Mechanism

**Goal**: Zero resource leaks when actors are stopped

#### Implementation Strategy
```typescript
// File: src/core/actor-lifecycle.ts
export interface ActorLifecycle {
  shutdown(): Promise<void>;
  addCleanupTask(task: () => void | Promise<void>): void;
  onShutdown(callback: () => void | Promise<void>): void;
}

export class ActorLifecycleManager implements ActorLifecycle {
  private cleanupTasks: Array<() => void | Promise<void>> = [];
  private shutdownCallbacks: Array<() => void | Promise<void>> = [];
  private isShuttingDown = false;
  
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    
    // Execute shutdown callbacks first
    await Promise.all(this.shutdownCallbacks.map(async (callback) => {
      try {
        await callback();
      } catch (error) {
        console.error('Shutdown callback error:', error);
      }
    }));
    
    // Then cleanup tasks
    await Promise.all(this.cleanupTasks.map(async (task) => {
      try {
        await task();
      } catch (error) {
        console.error('Cleanup task error:', error);
      }
    }));
    
    this.cleanupTasks.length = 0;
    this.shutdownCallbacks.length = 0;
  }
  
  addCleanupTask(task: () => void | Promise<void>): void {
    if (this.isShuttingDown) {
      console.warn('Cannot add cleanup task during shutdown');
      return;
    }
    this.cleanupTasks.push(task);
  }
  
  onShutdown(callback: () => void | Promise<void>): void {
    if (this.isShuttingDown) {
      console.warn('Cannot add shutdown callback during shutdown');
      return;
    }
    this.shutdownCallbacks.push(callback);
  }
}
```

---

### 3. Message Interceptors

**Goal**: Middleware chain for message processing

#### Pseudocode
```typescript
// File: src/core/message-interceptors.ts
export type MessageInterceptor<TEvents> = {
  intercept: (event: TEvents, next: (event: TEvents) => void) => void;
};

export class InterceptorChain<TEvents> {
  constructor(private interceptors: MessageInterceptor<TEvents>[] = []) {}
  
  process(event: TEvents, finalHandler: (event: TEvents) => void): void {
    if (this.interceptors.length === 0) {
      finalHandler(event);
      return;
    }
    
    let index = 0;
    const next = (modifiedEvent: TEvents): void => {
      if (index >= this.interceptors.length) {
        finalHandler(modifiedEvent);
        return;
      }
      
      const interceptor = this.interceptors[index++];
      interceptor.intercept(modifiedEvent, next);
    };
    
    next(event);
  }
}
```

---

### 4. Code Quality Tasks

#### 4.1 Remove `[actor-web] TODO` Comments
```bash
# Find all TODO comments
grep -r "\[actor-web\] TODO" src/ --include="*.ts" --include="*.js"

# Target: Convert all 15 TODOs to implementation or proper issue tracking
```

#### 4.2 Eliminate `any` Types
```typescript
// Current problematic areas (analyze with):
npx tsc --noEmit --strict

// Target: Zero `any` types in production code
// Strategy: Replace with proper type definitions or unknown/generic types
```

#### 4.3 Enhanced Error Messages
```typescript
// Before
throw new Error('Invalid state');

// After  
throw new ActorError(
  'INVALID_STATE_TRANSITION',
  `Cannot transition from '${currentState}' to '${targetState}' in actor '${actorId}'`,
  {
    actorId,
    currentState,
    targetState,
    availableTransitions: getAvailableTransitions(currentState)
  }
);
```

---

## 🧪 Testing Strategy

### Unit Tests (Target: 95% coverage)
```typescript
// File: src/core/__tests__/actor-ref.test.ts
describe('ActorRef Implementation', () => {
  describe('Event Emission', () => {
    // Test TEmitted support
  });
  
  describe('Lifecycle Management', () => {
    // Test graceful shutdown
    // Test resource cleanup
  });
  
  describe('Message Interceptors', () => {
    // Test middleware chain
    // Test error handling
  });
});
```

### Integration Tests
```typescript
// File: src/__tests__/integration/actor-system.test.ts
describe('Actor System Integration', () => {
  it('should handle complex actor communication patterns', () => {
    // Multi-actor scenario testing
  });
  
  it('should demonstrate zero resource leaks', () => {
    // Memory leak detection
  });
});
```

---

## 📊 Success Criteria

### Phase 1 Completion Checklist

- [ ] **Event Emission**: All actors can emit typed events
- [ ] **Graceful Shutdown**: Zero resource leaks in memory tests
- [ ] **Message Interceptors**: Middleware chain tested and documented
- [ ] **Cleanup Hooks**: All subscriptions properly cleaned
- [ ] **Resource Tracking**: Memory profiler shows flat line
- [ ] **Code Quality**: Zero `[actor-web] TODO` comments
- [ ] **Type Safety**: Zero `any` types in src/
- [ ] **Error Messages**: All errors have actionable context
- [ ] **Test Coverage**: 95%+ coverage on new code
- [ ] **Documentation**: API docs updated with examples

### Performance Targets

- Actor spawn time: <200ms
- Event emission latency: <1ms  
- Memory overhead per actor: <1KB
- Message throughput: >10k events/sec

---

## 🔄 Agent Coordination

### Handoff to Agent B (Implementation)
Once Phase 1 is complete, Agent A will provide:

1. **Complete ActorRef API** - Ready for real-world usage
2. **Usage Examples** - Demonstrating all patterns
3. **Testing Utilities** - For Agent B's integration work
4. **Performance Benchmarks** - Baseline measurements

### Handoff to Agent C (Testing)
Agent A will provide:

1. **Comprehensive Test Suite** - Template for testing patterns
2. **Memory Leak Detection** - Tools and procedures
3. **Performance Test Framework** - Benchmarking infrastructure
4. **Error Scenario Documentation** - Edge cases to test

---

## 📝 Implementation Log

### Session Notes Template
```markdown
## [Date] - Implementation Session

### 🎯 Focus Area
- [ ] Specific feature/task

### ✅ Completed
- Description of work done

### 🚧 In Progress  
- Current blockers or partial implementations

### 🔄 Next Steps
- Immediate next actions

### 📊 Progress
- Updated percentage toward Phase 1 completion
```

---

## 🚀 Quick Start Commands

```bash
# Agent A workflow
pnpm aw:status          # Check current state
pnpm aw:save           # Quick commit work
pnpm test              # Run tests
pnpm test:coverage     # Check coverage
pnpm aw:ship           # Ship completed features

# Development helpers
npm run dev            # Watch mode for testing
npm run typecheck      # Verify types
npm run lint:fix       # Auto-fix linting issues
```

---

_**Agent A Owner**: Focus on architecture, types, and core patterns_  
_**Template Usage**: Other agents can copy this structure for their domains_  
_**Status**: Ready for implementation - Phase 1 sprint planning complete_ 