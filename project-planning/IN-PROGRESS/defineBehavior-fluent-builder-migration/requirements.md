# Requirements: defineBehavior Fluent Builder Migration

## Business Requirements

### BR-001: Zero Type Safety Violations
**Priority**: Critical  
**Description**: The new API must eliminate all `any` types and type casting from the `defineBehavior()` implementation and usage.  
**Acceptance Criteria**:
- ✅ Zero `any` types in implementation code
- ✅ Zero type casting (`as SomeType`) in implementation
- ✅ Passes strict Biome linter rules without exceptions
- ✅ Full TypeScript inference without manual type annotations

**Rationale**: Our architecture enforces pure actor model principles. Type safety violations undermine system reliability and maintainability.

### BR-002: Compile-Time Mutual Exclusivity  
**Priority**: Critical  
**Description**: It must be impossible to create actors with both `context` and `machine` configurations.  
**Acceptance Criteria**:
- ✅ TypeScript compiler prevents calling both `.withContext()` and `.withMachine()`
- ✅ Clear, actionable error messages for invalid usage patterns
- ✅ No runtime validation needed - pure compile-time enforcement

**Rationale**: The pure actor model requires clear separation between context-based and machine-based state management patterns.

### BR-003: Developer Experience Excellence
**Priority**: High  
**Description**: The API must guide developers toward correct usage with discoverable, intuitive method chaining.  
**Acceptance Criteria**:
- ✅ IDE autocompletion shows only valid next steps
- ✅ Method names clearly indicate their purpose (`.withContext()`, `.withMachine()`)
- ✅ No intermediate invalid states expressible in user code
- ✅ Error messages guide users toward correct patterns

### BR-004: Generic Type Preservation
**Priority**: High  
**Description**: Type information must flow correctly through the entire builder chain.  
**Acceptance Criteria**:
- ✅ `TMessage` type preserved from `defineBehavior<TMessage>()` to final handler
- ✅ `TContext` type properly inferred from `.withContext(initialContext)`
- ✅ Handler parameters correctly typed based on chosen path
- ✅ No loss of type information at any step in the chain

## Technical Requirements

### TR-001: Pure Actor Model Compliance
**Priority**: Critical  
**Description**: Implementation must strictly follow pure actor model principles.  
**Acceptance Criteria**:
- ✅ Both context-based and machine-based actors use IDENTICAL handler signature: `({ message, machine, dependencies })`
- ✅ All actors access state via `machine.getSnapshot().context` (consistent pattern)
- ✅ All actors have access to `machine` for system operations (send, ask, supervision, etc.)
- ✅ Context-based: `machine` created from `initialContext`; Machine-based: `machine` is the custom XState machine
- ✅ Message handlers return `MessagePlan` or `void` only

### TR-002: Backward Compatibility Strategy
**Priority**: High  
**Description**: Provide smooth migration path from current implementation.  
**Acceptance Criteria**:
- ✅ Current `defineBehavior` renamed to `defineBehaviorLegacy` with deprecation warnings
- ✅ All existing tests converted to new fluent API
- ✅ Migration guide documentation provided
- ✅ Automated migration script where feasible

### TR-003: Builder Architecture
**Priority**: High  
**Description**: Implement type-safe builder classes with proper encapsulation.  
**Acceptance Criteria**:
- ✅ `ContextBehaviorBuilder<TMessage, TEmitted, TDomainEvent, TContext>` class
- ✅ `MachineBehaviorBuilder<TMessage, TEmitted, TDomainEvent>` class  
- ✅ Proper constructor parameter validation
- ✅ Builder instances are immutable (no shared state issues)

### TR-004: Handler Type Definitions
**Priority**: Critical  
**Description**: Simplified, unified TypeScript definition for message handler signature with OTP state management patterns.  
**Acceptance Criteria**:
- ✅ Single `PureMessageHandler<TMessage, TEmitted, TDomainEvent>` type for both patterns
- ✅ Consistent signature: `({ message, machine, dependencies }) => ...` for all actors
- ✅ `machine` parameter provides both state access AND system operations for all actors
- ✅ Context-based actors: `machine` created from `initialContext`, Machine-based: custom XState machine
- ✅ **OTP-Enhanced Return Types**: `ActorHandlerResult<TContext, TResponse>` supporting:
  - `state?: TContext` - Return-based state updates (OTP gen_server pattern)
  - `response?: TResponse` - Ask pattern responses  
  - `behavior?: BehaviorFunction<TContext>` - Dynamic behavior switching (becomes pattern)
  - `effects?: Effect[]` - Side effects to execute
  - Backward compatible: `MessagePlan<TDomainEvent>`, `void`, Promise variants

### TR-005: OTP State Management Integration
**Priority**: Critical  
**Description**: Implement OTP-inspired state management patterns for context-based actors.  
**Acceptance Criteria**:
- ✅ **Return-based State Updates**: Handlers can return new state like OTP gen_server `{:reply, reply, new_state}`
- ✅ **Behavior Switching**: Support dynamic behavior changes via "becomes" pattern
- ✅ **Effect Handling**: Side effects returned from handlers and executed by actor system
- ✅ **Type Safety**: All patterns maintain zero `any` types and full TypeScript inference
- ✅ **Performance**: Structural sharing for large contexts, batch updates for high-throughput

