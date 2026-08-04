# @actor-web/cli

`@actor-web/cli` is the distributed Actor-Web runtime host and remote operator
shell. It packages the v2 distributed runtime-host surface and the v3
authenticated control-plane recovery path without taking ownership of
provider-specific workflow policy.

## What ships

- `actor-web serve <topology>` starts an in-process or distributed host from a
  topology module.
- `actor-web connect <topology> <gateway-url>` attaches a remote operator shell
  to an authenticated gateway.
- The programmatic API exports `createRuntimeHost`, `createRuntimeHostFromFile`,
  `executeCommand`, `splitExecScript`, and the runtime-host types from the
  package root.

## Security defaults

- Gateway and transport listeners stay loopback-only unless you pass an
  explicit unsafe-exposure override.
- Remote shells authenticate at the authoritative gateway; the CLI does not own
  provider policy.
- Checkpoint readiness can be required explicitly and is mandatory for
  non-localhost distributed exposure.
- Command admission belongs at the gateway/runtime boundary, not in downstream
  product adapters.

## Distributed and recovery surface

The shipped console and programmatic API cover:

- host `status` and readiness facts for process, transport, directory, checkpoint
  store, and policy admission;
- `watch-trace` gateway projection and receipt streaming for remote sessions;
- authenticated `send` and `ask` command admission over remote gateways;
- checkpoint-backed interruption, import, resume, and reconciliation flows; and
- graceful shutdown through `flush()` plus `stop()`.

## FAS adapter boundary

Actor-Web owns the provider-neutral operator shell, runtime-host lifecycle,
authenticated gateway connection, and trace/receipt plumbing. FAS-specific
workflow semantics, durable execution policy, and downstream control-plane
adapters stay outside this package.

The neutral consumer-facing conformance contract lives in `@actor-web/testing`.
That package owns the reusable executable control-plane fixture and scenario
expectations; `@actor-web/cli` stays focused on exposing the real host surface
that adapters exercise.

## Compatibility

- Node.js `>=18`
- ESM and CommonJS programmatic imports through the package root export
- Packed artifacts are expected to install outside the monorepo after workspace
  dependencies are rewritten during packing/versioning

## CLI examples

Local host:

```bash
actor-web serve ./topology.mjs --checkpoint-dir ./.actor-web/checkpoints --exec 'status; ls; exit'
```

Distributed host with authenticated remote access:

```bash
actor-web serve ./topology.mjs \
  --gateway \
  --transport \
  --peer worker=ws://127.0.0.1:9001 \
  --connect worker \
  --checkpoint-dir ./.actor-web/checkpoints

actor-web connect ./topology.mjs ws://127.0.0.1:9000 --token gateway-secret --exec 'status; watch-trace controlPlaneSession; exit'
```

## Programmatic API

```ts
import { createRuntimeHost } from '@actor-web/cli';
import { actor, defineActorWebTopology, defineBehavior, node } from '@actor-web/runtime';

const counter = defineBehavior()
  .withContext({ count: 0 })
  .onMessage(({ message, context }) => {
    if (message.type === 'INCREMENT') {
      return { context: { count: context.count + 1 } };
    }
    if (message.type === 'GET_COUNT') {
      return { reply: { count: context.count } };
    }
    return {};
  });

const topology = defineActorWebTopology({
  nodes: { local: node('local') },
  actors: { counter: actor({ id: 'counter', node: 'local', behavior: counter }) },
});

const started = await createRuntimeHost(topology);
if (started.ok) {
  const host = started.value;
  await host.send('counter', '{"type":"INCREMENT"}');
  await host.stop();
}
```

## Removed surface

The old git-workflow console (`save`, `ship`, `sync`, git actor coordination,
and similar commands) is not part of the distributed runtime-host package and
must not appear in packed artifacts.
