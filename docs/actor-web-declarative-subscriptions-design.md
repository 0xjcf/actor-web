# Actor-Web Declarative Subscriptions Design

## Summary

Actor-Web should let one actor react to another actor's emitted events through
**topology-declared subscriptions**, not through external shell code that
subscribes to snapshots and re-dispatches commands.

The canonical reaction primitive already exists: a handler returns
`{ emit: [...] }`, and the runtime enqueues those events directly into the
mailbox of any registered subscriber actor
(`emitEventToSubscribers`, `actor-system-impl.ts:2408`). What is missing is an
ergonomic, durable, type-checked way to *declare who listens to whom*. Today the
only path is the imperative, singular `system.subscribe(publisher, { subscriber,
events })` (`actor-system.ts:413`), which is under-documented, lost on system
restart, silently non-idempotent, and repetitive when fanning one event out to
several actors.

This design adds:

1. A declarative `subscriptions` block on `defineActorWebTopology`, wired and
   torn down by the runtime.
2. A batch `subscribers: ActorRef[]` overload on `system.subscribe` as the
   imperative escape hatch under the same machinery.
3. Event-type checking derived from the publisher's emitted-event union.

It also removes the unused `EventBrokerActor`, locking `AutoPublishingRegistry`
as the single, canonical pub/sub mechanism.

`fas-studio` (with `ignite-element`) is the live proving ground: clicking
*Accept Fork* in `compare-view` should advance the pipeline and activate the
engineer with **zero UI orchestration**.

## Background and motivation

The triggering case is FAS Studio's `wireFasCoordinator` — a shell function that
`compare.subscribe(...)`s to snapshots, re-derives a view on every tick,
hand-rolls edge detection with a `reacted` boolean, and `send`s commands to
`pipeline` and `actorSystem`. That shape is wrong on this platform's own terms
(it mixes a pure decision with I/O in the shell, contrary to Functional Core /
Imperative Shell) and it bypasses the actor model entirely.

`defineActor` already supports OTP-style reaction. A handler can return a
`MessagePlan` of directed `tell`s (`message-plan.ts:111`), or — better for
decoupling — `emit` a domain event that subscriber actors receive as a normal
mailbox message (`actor-system-impl.ts:2424`: "events are just messages...
direct enqueue to mailbox"). The producer needs no references to its consumers;
the wiring lives outside the producer.

The remaining friction is entirely in *declaring the wiring*.

## Decisions (locked)

- **Subscription API**: declarative topology `subscriptions` **and** a batch
  `subscribers[]` overload on `system.subscribe`.
- **EventBrokerActor**: delete it. `AutoPublishingRegistry` is canonical.
- **Process**: design doc first (this document), then FAS planning. No code yet.

## Current state (verified)

| Fact | Evidence |
|---|---|
| `emit` routes via `AutoPublishingRegistry`, direct mailbox enqueue, single-node | `actor-system-impl.ts:2408-2463` |
| `system.subscribe(publisher, { subscriber, events? })` is singular, async (no I/O), returns async unsubscribe | `actor-system.ts:413`, impl `actor-system-impl.ts:3827` |
| Registry keyed by `publisherId` → `subscribers` map keyed by `subscriberId`; per-subscriber `eventTypes[]` filter | `auto-publishing.ts:44,51,231` |
| Re-subscribing the same (publisher, subscriber) **overwrites** — no dedup | `auto-publishing.ts:231` |
| `events: []` means "all events" | `auto-publishing.ts:298-303` |
| **No wildcard support** — exact event-type match only | `auto-publishing-actual.test.ts:207-221` |
| Subscriptions survive supervised single-actor **restart** (same id) | `actor-system-impl.ts:3650-3654` |
| Subscriptions are **lost on system restart** (in-memory registry) | `actor-system-impl.ts:355,380` |
| `analyzeActorBehavior` is conservative: any `onMessage` actor "might emit"; types not introspected | `auto-publishing.ts:123-147` |
| `EventBrokerActor` (topics + wildcards + cross-node design) is **never spawned, zero tests** | `event-broker-actor.ts`; `getEventBrokerAddress()` returns `undefined` |
| Declarative/batch subscriptions are an **open question** in the topology DX doc | `actor-web-topology-source-dx-design.md:673-694` |
| `emit` reaches inter-actor subscribers **and** UI `subscribeEvent` off the same stream | `integration/ignite-element-bridge.ts:213-226` |
| `ignite-element` re-renders on snapshots; events require explicit `subscribeEvent` | `integration/ignite-element-bridge.ts`; FAS `compare-view.tsx` |
| FAS local runtime exposes `.system` via `runtime.nodes.local.system`; refs via `runtime.requireActor(key)` | `start-actor-web-node.ts:76`, `actor-web-client.ts:163-185` |

## Goals

- Let an actor react to another actor's events without shell subscribers, edge
  flags, or peer-ref injection into the producer.
- Make subscriptions **declarative, durable across restart, and idempotent** by
  construction.
- Type-check subscription `from`/`to` against real actor ids and `events`
  against the publisher's emitted-event union.
- Reduce the canonical pub/sub surface to one mechanism.

## Non-goals

- No new delivery guarantees (ordering/backpressure/at-least-once stay as-is).
- No topics or wildcard patterns in this iteration (exact event-type match is
  sufficient for the FAS choreography). Revisit if/when topics are needed.
- No cross-node subscription semantics beyond what the registry already does;
  the declarative form compiles down to existing single-node wiring.

## Proposed API

### 1. Declarative `subscriptions` in the topology

```ts
defineActorWebTopology({
  contractVersion: "0.1.0",
  nodes: { local: node(FAS_NODE) },
  actors: { compare, pipeline, actorSystem, decisions },
  subscriptions: [
    { from: "compare", to: ["actorSystem", "pipeline"], events: ["OUTCOME_RESOLVED"] },
  ],
});
```

- `from`: a single publisher actor id (key of `actors`).
- `to`: one id or an array of subscriber actor ids.
- `events`: event-type strings; omitted/empty means "all events from `from`".
- All three are type-checked: `from`/`to` against `keyof actors`, `events`
  against the union of the publisher behavior's emitted event types (see
  *Typed events* below).

