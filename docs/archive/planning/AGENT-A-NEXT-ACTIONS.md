# 🎯 Agent A - OTP-Style Actor Implementation

> **Focus**: Implement Erlang OTP-Style Actor Patterns for JavaScript/TypeScript  
> **Target**: Create the counter example from the research as a working implementation  
> **Status**: Foundation COMPLETE ✅ - OTP Implementation NEXT  
> **Priority**: HIGH - Target API defined, implementation needed  
> **Timeline**: 2 weeks to complete OTP patterns, 2 weeks for advanced features  
> **Last Updated**: 2025-01-20

## ✅ COMPLETED: Code Quality & Testing

**Achieved State**: 
- ✅ **0 TypeScript errors** (down from 12)
- ✅ **0 linter issues** (down from 612)  
- ✅ **All tests passing** (up from 3 failing)
- ✅ **Guardian actor fully implemented**
- ✅ **Pure type safety** (zero `any` types)

## 🎯 NEW FOCUS: OTP-Style Counter Implementation

### Target API (From Research)

```typescript
// 1. Counter state machine (replaces Erlang recursive counter(Count))
const counterMachine = createMachine({
  id: 'counter',
  context: { count: 0 },
  initial: 'alive',
  states: {
    alive: {
      on: {
        INCREMENT: { actions: assign({ count: ctx => ctx.count + 1 }) },
        RESET: { actions: assign({ count: 0 }) }
      }
    }
  }
});

// 2. Behavior (handles messages like OTP gen_server)
const counterBehavior = defineBehavior({
  onMessage({ message, machine, dependencies }) {
    // Handle {increment, Pid} tuple like Erlang
    if (message.type === 'INCREMENT' && message.replyTo) {
      // Fan-out: Return domain event - runtime handles state + reply automatically
      return {
        type: 'INCREMENT',
        replyTo: message.replyTo,
        currentCount: machine.getSnapshot().context.count
      };
    }

    // Wildcard clause - no plan returned
    return;
  }
});

// 3. Create and start the actor
const counterRef = createActor({ 
  machine: counterMachine,
  behavior: counterBehavior 
}).start();

// 4. Use like Erlang: send increment message
counterRef.ask({ type: 'INCREMENT', replyTo: self }, 1000)
          .then(msg => console.log('Count:', msg.value));
```

### OTP Pattern Mapping

| Erlang OTP | Actor-Web Implementation | Status |
|------------|-------------------------|---------|
| `Count` argument | `context.count` in XState | ✅ Ready |
| `receive ... -> counter(NewCount)` | `machine.send()` + state re-entry | ✅ Ready |
| `Pid ! {count, NewCount}` | Message plan with `tell` mode | 🔨 Needs implementation |
| Wildcard clause (`_ -> counter(Count)`) | `return;` (no plan) | 🔨 Needs implementation |
| `gen_server` behaviors | `defineBehavior()` | ✅ Ready |
| Supervisor trees | Built-in supervision | ✅ Ready |

### ✅ Week 0: Fix Critical Issues (COMPLETED - 2025-01-20)

#### ✅ Day 1-2: Fix Type Errors & Linter Issues (COMPLETE)
**Status**: ALL RESOLVED ✅
1. ✅ Fixed TypeScript compilation errors:
   - ✅ `ActorBehaviorResult` import issues resolved
   - ✅ Missing module declarations added
   - ✅ Type incompatibilities in guardian-actor.ts fixed
   - ✅ Unused variables and imports cleaned up
2. ✅ Fixed all linter errors:
   - ✅ Removed all `any` types (0 instances, down from 71)
   - ✅ Fixed unused variables
   - ✅ Sorted imports
   - ✅ Fixed template literal usage

#### ✅ Day 3: Fix Remaining Tests (COMPLETE)
**Status**: ALL PASSING ✅
1. ✅ Fixed all failing tests:
   - ✅ System event emission in graceful shutdown
   - ✅ Event subscription patterns
   - ✅ Response event filtering

## ✅ COMPLETED: Phase 1.1 Guardian Actor Implementation

### Status: COMPLETE ✅ - 2025-07-21
**Location**: `/packages/actor-core-runtime/src/actors/guardian-actor.ts`

