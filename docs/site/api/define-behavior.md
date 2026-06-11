---
title: defineBehavior
description: The behavior builder API — withContext, withMachine, onMessage, onTransition, build.
---

# `defineBehavior`

```ts
import { defineBehavior } from '@actor-web/runtime';

defineBehavior<TMessage, TEmitted?>(): UnifiedActorBuilder
```

Creates a fluent builder for an actor behavior. `TMessage` is the union of
messages the actor accepts; `TEmitted` (optional) is the union of events it can
emit.

## Builder methods

| Method | Purpose |
| --- | --- |
| `.withContext(initial)` | Set initial state. Infers the context type. |
| `.withMachine(machine)` | Drive state with an XState machine. |
| `.withFSM(fsm)` | Drive state with a lightweight FSM constraint map. |
| `.withTools<TRegistry>()` | Narrow the tool registry (standalone actors). |
| `.onMessage(handler)` | Catch-all message handler. |
| `.onTransition({ TYPE: handler })` | Per-message handlers (requires a machine/FSM). Optional — see below. |
| `.onStart(fn)` / `.onStop(fn)` | Lifecycle hooks. |
| `.build()` | Produce the `ActorBehavior`. **Optional** — see below. |

`withMachine` and `withFSM` are mutually exclusive. `onTransition` requires one
of them.

### Default behavior (no handlers)

With a machine or FSM attached, handlers are **optional**: an event with no
explicit handler transitions the machine/FSM and resolves `ask(...)` with the
snapshot (`{ value, context }`); illegal transitions are rejected. So a
machine-backed actor can be the whole behavior:

```ts
const compare = defineBehavior<CompareEvent>().withMachine(compareMachine);
```

`onMessage` still serves as the fallback for non-transition messages.

### `.build()` is optional

`actor({ behavior })` and `system.spawn(...)` accept the builder directly and
build it under the hood, so you can drop the trailing `.build()`:

```ts
actor({ id: 'compare', node: 'local', behavior: defineBehavior<CompareEvent>().withMachine(compareMachine) });
```

Call `.build()` explicitly only when you need the materialized `ActorBehavior`
value (for example to inspect or reuse it). Building requires *either* a handler
(`onMessage`/`onTransition`) *or* an attached machine/FSM.

## The handler

```ts
(params: {
  message: TMessage;
  context: TContext;
  actor: TypedActorInstance<TContext>;
  tools: ActorToolbox;
}) => ActorHandlerResult | MessagePlan | DomainEvent | void
```

### `ActorHandlerResult`

```ts
{
  context?: TContext;   // replace state (omit = unchanged)
  reply?: unknown;      // 1-to-1 response to ask(...)
  emit?: unknown[];     // 1-to-many domain events to subscribers
}
```

### Returning a `MessagePlan`

To message other actors, return a send/ask instruction (or array):

```ts
{ to: ref, tell: message } // mode?: 'fireAndForget' — optional, the only delivery mode
{ to: ref, ask: message, onOk: (r) => domainEvent, onError?: (e) => domainEvent }
```

## `defineFSM`

```ts
defineFSM<TMessage, TContext, TState>(fsm): ActorFSMDefinition
```

Helper to author a typed FSM constraint map for `withFSM`. See
[State & machines](/concepts/state-and-machines).

## See also

- [Actors & behaviors](/concepts/actors-and-behaviors)
- [Messages](/concepts/messages)
