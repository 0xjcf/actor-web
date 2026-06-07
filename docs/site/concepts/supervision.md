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

A per-actor policy bounds restarts so a crash-loop can't spin forever:

```ts
actor({
  id: 'pipeline',
  node: 'local',
  behavior: createPipeline,
  supervision: { strategy: 'restart', maxRestarts: 3, withinMs: 60_000 },
});
```

If an actor exceeds `maxRestarts` within `withinMs`, the supervisor stops
restarting and escalates — the signal that something is genuinely wrong rather
than transient.

## What survives a restart

A restarted actor starts from its initial context (or its last persisted state
where configured). Subscriptions registered against a restarted actor are
preserved when it respawns with the same id. A full *system* restart, by
contrast, starts fresh — durable state belongs in adapters/stores, not actor
memory.

## Why this beats defensive coding

Centralizing recovery in supervisors keeps behaviors focused on the happy path
and makes failure modes explicit and testable, instead of scattered across
ad-hoc error handling.
