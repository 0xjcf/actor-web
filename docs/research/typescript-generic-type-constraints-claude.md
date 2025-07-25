# TypeScript generic constraints fail in discriminated unions: Solutions for actor configuration APIs

TypeScript's type system encounters fundamental limitations when attempting to narrow generic types within discriminated unions, creating significant challenges for developers building type-safe actor configuration APIs. This research explores why these failures occur and presents multiple architectural solutions for creating a `defineBehavior()` function that enforces mutual exclusivity between context-based and machine-based actor patterns while maintaining zero type casting and excellent developer experience.

## The core problem lies in TypeScript's constraint substitution mechanism

TypeScript's control flow analysis fails to properly narrow generic type parameters constrained by unions due to limitations in the `getNarrowableTypeForReference` function. When encountering a generic `T extends 'a' | 'b'`, the type checker only substitutes constraints in specific "constraint positions" - primarily property access, call expressions, and element access. **This excludes most control flow contexts**, preventing the narrowing needed for discriminated unions to function correctly with generics.

Consider this failing pattern that directly impacts actor configuration:
```typescript
function process<T extends 'context' | 'machine'>(
  type: T, 
  config: ActorConfig<T>
) {
  if (type === 'context') {
    // TypeScript doesn't narrow T to 'context' here
    // config remains ActorConfig<T> instead of ActorConfig<'context'>
    config.initialContext; // Error: Property doesn't exist
  }
}
```

The TypeScript team considers this a design limitation rather than a bug, as documented in issues #46899, #44446, and #42007. The complexity of implementing proper generic narrowing without breaking existing code makes rapid fixes unlikely.

## XOR patterns enforce mutual exclusivity at compile time

For the specific requirement of preventing both `initialContext` and `machine` from being used together, **XOR (exclusive OR) type patterns** provide the most direct solution. The "optional never" trick offers simplicity with good error messages:

```typescript
interface ContextBasedActor {
  initialContext: ActorContext;
  machine?: never;
}

interface MachineBasedActor {
  machine: XStateMachine;
  initialContext?: never;
}

type ActorConfig = ContextBasedActor | MachineBasedActor;
```

This pattern **prevents property coexistence** at compile time while maintaining full type inference within conditional blocks. Production-ready libraries like ts-xor extend this pattern to support complex scenarios with up to 200 mutually exclusive types.

## Builder patterns circumvent discriminated union limitations entirely

Rather than fighting TypeScript's generic narrowing limitations, **fluent builder patterns** provide superior type safety by evolving the builder's type signature at each step. This approach, successfully implemented by tRPC and Zod, offers several advantages over discriminated unions:

```typescript
class ActorBuilder {
  static create() {
    return new ActorBuilder();
  }
  
  withContext(context: ActorContext): ContextActorBuilder {
    return new ContextActorBuilder(context);
  }
  
  withMachine(machine: XStateMachine): MachineActorBuilder {
    return new MachineActorBuilder(machine);
  }
}

// Separate builders prevent mixing patterns
class ContextActorBuilder {
  constructor(private context: ActorContext) {}
  
  withHandlers(handlers: ContextHandlers) {
    // Type-safe handlers specific to context actors
    return this;
  }
  
  build(): ContextActor {
    return { type: 'context', context: this.context };
  }
}
```

This pattern **eliminates the need for discriminated unions** while providing excellent IntelliSense support and meaningful error messages. The type system prevents invalid method calls at each step rather than requiring post-hoc validation.

## XState v5's setup pattern offers a production-tested solution

XState v5 introduces a sophisticated pattern that centralizes type definitions while maintaining inference throughout the configuration:

```typescript
const defineBehavior = setup({
  types: {
    context: {} as { count: number },
    events: {} as 
      | { type: 'increment'; amount: number }
      | { type: 'decrement' },
    input: {} as { initialCount: number }
  },
  actions: {
    increment: assign(({ context }, params: { amount: number }) => ({
      count: context.count + params.amount
    }))
  }
}).createBehavior({
  context: ({ input }) => ({ count: input.initialCount }),
  on: {
    increment: {
      actions: {
        type: 'increment',
        params: ({ event }) => ({ amount: event.amount })
      }
    }
  }
});
```

This approach **separates type declarations from implementation**, enabling strong inference without generic narrowing issues. The pattern supports both direct event handling and parameter-based handlers, providing flexibility for different use cases.

## Recommended implementation combines patterns for optimal results

For the `defineBehavior()` function, a hybrid approach leveraging insights from all patterns provides the best solution:

```typescript
// Factory function with builder-style API
export function defineBehavior() {
  return {
    fromContext<TContext, TEvents>() {
      return new ContextBehaviorBuilder<TContext, TEvents>();
    },
    
    fromMachine<TMachine extends AnyStateMachine>() {
      return new MachineBehaviorBuilder<TMachine>();
    }
  };
}

// Type-safe builders for each pattern
class ContextBehaviorBuilder<TContext, TEvents> {
  private config: Partial<ContextBehaviorConfig<TContext, TEvents>> = {};
  
  initialContext(context: TContext) {
    this.config.context = context;
    return this;
  }
  
  handlers<K extends TEvents['type']>(
    handlers: {
      [E in K]: (
        context: TContext,
        event: Extract<TEvents, { type: E }>
      ) => void
    }
  ) {
    this.config.handlers = handlers;
    return this;
  }
  
  build(): ContextBehavior<TContext, TEvents> {
    // Validation and final type assertion
    return new ContextBehavior(this.config as Required<typeof this.config>);
  }
}
```

This design **avoids generic discriminated unions entirely** while providing:
- Zero type casting in user code
- Compile-time prevention of mixing patterns
- Excellent parameter inference for message handlers
- Clear, actionable error messages
- Progressive disclosure of complexity

## Alternative: Conditional type mapping for direct API

If a direct object-based API is preferred over builders, conditional type mapping combined with function overloads provides a workable solution:

```typescript
type BehaviorConfig<T extends 'context' | 'machine'> = 
  T extends 'context' 
    ? { type: 'context'; initialContext: ActorContext; handlers: ContextHandlers }
    : { type: 'machine'; machine: XStateMachine; config?: MachineConfig };

function defineBehavior<T extends 'context'>(
  config: BehaviorConfig<'context'>
): ContextBehavior;
function defineBehavior<T extends 'machine'>(
  config: BehaviorConfig<'machine'>
): MachineBehavior;
function defineBehavior(config: BehaviorConfig<any>) {
  // Implementation with type assertions
}
```

This approach maintains type safety through **overload signatures** rather than relying on generic narrowing, though it requires more boilerplate than the builder pattern.

## Conclusion

TypeScript's inability to narrow generic types in discriminated unions stems from fundamental architectural decisions in the type checker. Rather than waiting for potential future improvements, **builder patterns and alternative API designs** provide immediate, practical solutions for creating type-safe actor configuration APIs. The combination of XOR types for simple mutual exclusivity, builder patterns for complex configurations, and XState-inspired setup patterns for type organization delivers a robust foundation for the `defineBehavior()` function that meets all stated requirements while providing an excellent developer experience.