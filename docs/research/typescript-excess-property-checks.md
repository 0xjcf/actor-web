Thanks for the detailed clarification — that’s exactly what I needed. I’ll now dive into how TypeScript handles excess property checking in union return types and investigate advanced ergonomic patterns used in libraries like XState, Redux Toolkit, fp-ts, and Akka.js. I’ll focus on current TypeScript (5.3+) with attention to 5.4/5.5 improvements, and prioritize an out-of-the-box solution that catches compile-time errors without requiring helpers or assertions.

I’ll report back shortly with concrete recommendations and examples tailored for your ActorBehavior API.


# TypeScript Excess Property Checks in Union Return Types

## **Overview of the Issue**

In our actor framework, the `onMessage` handler can return either just a context state or an object with context *and* emitted events. We expected TypeScript to flag mistakes like misspelled event properties, but it isn’t. For example, given `TEmitted` defined as `{ type: string; data: string }`, the following code **should** error on the misspelled `dat` property, yet TypeScript **does not report an error**:

```ts
const behavior: ActorBehavior<ActorMessage, {}, { type: string; data: string }> = {
  context: {},
  onMessage: async ({ message, context }) => {
    return {
      context,
      emit: [
        { type: 'TEST_EVENT_1', dat: 'Hello' },  // Misspelled 'data', but no error
        { type: 'TEST_EVENT_2', data: 'World' }, // Correct property name
      ],
    };
  },
};
```

Here, the event object `{ type: 'TEST_EVENT_1', dat: 'Hello' }` is missing the required `data` field and has an extra `dat` field. Under normal circumstances, TypeScript’s type checker should catch this. However, because of how the return type is defined as a **union** (`TContext` *or* `{ context: TContext; emit?: TEmitted | TEmitted[] }`), the excess property check isn’t working as expected.

## **TypeScript’s Excess Property Checking – Limitations**

**Excess property checks** in TypeScript are an extra safety net that typically catch typos or unknown properties in object literals. But these checks only apply in certain situations – notably when an object literal is assigned to a **non-union** target type directly. If the context is more complex (like being inferred as part of a function return or a union type), TypeScript may skip the excess property validation. In our case, the object literal is being returned from a function with a union return type, which is one of those scenarios where excess property checks are not applied.

