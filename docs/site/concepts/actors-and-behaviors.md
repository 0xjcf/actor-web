---
title: Actors & behaviors
description: What an actor is in Actor-Web, and how defineActor authors its behavior.
---

# Actors & behaviors

An **actor** is an isolated unit of state that processes one message at a time.
Its **behavior** is the function that decides what happens for each message —
authored with `defineActor`.

## The builder

`defineActor` is a small fluent builder. You declare the message union, optional
state, and a handler:

```ts twoslash
import { defineActor } from '@actor-web/runtime';

type Msg = { type: 'PING' } | { type: 'RESET' };

export const pinger = defineActor<Msg>()
  .withContext({ pings: 0 })
  .onMessage(({ message, context }) =>
    message.type === 'PING'
      ? { context: { pings: context.pings + 1 } }
      : { context: { pings: 0 } },
  )
  .build();
```

The builder steps:

- **`withContext(initial)`** — give the actor state. Omit it for a stateless
  actor.
- **`withMachine(machine)`** / **`withFSM(map)`** — drive state with an XState
  machine or a lightweight FSM constraint map (see
  [State & machines](/concepts/state-and-machines)).
- **`onMessage(handler)`** — the catch-all handler.
- **`onTransition({ TYPE: handler })`** — per-message handlers, used with a
  machine/FSM.
- **`onStart` / `onStop`** — lifecycle hooks.
- **`build()`** — produce the behavior.

## The handler

Every handler receives the same shape:

```ts
({ message, context, actor, tools }) => result
```

- **`message`** — the incoming message (narrowed to its `type`).
- **`context`** — current state.
- **`actor`** — a handle to *this* actor (`getSnapshot()`, self `send`/`ask`).
- **`tools`** — the actor's declared [tools](/concepts/tools) for I/O.

What it returns is an `ActorHandlerResult` — see
[Messages](/concepts/messages) for `context` / `reply` / `emit`, and the
declarative `MessagePlan` for talking to other actors.

## Three shapes of actor

- **Stateless** — no `withContext`; pure message router.
- **Context-based** — `withContext`; the OTP `gen_server` pattern, returning the
  next `context`.
- **Machine-based** — `withMachine`/`withFSM`; transitions are constrained by a
  state machine. Handlers are optional: an event with no handler transitions and
  resolves `ask(...)` with the snapshot, so `defineActor().withMachine(m).build()`
  can be the whole behavior. Add an `onTransition` handler only for events that
  emit or do I/O.

All three share the same handler signature, so you can start simple and add a
machine later without rewriting handlers.
