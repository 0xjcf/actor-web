Perfect—thank you for the precise clarification. I’ll begin deep research into advanced discriminated union patterns, fluent builder-style APIs with mutual exclusivity, and utility type techniques compatible with your strict setup.

I’ll be looking for ways to:

* Enforce mutual exclusivity between `context` and `machine`
* Preserve type inference and generics across chained methods or unions
* Avoid any form of type casting or `any`
* Optimize for clean DX and strict Biome compliance

I’ll let you know as soon as the findings are ready.


# TypeScript Generic Type Constraints in Discriminated Unions for Actor Configuration API

## Generic Type Narrowing in Discriminated Unions

TypeScript has known limitations when narrowing **generic** types in a discriminated union. In our case, `defineBehavior` is parameterized by generics (`TMessage, TEmitted, TDomainEvent, TContext`), and we attempted to discriminate on a literal field `configType`. The compiler *does not* automatically unwrap or narrow a generic type based on a union discriminator. In other words, if `pureConfig` is of a generic union type like `PureActorBehaviorConfig<TMessage,…,TContext>`, checking `pureConfig.configType === 'context'` will **not** reliably narrow `pureConfig` to the `'context'` branch at compile time. This is a documented TypeScript behavior: given a generic param with a union type, the compiler treats it as one generic type (not distributed) and won’t narrow it without explicit specialization. For example, a function argument of type `GenericThing<'foo' | 'bar'>` doesn’t narrow inside a switch on a discriminant, whereas a union type `GenericThing<'foo'> | GenericThing<'bar'>` *will* narrow properly.

**Impact on our API:** Because `defineBehavior` uses generics, the compiler isn’t recognizing at compile time that `pureConfig.onMessage` has a different signature in each branch. Thus, inside the `if (pureConfig.configType === 'context')` block, `pureConfig` still has the broad union type, and calling `pureConfig.onMessage({ … context })` fails type-checking (the call signature is not guaranteed to accept a `context` field due to the `'machine'` variant) – hence the error about types not being assignable.

**Workarounds:** One approach is to **explicitly separate the union cases** so TypeScript can narrow them. For example, use **function overloads** for `defineBehavior` – one overload accepting `PureActorBehaviorConfigWithContext<TContext>` and another accepting `PureActorBehaviorConfigWithMachine`. This way, when you call `defineBehavior({...})` with `configType: 'context'`, the compiler picks the matching overload and infers `TContext` (and in the `'machine'` case, no `TContext`). Overloads can thus achieve the desired narrowing at the call site. The downside is that **overloads might complicate generic inference** and maintenance. If not carefully designed, you might lose some inference for `TContext` or have to repeat types. Still, it’s a viable solution: two strongly-typed overloads ensure mutual exclusivity and correct handler types, at the cost of a bit more boilerplate and potential duplication.

Another solution is a **user-defined type guard** to help the compiler narrow the generic union inside the function. This is what Stack Overflow users suggest for similar scenarios. For example, you could write:

```ts
function isContextConfig<TMsg,TEm,TD,TCtx>(
  config: PureActorBehaviorConfig<TMsg,TEm,TD,TCtx>
): config is PureActorBehaviorConfigWithContext<TMsg,TEm,TD,TCtx> {
  return config.configType === 'context';
}
```

Using `isContextConfig` in the `if` condition would explicitly tell TypeScript the narrowed type. This can make the code verbose (and you must write one guard per variant or a generic guard that checks `configType`). It does **avoid `any`** – the guard can be fully generic using a type predicate – but it’s somewhat clunky for an API intended to be clean. The Stack Overflow example shows a generic type guard narrowing a `GenericThing<T>` by its inner `T['type']` field. In our case, since we have a top-level discriminant, the guard is simpler. This approach is sound but adds indirection – likely not ideal for a clean API.

**Why the compiler behaves this way:** It’s essentially because **narrowing doesn’t distribute over generic type parameters**. The compiler won’t split a generic union unless the union is explicit in the variable’s type. To get narrowing, the union must be at the top level of the function’s parameter type (not hidden behind generics). This is why your attempt with a single generic `PureActorBehaviorConfig<T,…>` didn’t narrow, but an explicit union or overload would. There’s no compiler flag to change this – it’s a design limitation (to avoid problematic edge cases the TS team couldn’t safely resolve).

