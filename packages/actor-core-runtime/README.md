# @actor-web/runtime

> **Pure actor model runtime for JavaScript/TypeScript** — location-transparent actors across local and directly connected runtime nodes, supervision trees, and message-only communication, inspired by Erlang/OTP. Dynamic membership and production multi-machine transport remain roadmap work; see the [external transport status](https://github.com/0xjcf/actor-web/blob/main/docs/spikes/actor-web-external-transport-design.md).

**📚 Documentation: [0xjcf.github.io/actor-web](https://0xjcf.github.io/actor-web/)**

## Install

```bash
npm install @actor-web/runtime
```

## Quick start

```typescript
import { createActorSystem, defineBehavior } from '@actor-web/runtime';

const counter = defineBehavior<{ type: 'INCREMENT' | 'GET_COUNT' }>()
  .withContext({ count: 0 })
  .onMessage(({ message, actor }) => {
    const { count } = actor.getSnapshot().context;

    switch (message.type) {
      case 'INCREMENT':
        return {
          context: { count: count + 1 },
          emit: [{ type: 'COUNT_CHANGED', newValue: count + 1 }],
        };
      case 'GET_COUNT':
        return { reply: { count } };
    }
  });
// .build() is optional — the framework builds the behavior when you spawn it

const system = await createActorSystem({ nodeAddress: 'localhost:0' });
await system.start();

const ref = await system.spawn(counter, { id: 'counter-1' });
await ref.send({ type: 'INCREMENT' });
const { count } = await ref.ask({ type: 'GET_COUNT' });
```

For multi-actor applications, declare a topology and let the runtime own
placement, lifecycle, supervision, and event wiring — see
[Topology & local runtime](https://0xjcf.github.io/actor-web/getting-started/topology-and-runtime).

## Entry points

| Import | Use for |
| --- | --- |
| `@actor-web/runtime` | `defineBehavior`, `createActorSystem`, message-plan types, testing hooks |
| `@actor-web/runtime/topology` | `defineActorWebTopology`, `actor`, `node`, `supervisor`, `tool` — declarative, import-safe topology definitions |
| `@actor-web/runtime/node` | `serveNode`, `serveActorWebHttp` — host a topology node in Node.js with WebSocket transport and gateway |
| `@actor-web/runtime/browser` | `startActorWebNode`, `createActorWebClient`, `createActorWebReadModelClient` — browser/worker nodes and gateway clients |

## What you get

- **Unified behavior builder** — one `defineBehavior()` API for stateless,
  context-based, and XState-machine actors, with full type inference from
  message unions through to UI sources.
- **OTP-style handler returns** — `{ context, reply, emit }`: update state,
  answer an `ask`, broadcast domain events to subscribers.
- **Topology-declared runtime** — declare nodes, actors, supervisors, and
  inter-actor `subscriptions` once; the runtime wires them on every start.
- **Supervision trees** — `one-for-one` / `one-for-all` / `rest-for-one` /
  `escalate` strategies with bounded restart policies ("let it crash").
- **Bounded mailboxes** — FIFO per-actor processing with configurable
  backpressure (drop, park, or fail on overflow).
- **Tool ports** — actors declare the capabilities they need; concrete
  adapters are injected at the runtime boundary via a per-actor allow-list,
  keeping behavior logic free of direct I/O.
- **Transports & gateway** — WebSocket transports for Node and browser nodes,
  plus a projection gateway for UI read models and commands.
- **Test utilities** — `system.enableTestMode()`, `system.flush()`, and
  event-collector actors for deterministic tests without timing hacks.

## Delivery semantics (read this)

Message delivery is **at-most-once**: a send enqueues to the target mailbox
once and is never retried or acknowledged by the runtime. Per-actor ordering
is FIFO. For request/response confirmation use `ask` with a timeout; for
stronger guarantees build an application-level acknowledgement protocol.
Actor restarts begin from the behavior's initial context — durable state
belongs in external stores, re-derived in `onStart`.

## Part of Actor-Web

This package is the runtime for the
[Actor-Web framework](https://github.com/0xjcf/actor-web). Companion packages:

- [`@actor-web/testing`](https://www.npmjs.com/package/@actor-web/testing) —
  machine analysis and test helpers.

## License

MIT
