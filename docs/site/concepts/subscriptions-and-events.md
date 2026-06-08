---
title: Subscriptions & events
description: How actors react to each other in Actor-Web — emit, system.subscribe, and declarative topology subscriptions.
---

# Subscriptions & events

Actors don't call each other. When something happens that other actors (or a UI)
might care about, an actor **emits a domain event** — a fact — and anyone
subscribed receives it. This is the actor-model way to coordinate without
coupling: the producer doesn't know who is listening.

## Emitting events

A handler broadcasts events with the `emit` field of its result:

```ts
return {
  context: { count },
  emit: [{ type: 'COUNT_CHANGED', count }],
};
```

`emit` is a 1-to-many broadcast, distinct from `reply` (the 1-to-1 response to
an `ask`). Emitted events are delivered straight into each subscriber's mailbox
as ordinary messages — "events are just messages," the same model as Erlang/OTP
and Akka.

Machine-backed actors can emit from the machine itself: an XState v5 `emit(...)`
action is bridged onto the same stream, so a `withMachine` actor announces domain
events with no handler.

```ts
// inside the machine — emit a domain event as a transition action
MERGE: { target: 'resolved', actions: emit(() => ({ type: 'OUTCOME_RESOLVED', outcome: 'merged' })) }
```

## Reacting to another actor's events

An actor becomes a subscriber by being wired to a publisher. Today that wiring
is explicit:

```ts
// Deliver `compare`'s OUTCOME_RESOLVED events into the pipeline actor.
await system.subscribe(compareRef, {
  subscriber: pipelineRef,
  events: ['OUTCOME_RESOLVED'],
});
```

The subscriber then handles `OUTCOME_RESOLVED` like any other message and
decides what to do — advance a pipeline, activate a role, update a projection.
Because the producer only emits, it stays ignorant of its consumers
(_choreography_, not orchestration).

## Orchestration vs. choreography

- **Choreography** — each consumer subscribes to events and decides its own
  reaction. Maximally decoupled; the reaction logic lives with the consumers.
- **Orchestration** — a dedicated coordinator actor subscribes to events and
  tells others what to do. Centralizes a cross-cutting rule at the cost of a
  coordinator that knows the participants.

Both are built from the same `emit` + subscription primitives. Reach for a
coordinator only when a rule genuinely spans several actors.

## Declarative subscriptions

Wiring subscriptions imperatively at startup is easy to lose track of — and
in-memory subscriptions don't survive a full runtime restart. Declare them in the
topology instead: the runtime wires them on start and tears them down on stop, so
the wiring is durable (re-established on every start) and type-checked.

```ts
defineActorWebTopology({
  actors: { compare, pipeline, actorSystem },
  subscriptions: [
    { from: 'compare', to: ['actorSystem', 'pipeline'], events: ['OUTCOME_RESOLVED'] },
  ],
});
```

`from`/`to` are actor keys (`to` accepts one key or an array for fan-out);
`events` filters by type (omit for all events from `from`). This is the preferred
path; `system.subscribe(...)` remains the imperative escape hatch for dynamic
wiring.

## See also

- [Your first actor](/getting-started/your-first-actor) — where `emit` is
  introduced.
