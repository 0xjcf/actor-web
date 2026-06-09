# Actor-Web Actor DX Design (minimal boilerplate)

## Summary

Author actors with the **existing** primitives — `defineBehavior`,
`defineActorWebTopology`, `igniteCore`, `spawn`, `subscribe` — and make their
*defaults* match the systems Actor-Web draws from (XState, Erlang/OTP, Elixir,
Akka). No new sugar functions. The boilerplate in today's consumers (e.g.
fas-studio: 20 identical transition handlers, 8-line command blocks, a shell
coordinator) exists because the primitives don't yet default to those
semantics — so we fix the defaults, not the surface.

Outcome for fas-studio: `behaviors.ts` 95 → ~4 lines, every UI command block
shrinks to `send(...)` entries, the coordinator/shell is deleted, and a
newcomer who knows XState + OTP already knows the API.

## Guiding principle

> **Zero boilerplate for the default case; you write code only for what isn't
> default.** Sensible zero-config defaults with explicit escape hatches
> (progressive disclosure) — never magic you can't trace.

## The five primitives and their lineage

| Primitive | Lineage | Default that removes boilerplate |
|---|---|---|
| `defineBehavior` + machine/FSM | Akka `Behaviors`, Erlang `gen_statem`, XState machine-as-actor | The machine/FSM **is** the behavior. No handler required; `ask` resolves with the snapshot; an event with no override just transitions. |
| `defineActorWebTopology` | OTP supervision tree, Akka guardian | Static actors + supervisors declared; behaviors are plain values. |
| `spawn` | Erlang `spawn_link`, Akka `context.spawn`, XState `spawnChild` | Dynamic / per-entity actors — use it instead of a new "dynamic actor" API. |
| `subscribe` | Phoenix.PubSub, Akka EventStream, Erlang `monitor` | `emit` → `subscribe` delivers to other actors; declarative topology `subscriptions` is OTP-style wiring over the same primitive. |
| `igniteCore` | XState `useActor` | Exposes `view`, `send`-based commands, and a headless agent runtime — all from one definition. |

## Behavior authoring

The XState machine (or FSM constraint map) already owns transitions, guards, and
state. Actor-Web should *run* it, not make you restate it.

### `withMachine` (XState) — the machine is the behavior

```ts
// behaviors.ts — no per-event handlers; defaults: transition + ask resolves with snapshot
export const compareBehavior     = defineBehavior<CompareEvent>().withMachine(compareMachine);
export const pipelineBehavior    = defineBehavior<PipelineEvent>().withMachine(pipelineMachine);
export const decisionsBehavior   = defineBehavior<DecisionsEvent>().withMachine(decisionsMachine);
export const actorSystemBehavior = defineBehavior<ActorSystemEvent>().withMachine(actorSystemMachine);
```

`.build()` is **optional**: `actor({ behavior })` and `spawn` accept the builder
directly and build it under the hood. Call `.build()` explicitly only when you
need the materialized `ActorBehavior` value.

Domain events are emitted *from the machine* (XState v5 `emit`), so the behavior
stays empty:

```ts
// compare.machine.ts
export const compareMachine = setup({
  types: {
    context: {} as CompareContext,
    events:  {} as CompareEvent,
    emitted: {} as { type: "OUTCOME_RESOLVED"; outcome: CompareOutcome },
  },
}).createMachine({
  /* … */
  MERGE: {
    target: "resolved",
    actions: [
      assign({ outcome: () => "merged" as CompareOutcome }),
      emit(({ context }) => ({ type: "OUTCOME_RESOLVED", outcome: context.outcome })),
    ],
  },
});
```

Add `.onTransition({ SOME_EVENT })` back **only** for an imperative effect the
machine can't express.

### `withFSM` — strict constraint mapping (first-class target)

`withFSM` is **not** a fallback for "no XState." It is the right target whenever
the **legal transition matrix is the thing you must get exactly right**:

- The FSM map *is* the spec — a flat, exhaustive, reviewable declaration of
  `state → allowed events → target (+ guard)`, and nothing else.
- **No hidden behavior.** It carries no `assign`/`emit`/`invoke`/nested states,
  so "what is *legal*" (the map) stays physically separated from "what
  *happens*" (the handlers). The constraint surface is auditable on its own.
