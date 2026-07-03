---
title: Sources & the gateway
description: How a UI consumes actor state through read-model and command sources.
---

# Sources & the gateway

A **source** is how the outside world — usually a UI — observes and drives an
actor. Actor-Web separates the two concerns deliberately, following CQRS and
least-privilege: reading is not the same capability as commanding.

## Read-model vs command sources

Each actor in a topology exposes source factories:

- **`readModel(opts)`** — projection only: `snapshot()`, `subscribe(listener)`,
  `subscribeEvent(listener)`, transport status. No `send`/`ask`.
- **`source(opts)`** — the unified surface (read + command) for simple cases.
- **`commandSource(opts)`** — the command-only surface for hosts that need
  `send(message)` / `ask(message)` without projection replay.
- **`sourceHandle(opts)`** — a paired read-model + command source for hosts that
  want both explicitly.

```ts
const view = topology.actors.compare.readModel({ gateway: { url } });
const ui   = topology.actors.compare.source({ gateway: { url } });
const cmd  = topology.actors.compare.commandSource({ gateway: { url } });
```

Prefer `readModel` for components that only display state, and reach for a
unified or command-only source only where a component intentionally drives the
actor — so the ability to send commands is visible in the code, not granted by
default.

## The gateway

The **gateway** is the projection/control edge between a runtime and its
consumers (a browser, a dashboard). It streams snapshots and emitted events over
a WebSocket, detects sequence gaps, and resyncs from a bounded replay tail. It is
*not* the inter-node [transport](/concepts/transport) — it's the consumer-facing
boundary.

`opts` is gateway/transport configuration (`{ gateway: { url, scope?, auth? } }`,
`streamId?`, `createSocket?`), not actor identity — the actor is already fixed by
which factory you called.

## Consuming from a UI

These sources are shaped to plug straight into
[ignite-element](https://github.com/0xjcf/ignite-element)'s `igniteCore`:

```ts
igniteCore({
  source: topology.actors.compare.source({ gateway: { url } }),
  view: ({ context }) => ({ outcome: context.outcome }),
  commands: ({ actor, command }) => ({
    acceptFork: command(() => actor.send({ type: 'ACCEPT_FORK' })),
  }),
});
```

The view projects snapshot context into UI state; commands bind to `actor.send`
/ `actor.ask`. Domain protocol types stay at the actor boundary — the UI never
imports runtime internals.