**Recommendation:** Favor designing the API so that the **discriminated union is explicit** to the compiler. If sticking with a single `defineBehavior` function, you might incorporate the discriminant into the type parameters or use conditional types (though that gets complex). A simpler path is splitting into two code paths (via overloads or a builder, discussed later) so that each branch’s types are clear. This ensures that within the `'context'` branch, `TContext` is known and `onMessage` expects `context`. Without this, you’ll keep encountering errors or resorting to unsafe casts. In summary, TypeScript can encode the *either-or* config, but you must structure the types to avoid relying on generic-narrowing of unions at runtime.

## Conditional Handler Signatures Based on `configType`

Your `onMessage` function has two possible call signatures, which depend on the `configType` (context vs machine). In a discriminated union, it’s normal to have properties whose types differ between variants – in your case, the type of `onMessage` is essentially **a union of two function types**. Modeling this directly is fine: the union type `PureActorBehaviorConfig` already has `onMessage` as either `PureMessageHandlerWithContext<…TContext>` **or** `PureMessageHandlerWithMachine`. This allows object literals to be checked correctly. For example, an object literal with `configType: 'context'` will be expected to have an `onMessage` matching the context signature (with a `context` param), whereas a `'machine'` config expects the other signature. This part is conceptually correct.

The challenge arises when **calling** the `onMessage` function on a union-typed variable. As noted, if the compiler doesn’t narrow the union, it sees `onMessage` as a union type itself, and you *cannot call* a union-typed function without narrowing. Typically, the solution is to narrow first (e.g. inside an `if` on `configType`). If that had worked, you could call `pureConfig.onMessage({…context})` inside the `'context'` branch with no error. But since the narrowing wasn’t working due to generics, the call was considered unsafe.

**Patterns to resolve this:**

* **Approach 1: Align the function types via optional params.** One trick is to define a single function type that works for both variants by making the `context` parameter optional or presence conditional. For example, you could define `onMessage: (params: { message: TMessage; machine: Actor<AnyStateMachine>; dependencies: ActorDependencies; context?: TContext }) => …`. In the context case, `context` would be provided; in the machine case, you simply ignore it. However, this has drawbacks:

  * It weakens type safety (the machine-based handler might accidentally use `params.context` which would be `undefined` at runtime).
  * It doesn’t enforce that *if* `configType === 'context'`, a context **must** be provided. Making it optional loses the guarantee.
  * Developer experience may suffer: the function signature is less precise, and errors like “cannot read property of undefined” would become possible if misuse occurs.

  Given your strict requirements, this unified signature is not ideal.

* **Approach 2: Use **function overloads** for `defineBehavior`** (revisited in context of handlers): By writing separate overload signatures, each can specify the exact `onMessage` type required. For example:

  ```ts
  function defineBehavior<TMsg, TE, TD, TCtx>(
    config: PureActorBehaviorConfigWithContext<TMsg, TE, TD, TCtx>
  ): Behavior<…>;
  function defineBehavior<TMsg, TE, TD>(
    config: PureActorBehaviorConfigWithMachine<TMsg, TE, TD>
  ): Behavior<…>;
  ```

  In the `'context'` overload, `onMessage` is of type `PureMessageHandlerWithContext<…, TCtx>`. In the `'machine'` overload, `onMessage` is `PureMessageHandlerWithMachine`. This ensures that inside each overload’s implementation, you know exactly which handler signature you have. You mentioned this approach lost some generic info or had poor DX – likely because TypeScript might not infer all type parameters when using overloads, especially if you omit explicit generics. To mitigate that, you can often rely on the object literal’s contents to infer `TMessage`, `TContext`, etc., or allow generic parameters with defaults. Overloads can sometimes make error messages less straightforward (the compiler may try to match the wrong overload first). But properly ordered, they should give clear errors (e.g. “machine property not allowed here” or “onMessage type mismatch”).

* **Approach 3: Use a **conditional type** for `onMessage`** within a single config interface. For example:

  ```ts
  type OnMessage<T extends 'context' | 'machine', TMsg, TEm, TD, TCtx> = 
    T extends 'context'
      ? PureMessageHandlerWithContext<TMsg, TEm, TD, TCtx>
      : PureMessageHandlerWithMachine<TMsg, TEm, TD>;

  interface BaseBehaviorConfig<TKind extends 'context' | 'machine', …> {
    configType: TKind;
    onMessage: OnMessage<TKind, TMessage, TEmitted, TDomainEvent, TContext>;
    // ... (and either initialContext or machine below)
  }
  ```

  Then define `DefineBehaviorConfig = BaseBehaviorConfig<'context',…,TCtx> | BaseBehaviorConfig<'machine',…,any>`. This attempts to tie the `onMessage` type to the `configType` in one structure. In theory, this helps inference: when `configType` is `'context'`, the compiler knows which branch of the conditional applies. In practice, however, this can confuse inference of `TContext` (since `TContext` isn’t used in the `'machine'` branch). You might end up needing defaults or a dummy type for `TContext` in the machine case. It’s essentially another way to spell the union, and the compiler’s behavior may not be significantly better than the union-of-interfaces approach. It can also produce more complex error messages if mismatched.