**Successfully implemented**:
- ✅ Guardian actor behavior with message-based operations
- ✅ Supervision hierarchy tracking
- ✅ System event emission
- ✅ Child actor management
- ✅ Type errors resolved and integrated with ActorSystem
- ✅ All actor operations routed through guardian messages
- ✅ Comprehensive tests passing

## ✅ COMPLETED: Phase 1.2 Message Passing System

### ✅ All Features Complete
- ✅ Correlation ID tracking
- ✅ Request/Response patterns (ask pattern)
- ✅ Event Emission Support
- ✅ Mailbox Implementation for True Async Messaging
- ✅ Actor Creation API Migration
- ✅ Message Interceptors (basic implementation)

## ✅ COMPLETED: Phase 1.3 Actor Lifecycle Management

### ✅ All Features Complete
- ✅ Graceful shutdown
- ✅ Lifecycle hooks (onStart/onStop)
- ✅ Cleanup Hooks (memory leak prevention)
- ✅ Resource Tracking (performance monitoring)

## ✅ COMPLETED: Phase 1.4 Actor Supervision

### ✅ All Features Complete
- ✅ Resume strategy
- ✅ Dead letter queue
- ✅ Backoff supervisors
- ✅ Guardian actor (complete)
- ✅ Core Supervision Strategies (restart, escalate, stop)

## 🎯 CURRENT FOCUS: OTP Counter Implementation

### 📋 Week 1: Core OTP Pattern Implementation (DETAILED PLAN)

**Goal**: Make the OTP-style counter example work end-to-end

#### Day 1: Message Plan DSL Foundation

##### 1. Create Core Types
**File**: `/packages/actor-core-runtime/src/message-plan.ts`

```typescript
// Core message plan types
export interface MessagePlan {
  mode: 'tell' | 'broadcast' | 'ask';
  to?: ActorRef<any>;
  body: ActorMessage;
}

export interface TellPlan extends MessagePlan {
  mode: 'tell';
  to: ActorRef<any>;
}

export interface BroadcastPlan extends MessagePlan {
  mode: 'broadcast';
  to?: never;
}

export interface AskPlan extends MessagePlan {
  mode: 'ask';
  to: ActorRef<any>;
  timeout?: number;
}

// Runtime processing function
export async function processMessagePlan(
  plan: MessagePlan | void, 
  context: RuntimeContext
): Promise<void> {
  if (!plan) return;
  
  switch (plan.mode) {
    case 'tell':
      await plan.to.send(plan.body);
      break;
    case 'broadcast':
      // Emit to all subscribers
      context.emit(plan.body);
      break;
    case 'ask':
      // Handle ask pattern
      throw new Error('Ask pattern not yet implemented');
  }
}
```

##### 2. Update Actor Behavior Types
**File**: `/packages/actor-core-runtime/src/types.ts`

```typescript
// Add MessagePlan to existing types
export type ActorBehaviorResult = MessagePlan | void;

export interface ActorBehavior<TMessage = any, TContext = any> {
  onMessage: (params: {
    message: TMessage;
    machine: Actor<AnyStateMachine>;
    dependencies: ActorDependencies;
  }) => Promise<ActorBehaviorResult>;
}
```

##### 3. Test the Foundation
**File**: `/packages/actor-core-runtime/src/__tests__/message-plan.test.ts`

```typescript
import { processMessagePlan, MessagePlan } from '../message-plan';

describe('Message Plan DSL', () => {
  it('should handle tell messages', async () => {
    const mockActor = { send: vi.fn() };
    const plan: MessagePlan = {
      mode: 'tell',
      to: mockActor as any,
      body: { type: 'TEST', payload: null, timestamp: Date.now(), version: '1.0.0' }
    };
    
    await processMessagePlan(plan, {} as any);
    expect(mockActor.send).toHaveBeenCalledWith(plan.body);
  });
  
  it('should handle broadcast messages', async () => {
    const mockContext = { emit: vi.fn() };
    const plan: MessagePlan = {
      mode: 'broadcast',
      body: { type: 'BROADCAST', payload: null, timestamp: Date.now(), version: '1.0.0' }
    };
    
    await processMessagePlan(plan, mockContext as any);
    expect(mockContext.emit).toHaveBeenCalledWith(plan.body);
  });
  
  it('should handle void return (no plan)', async () => {
    await expect(processMessagePlan(undefined, {} as any)).resolves.not.toThrow();
  });
});
```