The runtime wires every declared subscription during start (after the referenced
actors are spawned) and removes them during `stop()`. This directly closes the
**system-restart** gap: subscriptions are re-established on every start because
they are part of the topology, not one-shot startup code.

### 2. Batch `subscribers[]` overload on `system.subscribe`

The imperative escape hatch for dynamic wiring, sharing the registry path:

```ts
// existing (kept)
subscribe(publisher, { subscriber: a, events });
// new overload
subscribe(publisher, { subscribers: [a, b], events });
```

`addSubscriber` already loops per subscriber (`auto-publishing.ts:231`), so the
overload is a thin adapter. This removes the call-site redundancy in the
original motivating example.

### 3. Typed events

`events` is currently `string[]` with no relationship to what the publisher can
emit. Derive the allowed set from the publisher behavior's emitted-event union
(the `TEmitted` phantom already threaded through `defineActor` /
`UnifiedActorBuilder`, `unified-actor-builder.ts:314-317`). In the declarative
form this is checkable at the topology call site; in the imperative form it
narrows `TEventType`.

### Idempotency

Declarative subscriptions are defined once, so the overwrite-on-resubscribe
footgun (`auto-publishing.ts:231`) cannot fire through the topology path. The
imperative path keeps current semantics; document the overwrite explicitly.

## EventBroker deletion

`EventBrokerActor` (`actors/event-broker-actor.ts`, `SYSTEM_EVENT_BROKER_ADDRESS`)
is specification-only: never spawned, no tests, no activation path. Keeping it as
undocumented dead code misleads anyone searching for "the broker." Delete the
actor, its address constant, and `getEventBrokerAddress()`
(`actor-system-impl.ts:3812`). Record in the doc that `AutoPublishingRegistry`
is canonical and that topics/wildcards are deliberately out of scope until a real
requirement appears.

> Risk check before deletion: confirm no transport/discovery code references
> `SYSTEM_EVENT_BROKER_ADDRESS` and no public export re-exports the actor. The
> research found none, but the FAS plan must grep-verify.

## Reaction logic: choreography, kept pure

With `emit` + subscriptions, the R1–R4 reaction is **choreography** — each
consumer decides its own response to `OUTCOME_RESOLVED`:

- `pipeline`: on `OUTCOME_RESOLVED`, `ADVANCE` unless `outcome === "sent-to-reviewer"`.
- `actorSystem`: on `OUTCOME_RESOLVED`, `ACTIVATE` engineer (or reviewer when
  `sent-to-reviewer`).

Keep the decision pure and shared: a `planCompareReaction(outcome)` helper in the
functional core that each consumer calls and filters to its own slice. This
preserves Functional Core / Imperative Shell — the consumers' handlers stay thin,
the matrix stays testable without a runtime.

Trade-off acknowledged: choreography means no single place states the whole R1–R4
table. That is acceptable for four aggregates; if more producers need the same
fan-out later, promote the decision into a dedicated coordinator actor (same
`emit`/subscription mechanics).

