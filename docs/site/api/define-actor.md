---
title: defineActor
description: The behavior builder API — withContext, withMachine, onMessage, onTransition, build.
---

# `defineActor`

```ts
import { defineActor } from '@actor-web/runtime';

defineActor<TMessage, TEmitted?>(): UnifiedActorBuilder
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
| `.build()` | Produce the `ActorBehavior`. |

`withMachine` and `withFSM` are mutually exclusive. `onTransition` requires one
of them.

### Default behavior (no handlers)

With a machine or FSM attached, handlers are **optional**: an event with no
explicit handler transitions the machine/FSM and resolves `ask(...)` with the
snapshot (`{ value, context }`); illegal transitions are rejected. So a
machine-backed actor can be the whole behavior:

```ts
const compare = defineActor<CompareEvent>().withMachine(compareMachine).build();
```

`build()` requires *either* a handler (`onMessage`/`onTransition`) *or* an
attached machine/FSM. A machine event without a handler falls through to this
default; `onMessage` still serves as the fallback for non-transition messages.

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
{ to: ref, tell: message, mode: 'fireAndForget' | 'retry(3)' | 'guaranteed' }
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
