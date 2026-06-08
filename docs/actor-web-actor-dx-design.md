# Actor-Web Actor DX Design (minimal boilerplate)

## Summary

Author actors with the **existing** primitives — `defineActor`,
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
| `defineActor` + machine/FSM | Akka `Behaviors`, Erlang `gen_statem`, XState machine-as-actor | The machine/FSM **is** the behavior. No handler required; `ask` resolves with the snapshot; an event with no override just transitions. |
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
export const compareBehavior     = defineActor<CompareEvent>().withMachine(compareMachine).build();
export const pipelineBehavior    = defineActor<PipelineEvent>().withMachine(pipelineMachine).build();
export const decisionsBehavior   = defineActor<DecisionsEvent>().withMachine(decisionsMachine).build();
export const actorSystemBehavior = defineActor<ActorSystemEvent>().withMachine(actorSystemMachine).build();
```

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

### `withFSM` (no XState) — handlers own context + emit

The FSM constraint map has transitions + guards but **no actions/assign**, so
context updates and `emit` move into the `onTransition` handler (the Erlang/Akka
shape). `emit` is a field on the handler result — engine-agnostic, works today.

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

const resolve = (context: CompareContext, outcome: CompareOutcome) => ({
  context: { ...context, outcome },
  emit: [{ type: "OUTCOME_RESOLVED" as const, outcome }],
});

export const compareBehavior = defineActor<CompareEvent, CompareEmitted>()
  .withContext(INITIAL_COMPARE_CONTEXT)
  .withFSM(compareFSM)
  .onTransition({
    SELECT_ORIGINAL: ({ context }) => ({ context: { ...context, selected: "original" } }),
    SELECT_FORK:     ({ context }) => ({ context: { ...context, selected: "fork" } }),
    KEEP_ORIGINAL:   ({ context }) => resolve(context, "kept-original"),
    ACCEPT_FORK:     ({ context }) => resolve(context, "accepted-fork"),
    MERGE:           ({ context }) => resolve(context, "merged"),
    APPROVE:         ({ context }) => resolve(context, "approved"),
    SEND_TO_REVIEWER:({ context }) => resolve(context, "sent-to-reviewer"),
    REPLAY:          ({ context }) => ({ context: { ...context, selected: null, outcome: null } }),
  })
  .build();
```

### Machine vs FSM — same downstream

| | `withMachine` (XState) | `withFSM` (no XState) |
|---|---|---|
| Transitions/guards | machine | FSM map |
| Context updates | machine (`assign`) | handler (`{ context }`) |
| `emit` | machine (`emit(...)`) | handler (`{ emit: [...] }`) |
| Handlers needed | none (override for imperative effects) | one per **effect-bearing** event |
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
(`actor.withTools<R>()` + `(defineActor) => …`) stays only as the escape hatch
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

1. `defineActor().withMachine(m).build()` and `.withFSM(f).build()` legal with
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
- `withMachine` and `withFSM` are both first-class; emit in machine (XState) or
  handler (engine-agnostic) respectively; identical downstream.
- Hybrid event model: actor emits auto-bridge; `effects` additive.
- Commands: authored names + `send` helper; `Command | (payload) => Command`.
- Coordination: `emit` + declarative `subscriptions` (choreography default).

## Status

Target design. Not yet implemented. Build order: T1–T4 (subscriptions) +
behavior-default + emit-bridge in actor-web; `send`/event-bridge in
ignite-element. The published docs site documents only shipped API; this design
stays an internal reference until the pieces land.
