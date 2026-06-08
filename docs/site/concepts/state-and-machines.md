---
title: State & machines
description: Context state, XState machines, and lightweight FSM constraint maps.
---

# State & machines

An actor's state is its `context`. How transitions between states are governed is
your choice: plain context updates, a full XState machine, or a lightweight FSM
constraint map.

## Plain context

The simplest model returns the next `context` from each handler:

```ts
const counter = defineActor<{ type: 'INC' }>()
  .withContext({ count: 0 })
  .onMessage(({ context }) => ({ context: { count: context.count + 1 } }))
  .build();
```

## XState machines

For real state-machine semantics — guarded transitions, hierarchical states —
attach an XState machine with `withMachine`. The machine **is** the behavior, so
no handlers are required: each event transitions the machine and `ask(...)`
resolves with the snapshot.

```ts
// the machine owns transitions, guards, and (via XState actions) effects
const compare = defineActor<CompareEvent>().withMachine(compareMachine).build();
```

Domain events can be emitted from the machine: an XState v5 `emit(...)` action is
bridged onto the actor's event stream, reaching subscribers and the agent runtime
just like a handler's `emit` (see [Subscriptions & events](/concepts/subscriptions-and-events)).

Add an `onTransition` handler only for an event that needs an imperative effect;
un-handled events keep the default:

```ts
defineActor<CompareEvent>()
  .withMachine(compareMachine)
  .onTransition({
    MERGE: ({ context }) => ({ context, emit: [{ type: 'MERGED' }] }),
  })
  .build();
```

The machine decides whether a transition is legal; the runtime rejects
impossible transitions before any handler runs.

## Lightweight FSM constraint maps

When you want transition constraints without pulling in XState, `withFSM` takes a
small `{ initial, states }` map:

```ts
const fsm = defineFSM({
  initial: 'design',
  states: {
    design:    { on: { ADVANCE: 'implement' } },
    implement: { on: { ADVANCE: 'review' } },
    review:    { on: {} },
  },
});
```

The FSM is intentionally **pure and synchronous** — it only constrains which
transitions are allowed. I/O, emits, replies, and context updates belong in the
`onTransition` handlers, never in the FSM itself. A pure transition needs no
handler (the default resolves `ask(...)` with the new state); write a handler for
any event that updates context or emits.

## The rule

State *shape* lives in `context`. State *transitions* are constrained by the
machine/FSM. Side effects live in handlers. Keeping those separated is what makes
behaviors testable without a running system.