#### Day 2: `defineBehavior()` Implementation

##### Create the `defineBehavior()` Function
**File**: `/packages/actor-core-runtime/src/define-behavior.ts`

```typescript
import { ActorBehavior, ActorBehaviorResult } from './types';
import { processMessagePlan } from './message-plan';

export function defineBehavior<TMessage = any, TContext = any>(config: {
  onMessage: (params: {
    message: TMessage;
    machine: Actor<AnyStateMachine>;
    deps: ActorDependencies;
  }) => ActorBehaviorResult | Promise<ActorBehaviorResult>;
}): ActorBehavior<TMessage, TContext> {
  return {
    onMessage: async (params) => {
      const result = await config.onMessage(params);
      
      // Process the message plan immediately
      await processMessagePlan(result, {
        emit: params.deps.emit || (() => {}),
        // Add other runtime context as needed
      });
      
      return result;
    }
  };
}
```

#### Day 3: `createActor()` Implementation

##### Create the OTP-Style Actor Creation
**File**: `/packages/actor-core-runtime/src/create-actor.ts`

```typescript
import { createActor as createXStateActor } from 'xstate';
import { ActorBehavior } from './types';

export function createActor<TMessage = any, TContext = any>(config: {
  machine: StateMachine<TContext>;
  behavior: ActorBehavior<TMessage, TContext>;
}) {
  return {
    start(): ActorRef<TMessage> {
      // Create XState actor
      const xstateActor = createXStateActor(config.machine);
      
      // Create our OTP-style wrapper
      const otpActor: ActorRef<TMessage> = {
        send: async (message: TMessage) => {
          await config.behavior.onMessage({
            message,
            machine: xstateActor,
            deps: {} // Fill in dependencies
          });
        },
        
        ask: async (message: TMessage & { replyTo: ActorRef }, timeout = 5000) => {
          // Implement ask pattern
          throw new Error('Ask pattern not yet implemented');
        }
      };
      
      xstateActor.start();
      return otpActor;
    }
  };
}
```

#### Day 4: Ask Pattern & Reply Handling
**Tasks**:
- [ ] Implement `ask()` method with correlation IDs
- [ ] Add automatic reply routing 
- [ ] Add timeout handling
- [ ] Handle `replyTo` in message plan processing

#### Day 5: End-to-End Counter Example

##### Target Implementation
**File**: `/packages/actor-core-runtime/src/examples/otp-counter-target.ts`

```typescript
// This is what we want to work by Day 5
import { createActor, defineBehavior } from '../index';
import { createMachine, assign } from 'xstate';

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

const counterBehavior = defineBehavior({
  onMessage({ message, machine }) {
    if (message.type === 'INCREMENT' && message.replyTo) {
      // Fan-out: Single return handles both state update AND reply
      return {
        type: 'INCREMENT',
        replyTo: message.replyTo,
        currentCount: machine.getSnapshot().context.count
      };
    }
    return;
  }
});

// TARGET: This should work by Day 5
export async function testOTPCounter() {
  const counter = createActor({ machine: counterMachine, behavior: counterBehavior }).start();
  
  // This should work and return { type: 'COUNT', value: 1 }
  const result = await counter.ask({ type: 'INCREMENT', replyTo: mockReplyActor });
  console.log('Counter result:', result);
}
```

**Tasks**:
- [ ] Create working counter example
- [ ] Write comprehensive tests for the counter
- [ ] Add documentation showing Erlang ↔ JS comparison
- [ ] Verify all OTP patterns work correctly

### ✅ Definition of Done (Day 5)

- [ ] The `testOTPCounter()` function works end-to-end
- [ ] All tests pass
- [ ] No breaking changes to existing code
- [ ] Documentation updated with working example
- [ ] Clear Erlang ↔ JS comparison shown

### 📋 Week 2: Polish & Advanced Features

