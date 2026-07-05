---
title: Ignite Element integration
description: Drive a UI from an Actor-Web actor with igniteCore — read-model sources and command binding.
---

# Ignite Element integration

[ignite-element](https://github.com/0xjcf/ignite-element) renders web components
from a source. Actor-Web actors expose exactly the source shapes `igniteCore`
expects, so a UI consumes an actor with no bridging glue.

The boundary is clean: **Actor-Web owns** topology, runtime lifecycle, source
handles, and command transport. **Ignite owns** projection and UI command
binding.

## The pattern

```ts
import { igniteCore } from 'ignite-element/actor-web';

const registerCompare = igniteCore({
  // a topology-owned read/write source for one actor
  source: topology.actors.compare.source({ gateway: { url } }),
  // project snapshot context into UI state
  view: ({ context }) => ({ outcome: context.outcome, selected: context.selected }),
  // bind UI actions to actor messages
  commands: ({ actor, command }) => ({
    acceptFork: command(() => actor.send({ type: 'ACCEPT_FORK' })),
    selectFork: command(() => actor.send({ type: 'SELECT_FORK' })),
  }),
});

registerCompare('compare-view', (props) => /* render */);
```

## Source factories

Each topology actor selects the Actor-Web actor identity first:

```ts
topology.actors.compare.readModel({ gateway: { url } });
```

The argument is `ActorWebSourceOptions`: gateway and client transport config,
not actor identity.

```ts
type ActorWebSourceOptions = {
  gateway: {
    url: string;
    scope?: { kind?: string; params?: Record<string, string> };
    auth?: RuntimeGatewayAuthProvider;
  };
  streamId?: string;
  createSocket?: (url: string) => ActorWebGatewaySocket;
  clientVersion?: string;
};
```

Use `gateway.scope.params` for tenant, document, or entity filters. Override
`gateway.scope.kind` only when the public gateway projection is intentionally
different from the topology actor key.

## Ignite mapping

Ignite takes one Actor-Web handle as `source`. `commandSource(...)` is an
Actor-Web factory name, not a second `igniteCore` config key.

| Actor-Web factory | Capability | Pass to `igniteCore` |
| --- | --- | --- |
| `readModel(opts)` | snapshots, emitted events, transport status | `source` |
| `source(opts)` | read model plus `send` / `ask` | `source` |
| `commandSource(opts)` | command-capable source optimized for command-only gateway subscription | `source` |
| `sourceHandle(opts)` | `{ source, commandSource, stop }` for hosts that want explicit read/write handles | pass `handle.commandSource` when Ignite commands; pass `handle.source` for read-only projection |
| `readModelHandle(opts)` | `{ source, stop }` for explicit read-model lifecycle ownership | pass `handle.source` |

For normal Ignite components, prefer passing `readModel(...)`, `source(...)`, or
`commandSource(...)` directly. Use handle factories when the host owns lifecycle
outside Ignite and needs a single `stop()` for cleanup.

## Headless runtime

The value returned by `igniteCore(...)` is also a headless runtime. You can
execute named commands, inspect projected view state, subscribe to actor-emitted
runtime events, and record deterministic stories without mounting a custom
element:

```ts
const result = await registerCompare.execute('acceptFork');
const snapshot = registerCompare.getSnapshot();
const view = registerCompare.getView();

const events = registerCompare.on('OUTCOME_RESOLVED', (event) => {
  console.log(event.detail);
});

const views = registerCompare.watchView((nextView) => {
  console.log(nextView.outcome);
});

events.unsubscribe();
views.unsubscribe();
```

See [Headless agent runtime](/guides/agent-runtime) for the full runtime surface
and Actor-Web boundary rules.

## Read-model vs command source

Pick the narrowest capability:

- **`readModel(opts)`** — display-only components. Snapshots + events, no
  `send`/`ask`.
- **`source(opts)`** — components that render state and intentionally drive the
  actor.
- **`commandSource(opts)`** — command-only hosts that do not need projection
  replay.

This is CQRS at the UI edge: the ability to command is visible in the code, not
granted to every projection by default. See
[Sources & the gateway](/concepts/sources-and-gateway).

## Conventions

- Keep `view` inline for small mappings: `({ context }) => ({ ... })`. Reach for
  a projection helper only when the view composes multiple slices or
  loading/error rules.
- Put commands **inside** the `commands: ({ actor, command }) => ...` callback
  using `actor.send` / `actor.ask`. Each command is a named product verb; wrap it
  in `command(...)` when you want schema metadata for headless agents or
  operator tooling.
- Don't import runtime source-handle generics or custom runtime interfaces into
  UI code. Domain protocol types stay at the actor/domain boundary.

## Local vs gateway

For a browser-local runtime, get sources from `startRuntime(...)`.
For a server-owned runtime, point the source at the gateway URL
(`{ gateway: { url } }`) — the UI code is identical either way.