Given these considerations, the **cleanest approach** is likely using **overloads or a builder** (discussed next) to ensure that the handler function’s signature is properly tied to the presence or absence of context. Overloads keep a single entry point but bifurcate types, whereas a builder will force the user to choose a path (context or machine) before providing the handler. Both avoid any use of `any` or casts, and both ensure the handler is invoked with the correct parameter types.

## Enforcing Mutual Exclusivity of `initialContext` vs `machine`

Ensuring that **both** `initialContext` and `machine` cannot be provided at the same time (and that at least one is provided) is crucial. Your current discriminated union with `configType` partially enforces this: because `configType` can only be `'context'` or `'machine'`, an object with `configType: 'context'` *should* logically only have a context and not a machine. However, as you discovered, an object literal could still include an extraneous `machine` property without an immediate type error unless we explicitly forbid it.

**The “optional never” trick (XOR pattern)** is the go-to solution for making a union **exclusive** in TypeScript. This pattern uses optional properties of type `never` to **prevent** certain combinations. For example, we can redefine our config interfaces as:

```ts
interface PureActorBehaviorConfigWithContext<TMsg,TEm,TD,TContext> {
  configType: 'context';
  initialContext: TContext;
  machine?: never;  // 🚫 disallow providing machine
  onMessage: PureMessageHandlerWithContext<TMsg,TEm,TD,TContext>;
}

interface PureActorBehaviorConfigWithMachine<TMsg,TEm,TD> {
  configType: 'machine';
  machine: AnyStateMachine;
  initialContext?: never; // 🚫 disallow providing context
  onMessage: PureMessageHandlerWithMachine<TMsg,TEm,TD>;
}
```

Now our union `PureActorBehaviorConfig = PureActorBehaviorConfigWithContext | PureActorBehaviorConfigWithMachine` is an **exclusive OR**. If a developer tries to supply both `initialContext` and `machine` in the same object, the compiler will complain that the extra property is incompatible. This works because no value (except `undefined`) can be assigned to a property of type `never`. Marking it optional (`?: never`) means “this property **must not** exist”. In effect, an object can match one interface or the other, but not both, because to match one branch it would have to have a `never` property (impossible) from the other branch. This trick, combined with the discriminant, gives very strong compile-time checking:

* **Correct**: providing just `initialContext` with `configType: 'context'` passes.
* **Correct**: providing just `machine` with `configType: 'machine'` passes.
* **Error**: providing both will fail to match either union arm (you’ll get a clear error about types incompatible with `never`, e.g. “Type ‘XStateMachine’ is not assignable to type ‘never’” for the `machine` property in a context config).

For completeness, **TypeScript 4.4+** introduced a flag `exactOptionalPropertyTypes` which makes the optional `never` trick even stricter. Without this flag, a value `{ configType: 'context', initialContext: {...}, machine: undefined }` could technically bypass the check (since `machine?: never` would accept `undefined`). If you enable `"exactOptionalPropertyTypes": true` in tsconfig, even an explicit `machine: undefined` will be rejected. This is a minor nuance, but worth noting for absolute rigor.

It’s also possible to enforce mutual exclusivity using utility types. Libraries like **`type-fest`** and **`ts-essentials`** provide an `XOR` or “exclusive merge” type that does exactly this. For example, `type-fest` has `MergeExclusive<T, U>` and `RequireExactlyOne<T, Keys>` which can ensure only one of two sets of keys is present. The implementation under the hood is similar to the optional never trick. Effective TypeScript’s blog gives a sample XOR definition that matches the ts-essentials version: it intersects each variant with `never` properties for the other’s keys. Using such a utility can simplify your definitions. For instance:

```ts
import {MergeExclusive} from 'type-fest';

type ContextConfig<TMsg,TEm,TD,TContext> = {
  configType: 'context';
  initialContext: TContext;
  onMessage: PureMessageHandlerWithContext<TMsg,TEm,TD,TContext>;
};
type MachineConfig<TMsg,TEm,TD> = {
  configType: 'machine';
  machine: AnyStateMachine;
  onMessage: PureMessageHandlerWithMachine<TMsg,TEm,TD>;
};

type PureActorBehaviorConfig<TMsg,TEm,TD,TContext> = 
  MergeExclusive<ContextConfig<TMsg,TEm,TD,TContext>, MachineConfig<TMsg,TEm,TD>>;
```

Here, `MergeExclusive` will ensure the two sets of properties don’t overlap in any given object. The `configType` is present in both, but since the literal values `'context'` vs `'machine'` are mutually exclusive, it’s fine (the utility will treat `configType` as just another key – in practice the literal ensures exclusivity of branches). You could also use `RequireExactlyOne<{ initialContext: TContext; machine: AnyStateMachine }, 'initialContext' | 'machine'>` in a similar way.

**Bottom line:** Add the `?: never` exclusions to your union interfaces (or use an XOR utility) to **enforce at compile time** that context and machine cannot coexist. This meets your requirement of a compile-time error for `behavior3` (the invalid case) – the error will be immediate and clear, without any `any` or runtime checks. This change is purely at the type level and should not affect runtime behavior. It complements the discriminant nicely: the discriminant (`configType`) ensures no *overlap* in the union arms, and the XOR pattern ensures no object can satisfy both arms’ fields simultaneously.

## Patterns for Either-Or Configuration in TypeScript

The problem of “either A or B but not both” appears in many APIs, and several TypeScript patterns have emerged:

* **Tagged Discriminated Unions:** This is what you started with – a union of interfaces that share a tag field (like `configType`). This is usually the most straightforward approach. The tag being a literal type ensures the union is exclusive by intent. To fully prevent combined usage, we augment it with the XOR trick as discussed. This pattern is idiomatic TypeScript: it’s clear to the developer (the tag indicates which case it is) and works well with control flow narrowing (when not hindered by generics).

* **Mutually Exclusive Interfaces (XOR):** Even without an explicit tag, one can define a union such that the presence of one key excludes the other. For example, a common StackOverflow suggestion for XOR of properties is:

  ```ts
  type Foo = { bar: string; baz?: never } | { bar?: never; baz: number };
  ```

  Here an object can have `bar` or `baz` but not both. In your case, using `configType` plus `?: never` is a hybrid of tagged union and XOR. Another approach is to drop the tag and discriminate by the presence of a property (e.g., check `if ('machine' in config)` at runtime). This can work but is less self-documenting – it’s usually better to have an explicit `configType` for readability and error messaging.

* **Utility Types:** As mentioned, `type-fest`’s `MergeExclusive` (aka XOR) and similar helpers in `ts-essentials` or `utility-types` libraries provide ready-made types for mutual exclusivity. There’s also `RequireExactlyOne` which ensures exactly one of a set of keys is present. For example, one could model your config as a single interface with both optional, then `RequireExactlyOne<{ initialContext: TContext; machine: AnyStateMachine }, 'initialContext' | 'machine'> & { onMessage: ... }`. However, combining that with generic onMessage signatures gets tricky. It’s often clearer to stick with the explicit union of two interfaces (plus `never` trick) rather than one mega-type with conditional internals.

* **Function Overloads:** Overloads can be seen as a *behavioral* enforcement of XOR. By providing two overload signatures, you allow either pattern but not both. If a caller tries to pass an object that doesn’t match either overload (e.g. both context and machine present), the call fails to compile. We’ve already covered this in context of narrowing and handler types. Overloads are a perfectly valid pattern for either/or configurations, especially when the resulting behavior or return type might differ. The drawback is maintenance overhead and potential confusion if the overloads’ distinctions aren’t obvious to users. In your API, though, the distinction is very clear (`configType` literally guides it), so overloads could work well.

* **Separate Functions or Builders:** Some APIs choose to expose separate entry points entirely (e.g. `defineContextActor(...)` vs `defineMachineActor(...)`). This is the simplest conceptually, but it’s two functions in your public API instead of one. The builder pattern (next section) is a more fluid variation of this – it provides one initial call but forces a choice of context vs machine configuration in the next step.

* **Fluent Builders (Fluent APIs):** This pattern is particularly useful when multiple configuration options are mutually exclusive or order-dependent, which is exactly our scenario. Instead of one function with many generics and a complex union, a builder breaks the configuration into a sequence of calls, using the type system to guide the developer toward a correct combination. We’ll dive into this next, as it appears promising for your use case.

