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
  commands: ({ actor }) => ({
    acceptFork: () => actor.send({ type: 'ACCEPT_FORK' }),
    selectFork: () => actor.send({ type: 'SELECT_FORK' }),
  }),
});

registerCompare('compare-view', (props) => /* render */);
```

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
- Put commands **inside** the `commands: ({ actor }) => ...` callback using
  `actor.send` / `actor.ask`. Each command is a plain function — no wrapper
  helper.
- Don't import runtime source-handle generics or custom runtime interfaces into
  UI code. Domain protocol types stay at the actor/domain boundary.

## Local vs gateway

For a browser-local runtime, get sources from `startRuntime(...)`.
For a server-owned runtime, point the source at the gateway URL
(`{ gateway: { url } }`) — the UI code is identical either way.