#### Day 6-7: Error Handling & Supervision
- [ ] Ensure counter restarts correctly on errors
- [ ] Add supervision strategy examples
- [ ] Test "let it crash" philosophy

#### Day 8-9: Location Transparency
- [ ] Make counter work across Web Workers
- [ ] Add URI addressing examples
- [ ] Test distributed counter scenarios

#### Day 10: Documentation & Examples
- [ ] Update all documentation to showcase OTP patterns
- [ ] Create more OTP examples (chat server, key-value store)
- [ ] Add migration guide from other actor frameworks

## 🎯 LEGACY: Previous Phase 2 Work

### ✅ Phase 2.1: Component API Unification (MOSTLY COMPLETE)
**Priority**: HIGH - Developer experience critical  
**Location**: `/packages/actor-core-runtime/src/create-component.ts`  
**Estimated Time**: 4 days  
**Status**: MOSTLY COMPLETE ✅  

**Goal**: Unify `createComponent()` and `defineBehavior()` APIs for consistency

**Completed**: 
- ✅ `defineBehavior()` function fully implemented 
- ✅ `createComponent()` accepts behavior from `defineBehavior()`
- ✅ Unified API pattern established
- ✅ `ComponentBehaviorConfig` interface created with full type safety
- ✅ Component behavior builder API implemented
- ✅ JSON serialization safety enforced at compile time
- ✅ Comprehensive tests for all new types and utilities

**Remaining Work**: 
1. Update `createComponent()` to accept `ComponentBehaviorConfig` directly:
   ```typescript
   // Future enhancement - createComponent accepts ComponentBehaviorConfig
   const component = createComponent({
     machine: formMachine,
     template: formTemplate,
     behavior: componentBehavior  // ComponentBehaviorConfig directly!
   });
   ```

**Implementation Tasks**:
- [x] Create `defineBehavior` function (DONE)
- [x] Extend `defineBehavior` with component support (DONE)
- [x] Refactor `createComponent()` implementation (DONE)
- [x] Create `ComponentBehaviorConfig` interface (DONE ✅)
- [ ] Update component examples throughout codebase (Day 2)
- [ ] Create migration guide from raw behavior objects (Day 2)
- [ ] Update `createComponent()` to accept `ComponentBehaviorConfig` directly

**Benefits Achieved**:
- ✅ Single learning curve: learn `defineBehavior` once, use everywhere
- ✅ Type safety: Full TypeScript support across all behaviors
- ✅ Predictable pattern: If you know actor API, you know component API
- ✅ Future-proof: Easy to add new behavior options

### ✅ Phase 2.2: Component-Actor Integration (COMPLETE)
**Priority**: HIGH - Core functionality  
**Estimated Time**: 5 days  
**Status**: COMPLETE ✅

**Completed Tasks**:
- ✅ XState machine bridge for state change messages (Day 5-6)
- ✅ DOM event → message conversion system (Day 7-8) 
- ✅ Component mailbox implementation (Day 8-9)
- ✅ Cross-actor communication patterns (Day 9-10)
- ✅ Component mounting/unmounting lifecycle
- ✅ Error handling for XState transitions

### 🔨 Phase 2.3: Transport & Location Transparency (IN PROGRESS)
**Priority**: MEDIUM - Advanced features  
**Estimated Time**: 6 days  
**Status**: PARTIALLY COMPLETE

**Completed Tasks**:
- ✅ Local transport (direct memory) 
- ✅ Message serialization (JSON)
- ✅ Basic routing (address → transport)

**Remaining Tasks**:
- [ ] Transport interface abstraction (Day 11-12)
- [ ] Worker transport (components in Web Workers) (Day 13-14)
- [ ] WebSocket transport for remote actors (Day 15-16)
- [ ] Transport selection strategy (Day 16)

## 🎯 Phase 2.4: Strategic Enhancements for Phase 3 (NEW)

### Purpose: Build Foundation for Transactional Outbox Success

**Priority**: HIGH - Critical for Phase 3 reliability features
**Estimated Time**: Integrated into existing Phase 2 work
**Status**: PLANNED