TypeScript’s *design* currently widens function return types and doesn’t treat them like direct assignments, so it fails to catch extra or misspelled properties in return object literals. This is a known limitation tracked by the TypeScript team. In fact, an issue titled “Don’t widen return types of function expressions” (microsoft/TypeScript#241) has been open for years, discussing exactly this problem. A proposed fix (PR #40311) aimed to make function returns behave more like direct assignments (thus catching these errors) but was ultimately not merged. As of TypeScript 5.3 (and even looking toward 5.4/5.5), **no official compiler flag or option enables strict excess property checking on function return values** – it’s a design limitation we have to work around.

**Unions further complicate excess property checks.** Prior to TypeScript 3.5, object literals assigned to a union type wouldn’t get checked for extra properties at all. TypeScript 3.5 improved this by ensuring that every property in a literal must exist in *at least one* of the union’s member types. For example, if you have `type U = {x: number,y: number} | {name: string}`, and you assign `{ x:0, y:0, name:true }` to `U`, the compiler will error because `name` is of the wrong type (expected string). It also won’t allow completely unknown keys. **However**, in our case one union branch is just `TContext` (which was `{}` – an empty object type). An empty-object `{}` type in TypeScript is extremely permissive: it doesn’t forbid extra properties (it basically means “any object that isn’t null or undefined”). This broad branch allows the return value `{ context: ..., emit: [...] }` to be treated as matching `TContext` (since `{}` will accept any object shape), bypassing the stricter branch that includes the `emit` field. In other words, because one union branch is so general, the compiler finds the return value assignable to that branch and **stops checking deeper**. This is why the missing `data`/extra `dat` went unnoticed – the object literal satisfied the `{}` branch of the union, so TypeScript never validated it against the `TEmitted` structure. The improved union excess check from TS3.5 doesn’t help here because `{}` “absorbs” the extra properties.

**Key Takeaway:** Excess property checks only apply in limited scenarios. Function return contexts and unions (especially with a very generic member) are two cases where the usual checks either don’t run or can be inadvertently bypassed. It’s not that TypeScript thinks `{ dat: 'Hello' } is correct – it’s that our typing allows the compiler to accept the object via a broad union member without ever checking the internals of the `emit\` array.

## **Enforcing Stricter Checks – Workarounds**

Although we can’t flip a compiler switch to fix this, there are some workarounds and patterns to force stricter checking:

* **Explicit Return Type Annotation:** One simple trick is to explicitly annotate the return type *on the function itself* rather than relying on contextual typing. For example:

  ```ts
  const onMessage: ({message, context}: { message: ActorMessage; context: {} }) 
      => Promise<{ context: {}; emit?: {type:string; data:string}[] }> 
    = async ({ message, context }) => {
      return { 
        context, 
        emit: [ { type: 'TEST_EVENT_1', dat: 'Hello' } /* ... */ ] 
      };
    };
  ```

  By writing out the return type (here `Promise<{context: {}; emit?: EventType[]}>`), the object literal is directly checked against that type at the return statement. This often triggers excess property checks as desired. In our scenario, the misspelled `dat` property would be caught because the function explicitly promises to return an object with `data` (not `dat`). This approach is a bit verbose and can be tedious, but it leverages the fact that a **manually annotated return** forces TypeScript to immediately match the literal to the specified type (thus catching extra properties).

* **Intermediate Variable Assignment:** Similarly, assigning the return object to a properly typed variable before returning can trigger excess property checks. For example:

  ```ts
  const result: { context: {}; emit: {type:string; data:string}[] } = {
    context,
    emit: [
      { type: 'TEST_EVENT_1', dat: 'Hello' }, // <-- error: 'dat' not allowed
      { type: 'TEST_EVENT_2', data: 'World' },
    ]
  };
  return result;
  ```

  Here, when we assign to `result` (which has a non-union exact type), TypeScript will complain that `'dat' does not exist in type 'EventType'` – exactly what we want. This works because object literals *do* undergo excess property checking when assigned to a specific non-union type. The downside is you’ve introduced an extra constant and added verbosity.

* **Using the `satisfies` Operator (TypeScript 4.9+):** The `satisfies` operator can be very handy in these scenarios. It allows you to check that an expression matches a given type **without** widening its type. For example:

  ```ts
  return { 
    context, 
    emit: [ { type: 'TEST_EVENT_1', dat: 'Hello' } ] 
  } as const satisfies { context: TContext; emit?: TEmitted[] };
  ```

  Using `satisfies` will cause TypeScript to ensure the returned object is assignable to the target type (and report errors if not) but without forgetting the literal’s exact shape. In the above, `satisfies` would produce an error for the `dat` property, and it avoids the pitfalls of full type assertions. The drawback is that it’s a bit advanced and still requires the user to annotate the return with `satisfies { ... }`. It’s easy to forget to do this, so while it’s a **tool** we can use (and perhaps encourage in documentation), it’s not foolproof for every user.

* **Generic “Strict” Helpers:** You already experimented with a helper like `withEmit(context, events)` that likely wraps the return in a correctly typed way. Another variant is to use a generic constraint trick: for example, a function that takes an object and ensures via conditional types that no keys outside an expected set are present. The Stack Overflow community has produced patterns like:

  ```ts
  function asActorResult<C, E extends {type:string}>(
    result: E & Record<Exclude<keyof E, keyof {type:string; data:string}>, never>
  ): { context: C; emit: E } {
    return { context: (null as any as C), emit: result }; // dummy impl
  }
  ```

  The idea is the `Record<Exclude<keyof E, knownKeys>, never>` part forces excess keys to be of type `never` (causing a compile error if any exist). Using such a helper, one could write:

  ```ts
  return asActorResult(context, { type: 'TEST_EVENT_1', dat: 'Hello' });
  ```

  and get an error on `dat` because it’s not assignable to `never`. However, this is **not ergonomic** – it’s essentially the same as your `withEmit` approach, pushing complexity onto the user. It also tends to make error messages harder to decipher. So while these clever type constructs can achieve strict checking, they don’t meet our goal of an intuitive API.

**Compiler Options:** Currently, there is no compiler flag that specifically fixes excess property checks on return types. Enabling `--strict` is essential (and we assume it’s already on). Some related flags and features are worth noting, though they don’t directly solve this problem:

* **`exactOptionalPropertyTypes`:** This makes optional properties exact about whether they are present or not (treating `property?: Type` differently from `property: Type | undefined`). It doesn’t change excess property checking behavior for returns, but if we adopt patterns like “optional `emit` field must be exactly absent or of correct type”, this flag can help catch cases where someone might explicitly set `emit: undefined`. In our context it’s a minor detail.
* **NoImplicitReturns / NoUncheckedIndexedAccess:** These don’t relate to object excess properties; they cover other linting/strictness areas (ensuring all code paths return, and that array indexes are handled safely, respectively). They won’t address our issue.

In summary, **no tsconfig magic bullet** exists for this. The most practical workarounds involve changing how we write the return so the compiler sees a direct object-to-type assignment. Explicit return type annotations or intermediate variables can surface the error, but they require discipline. The `satisfies` operator is a newer, more elegant way to achieve a check without verbosity – it’s worth considering as part of our documentation (“if you want to ensure no excess properties in your return object, use `satisfies` with the Actor result type”). Ultimately, though, the cleanest solution will likely come from **redesigning our API types** rather than relying on every user to remember these tricks.

## **Designing a Safer API for Union Returns**

The core design challenge is allowing two forms of return (just `TContext` vs. `{ context: TContext; emit: ... }`) in a way that TypeScript can verify thoroughly. Here are some best-practice strategies to consider:

* **Unify the Return Type (Always an Object):** The simplest fix is to remove the union entirely and always return an object with a `context` property. In other words, change the return type to something like:

  ```ts
  type OnMessageResult<TContext, TEmitted> = { 
    context: TContext; 
    emit?: TEmitted | TEmitted[] 
  };
  ```

  Here `emit` is optional. An actor that doesn’t emit events would just return `{ context: newContext }`, and one that does would return `{ context: newContext, emit: [...] }`. This approach makes the type checking straightforward – TypeScript will always treat the return as matching a single object type. If someone includes a misspelled property in the `emit` array, the compiler will catch it because it’s directly checking those array elements against `TEmitted` (there’s no second union branch to hide behind). This significantly reduces complexity and avoids the union altogether. The downside is a **breaking change** in usage: previously, users could return `context` directly, whereas now they’d have to wrap it as `{ context }`. However, this change might be worth the improved type safety. It also makes the API more explicit – you always know the function returns an object with a context (and optionally events), rather than sometimes a raw context and sometimes an object.

* **Discriminated Union with a Tag:** If we really want to preserve the ability to return a raw context or an object, we can add a discriminant field to guide the compiler. For example:

  ```ts
  type OnMessageResult<TContext, TEmitted> = 
    | { kind: 'context'; context: TContext } 
    | { kind: 'emit'; context: TContext; emit: TEmitted | TEmitted[] };
  ```

  Now the union is *discriminated* by the literal `kind` property. In practice, a user returning events would write:

  ```ts
  return { kind: 'emit', context, emit: [ /* events */ ] };
  ```

  and a user returning only context would write:

  ```ts
  return { kind: 'context', context };
  ```

  This makes the union branches explicit to TypeScript. Crucially, the branch without `emit` (the `'context'` variant) **does not allow an `emit` property at all**, and the `'emit'` variant requires it. The presence or absence of `emit` is tied to `kind`. With this design, if someone tried to return an object with `emit` but put `kind: 'context'`, or omitted `kind` entirely, they’d get a type error. And if they include an `emit` array, the compiler knows it must match `TEmitted`’s shape exactly. This approach ensures no stray properties can creep in unnoticed – any return must conform to one of the exact shapes. The drawback is that it forces the user to include an extra `kind` field in their return object, which is a bit noisier. It’s not too bad (just a string literal), and it makes the code self-documenting, but it is additional ceremony that some might dislike. Also, if a user forgets the `kind` property entirely, the error messages might be confusing until they realize what’s missing.

* **“Exact” Types via Utility Types:** Another approach is to enforce exactness on the event objects themselves. We touched on this with the `Record<..., never>` trick. We could bake a utility into our types, for example:

  ```ts
  type Exact<T, Shape> = T extends Shape 
    ? (Exclude<keyof T, keyof Shape> extends never ? T : never) 
    : never;
  type StrictEvent<E extends Exact<E, TEmitted>> = E; // forces E to have no extra keys beyond TEmitted
  ```

  Then define `TEmitted` in `ActorBehavior` as this `StrictEvent`. In theory, this would cause any extra keys on event objects to be rejected by the type system. However, using such utilities can be tricky. They tend to require the event object to be a generic type argument (so the compiler can infer and then constrain it), which is hard to wire into our return type cleanly. We could try something like:

  ```ts
  emit?: (TEmitted extends infer U ? Exact<U, TEmitted> : never)[] 
  ```

  in the return type, but this might confuse inference more than help. This technique is powerful but can lead to overly complex types and error messages. It’s generally used sparingly (for instance, some libraries use it to ensure no unknown keys in configuration objects). In our case, it’s probably overkill and might not play well with union returns.

* **Leverage Optional Properties Smartly:** If we stick with the simpler union (context OR context+emit), one idea is to leverage optional vs required properties to guide the compiler. For example:

  ```ts
  type ContextOnly<TContext> = { context: TContext; emit?: never };
  type WithEmit<TContext, TEmitted> = { context: TContext; emit: TEmitted | TEmitted[] };
  type OnMessageResult<TContext, TEmitted> = ContextOnly<TContext> | WithEmit<TContext, TEmitted>;
  ```

  Here, in the “context only” variant, we explicitly say `emit` can only be `undefined` (because its type is `never` if present). This way, if a user tries to include an `emit` property with a real value while intending to return only context, it won’t match the `ContextOnly` branch. The presence of a non-`never` `emit` forces the value to be treated as `WithEmit`. In our problematic example, `{ context: {}, emit: [ { type: "...", dat: "Hello" } ] }` would *have* to match `WithEmit` (since `emit` is present with a value), and thus the compiler would check the array elements against `TEmitted`. Would this fix the issue? Potentially, yes – because now the union can’t fall back to treating the whole object as just `TContext`. We’ve structurally required a `context` property in both variants, so an object with `context` and `emit` won’t accidentally align with a bare `TContext`= `{}`. This approach is a bit subtle but doesn’t require a manual tag field. It does, however, force even the “context only” returns to be an object with a `context` key (similar to the first suggestion). If someone literally returns a raw number or string for context, it wouldn’t match `ContextOnly<TContext>` (since that expects an object with a `context` property) – resulting in a type error. So this really collapses back to “always return an object”, just with a union to differentiate if `emit` is included. Given that, we might as well simplify to a single object type with optional `emit` as described earlier.

**Recommendation:** To maintain **ergonomics and safety**, the cleanest path is likely to eliminate the union at the top level. Having a single return object type (with an optional `emit`) means developers get used to always returning an object, and the compiler can consistently enforce the structure. This avoids edge cases with union assignability completely. Yes, it means a minor change in how actors return their state when no events are emitted (they’d do `return { context }` instead of `return context`), but this is a one-time adjustment. In return, we guarantee that any misspelled or extraneous property in `emit` will be caught at compile time. This design aligns with how many modern APIs work – for example, Redux reducers always return a single state object, never a union of two shapes. It makes the type system’s job easier and our API more predictable.

## **Comparisons to Existing Libraries**

It’s instructive to see how other TypeScript libraries tackle similar problems of typed events or union returns:

* **XState (State Machine/Actor library):** XState addresses the “emit an event from an actor/machine” scenario by **not using a return value at all**. Instead, it provides an `emit` function inside the actor logic context. The user calls `emit(event)` to produce an event, rather than returning it. Under the hood, XState knows the union of all possible event types that can be emitted (because you define it up front in the machine’s `types.emitted` configuration). The `emit()` function is strongly typed – if you try to call `emit` with an event object that doesn’t match one of the allowed event shapes, TypeScript errors out. For example, if you defined emitted events as either `{ type: 'notification'; message: string }` or `{ type: 'error'; error: Error }`, then calling `emit({ type: 'notification', mesage: 'hi' })` (typo in “message”) would be a type error. XState achieves this by making you declare the event union in one place, and then it uses that to type the `emit` function. The developer experience is quite good: you get autocompletion for the `type` field and the corresponding payload properties. The takeaway for us is that XState sidesteps the entire issue of union return types by using a callback/side-effect model for emissions. They ensure type safety by **discriminated unions on the event type** (every event has a literal `type` tag) and by providing well-typed helpers (like their `emit` action creator) to construct events. Adopting a similar approach in our framework (e.g., passing an `emit` callback to `onMessage`) could be a radical change, but it *would* completely solve the type checking issue since the `emit` call is a normal function call (object literals passed to functions *do* get excess property checked). However, this would alter the actor behavior API significantly, and it might not align with our goal of a minimal, pure function style return. It’s a trade-off: XState’s approach favors explicitness and side-effect signaling, whereas our current design was more functional (pure input -> output).

* **Redux Toolkit (Typed Redux actions):** Redux actions are conceptually similar to events – they have a type and payload. Redux Toolkit avoids manual union type definitions by using **createSlice and createAction** helpers which infers action types for you. Under the hood, though, Redux actions typically use a discriminated union pattern on the `type` field. For instance, if you have two action types `'INCREMENT'` and `'DECREMENT'`, each with its own payload shape, you effectively get a union like `{ type: 'INCREMENT'; amount: number } | { type: 'DECREMENT'; step: number }`. If a developer dispatches an action object literal that doesn’t match one of these shapes, TypeScript will usually catch it. For example, an action `{ type: 'INCREMENT'; amount: 5; foo: 123 }` will be flagged because `foo` is not a known property in any action shape. Thanks to TypeScript’s union checking improvements, extra properties that aren’t recognized in any union member cause errors. The presence of the `type` literal is key: it forces each object into a specific mold. This is analogous to our potential discriminated union solution (using a `kind` or similar tag). The lesson from Redux Toolkit is to use **tagged unions** for variant shapes and to rely on TypeScript’s ability to narrow and check those tags. Redux Toolkit also demonstrates focusing on developer ergonomics: rather than writing unions by hand, developers use factory functions (which perform type inference). In our case, a parallel might be providing helper functions like `createActorBehavior(...)` that could infer the return type from a given implementation, but that might be over-engineering. Still, the general principle is: structure your types so that the compiler can discern which case it is, and you’ll get better checking.

* **Functional Programming Libraries (fp-ts, effect-ts):** These libraries often use **tagged union (discriminated union)** types to represent different outcomes (e.g., `Either<Error, Result>` or various `Effect` result variants). They achieve type safety by *never* conflating two shapes into one union without a clear differentiator. For example, an `Either` is `Left<E>` or `Right<A>`, each with a known wrapper. You can’t accidentally return a `Left` with the shape of a `Right` because the types make that impossible. In our context, that would mean making sure “context-only result” and “with-events result” are distinct in the type system (via either a wrapper or a tag). FP libraries also encourage using the type system to force you to handle each case (pattern matching or `.fold` methods). While our case is simpler (just ensuring correctness of structure), the philosophy is the same: **make invalid states unrepresentable** through the types. That’s what we aim to do by adjusting our return type definitions.

* **Akka.js or Other Actor Model Implementations:** Typed actor systems (like Akka Typed in Scala) typically enforce that an actor’s messages and signals are well-defined types. In Scala’s Akka Typed, the behavior of an actor can return effects (such as spawning child actors or sending messages) separately from the state, but Scala’s type system and Akka’s API ensure those are correct by design (often using sealed trait hierarchies for messages). In TypeScript, we don’t have sealed traits, but discriminated unions serve a similar role. Unfortunately, Akka.js (if it exists in TS) isn’t as mainstream, so we don’t have a direct comparison. However, our problem (ensuring event emissions match a declared type) is essentially a question of making the event channel typed – something XState and Redux both handle via tagged unions.

In summary, **other libraries favor clear discriminators and separate channels for side-effects**. XState gives an `emit` function tied to a declared union of event types. Redux gives each action a `type` tag and unions them. The common theme is avoiding ambiguous unions. We should do the same: either unify into one object type with optional content (simplest), or use a discriminator/tag to clearly separate the cases.

## **Conclusions and Recommendations**

To directly answer the specific questions:

1. **TypeScript’s limitation**: It’s well-documented that TypeScript does **not** perform excess property checks on function return object literals. This is why our union return wasn’t checked. Additionally, if a union includes a very broad type (like `{}` or `unknown`), an object literal can match that broad type and bypass stricter branches. The recommended workaround from the TypeScript team’s perspective is often “explicitly annotate the return type or use a different pattern,” since this behavior is intentional (to avoid breaking existing code).

2. **Enforcing strict checks on array elements in a union**: There’s no direct way to tell the compiler “be strict here” for our union case. Our best bet is to remove the conditions that caused the lax checking. Making the union discriminated (via a tag or structurally, as with an optional `emit?: never` in one branch) forces the compiler to consider the proper branch and thus check the array’s element type. Alternatively, bypass union returns altogether (always return a consistent object type) so that the `emit` array is always checked against a known type. In short: refine the union’s design or eliminate it. If we absolutely wanted to keep the current union, we’d rely on patterns like explicit annotation, intermediate variables, or `satisfies` in documentation to catch mistakes – but those are developer-dependent. A type system solution (like the above redesigns) is more robust.

3. **Compiler options**: There is no special compiler flag to make excess property checks “more strict” beyond what `--strict` does. Flags like `--exactOptionalPropertyTypes` or upcoming features don’t change this fundamental return-type behavior (they address different issues). The TypeScript team has considered a flag to disallow return type widening (which might enable excess checks on returns), but as of now, it doesn’t exist. So, we must resolve this in the type definitions or usage patterns.

4. **Best practices for API design with either/or returns**: The consensus best practice is to avoid ambiguous unions. Options include: using a single object with optional fields, using discriminated unions (with a tag or some distinguishing required property), or providing separate functions/overloads for each case. The goal is to make each possible return form explicit. In our case, changing `onMessage` to *always* return an object (`{ context, emit? }`) is one clean solution. If we feel strongly about keeping the sugar of returning just a context, we could internally overload or reinterpret a bare return – but type-wise, that’s hard to do safely. Another best practice is to leverage the type system’s strengths; for example, require that every event have a `type` field that is a literal. This way, even if multiple event shapes are unioned, TypeScript will catch property name mistakes on that `type` or on mismatched payload fields (because it knows exactly which shape corresponds to each `type`). We have that already (our events have a `type`), but we allowed a scenario where an event object with the wrong fields snuck through due to the union return. So, designing the API to avoid such unions (or make them discriminated) is the key. A real-world guiding principle: **if an API can be designed such that the compiler can always determine which case it’s dealing with, then you’ll get maximum type safety**. Right now, our `Promise<TContext | {context:TContext; emit?...}>` doesn’t let the compiler clearly know when it should expect an `emit` field – so it doesn’t enforce it strictly. Changing that will align our design with TypeScript’s sweet spot.

5. **Examples from other libraries**: As discussed, frameworks like XState and Redux Toolkit have tackled similar problems by using internal helper functions and discriminated unions to ensure type-safe events. XState’s approach of providing an `emit()` API is an alternative model we could consider – it leads to excellent type safety (since events are checked at the point of emission) at the cost of a different usage pattern. Redux Toolkit’s use of createAction/createSlice shows that hiding the union behind abstractions and using discriminated `type` tags yields safer code. We can draw inspiration from these: for instance, we might introduce a utility to define an actor behavior that infers the `TEmitted` type from a given events object structure, ensuring no extra keys (similar in spirit to how Redux infers action types). But again, this adds complexity we may not need if a simpler type tweak can solve it.

**Final recommendation:** Refactor the `ActorBehavior.onMessage` return type to **eliminate the broad union**. The safest route is to return a single object shape consistently (with `emit` optional). This will immediately fix the excess property issue for array elements because the compiler will directly match event objects to the `TEmitted` type (catching missing `data` or extra `dat` properties). If maintaining backwards compatibility is a must, consider a temporary solution like: accept both forms in the type but internally cast one to the other. For example, we could do:

```ts
onMessage: (...) => Promise<{ context: TContext; emit?: TEmitted|TEmitted[] } | TContext> 
// (still a union for backward compat)
```

but then internally (in implementation) immediately normalize `TContext` to `{ context: TContext }`. This wouldn’t improve compile-time checking though – it’s more for easing migration. So, ideally, make a clean break: switch to a single return object. Document this change clearly for users (“Wrap your context in an object on return; `emit` field is optional”). The improved type safety is worth it – we avoid silent failures where an event is emitted with the wrong shape.

By aligning our API with how TypeScript’s type system works best (unions with clear discriminants or no unions at all for return types), we ensure that mistakes like the `dat` vs `data` typo are caught at compile time, fulfilling our goal of **robust type safety without sacrificing developer experience**. The user experience remains straightforward (return an object with `context` and optionally `emit`), and under the hood the types will do the right thing.

Ultimately, solving this “excess property” issue reinforces the value of designing TypeScript APIs that cooperate with the compiler’s strengths. It’s a bit of extra upfront consideration, but it prevents bugs and gives users confidence in the framework’s correctness. With the above changes, our actor model should be as type-safe and ergonomic as we need, catching errors early and making event emission a delight rather than a source of sneaky bugs.

**Sources:**

* Stack Overflow – *“Validate excess keys on value returned from function”* (explains why function return object literals aren’t excess-checked)
* TypeScript GitHub Issue – *Function return type with array (#33158)* (TypeScript team member confirming excess property checks don’t apply to non-literal returns)
* TypeScript 3.5 Release Notes (improved excess property checks in unions)
* Stately AI XState Documentation – *Strongly typing emitted events in XState* (showing use of a declared union of event types for `emit`)
