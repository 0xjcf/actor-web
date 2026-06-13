---
title: Supervision & fault tolerance
description: Let-it-crash recovery, supervision strategies, and restart policies.
---

# Supervision & fault tolerance

Actor-Web follows Erlang/OTP's **"let it crash"** philosophy: instead of
defensive try/catch everywhere, an actor that hits an unrecoverable state fails
fast, and a **supervisor** decides how to recover. Failures are isolated — they
don't cascade by default.

## Supervisors

A supervisor groups child actors and applies a strategy when one of them
fails and its per-actor policy resolves to a restart:

- **`one-for-one`** (the default) — restart only the failed child.
- **`one-for-all`** — restart all children of the supervisor.
- **`rest-for-one`** — restart the failed child and the children declared
  after it.
- **`escalate`** — do not handle the failure in the group: stop all children
  and emit an `actorEscalated` system event.

```ts
supervisor({ node: 'local', strategy: 'one-for-one', children: ['pipeline', 'compare'] })
```

Supervisor groups are wired into the runtime failure path by the node hosts:
`serveNode` and `startActorWebNode` register the groups a node owns. The
browser-local `startRuntime` client does not register groups yet — per-actor
policies still apply there.

### How a group restart works

When a child's policy resolves to `restart` inside a `one-for-all` or
`rest-for-one` group, the runtime widens the restart to the group:

- Affected members are stopped in **reverse declaration order** and respawned
  in **declaration order** (declaration order is the `children` array).
- One exponential-backoff wait applies per group restart, scaled by the
  failing child's restart history.
- Each stopped member emits a single `actorStopped` event with reason
  `supervisor-group-restart`; each respawn emits `actorRestarted` carrying the
  supervisor key.
- Member mailboxes are destroyed: in-flight messages are dropped (delivery is
  at-most-once) and asks still queued in a destroyed mailbox fail by ask
  timeout. Auto-publishing subscriptions and snapshot listeners survive the
  restart; `subscribeToActorEvents` listeners are dropped — the same contract
  as a single-actor restart.
- Group restarts count only against the **failing child's**
  `maxRestarts`/`withinMs` budget. Siblings restarted as collateral get their
  counters reset.
- Siblings keep processing messages in the brief window between the failure
  and their stop (the backoff blocks only the failing actor's supervision
  turn) — there is no global pause.

If the failing child has exhausted its restart bound, the group gives up: all
children stop (the failing child with reason `max-restarts-exceeded`, siblings
with `supervisor-max-restarts-exceeded`) and one `actorEscalated` event is
emitted with the supervisor key, the failed child, and the reason.

### Group rules

- Trees are **one level deep** — `children` lists actors only; nested
  supervisors are not supported.
- Children must be **co-located** on the supervisor's node;
  `defineActorWebTopology` rejects cross-node children.
- **Parameterized children** (actors whose `id` is a function) spawn on
  demand, so a group cannot know its blast radius statically: they are skipped
  with a warning in `one-for-one` groups (each instance is still covered by
  its per-actor policy) and rejected at host start in `one-for-all`,
  `rest-for-one`, and `escalate` groups.

## Restart policies

A per-actor policy controls what the runtime does when an actor's message
handler throws. Declare it on the topology actor (or pass the same object to
`system.spawn(behavior, { supervision })`):

```ts
actor({
  id: 'pipeline',
  node: 'local',
  behavior: createPipeline,
  supervision: { strategy: 'restart', maxRestarts: 3, withinMs: 60_000 },
});
```

Four strategies are supported:

- **`restart`** (the default) — stop and respawn the actor with exponential
  backoff (1s, doubling per attempt), bounded by `maxRestarts` within
  `withinMs`. Exceeding the bound stops the actor permanently and emits an
  `actorStopped` system event with reason `max-restarts-exceeded`.
- **`resume`** — keep the actor running with its current state. The failed
  message is skipped; the rest of the mailbox is preserved. Emits an
  `actorResumed` system event.
- **`stop`** — stop the actor on the first failure; no restarts. Emits an
  `actorStopped` system event with reason `supervision-stop`.
- **`escalate`** — hand the failure up the chain: actor policy → group
  strategy → node level. Inside a `one-for-all`/`rest-for-one` group, an
  escalating child triggers a group restart bounded by its own
  `maxRestarts`/`withinMs`; with no group (or a `one-for-one` group) the actor
  stops and a distinct `actorEscalated` system event is emitted. The system
  itself never self-terminates on escalation — hosts observe the event via
  `subscribeToSystemEvents` and decide.

Actors with no policy restart under the system-wide defaults: **3 restarts
within 30 seconds**. `maxRestarts`/`withinMs` override those defaults per
actor — the example above deliberately widens the window to 60 seconds.

## What survives a restart

A restarted actor starts from its initial context. Machine-backed actors keep
their state machine across the restart — the machine restarts at its initial
state, not as a plain context actor. Durable state is not yet a
runtime feature — if state must survive restarts, re-derive it from an external
source in `onStart`. Restarting to a known-good initial state is deliberate
("let it crash"): silently resuming the exact state that preceded a crash risks
restarting straight back into the failure.

Subscriptions split by how they were registered: topology-declared
`subscriptions` are durable — the runtime re-wires them from the topology on
every start. Imperative `system.subscribe(...)` registrations survive a
supervised single-actor restart (same id) but are in-memory and lost on a full
*system* restart. Either way, durable state belongs in adapters/stores, not
actor memory.

## Why this beats defensive coding

Centralizing recovery in supervisors keeps behaviors focused on the happy path
and makes failure modes explicit and testable, instead of scattered across
ad-hoc error handling.
