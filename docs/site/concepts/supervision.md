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

A supervisor groups child actors and applies a strategy when one fails:

- **`one-for-one`** — restart only the failed child.
- **`one-for-all`** — restart all children of the supervisor.
- **`rest-for-one`** — restart the failed child and the ones started after it.
- **`escalate`** — propagate the failure up to the parent supervisor.

```ts
supervisor({ node: 'local', strategy: 'one-for-one', children: ['pipeline', 'compare'] })
```

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
- **`escalate`** — stop the actor and emit a distinct `actorEscalated` system
  event. Handing the failure to a `supervisor()` parent (tree propagation) is
  not wired into the runtime yet; today the escalation event is the signal.

Actors with no policy restart under the system-wide defaults: **3 restarts
within 30 seconds**. `maxRestarts`/`withinMs` override those defaults per
actor — the example above deliberately widens the window to 60 seconds.

## What survives a restart

A restarted actor starts from its initial context. Durable state is not yet a
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