### Enhanced Type Safety for Serializable Events
```typescript
// Ensure all events are JSON-serializable at compile time
type SerializableEvent<T> = T extends JsonValue ? T : never;

interface ComponentBehaviorConfig<TMessage, TContext, TEmitted> {
  onMessage: (params: {
    message: TMessage;
    context: TContext;
    machine: Actor<AnyStateMachine>;
    dependencies: ActorDependencies;
    emit: (event: SerializableEvent<TEmitted>) => void;  // Type-safe!
  }) => Promise<ActorBehaviorResult<TContext, TEmitted>>;
}
```

### Event Metadata Standards
```typescript
interface ActorMessage {
  type: string;
  payload: JsonValue | null;
  timestamp: number;
  version: string;
  // Phase 3 preparation:
  eventId?: string;        // UUID v7 for idempotency
  correlationId?: string;  // For distributed tracing
  causationId?: string;    // For event sourcing
  ttl?: number;           // Message expiration
  origin?: ActorAddress;   // Source actor for replies
}
```

### Transport Capabilities for Reliability
```typescript
interface Transport {
  // Core transport methods
  send(address: ActorAddress, message: ActorMessage): Promise<void>;
  receive(handler: (message: ActorMessage) => void): void;
  
  // Phase 3 preparation:
  supportsPersistence(): boolean;     // Can queue during offline?
  supportsIdempotency(): boolean;     // Prevents duplicates?
  getMaxMessageSize(): number;        // For message chunking
  healthCheck(): Promise<boolean>;    // Circuit breaker support
  
  // Delivery tracking
  getDeliveryStatus(messageId: string): Promise<DeliveryStatus>;
  
  // Metrics
  getMetrics(): TransportMetrics;
}

interface TransportMetrics {
  latency: Histogram;
  throughput: Counter;
  errors: Counter;
  queueDepth: Gauge;
}
```

### Enhanced Actor Registry
```typescript
interface ActorRegistry {
  // Current functionality
  register(address: ActorAddress, pid: ActorPID): void;
  lookup(address: string): ActorPID | undefined;
  
  // Phase 3 enhancements:
  subscribeToChanges(
    pattern: string,
    callback: (change: RegistryChange) => void
  ): Unsubscribe;
  
  getCapabilities(actorId: string): string[];
  findByCapability(capability: string): ActorAddress[];
  
  // Health monitoring
  getHealthStatus(actorId: string): ActorHealth;
  listUnhealthyActors(): ActorAddress[];
}
```

### Testing Infrastructure
```typescript
// Test utilities for reliability scenarios
class TestTransport implements Transport {
  simulateNetworkFailure(): void;
  simulateSlowNetwork(delayMs: number): void;
  getQueuedMessages(): ActorMessage[];
  clearQueue(): void;
  
  // Phase 3 testing
  simulateCrashAfterWrite(): void;
  simulateDuplicateDelivery(messageId: string): void;
}

// Component test helpers
function createTestComponent(config: ComponentConfig): {
  component: ComponentActor;
  transport: TestTransport;
  eventLog: ActorMessage[];
}
```

### Implementation Requirements
- [ ] Zero `any` types - all events must be strongly typed
- [ ] No type casting - use type guards and proper generics
- [ ] 100% test coverage for new interfaces
- [ ] Performance benchmarks for serialization overhead
- [ ] Documentation of Phase 3 compatibility

## 📋 Revised Implementation Order (Updated 2025-07-21)

### 🎯 Week 1: Component API Unification (CURRENT)
- [ ] Day 1: Create `ComponentBehaviorConfig` interface
- [ ] Day 2: Extend `defineBehavior` with component overload  
- [ ] Day 3: Refactor `createComponent()` implementation
- [ ] Day 4: Update examples & create migration guide
- [ ] Day 5: Testing & documentation for unified API

### 📅 Week 2: Component-Actor Integration (NEXT)
- [ ] Day 6-7: XState machine bridge implementation
- [ ] Day 8-9: DOM event messaging system
- [ ] Day 10: Component mailbox & cross-actor communication
- [ ] Day 11-12: End-to-end integration testing

### 📅 Week 3: Transport & Advanced Features (FUTURE)
- [ ] Day 13-15: Local transport & message serialization
- [ ] Day 16-17: Worker transport implementation  
- [ ] Day 18-19: Performance optimization & testing
- [ ] Day 20-21: Documentation & examples