## Functional Requirements

### FR-001: Context-Based Actor Creation
**Priority**: Critical  
**Description**: Support creating actors with context-based state management.  
**Usage Pattern**:
```typescript
const behavior = defineBehavior<MyMessage>()
  .withContext({ count: 0, status: 'idle' })
  .onMessage(({ message, machine, dependencies }) => {
    // machine: Actor<AnyStateMachine> - created from initialContext
    // Access state: machine.getSnapshot().context (contains { count: 0, status: 'idle' })
    // System operations: machine.send(), machine.ask(), etc.
    const { count, status } = machine.getSnapshot().context;
  });
```
**Acceptance Criteria**:
- ✅ Context type inferred from `initialContext` argument and embedded in machine
- ✅ Consistent handler signature: `({ message, machine, dependencies })`  
- ✅ Machine created from `initialContext` provides both state access and system operations
- ✅ No access to machine-specific configuration methods after `.withContext()`

### FR-002: Machine-Based Actor Creation  
**Priority**: Critical  
**Description**: Support creating actors with XState machine-based state management.  
**Usage Pattern**:
```typescript
const behavior = defineBehavior<MyMessage>()
  .withMachine(myXStateMachine)
  .onMessage(({ message, machine, dependencies }) => {
    // machine: Actor<AnyStateMachine> - the custom XState machine provided
    // Access state: machine.getSnapshot().context (XState machine's context)
    // System operations: machine.send(), machine.ask(), etc.
    const state = machine.getSnapshot();
  });
```
**Acceptance Criteria**:
- ✅ Machine parameter properly validated as `AnyStateMachine`
- ✅ Consistent handler signature: `({ message, machine, dependencies })`
- ✅ Machine is the custom XState machine provided, supporting both state access and system operations
- ✅ No access to context-specific configuration methods after `.withMachine()`

### FR-003: Type-Safe Method Chaining
**Priority**: High  
**Description**: Builder methods must return objects with only valid next methods available.  
**Acceptance Criteria**:
- ✅ `defineBehavior()` returns object with `.withContext()` and `.withMachine()` only
- ✅ `.withContext()` returns object with `.onMessage()` only
- ✅ `.withMachine()` returns object with `.onMessage()` only
- ✅ TypeScript prevents calling invalid method sequences

### FR-004: OTP Return-Based State Updates with Smart Defaults  
**Priority**: Critical  
**Description**: Context-based actors can update their state by returning new state from handlers (OTP gen_server pattern) with intelligent state/response defaults.  
**Usage Pattern**:
```typescript
const behavior = defineBehavior<CounterMessage>()
  .withContext({ count: 0, status: 'idle' })
  .onMessage(({ message, machine, dependencies }) => {
    const currentContext = machine.getSnapshot().context;
    
    switch (message.type) {
      case 'INCREMENT':
        // ✅ SMART DEFAULT: Auto-respond with state for ask patterns
        return {
          state: { ...currentContext, count: currentContext.count + 1 }
          // No explicit response = auto-respond with state if correlationId present
        };
      case 'LOG_EVENT':
        // ✅ FIRE-AND-FORGET: No response for send patterns  
        return {
          state: { ...currentContext, eventCount: currentContext.eventCount + 1 }
          // No correlationId = no response sent
        };
      case 'CREATE_USER':
        // ✅ EXPLICIT CONTROL: Different state vs response when needed
        return {
          state: { ...currentContext, users: [...currentContext.users, newUser] },
          response: { id: newUser.id, status: 'created' }  // Explicit response
        };
      case 'GET_STATUS':
        // ✅ RESPONSE-ONLY: No state change
        return {
          response: { count: currentContext.count, status: currentContext.status }
        };
    }
  });
```
**Acceptance Criteria**:
- ✅ Handlers can return `{ state: NewContext }` to update actor state
- ✅ **Smart Defaults**: Auto-respond with `state` for ask patterns (correlationId present)
- ✅ **Explicit Control**: Explicit `response` always overrides smart defaults
- ✅ **Fire-and-Forget**: No response for send patterns (no correlationId)
- ✅ Omitting `state` property means no state change (current state preserved)
- ✅ State updates are atomic - applied after handler completes successfully
- ✅ **90% boilerplate reduction** for common ask patterns
- ✅ Full TypeScript inference for context type from `initialContext`

