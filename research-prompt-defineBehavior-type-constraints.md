# Research Prompt: TypeScript Generic Type Constraints in Discriminated Unions for Actor Configuration API

## Project Context

Developing a **pure actor model framework** in TypeScript with **strict type safety** requirements. The framework provides a `defineBehavior()` API that must support two mutually exclusive patterns:

1. **Context-based actors**: Use `initialContext` parameter for state management
2. **Machine-based actors**: Use custom XState `machine` for state management

**Key Requirements:**
- **Zero `any` types or type casting** (enforced by linter rules)
- **Compile-time prevention** of using both `context` and `machine` together
- **Proper TypeScript inference** for message handler parameters
- **Clean developer experience** with meaningful error messages

## Core Problem Statement

**TypeScript generic type constraints are failing** when implementing discriminated unions for actor configuration. The goal is to create a `defineBehavior<T>()` function that:

```typescript
// ✅ Should work: Context-based actor
const behavior1 = defineBehavior({
  configType: 'context',
  initialContext: { count: 0 },
  onMessage: ({ message, context }) => { // context should be typed as { count: number }
    // Handle message with context
  }
});

// ✅ Should work: Machine-based actor  
const behavior2 = defineBehavior({
  configType: 'machine', 
  machine: myXStateMachine,
  onMessage: ({ message, machine }) => { // No context parameter
    // Handle message with machine.getSnapshot().context
  }
});

// ❌ Should be compile-time error: Both context and machine
const behavior3 = defineBehavior({
  configType: 'context',
  initialContext: { count: 0 },
  machine: myXStateMachine, // ← Should be TypeScript error
  onMessage: ({ message, context }) => {}
});
```

**Current Error:** Generic type constraints fail to narrow properly, requiring `any` types or type casting which violates our architecture rules.

## Current Setup / Environment

**TypeScript Version:** 5.3+  
**Key Dependencies:** XState 5.x, Vitest for testing  
**Linter:** Biome with strict `no-any` rules  

**Current Type Definitions:**
```typescript
// Message handlers with different signatures
export type PureMessageHandlerWithContext<TMessage, TEmitted, TDomainEvent, TContext> = (params: {
  readonly message: TMessage;
  readonly machine: Actor<AnyStateMachine>;
  readonly dependencies: ActorDependencies;
  readonly context: TContext; // ✅ Required for context-based
}) => MessagePlan<TDomainEvent> | Promise<MessagePlan<TDomainEvent>> | void | Promise<void>;

export type PureMessageHandlerWithMachine<TMessage, TEmitted, TDomainEvent> = (params: {
  readonly message: TMessage;
  readonly machine: Actor<AnyStateMachine>;
  readonly dependencies: ActorDependencies;
  // ✅ No context - use machine.getSnapshot().context
}) => MessagePlan<TDomainEvent> | Promise<MessagePlan<TDomainEvent>> | void | Promise<void>;

// Discriminated union attempt
export interface PureActorBehaviorConfigWithContext<TMessage, TEmitted, TDomainEvent, TContext> {
  readonly configType: 'context';
  readonly initialContext?: TContext;
  readonly onMessage: PureMessageHandlerWithContext<TMessage, TEmitted, TDomainEvent, TContext>;
}

export interface PureActorBehaviorConfigWithMachine<TMessage, TEmitted, TDomainEvent> {
  readonly configType: 'machine';
  readonly machine: AnyStateMachine;
  readonly onMessage: PureMessageHandlerWithMachine<TMessage, TEmitted, TDomainEvent>;
}

export type PureActorBehaviorConfig<TMessage, TEmitted, TDomainEvent, TContext> = 
  | PureActorBehaviorConfigWithContext<TMessage, TEmitted, TDomainEvent, TContext>
  | PureActorBehaviorConfigWithMachine<TMessage, TEmitted, TDomainEvent>;
```

**Implementation Logic:**
```typescript
// Runtime discrimination attempt
if (pureConfig.configType === 'context') {
  const context = pureConfig.initialContext || ({} as Record<string, unknown>);
  return await pureConfig.onMessage({
    message: params.message,
    machine: params.machine,
    dependencies: params.dependencies,
    context, // ← TypeScript error: not assignable to TMessage
  });
}
```

## Troubleshooting Steps Already Taken & Observations

### Attempt 1: Simple Union Types with Optional Properties
```typescript
interface Config { 
  initialContext?: TContext; 
  machine?: AnyStateMachine;
  onMessage: (params: { context?: TContext }) => void;
}
```
**Result:** Failed - allows both `context` and `machine` together, defeats architectural goal.

### Attempt 2: Discriminated Unions with `configType`
**Result:** TypeScript fails to narrow generic types properly. Error: `Type 'TMessage' is not assignable to type 'ActorMessage'`.

### Attempt 3: Conditional Types
```typescript
type ConfigType<T> = T extends { machine: any } ? MachineConfig : ContextConfig;
```
**Result:** Generic constraints become too complex, still requires type casting.

### Attempt 4: Method Overloading
```typescript
function defineBehavior(config: ContextConfig): Behavior;
function defineBehavior(config: MachineConfig): Behavior;
```
**Result:** Loses generic type information, creates poor DX.

## Specific Questions for Research

1. **Generic Type Narrowing:** How can TypeScript properly narrow generic types `TMessage` within discriminated unions when the discriminator is a string literal?

2. **Conditional Handler Types:** What's the best pattern for having different function signatures in union types where the parameters depend on the discriminator?

3. **Mutual Exclusion Enforcement:** How can we enforce at compile-time that two properties (`initialContext` vs `machine`) are mutually exclusive while maintaining generic type safety?

4. **Alternative Patterns:** Are there established TypeScript patterns for "either A or B but not both" configurations that work well with generic constraints?

5. **Builder Pattern Alternative:** Would a fluent builder pattern (`defineBehavior().withContext()` vs `defineBehavior().withMachine()`) provide better type safety for this use case?

## Success Criteria

The solution should provide:
- ✅ **Zero `any` types or casting** in implementation
- ✅ **Compile-time errors** for architectural violations  
- ✅ **Proper type inference** for message handler parameters
- ✅ **Clean API surface** with good developer experience
- ✅ **Generic type preservation** through the function call chain

## Additional Context

This is part of a larger **Actor-Web Framework** migration where we're enforcing pure actor model principles. The type system must prevent architectural violations while maintaining ergonomic APIs for developers building distributed actor systems. 