- **Illegal transitions are rejected, not ignored.** An event with no entry in
  the current state surfaces an explicit `INVALID_TRANSITION` (and an
  `ACTOR_TRANSITION_REJECTED` event) rather than a silent no-op — exactly what
  you want when "this transition must be impossible" is a correctness rule.

Because the FSM has no actions, context updates and `emit` move into the
`onTransition` handler (the Erlang/Akka shape). `emit` is a field on the handler
result — engine-agnostic, works today.

```ts
const compareFSM = defineFSM<CompareEvent, CompareContext, CompareState>({
  initial: "comparing",
  states: {
    comparing: {
      on: {
        SELECT_ORIGINAL: "comparing",
        SELECT_FORK:     "comparing",
        KEEP_ORIGINAL:   { target: "resolved", guard: hasSelection },
        ACCEPT_FORK:     { target: "resolved", guard: hasSelection },
        MERGE:           "resolved",
        APPROVE:         { target: "resolved", guard: hasSelection },
        SEND_TO_REVIEWER:"inReview",
      },
    },
    resolved: { on: { REPLAY: "comparing" } },
    inReview: { on: { REPLAY: "comparing" } },
  },
});

export const compareBehavior = defineBehavior<CompareEvent, CompareEmitted>()
  .withContext(INITIAL_COMPARE_CONTEXT)
  .withFSM(compareFSM)
  .onTransition({
    SELECT_ORIGINAL: ({ context }) => ({ context: { ...context, selected: "original" } }),
    SELECT_FORK:     ({ context }) => ({ context: { ...context, selected: "fork" } }),
    KEEP_ORIGINAL:   ({ context }) => ({ context: { ...context, outcome: "kept-original" },    emit: [{ type: "OUTCOME_RESOLVED", outcome: "kept-original" }] }),
    ACCEPT_FORK:     ({ context }) => ({ context: { ...context, outcome: "accepted-fork" },     emit: [{ type: "OUTCOME_RESOLVED", outcome: "accepted-fork" }] }),
    MERGE:           ({ context }) => ({ context: { ...context, outcome: "merged" },            emit: [{ type: "OUTCOME_RESOLVED", outcome: "merged" }] }),
    APPROVE:         ({ context }) => ({ context: { ...context, outcome: "approved" },          emit: [{ type: "OUTCOME_RESOLVED", outcome: "approved" }] }),
    SEND_TO_REVIEWER:({ context }) => ({ context: { ...context, outcome: "sent-to-reviewer" },  emit: [{ type: "OUTCOME_RESOLVED", outcome: "sent-to-reviewer" }] }),
    REPLAY:          ({ context }) => ({ context: { ...context, selected: null, outcome: null } }),
  })
  .build();
```

> A handler returns the same `ActorHandlerResult` — `{ context?, reply?, emit? }` —
> as `onMessage` (see below); `emit` is an array. Extracting a local helper to
> dedupe repeated results is fine, but it's user code, not API — the canonical
> shape is the explicit `{ context, emit }` object above.

### `onMessage` — no machine, and the fallback

`onMessage` is the gen_server catch-all and is fully supported. Use it for
actors that are **not** machine/FSM-backed, and as the **fallback** alongside
`onTransition`. It returns the same `ActorHandlerResult` shape.

```ts
// (a) onMessage only — no machine; switch on message.type yourself
defineBehavior<CounterMsg>()
  .withContext({ count: 0 })
  .onMessage(({ message, context }) =>
    message.type === "INCREMENT"
      ? { context: { count: context.count + 1 }, emit: [{ type: "COUNTED", count: context.count + 1 }] }
      : { context: { count: 0 } })
  .build();

// (c) both — onTransition for specific events, onMessage as the catch-all
defineBehavior<E>().withFSM(fsm)
  .onTransition({ MERGE: ({ context }) => ({ context, emit: [/* … */] }) })
  .onMessage(({ actor }) => ({ reply: actor.getSnapshot().value }))   // fallback for the rest
  .build();
```

The transition dispatcher already falls back to `onMessage` for events without an
`onTransition` entry. Task A1 adds an *implicit* default (transition + snapshot
reply) so the trivial fallback isn't even needed.