### FR-005: OTP Behavior Switching ("Becomes" Pattern)  
**Priority**: High  
**Description**: Actors can dynamically switch their behavior logic at runtime.  
**Usage Pattern**:
```typescript
// Define behavior factory functions
function createCounterBehavior(): BehaviorFunction<CounterContext> {
  return ({ message, machine, dependencies }) => {
    switch (message.type) {
      case 'INCREMENT':
        const ctx = machine.getSnapshot().context;
        return { state: { ...ctx, count: ctx.count + 1 } };
      case 'SWITCH_TO_MULTIPLIER':
        return {
          behavior: createMultiplierBehavior(), // Dynamic behavior switch
          response: 'switched to multiplier mode'
        };
    }
  };
}

const behavior = defineBehavior<CounterMessage>()
  .withContext({ count: 0 })
  .onMessage(createCounterBehavior());
```
**Acceptance Criteria**:
- ✅ Handlers can return `{ behavior: NewBehaviorFunction }` to switch logic
- ✅ New behavior takes effect for subsequent messages  
- ✅ Type safety maintained - new behavior must handle same message types
- ✅ Behavior switches are atomic and supervised

### FR-006: OTP Effect Handling
**Priority**: High  
**Description**: Handlers can return side effects to be executed by the actor system.  
**Usage Pattern**:
```typescript
const behavior = defineBehavior<UserMessage>()
  .withContext({ users: new Map() })
  .onMessage(({ message, machine, dependencies }) => {
    switch (message.type) {
      case 'CREATE_USER':
        const newUser = { id: message.userId, name: message.name };
        return {
          state: { users: new Map(context.users).set(message.userId, newUser) },
          effects: [
            () => dependencies.database.saveUser(newUser),
            () => dependencies.eventBus.emit('USER_CREATED', newUser),
            () => console.log(`User ${newUser.name} created`)
          ],
          response: newUser
        };
    }
  });
```
**Acceptance Criteria**:
- ✅ Handlers can return `{ effects: Effect[] }` for side effects
- ✅ Effects executed after successful state update
- ✅ Effects are supervised - failures don't crash actor
- ✅ Type-safe effect functions with proper error handling

## Performance Requirements

### PR-001: Minimal Runtime Overhead
**Priority**: Medium  
**Description**: Builder pattern must not introduce significant performance penalties.  
**Acceptance Criteria**:
- ✅ Builder creation overhead < 1ms (behavior definition is one-time cost)
- ✅ No memory leaks from builder instances
- ✅ No impact on message handling performance (handler execution unchanged)

### PR-002: Bundle Size Impact
**Priority**: Medium  
**Description**: New implementation should not significantly increase bundle size.  
**Acceptance Criteria**:
- ✅ Bundle size increase < 5KB after minification
- ✅ Tree-shaking eliminates unused builder code
- ✅ TypeScript definitions don't bloat published package

## Quality Requirements

### QR-001: Test Coverage
**Priority**: High  
**Description**: Comprehensive test coverage for all builder patterns and edge cases.  
**Acceptance Criteria**:
- ✅ 100% line coverage for builder implementation
- ✅ Tests for both context and machine paths
- ✅ Tests for compile-time error scenarios (via type-level tests)
- ✅ Integration tests with existing actor system

### QR-002: Documentation Quality
**Priority**: High  
**Description**: Clear documentation and examples for the new API.  
**Acceptance Criteria**:
- ✅ API reference documentation with TypeScript signatures
- ✅ Migration guide from old to new API
- ✅ Code examples for common usage patterns
- ✅ Architecture decision record explaining the change

## Non-Functional Requirements

### NFR-001: Framework Integration
**Priority**: Critical  
**Description**: New API must integrate seamlessly with existing actor system.  
**Acceptance Criteria**:
- ✅ Generated `ActorBehavior` objects work with current `createActor()` function
- ✅ No breaking changes to downstream actor system components
- ✅ Existing actor lifecycle and supervision patterns unaffected

### NFR-002: Extensibility
**Priority**: Medium  
**Description**: Builder pattern should support future configuration options.  
**Acceptance Criteria**:
- ✅ Architecture allows adding new builder methods (`.withSupervision()`, `.withLifecycle()`)
- ✅ Type system scales to additional configuration options
- ✅ No need to refactor core builder infrastructure for extensions

## Success Metrics

1. **Zero Type Safety Violations**: All linter rules pass without exceptions
2. **100% Test Migration**: All existing tests converted to new API  
3. **Developer Satisfaction**: API usage patterns are intuitive and discoverable
4. **Performance Neutral**: No measurable impact on actor system performance
5. **Documentation Complete**: Migration guide enables smooth transition

## Risk Mitigation

### High Risk: Breaking Changes
**Mitigation**: Maintain backward compatibility via `defineBehaviorLegacy` wrapper

### Medium Risk: Complex Type Inference  
**Mitigation**: Extensive TypeScript testing and type-level unit tests

### Low Risk: Performance Regression
**Mitigation**: Benchmark testing during implementation

## Acceptance Criteria Summary

**✅ Implementation Complete When:**
- All current `defineBehavior` usage migrated to fluent builder API
- Zero `any` types or casting in implementation
- All tests pass with new API
- Documentation updated with migration guide
- Biome linter passes without exceptions
- TypeScript compiler provides excellent inference and error messages 