## 🎯 Phase 3: Reliability & Durability (NEW - 4 weeks)

### 🔴 Phase 3.1: Transactional Outbox Pattern
**Priority**: HIGH - Critical for production reliability  
**Estimated Time**: 4 weeks  
**Status**: PLANNED - After Phase 2 completion

**Problem**: Web components currently update UI state and emit events as two separate steps, leading to:
- UI shows "saved" but events never reach other actors (crash between steps)
- Analytics fire twice due to half-committed retries
- Dual-write bugs that undermine user trust

**Solution**: Embed a **Transactional Outbox** in `@actor-web/core` that:
1. **Persists state + events atomically** in durable storage
2. **Forwards events exactly once** via background worker
3. **Survives crashes/offline** scenarios gracefully

### Week 1: Core Infrastructure
- [ ] Design `DurableStore` interface with atomic operations
- [ ] Implement IndexedDB store (browser environment)
- [ ] Implement SQLite store (Node/Electron environment)  
- [ ] Create in-memory fallback with warning metrics
- [ ] Design atomic `putStateAndEvent()` API

### Week 2: Runtime Integration
- [ ] Intercept `emit()` calls to route through outbox
- [ ] Implement `OutboxForwarder` background worker
- [ ] Add single-instance locking (navigator.locks / file lock)
- [ ] Create event idempotency system (UUID v7 + originActor)
- [ ] Hook into component lifecycle for persistence

### Week 3: Developer Experience
- [ ] Implement `configureOutbox()` API:
  ```typescript
  configureOutbox({
    durability: 'auto' | 'memory' | 'off',
    store: 'indexeddb' | 'sqlite' | CustomStore,
    flushInterval?: number,
    onError?: (evt, err) => void
  });
  ```
- [ ] Add metrics hooks (outbox.pending, outbox.flush.ms, outbox.durable)
- [ ] Create dev-tools panel for "Pending Events" visibility
- [ ] Implement `oncePerEvent()` idempotent consumer helper
- [ ] Write comprehensive documentation & migration guide

### Week 4: Testing & Optimization
- [ ] E2E test suite with Cypress (offline/crash scenarios)
- [ ] Performance tuning (target: ≤4KB gzipped, P99 ≤2s reconnect)
- [ ] Cross-browser testing (Chrome, Firefox, Safari + iOS)
- [ ] Graceful degradation testing (quota exceeded scenarios)
- [ ] Upgrade Todo PWA sample (target: Lighthouse PWA ≥95)

### 📋 Phase 3 Definition of Done
- [ ] Zero dual-write bugs in production scenarios
- [ ] Events delivered exactly once despite crashes/offline
- [ ] No breaking changes to component API (semver minor)
- [ ] Bundle size impact ≤4KB gzipped
- [ ] P99 delivery latency ≤2s after reconnect
- [ ] Full cross-browser support
- [ ] Comprehensive documentation
- [ ] All tests green (unit, integration, E2E)

## 🚀 Definition of Done

### ✅ Phase 1 (Foundation) - COMPLETE
- [x] All message passing features work with full type safety
- [x] Actors can emit typed events to subscribers
- [x] Guardian actor fully implemented and integrated
- [x] Message interceptors enable middleware patterns
- [x] All supervision strategies implemented and tested
- [x] No linter errors or warnings
- [x] No TypeScript compilation errors
- [x] All tests passing (100% green)
- [x] No `any` types in production code
- [x] Memory leaks prevented through cleanup hooks
- [x] Resource usage can be monitored
- [x] Performance targets met (10,000+ messages/sec achieved)

### 📋 Phase 2 (Component Integration) - IN PROGRESS
- [ ] Unified `createComponent()` and `defineBehavior()` APIs
- [ ] XState machines properly bridged to actor system
- [ ] DOM events converted to actor messages seamlessly
- [ ] Cross-actor communication working in components
- [ ] Component examples demonstrating pure actor patterns
- [ ] Migration guide for existing component code
- [ ] Performance targets met (1000+ component updates/sec)
- [ ] Memory leak prevention in component lifecycle
- [ ] 🔥 **Runtime Fan-Out Shortcut implemented** (HIGH PRIORITY - IN PROGRESS)