**One result shape everywhere.** `onMessage` and every `onTransition` handler
return the same `ActorHandlerResult` (`{ context?, reply?, emit? }`) — or a
`MessagePlan` to message peers. `emit` is always an array.

### Machine vs FSM — two first-class targets

Both are deliberate choices, picked by **intent** — not default-vs-fallback.

| | `withMachine` (XState) | `withFSM` (strict constraints) |
|---|---|---|
| Choose when | rich engine: hierarchy, parallel states, `assign`/`emit`/`invoke` | the legal transition matrix must be exact, minimal, auditable |
| Transitions/guards | machine | FSM map (the spec) |
| Context updates | machine (`assign`) | handler (`{ context }`) |
| `emit` | machine (`emit(...)`) | handler (`{ emit: [...] }`) |
| Illegal transitions | machine semantics | **rejected** — explicit `INVALID_TRANSITION` + `ACTOR_TRANSITION_REJECTED` |
| Handlers needed | none (override for imperative effects) | one per **effect-bearing** event |
| Effects vs legality | entangled in the machine | **separated** — map = legality, handlers = effects |
| Dependency | XState | none — portable |

Both feed `subscribe`, declarative `subscriptions`, and the ignite agent runtime
**identically**. The UI/agent never knows which engine backs the actor.

## Coordination — `emit` → `subscribe` (hybrid)

The producer emits a fact; consumers subscribe. Choreography by default; a
coordinator actor only when a rule genuinely spans actors. Wiring is declared in
the topology (durable, type-checked) — see
`actor-web-declarative-subscriptions-design.md` (tasks T1–T4):

```ts
subscriptions: [
  { from: "compare", to: ["pipeline", "actorSystem"], events: ["OUTCOME_RESOLVED"] },
],
```

Consumers react in *their* machines/FSMs via an `on: { OUTCOME_RESOLVED: … }`
transition — no coordinator code, no shell.

## Topology — drop the curry

Tool-free actors take a plain behavior value; the tool-typing curry
(`actor.withTools<R>()` + `(defineBehavior) => …`) stays only as the escape hatch
for actors that actually call a tool.

```ts
actors: {
  compare: actor({ id: "fas-compare", node: "local", behavior: compareBehavior, supervision: SUPERVISION }),
  // …
},
```

## UI binding (ignite-element)

`igniteCore({ source, view, commands })`. `view` projects the snapshot; commands
are named verbs built with a `send` helper.

```ts
const compare = igniteCore({
  source: compareSource,
  view: ({ context }) => compareView(context),
  commands: ({ send }) => ({
    selectOriginal: send({ type: "SELECT_ORIGINAL" }),     // static  → execute('selectOriginal')
    acceptFork:     send({ type: "ACCEPT_FORK" }),
    merge:          send({ type: "MERGE" }),
    approve:        send({ type: "APPROVE" }),
    // parameterized: a plain arrow that returns send(...)
    promote: (id: DecisionId) => send({ type: "PROMOTE", id }), // → execute('promote', id)
  }),
});
```

### Command rule

> A command entry is `Command | ((payload) => Command)`, where **`send(message)`
> builds a `Command` (deferred — it does not dispatch).**

The runtime runs an entry by calling it with the payload first if it's the
`(payload) => Command` form, then running the `Command`. Consequences:

- No premature dispatch — `send(...)` at build time only constructs.
- Names are authored (the agent's verbs; the template's bindings) — never
  derived/mangled.
- Agent arity inference is exact: 0-arg `Command` → `execute('name')`;
  `(payload) => Command` → `execute('name', payload)`.

`actor` remains in the commands context as the escape hatch.

### Event bridge (hybrid)

When the source is an actor, its domain `emit`s **automatically** become the
headless runtime's events (typed from the machine/behavior's emitted union) — no
`events:`/`effects:` blocks needed. The ignite `effects` API stays available
**additively** for UI-derived events the actor doesn't author.

```ts
// actor-authored event flows automatically:
await compare.execute("acceptFork");
// → { state, events: [{ type: "OUTCOME_RESOLVED", outcome: "accepted-fork" }] }
compare.on("OUTCOME_RESOLVED", (e) => e.outcome);

// optional UI-derived add-on:
effects: ({ emit, select }) => {
  const sel = select((s) => s.context.selected);
  if (sel.changed) emit("selectionChanged", { selected: sel.current });
}
```