## Contract impact

`OUTCOME_RESOLVED` becomes part of `compare`'s **public** event contract: it
reaches inter-actor subscribers *and* UI `subscribeEvent` consumers off the same
stream (`integration/ignite-element-bridge.ts:213`). This is fine but
intentional — name inter-actor events as first-class domain facts, not private
nudges, and include them in the contract version.

## fas-studio + ignite-element validation plan

`fas-studio` is single-node with four aggregates already bound to UI elements via
`igniteCore` (`app-state.ts`, `compare-view.tsx`). Because `ignite-element`
re-renders on snapshots, the cascade is visible without any UI change.

1. `compare` emits `OUTCOME_RESOLVED` on its resolving transitions
   (`ACCEPT_FORK`, `KEEP_ORIGINAL`, `MERGE`, `SEND_TO_REVIEWER`) — `emit` lives
   inside `ActorHandlerResult`, so existing `reply` is preserved.
2. Declare the subscription in `fasTopology`:
   `{ from: "compare", to: ["actorSystem", "pipeline"], events: ["OUTCOME_RESOLVED"] }`.
3. `pipeline` and `actorSystem` gain an `OUTCOME_RESOLVED` handler that calls the
   shared `planCompareReaction` and transitions accordingly. Confirm the
   respective FSMs permit the resulting transitions.
4. **Manual proof**: click *Accept Fork* → `actor-rail` shows engineer active and
   `pipeline-sidebar` advances, with no command wiring in the UI.
5. **Automated proof** (first cross-actor test in the repo): in `runtime.test.ts`,
   `compare.ask({ type: "ACCEPT_FORK" })` ⇒ assert
   `pipeline.snapshot().value === "implement"` and `actorSystem` engineer active.
6. Delete `wireFasCoordinator` and its shell teardown.

System handle access for any imperative wiring needed during the spike:
`runtime.nodes.local.system.subscribe(...)` with refs from
`runtime.requireActor("pipeline")`.

## Gap backlog

1. **Batch fan-out** — `subscribers[]` overload. Small.
2. **Declarative `subscriptions`** — DX + restart durability. Primary.
3. **Typed events** — derive from publisher emitted-event union. Medium.
4. **Canonical mechanism** — delete `EventBrokerActor`. Small, but grep-verify.
5. **Dedup/idempotency** — free via declarative; document imperative overwrite.
6. **Wildcards/topics** — deferred; out of scope.

## FAS task breakdown (proposed sequencing)

Each is a separate task/commit; runs through the FAS pipeline (plan → verify →
review).

**actor-web (framework):**

- T1. Add `subscribers[]` overload to `system.subscribe` + tests
  (`auto-publishing`, `event-emission`). Lowest risk, no topology change.
- T2. Add `subscriptions` to `ActorWebTopologyInput` and
  `defineActorWebTopology`; wire on node start, unwire on `stop()`; type-check
  `from`/`to` against actor ids. Tests for wiring + restart durability.
- T3. Type `events` against the publisher emitted-event union.
- T4. Delete `EventBrokerActor`, `SYSTEM_EVENT_BROKER_ADDRESS`,
  `getEventBrokerAddress()`; grep-verify no references; update docs to name
  `AutoPublishingRegistry` canonical.

**fas-studio (adoption / live test):**

- T5. Core: `planCompareReaction(outcome): Command[]` pure helper + unit tests.
- T6. `compare` emits `OUTCOME_RESOLVED`; `pipeline`/`actorSystem` handle it.
- T7. Declare the subscription in `fasTopology`; delete `wireFasCoordinator`.
- T8. Cross-actor cascade test in `runtime.test.ts`; manual ignite-element proof.

T1 unblocks an early fas-studio spike (T5–T6 + imperative wiring) before T2 lands;
migrate to the declarative form once T2 is merged.

## Open questions

- **Cross-node declarative subscriptions**: the registry direct-enqueue path is
  single-node; remote events use a separate transport path
  (`__runtime.remote.event.subscribe`). Should declared `subscriptions` resolve
  transparently across nodes, or is single-node the documented scope for v1?
- **`subscriptions` placement**: top-level topology field vs. per-actor
  `subscribesTo` on the actor definition. Top-level keeps the wiring graph in one
  place; per-actor co-locates with the consumer. Leaning top-level.
- **`async` on `subscribe`**: it does no I/O today. Keep async for future
  cross-node acknowledgement, or simplify? Keep for now (no churn).