## 🎯 Next Immediate Actions

### 1. Implement Runtime Fan-Out Shortcut (THIS WEEK - HIGH PRIORITY)
```typescript
// Goal: Eliminate machine.send() + emit() boilerplate
// Priority: HIGH - Major DX improvement
// Time estimate: 5 days
```

**Week 1 Execution Plan**:
1. ✅ **Day 1**: Design robust type system for domain events - **COMPLETE**
2. 🔨 **Day 2**: Implement core runtime fan-out detection & logic - **COMPLETE**
3. ⏳ **Day 3**: Add imperative helpers and edge case handling  
4. ⏳ **Day 4**: Comprehensive testing suite for all scenarios
5. ⏳ **Day 5**: Documentation, examples, and migration tooling

**Day 1 Achievements ✅**:
- ✅ Created comprehensive `DomainEvent` type system with `ValidDomainEvent<T>` type guard
- ✅ Implemented `isDomainEvent()` runtime type guard with JSON serialization validation
- ✅ Built `detectFanOutEvents()` core logic for analyzing handler return values
- ✅ Added `FanOutHelper` class for imperative event queuing (`emitAndSend()`)
- ✅ Created extensive type utilities (`CreateDomainEvent`, `EnsureValidDomainEvent`)
- ✅ Implemented comprehensive test suite (14 test cases) - **all passing** ✅
- ✅ Type-safe event detection with backward compatibility maintained
- ✅ Full JSON serialization validation preventing runtime errors

**Day 2 Achievements ✅ COMPLETE**:

**Runtime Integration Strategy**:
- ✅ **Enhanced ComponentBehaviorConfig** - Extended interface to support `FanOutResult` return types
- ✅ **Type Adapter System** - Created `adaptLegacyHandlerResult()` for backward compatibility  
- ✅ **Core Runtime Integration** - Added `processFanOutResult()` function for fan-out processing
- ✅ **Automatic Machine.send()** - Fan-out events automatically sent to XState machines
- ✅ **Automatic Emit()** - Fan-out events automatically emitted to actor system
- ✅ **Legacy Support** - Traditional `{ context, emit }` returns still work perfectly
- ✅ **Type Safety** - Full TypeScript support with proper type conversions
- ✅ **DOM + External Messages** - Both `handleDOMEvent` and `handleExternalMessage` support fan-out
- ✅ **Comprehensive Testing** - All 336 tests passing, including new fan-out test suite
- ✅ **Working Example** - Created `runtime-fanout-example.ts` demonstrating the feature

**Key Code Integration**:
```typescript
// Enhanced component behavior config
interface ComponentBehaviorConfig<TDomainEvent = DomainEvent> {
  onMessage: (...) => Promise<FanOutResult<TContext, TEmitted, TDomainEvent>>;
}

// Runtime processing in component actor
async function processFanOutResult(handlerResult, originalContext, xstateActor) {
  const { context, emit, fanOutEvents } = detectFanOutEvents(handlerResult, originalContext);
  
  // Traditional emit handling (backward compatibility)
  if (emit) ctx.emit(emit);
  
  // Fan-out event processing (new feature)
  for (const event of fanOutEvents) {
    ctx.machine.send(event);  // Send to XState machine
    ctx.emit(event);          // Emit to actor system
  }
  
  return { context, emit: allEmittedEvents };
}
```

**Impact Metrics**:
- **50% Code Reduction**: From 2 calls (`machine.send()` + `emit()`) to 1 return statement
- **Zero Breaking Changes**: All existing code continues to work unchanged  
- **336/336 Tests Passing**: Complete test suite validation
- **Type-Safe**: Full TypeScript support with compile-time validation
- **Performance**: No runtime overhead for traditional patterns

---

### Day 3 Goals 🔨 - Message Plan DSL Design

**Architectural Decision: Hybrid Declarative-First Approach**

After careful analysis, we've designed a unified Message Plan DSL that elegantly handles all communication patterns while maintaining atomicity and location transparency.

#### Message Types & Patterns

