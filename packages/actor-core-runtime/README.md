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

<!-- Public entry points from package.json exports; keep import names and responsibilities aligned. -->

| Import | Use for |
| --- | --- |
| `@actor-web/runtime` | `defineBehavior`, `createActorSystem`, message-plan types, testing hooks |
| `@actor-web/runtime/source` | Platform-neutral source contracts and `createActorSource`, `createActorCommandSource`, `createActorReadModelSource` for caller-owned actor refs |
| `@actor-web/runtime/topology` | `defineTopology`, `actor`, `node`, `supervisor`, `tool` — declarative, import-safe topology definitions |
| `@actor-web/runtime/node` | `serveNode`, `serveHttp` — host a topology node in Node.js with WebSocket transport and gateway |
| `@actor-web/runtime/browser` | `startNode`, `createClient`, `createReadModelClient` — browser/worker nodes and gateway clients |
| `@actor-web/runtime/definition` | Pure, bounded validation of a limited XState-v5 JSON definition profile; no runtime startup |

## Declarative definition validation

<!-- Public contract and supported profile from src/definition.ts. -->

`validateMachineDefinition(source, options)` accepts **JSON text**, not an
arbitrary JavaScript object. It returns a deeply frozen success or first-failure
result, tagged `xstate-v5-flat-v1`. The optional entry has no runtime imports and
does not construct/start an actor, evaluate actions/guards, load modules or call
tools. Existing `withMachine()` and `system.spawn()` contracts are unchanged.

```typescript
import { validateMachineDefinition } from '@actor-web/runtime/definition';

const result = validateMachineDefinition(
  JSON.stringify({
    id: 'inspection',
    initial: 'idle',
    states: {
      idle: {
        on: {
          INSPECT: {
            target: 'complete',
            actions: { type: 'record', params: { label: 'inspection requested' } },
          },
        },
      },
      complete: { type: 'final' },
    },
  }),
  {
    // Example caller-selected validation budgets, not worker execution grants.
    limits: { maxInputBytes: 16_384, maxDepth: 16, maxStates: 16, maxTransitions: 32 },
    bindings: { actions: { record: { label: 'string' } }, guards: {} },
  }
);

if (!result.ok) {
  console.log(result.issue.code, result.issue.path, result.issue.message);
}
```

### Supported profile

- Root fields: required `id`, `initial`, nonempty `states`, and optional literal
  object `context`. Context may contain nested JSON data with finite numbers.
- Flat atomic/final states; optional `entry`/`exit` named actions and `on` event
  maps. Final states cannot declare `on`.
- Exact external event names and sibling-state targets. A transition is a target
  string or an object with `target`, `guard`, and/or `actions`; at least a target
  or actions is required. Nonempty ordered transition alternatives are supported.
- Actions are one named reference or a nonempty array. A guard is one named
  reference. References are strings or `{ type, params? }`, not code.
- IDs, state names and binding/parameter names match
  `[A-Za-z][A-Za-z0-9_-]*`. Event names additionally allow `.`, `:` and `-`, but
  not wildcards or the reserved `xstate.` prefix.
- Binding manifests are **trusted data-only configuration**, not user-generated
  grants or actual implementations. Each binding declares exact required
  parameter fields of type `string`, `boolean`, finite `number`, or safe
  `integer`. `{}` declares no parameters; omitted params or an empty object
  work for such a binding. Extra/missing fields refuse. This is not JSON Schema.

All four limits are explicit positive safe integers. `maxDepth` counts nested
objects/arrays, including the root, and cannot exceed 64. Byte accounting uses
UTF-8; depth is checked before native JSON parsing. State and transition bounds
are inclusive; each alternative counts as a transition. Trusted callers choose
practical byte/state/transition limits and bounded manifests appropriate to their
environment. Input byte/depth bounds also constrain literal data and action lists.

Duplicate decoded JSON keys (including escaped aliases), `__proto__`,
`constructor` and `prototype` keys anywhere in source data, and non-finite
numbers refuse. No coercion or field stripping occurs. Diagnostics are stable
codes with JSON Pointer paths where available; parsing/key-preflight errors use
the empty path and do not echo parser exceptions or source values.

Unknown fields and unsupported structural features return `unsupportedConstruct`;
malformed identifiers and reference shapes return `invalidDefinition`.
Hierarchy, parallel/history states, root transitions, invocations, timers,
eventless transitions, dynamic expressions, built-in action descriptors and
custom function bodies are outside this profile. An unsupported result is not
a claim that the source is invalid in full XState.

### What success does not prove

Success reports `structure` and `bindingManifest` as `passed`, but
`implementationBinding`, `authorization` and `behavior` as `notChecked`. Types
are XState-consumable; returned values are deeply frozen at runtime. A trusted
host may subsequently bind the exact definition to reviewed implementations,
after its own admission and effect checks. Manifest membership alone proves
neither that an implementation exists nor that it is allowed to run.

Product rules (role grants, workspace ownership, SDLC gates, independence and
CRUD policy) belong to the consuming application. Revalidate the exact revision
and current permissions at authoritative admission; browser feedback is not a
grant. Runtime tool/host fences remain necessary during execution.

Behavioral qualification must separately record the exact graph, bindings,
bounded scenarios/properties, assumptions and unchecked cases. This validator
does not prove termination, liveness, business correctness or sandbox isolation.
Even a structurally valid graph can invoke unsafe trusted bindings or repeatedly
receive events. Rejecting eventless transitions does not make arbitrary action
implementations safe; ordinary event-loop timeouts cannot fence synchronous
infinite loops.

The source-only entrypoint observes an existing actor; it does not create a host,
start a transport, or take over actor shutdown. A source subscription's release
ends that observation only. The application still owns the actor and runtime.
Use the platform entrypoints for host construction. This source-only boundary
does not make the root/browser/Node declaration graphs interchangeable.

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
- [`@actor-web/agent`](https://www.npmjs.com/package/@actor-web/agent) — LLM
  tool and agent-loop utilities for runtime hosts.
- [`@actor-web/lattice`](https://www.npmjs.com/package/@actor-web/lattice) —
  artifact and dependency coordination for stigmergic workflows.

## License

MIT