The coupling is one-directional and opt-out: ignite *reads* the actor's emitted
events; the actor never knows about ignite.

## Headless agent runtime

Every `igniteCore(...)` value is also an `IgniteAgentRuntime` — the same
definition drives a DOM custom element, a headless agent, and test stories. An
agent drives the actor with no DOM:

```ts
const { state, events } = await compare.execute("acceptFork");
const view = compare.getView();
await compare.watchView((v) => v.outcome !== null);
compare.on("OUTCOME_RESOLVED", (e) => /* react */);
```

This is why named commands matter — they are the agent's verb surface — and why
they are authored, not derived.

## Without ignite-element

The same actors consume directly through the command source — already lean, no
helpers:

```ts
const compare = runtime.actors.compare.commandSource();
compare.subscribe((s) => render(compareView(s.context)));
button.onclick = () => compare.send({ type: "ACCEPT_FORK" });
const resolved = await compare.ask({ type: "MERGE" });   // resolves with snapshot
```

## fas-studio before/after (net)

| File | Before | After |
|---|---|---|
| `behaviors.ts` | 95 lines, 20 identical handlers, curried factories | ~4 lines (`withMachine`) or per-effect handlers (`withFSM`) |
| `compare.machine.ts` | outcome in context only | + `emit(OUTCOME_RESOLVED)` (XState path) |
| `topology.ts` | `fasActor` curry + `behavior: createXBehavior` | `actor({ behavior: xBehavior })` + `subscriptions: [...]` |
| `*-view.tsx` | 8-line `commands` block of `() => actor.send` | `commands: ({ send }) => ({ name: send(msg) })` |
| coordinator/shell | external `wireFasCoordinator` subscriber | deleted — choreography via `emit`/`subscribe` |

## What Actor-Web must implement (all "fix the defaults," no new API)

1. `defineBehavior().withMachine(m).build()` and `.withFSM(f).build()` legal with
   **no** handlers; default = transition + `ask` resolves with snapshot.
2. Bridge XState v5 machine `emit` → the actor's emit/`subscribe` stream
   (`ActorHandlerResult.emit` already covers the FSM/handler path).
3. Declarative `subscriptions` in the topology (tasks T1–T4 /
   `actor-web-declarative-subscriptions-design.md`).
4. Allow plain-value behaviors in `actor({ behavior })` (curry only when tools
   are used).

## What ignite-element must implement

1. `send` helper in the commands context: `send(message): Command`, deferred.
2. Command-entry semantics: `Command | ((payload) => Command)`, with agent
   `execute` arity inference.
3. Actor-source event auto-bridge: actor `emit` → runtime events (typed),
   with `effects` remaining additive.

## Decisions (locked)

- Use existing primitives only; fix defaults, no new sugar.
- `withMachine` and `withFSM` are both first-class targets chosen by intent:
  `withMachine` for XState's rich engine (effects in the machine), `withFSM` for
  a strict, minimal, auditable constraint matrix with enforced legality (effects
  in handlers). Identical downstream.
- Hybrid event model: actor emits auto-bridge; `effects` additive.
- Commands: authored names + `send` helper; `Command | (payload) => Command`.
- `onTransition` stays **keyed per event** (`{ EVENT: ({ message, context }) =>
  result }`) — it is a dispatch, not a projection, so it preserves per-event
  message narrowing and lazy per-event effects (mirrors XState `on:`, Redux
  reducers, Elixir/Erlang per-message handlers). `commands`/`view` keep the
  single-callback shape because they are projections.
- One handler result shape everywhere: `onMessage` and `onTransition` both
  return `ActorHandlerResult` (`{ context?, reply?, emit? }`, `emit` an array) or
  a `MessagePlan`. `onMessage` stays first-class (non-machine actors + fallback).
  Canonical examples show the explicit `{ context, emit }` object — no
  result-hiding helpers in the docs.
- Coordination: `emit` + declarative `subscriptions` (choreography default).

## Status

Target design. Not yet implemented. Build order: T1–T4 (subscriptions) +
behavior-default + emit-bridge in actor-web; `send`/event-bridge in
ignite-element. The published docs site documents only shipped API; this design
stays an internal reference until the pieces land.