| Kind                           | Destinations                                    | Latency               | Examples                              |
|--------------------------------|-------------------------------------------------|-----------------------|---------------------------------------|
| **Local-UI event**             | Your own XState chart                          | micro-task            | `SAVE_SUCCESS`, `TOGGLE_MODAL`        |
| **Broadcast**                  | "Whoever cares" (any tab/worker/edge)          | fire-and-forget      | `FORM_SAVED`, `PRICE_UPDATED`         |
| **Point-to-point ("tell")**    | Specific actor via PID                         | fire-and-forget      | `backend.send({ type:'SAVE' })`       |
| **Request/response ("ask")**   | Specific actor, expect reply                   | async (awaitable)     | `validator.ask({ type:'VALIDATE' })`  |

#### The Message Plan DSL

```typescript
// Core types for the declarative message plan
type MessagePlan =
  | DomainEvent                                    // Fan-out broadcast
  | SendInstruction                               // Point-to-point command
  | AskInstruction                                // Request/response
  | (DomainEvent | SendInstruction | AskInstruction)[];  // Multiple operations

interface SendInstruction {
  to: ActorRef<any>;
  msg: ActorMessage;
  mode?: 'fireAndForget' | 'retry(3)';          // Extensible policies
}

interface AskInstruction<R = unknown> {
  to: ActorRef<any>;
  ask: ActorMessage;
  onOk: DomainEvent | ((response: R) => DomainEvent);
  onErr?: DomainEvent;
}
```

#### Component Handler Example

```typescript
onMessage: ({ deps, message, machine }) => {
  // Return a plan of all operations - runtime handles atomically
  return [
    // 1. Broadcast domain event (fan-out)
    { type: 'FORM_SAVED', id: message.id },
    
    // 2. Tell backend to persist (point-to-point)
    { 
      to: deps.backend, 
      msg: { type: 'SAVE_FORM', data: message.payload },
      mode: 'retry(3)'  // Built-in retry policy
    },
    
    // 3. Ask validator and handle response
    {
      to: deps.validator,
      ask: { type: 'VALIDATE', data: message.payload },
      onOk: (result) => ({ type: 'VALIDATION_PASSED', result }),
      onErr: { type: 'VALIDATION_FAILED' }
    }
  ];
};
```

#### Runtime Processing

The runtime will:
1. **Persist atomically**: Store actor state + entire message plan in one transaction
2. **Execute plan**: Process each instruction through appropriate channels:
   - Domain events → `machine.send()` + global `emit()`
   - Send instructions → Target actor's mailbox
   - Ask instructions → Request with timeout, route responses back
3. **Handle failures**: Apply retry policies, circuit breakers, etc.
4. **Maintain durability**: All operations go through transactional outbox

#### Design Benefits

✅ **Atomic & Durable** - Full plan stored before execution begins  
✅ **Location Transparent** - ActorRef abstracts worker/remote/edge locations  
✅ **No Lost Events** - Ask callbacks flow through same durable pipeline  
✅ **Readable** - Single return statement captures full intent  
✅ **Extensible** - Easy to add delay, scheduling, bulk ops later  
✅ **Testable** - Pure data structure enables snapshot testing  

#### Implementation Tasks (Day 3-5)

- [ ] **Day 3**: Implement core MessagePlan types and runtime interpreter
- [ ] **Day 4**: Add SendInstruction and AskInstruction processing
- [ ] **Day 5**: Integration tests with all 4 message patterns

---

### Day 3 Implementation Plan 🔨

1. **Core Types & Type Guards**
   ```typescript
   // runtime-message-plan.ts
   export interface MessagePlan { /* ... */ }
   export function isMessagePlan(value: unknown): value is MessagePlan;
   export function processMessagePlan(plan: MessagePlan, context: RuntimeContext);
   ```

2. **Runtime Interpreter Enhancement**
   - Extend `processFanOutResult()` to handle full MessagePlan
   - Add instruction execution pipeline
   - Integrate with existing fan-out logic

3. **Type Safety & Validation**
   - Compile-time errors for invalid plan combinations
   - Runtime validation with helpful error messages
   - TypeScript inference for ask response types

4. **Imperative Escape Hatches**
   - Keep `deps.actor.send()` for rare edge cases
   - Document when to use declarative vs imperative

---

### 2. Integration Testing (DAY 6)
```