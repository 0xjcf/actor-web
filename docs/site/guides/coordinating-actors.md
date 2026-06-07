---
title: Coordinating actors
description: Make actors react to each other with emit and subscriptions — choreography over orchestration.
---

# Coordinating actors

When one actor's outcome should drive others, don't reach across a UI or a shell
to wire them together. Let the producer **emit** a fact and let consumers
**subscribe** — coordination stays inside the actor system.

## 1. Emit the fact

The producer announces what happened; it doesn't know or care who listens:

```ts
// inside compare's resolving transition
return {
  context: next,
  emit: [{ type: 'OUTCOME_RESOLVED', outcome: 'merged' }],
};
```

## 2. Wire the listeners

Register the consumers against the producer's events:

```ts
await system.subscribe(compareRef, {
  subscriber: pipelineRef,
  events: ['OUTCOME_RESOLVED'],
});
await system.subscribe(compareRef, {
  subscriber: actorSystemRef,
  events: ['OUTCOME_RESOLVED'],
});
```

Emitted events land in each subscriber's mailbox as ordinary messages, so each
consumer just handles `OUTCOME_RESOLVED` and decides its own reaction.

## Choreography vs orchestration

- **Choreography** (above) — each consumer reacts on its own. Maximally
  decoupled; the producer is ignorant of its consumers. Best when each reaction
  is independent.
- **Orchestration** — a dedicated coordinator actor subscribes and *tells* others
  what to do (via a [`MessagePlan`](/concepts/messages)). Centralizes a
  cross-cutting rule at the cost of a coordinator that knows the participants.

Both are built from the same `emit` + subscription primitives.

## Keep the decision pure

Whichever you pick, keep the *decision* a pure function of the event and push
only the *dispatch* into the handler:

```ts
function planReaction(outcome: CompareOutcome): Command[] { /* ... */ }
```

A pure `planReaction` is unit-testable with no runtime — feed an outcome, assert
the commands. This is the functional-core / imperative-shell split applied to
coordination.

## See also

- [Subscriptions & events](/concepts/subscriptions-and-events)
- [Messages](/concepts/messages)