In summary, TypeScript offers multiple ways to encode an exclusive choice. The **tagged union + XOR** approach is generally robust and keeps all config in one object, giving nice error messages (especially if you label the fields clearly or use the tag in the error). The **builder** or **fluent API** is an alternative that can sometimes provide an even more guided experience, at the cost of introducing an extra concept (chained calls). Let’s explore the builder approach for your actor API, since you indicated interest in that pattern.

## Fluent Builder Pattern for Actor Behavior

Adopting a **fluent builder pattern** is a strong option to improve type safety and clarity. The idea is to split `defineBehavior` into a chained API where the user *must* choose either `.withContext()` or `.withMachine()` before finalizing the behavior, making it impossible to do both. This naturally mirrors the mutual exclusivity in the types. It also can improve type inference step-by-step.

Here’s how a builder could look for our scenario:

```ts
// Start the builder with required generics for messages, etc.
function defineBehavior<TMessage, TEmitted = void, TDomainEvent = void>() {
  return {
    withContext<TContext>(initialContext: TContext) {
      // Return an object that has onMessage for context, but no withMachine
      return {
        onMessage(
          handler: PureMessageHandlerWithContext<TMessage, TEmitted, TDomainEvent, TContext>
        ): PureActorBehavior { 
          /* ... create and return the behavior ... */
        }
      };
    },
    withMachine(machine: AnyStateMachine) {
      // Return an object that has onMessage for machine, but no withContext
      return {
        onMessage(
          handler: PureMessageHandlerWithMachine<TMessage, TEmitted, TDomainEvent>
        ): PureActorBehavior {
          /* ... create and return the behavior ... */
        }
      };
    }
  };
}
```

Usage would be:

```ts
const behavior1 = defineBehavior<MyMsgType>()
  .withContext({ count: 0 })
  .onMessage(({ message, context, machine, dependencies }) => {
    // context is { count: number } here
    // machine is available too, representing the underlying actor (for sending events or so)
  });

const behavior2 = defineBehavior<MyMsgType>()
  .withMachine(myXStateMachine)
  .onMessage(({ message, machine, dependencies }) => {
    // no context param here, as expected
    // can use machine.getSnapshot().context if needed
  });
```

In this design:

* Calling `.withContext(initialContext)` **returns a new object** that has an `.onMessage` method (and crucially, does **not** have a `.withMachine` method). Similarly, `.withMachine()` returns an object with only `.onMessage`. This ensures the next step can only be providing the handler.
* If the user tries to call a second configuration method, it’s simply not present on the returned type. For example, `defineBehavior()…withContext(..).withMachine(..)` will be a compile-time error: after `.withContext`, the returned type doesn’t have `.withMachine`. (The TypeScript error would say something like “Property 'withMachine' does not exist on type `{ onMessage: (...) => … }`”, which clearly indicates you can’t go that route.)
* Generics flow nicely: TypeScript can infer `TContext` from the argument to `withContext()`. The builder can carry the `TMessage, TEmitted, TDomainEvent` generics through from the initial call. By the time you call `.onMessage`, it knows the full context type (in the context branch) or knows you’re in the machine branch. Thus, the handler function’s parameter is correctly typed without the user explicitly providing any type arguments for it.

**Under the hood implementation:** You can implement this with simple objects (as in the snippet above) or with classes. One advanced technique uses a generic class that “evolves” its type parameters, but in this two-step case, plain object literals or factory functions are sufficient. Each method returns a fresh object of a new type. For example, the return type of `.withContext` can be an interface `BehaviorBuilderWithContext<TMsg,TEm,TD,TContext>` that only has the `onMessage` method. The return type of `defineBehavior()` initially could be an interface `BehaviorBuilderBase<TMsg,TEm,TD>` with the two methods `.withContext` and `.withMachine`. Internally, you might still create a single `PureActorBehaviorConfig` object to hold everything, but you build it in stages.

One thing to watch out: if you return object literals as shown, TypeScript might infer the type of `this` incorrectly within those methods. A common pattern is to explicitly type the return object. Alternatively, using `Omit` to strip methods is another approach (as seen in some StackOverflow examples). For instance, an answer on SO demonstrates defining builder methods that return a type with that method removed using `Omit<ThisType, 'methodName'>` so it cannot be called twice. In our simpler case, separate interfaces for each step might be easier to follow.

**DX considerations:** The builder pattern yields a very **guiding** developer experience:

* The moment a user types `defineBehavior()`, their IDE autocompletion will show `.withContext` and `.withMachine` as the only next options. It’s self-documenting that one of these must be chosen.
* After choosing one, the only next option is `.onMessage`. There’s no way to mistakenly add the other config because it’s not in the interface.
* Error messages in misuse scenarios are generally straightforward (e.g., “Property X does not exist” if they try an invalid chain). Since you won’t allow an intermediate state where both context and machine are set, you avoid complex union error messages about `never`. In the current union approach, an error for providing both might mention `Type 'XStateMachine' is not assignable to type 'never'` – which, while accurate, might confuse some users. In the builder, such a scenario is unrepresentable to begin with.

**Performance and complexity:** A fluent API is a bit more verbose to implement, but at runtime it’s mostly just creating a couple of small objects or closures. The performance impact is negligible in the context of defining actor behaviors (which likely happens far less frequently than message handling). The clarity of having a guided setup likely outweighs the tiny overhead.

**Comparison to single-call approach:** The main downside to the builder approach is that it’s a departure from a single configuration object literal. Some developers might prefer the simplicity of a single object argument. However, given that your current single-call solution is running into type system limits (or requires very advanced typing), the builder is a reasonable trade-off. It splits the problem into two simpler generic contexts: one where `TContext` is known and one where it isn’t needed.

**Real-world examples:** Fluent APIs are common in TypeScript for cases where certain methods must be called in order or certain options exclude others. For example, some HTTP client libraries use a builder to enforce that you set required options before sending a request. A more relevant example: the tRPC library uses a builder-like pattern for creating router procedures (you call `.input()` then `.query()` in sequence, and you can’t call `.mutation()` after `.query()` etc.). Builders leverage TypeScript’s control of method availability. As shown in one answer, TypeScript can understand when a builder method returns a new object without a given method, and will throw if you call a disallowed sequence.

In conclusion, moving to a fluent builder API would **satisfy all your success criteria**:

* **No `any` or casts:** All types are explicit in the method signatures, and the chaining preserves generics. No type assertions needed.
* **Compile-time exclusivity:** It’s inherently impossible to call both `.withContext` and `.withMachine` – the API won’t let it. The user’s choice is enforced by the type system.
* **Proper inference:** Each step infers the types (initialContext infers `TContext`, and the handler infers its param types from context or machine). There’s no ambiguity about the handler’s context parameter type – it’s either present with the correct shape or absent.
* **Clean DX:** The chainable methods are discoverable and guide the user. Errors for misuse are clear (misordered or repeated calls result in “property does not exist” or similar). And you avoid the user having to manually specify generic parameters in most cases – it all flows from function arguments.
* **Generic type preservation:** You still carry the generic types through. The final `behavior` object returned can be typed (if needed) with the specific `TContext` in the context case. If your `Behavior` type includes the context type (for example, to know the actor’s state shape), you can have the builder’s `onMessage` return something like `PureActorBehavior<TMessage, TEmitted, TDomainEvent, TContext>`. In the machine case, `TContext` could be defaulted to something like `unknown` or omitted.

One more note: if you implement the builder, consider also how to handle **edge cases** like: What if a user calls `defineBehavior().onMessage()` without choosing context or machine? In the simple factory approach above, `.onMessage` isn’t even defined until you choose one, so that’s safe. What if they call `.withContext()` with an incompatible initialContext type relative to some expected domain? (Probably not an issue – `TContext` is purely generic from that argument). Also, ensure the builder is flexible enough for any future extensions. For example, if you later add a third mode of configuration, it’s easier to add another method (like `.withXYZ`) in a builder than to jam it into an existing union.

**Summary:** The fluent builder pattern is a very **viable alternative** that provides stronger compile-time guidance and mutual exclusion by construction. It avoids the pitfalls we saw with the discriminated union approach (no more worrying about generic narrowing or union call signatures). The trade-off is a slightly different usage style and a bit more code to implement. Given the strict type-safety goals of your project, this pattern aligns well with ensuring no illegal states can even be expressed in user code.

---

By applying the above changes – whether tightening the union types or switching to a builder – you can achieve a **fully type-safe `defineBehavior` API** that the TypeScript compiler will enforce. This means no combination of context/machine gets through erroneously, and developers get properly typed `onMessage` handlers with either a `context` parameter or not, as appropriate. All of this is done without resorting to `any` or type casts, satisfying the linter and your architecture rules. The references and patterns discussed (discriminated unions, XOR types, and builder/fluent APIs) are commonly used in the TypeScript community to handle these kinds of advanced type constraints, so you’ll be in good company using them.
