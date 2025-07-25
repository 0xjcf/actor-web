# Research Prompt: OTP State Management Patterns for Actor-Web Framework

## Project Context

Developing a **pure actor model framework** in TypeScript that follows **OTP (Open Telecom Platform) principles** from Erlang/Elixir. We've designed a fluent builder API for creating actors with two patterns:

1. **Context-based actors**: Use `initialContext` for simple state management
2. **Machine-based actors**: Use custom XState machines for complex state management

**Current Architecture**:
```typescript
// Both patterns use identical handler signature
.onMessage(({ message, machine, dependencies }) => {
  // Access state: machine.getSnapshot().context
  // System operations: machine.send(), machine.ask()
})
```

**Key Technologies**: TypeScript 5.3+, XState 5.x, Pure Actor Model principles

## Core Problem Statement

**Critical Gap Identified**: Our current architecture doesn't address **how context-based actors update their state**. If actors access state via `machine.getSnapshot().context`, we need patterns for:

1. **State Updates**: How do context-based actors modify their state?
2. **Behavior Switching**: How do actors change their behavior dynamically (OTP `becomes` pattern)?
3. **Hot Code Reloading**: How do actors update their logic at runtime?
4. **State Transitions**: How do we handle complex state transitions without full XState machines?

**Current Problem**: Context-based actors can READ state but have no clear mechanism to UPDATE state while maintaining pure actor model principles.

## Current Setup / Environment

**TypeScript Implementation**:
```typescript
// Context-based actor - how does it update state?
const contextBehavior = defineBehavior<MyMessage>()
  .withContext({ count: 0, status: 'idle' })
  .onMessage(({ message, machine, dependencies }) => {
    const { count, status } = machine.getSnapshot().context;
    
    // ❓ HOW DO WE UPDATE count or status?
    // machine.getSnapshot().context is read-only
    // Need OTP-style state update patterns
  });

// Machine-based actor - already has state update via XState
const machineBehavior = defineBehavior<MyMessage>()
  .withMachine(myXStateMachine)  
  .onMessage(({ message, machine, dependencies }) => {
    // ✅ Can update state via: machine.send('UPDATE_STATE')
    // ✅ XState handles state transitions
  });
```

**Architecture Constraints**:
- Must maintain pure actor model (no shared state)
- Must avoid `any` types and casting
- Must support both simple context and complex XState patterns
- Must be compatible with existing actor system (supervision, ask patterns)

## Troubleshooting Steps Already Taken & Observations

### Approach 1: Immutable State Returns
```typescript
// Attempted returning new state from onMessage handlers
.onMessage(({ message, machine }) => {
  const currentState = machine.getSnapshot().context;
  return {
    newState: { ...currentState, count: currentState.count + 1 }
  };
})
```
**Result**: Unclear how actor system would apply state updates, breaks existing MessagePlan pattern.

### Approach 2: Direct Machine Mutation
```typescript
// Attempted sending state updates to machine
.onMessage(({ message, machine }) => {
  machine.send({ type: 'UPDATE_CONTEXT', newState: { count: 5 } });
})
```
**Result**: Context-based machines aren't designed to handle arbitrary state updates like XState machines.

### Approach 3: State Update Instructions
```typescript
// Attempted returning state update instructions in MessagePlan
return {
  stateUpdate: { count: newCount },
  emit: [...]
};
```
**Result**: Would require extending MessagePlan interface, architectural impact unclear.

## Specific Questions for Research

1. **OTP State Update Patterns**: How does Erlang/Elixir OTP handle state updates in `gen_server` actors? What are the established patterns for state mutation in actor systems?

2. **Becomes Pattern Implementation**: How do modern actor frameworks implement the `becomes` pattern for dynamic behavior switching? Are there TypeScript/JavaScript implementations?

3. **State Management in Actor Frameworks**: How do production actor frameworks (Akka, Orleans, Proto.Actor, etc.) handle simple state updates vs complex state machines?

4. **Immutable State Updates**: What are the best practices for immutable state updates in actor systems? How do frameworks handle state versioning and rollback?

5. **Hot Code Reloading**: How do OTP-style systems handle hot code reloading and behavior updates at runtime? Are there patterns applicable to JavaScript/TypeScript?

6. **Hybrid Approaches**: Are there established patterns for supporting both simple state (like context) and complex state machines (like XState) in the same actor framework?

7. **Performance Considerations**: How do different state update patterns perform in high-throughput actor systems? What are the memory and CPU implications?

## Success Criteria

The research should identify patterns that enable:

- ✅ **Simple State Updates**: Context-based actors can modify their state cleanly
- ✅ **Behavior Switching**: Actors can change their message handling logic dynamically  
- ✅ **Pure Actor Compliance**: No shared state, all communication via messages
- ✅ **Type Safety**: Full TypeScript support without `any` types
- ✅ **Performance**: Efficient state updates suitable for high-throughput systems
- ✅ **OTP Compatibility**: Patterns inspired by proven OTP principles
- ✅ **Framework Integration**: Works with existing MessagePlan, supervision, ask patterns

## Additional Context

**Examples We Need Patterns For**:

```typescript
// Counter actor that needs to increment/decrement
const counterActor = defineBehavior<CounterMessage>()
  .withContext({ count: 0 })
  .onMessage(({ message, machine }) => {
    const { count } = machine.getSnapshot().context;
    
    switch (message.type) {
      case 'INCREMENT':
        // ❓ How to update count to count + 1?
        break;
      case 'RESET':
        // ❓ How to reset count to 0?
        break;
      case 'BECOME_MULTIPLIER':
        // ❓ How to switch to different behavior that multiplies instead?
        break;
    }
  });

// User session actor that needs status updates
const sessionActor = defineBehavior<SessionMessage>()
  .withContext({ userId: '123', status: 'idle', lastActivity: Date.now() })
  .onMessage(({ message, machine }) => {
    // ❓ How to update status and lastActivity?
    // ❓ How to handle session expiration with behavior change?
  });
```

**Framework Context**: This is part of a comprehensive Actor-Web framework that must support:
- Web components with actor-based state management
- CLI tools with actor-based workflows  
- Browser and Node.js environments
- Integration with XState for complex state machines
- Supervision hierarchies and fault tolerance

The state management patterns we adopt will influence the entire framework's usability and performance characteristics.

## Research Focus & Scope

**1. Implementation Level**: Focus on **concrete implementation patterns** and TypeScript-specific solutions, not just conceptual insights. We need actionable patterns that can be directly implemented in our framework.

**2. MessagePlan Architecture**: **Open to extending MessagePlan interface** if it maintains pure actor model principles. Current MessagePlan supports `emit`, `ask` - adding state update instructions like `stateUpdate` or `becomes` is acceptable if architecturally sound.

**3. Target Environments**: **Both browser and Node.js** - our framework must support web components (browser) and CLI tools (Node.js) with identical actor behavior.

**4. Performance Focus**: **Real-world metrics and practical guidance** - we need production-ready patterns, not theoretical comparisons. Focus on frameworks with similar TypeScript/JavaScript implementations and actual performance characteristics.

## Specific Implementation Constraints

- **Must integrate with existing XState 5.x architecture**
- **Must maintain zero `any` types and full type safety**
- **Must support both sync and async message handlers**
- **Must work with current supervision and ask patterns**
- **Must be compatible with our fluent builder API design** 