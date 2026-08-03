# @actor-web/cli

> **Status: v0 — in-process runtime host.** A terminal console over the
> actor-web runtime. No network and no LLM yet; remote hosting arrives in v2.
> Design: [`docs/actor-web-cli-runtime-host-design.md`](../../docs/actor-web-cli-runtime-host-design.md).

For the CLI v3 FAS dogfood path, the consumer-facing conformance target lives in
`@actor-web/testing`, not in the runtime host package itself:

- `getControlPlaneConformanceFixture()`
- `listControlPlaneConformanceScenarios()`
- `assertControlPlaneConformanceFixture()`

That neutral fixture fixes the proof obligations for `success`, `rejection`,
`interruption_resume`, `duplicate_suppression`, `stale_projection`, and
`operator_reconciliation` without embedding FAS-specific runtime vocabulary into
Actor-Web.

Versioning for that dogfood contract is split deliberately:

- `packageVersion`: npm/package release of `@actor-web/cli`, `@actor-web/testing`,
  or the consumer adapter;
- `schemaVersion`: serialized gateway trace/watch payload shape;
- `contractVersion`: required neutral conformance scenarios and receipt
  expectations exposed to consumers.

Fail closed when:

- the received `schemaVersion` is unsupported;
- the required `contractVersion` is unsupported;
- a required scenario name is unknown; or
- a required receipt expectation is unknown.

Preserve canonical gateway provenance in conformance runs:

- use authenticated remote `watchTrace` projections as the primary evidence;
- keep runtime `receiptKind: 'projection'` with `status: 'stale_projection'`
  intact rather than flattening it into a made-up receipt kind;
- treat local actor events and direct host reads as supplementary state
  correlation only.

Authenticated local dogfood commands:

```bash
pnpm --filter @actor-web/testing build
pnpm --filter @actor-web/cli exec vitest run src/host/runtime-host-control-plane-conformance.test.ts
```

That conformance test is expected to serve an authenticated gateway, connect a
remote runtime host with token auth, subscribe through `watchTrace`, and
re-establish the served host plus remote trace watch before checkpoint
import/resume after a restart.

## What it does

`serve` boots an in-process runtime node from a topology module and opens an
operator console:

```bash
actor-web serve ./topology.mjs            # interactive console
actor-web serve ./topology.mjs --node worker
actor-web serve ./topology.mjs --exec 'ls; send counter {"type":"INCREMENT"}; ask counter {"type":"GET_COUNT"}'
```

Console verbs:

```text
ls                              list actors (key, origin, status, path)
spawn <file> <id>               spawn a behavior module as a new actor
send <target> <json>            fire-and-forget message
ask <target> <json> [timeout]   request/response (timeout in ms)
watch <target>                  stream emitted events to the console
watch-trace <target>            stream gateway trace projections (remote only)
unwatch <target>                stop streaming
unwatch-trace <target>          stop trace streaming
help / exit
```

Targets resolve by registry key (topology key or spawned id) or full
`actor://node/type/id` path.

## Topology and behavior modules

A topology module default-exports a `defineActorWebTopology(...)` value; a
behavior module default-exports a `defineBehavior()` value (built or builder):

```js
// topology.mjs
import { actor, defineActorWebTopology, defineBehavior, node } from '@actor-web/runtime';

const counter = defineBehavior()
  .withContext({ count: 0 })
  .onMessage(({ message, context }) => {
    if (message.type === 'INCREMENT') {
      const count = context.count + 1;
      return { context: { count }, emit: [{ type: 'COUNT_CHANGED', count }] };
    }
    if (message.type === 'GET_COUNT') {
      return { reply: { count: context.count } };
    }
    return {};
  });

export default defineActorWebTopology({
  nodes: { local: node('local') },
  actors: { counter: actor({ id: 'counter', node: 'local', behavior: counter }) },
});
```

TypeScript modules work when the CLI runs under a TS loader (e.g. `pnpm dev` /
tsx); otherwise point at compiled `.js`/`.mjs`.

## Programmatic API

The host is exported for tests and embedders:

```ts
import { createRuntimeHost, executeCommand } from '@actor-web/cli';

const started = await createRuntimeHost(topology);
if (started.ok) {
  const host = started.value;
  await host.send('counter', '{"type":"INCREMENT"}');
  const reply = await host.ask('counter', '{"type":"GET_COUNT"}');
  await host.stop();
}
```

Operations return facts (`{ ok: true, value } | { ok: false, error }`) instead
of throwing for expected failures.

## What was removed

The previous git-workflow surface (`aw` save/ship/sync/worktrees/agent
coordination, plus a stubbed "git actor") was removed in v0's ground-clearing.
It duplicated FAS and plain git. The reusable state-machine analysis utilities
continue to live in `@actor-web/testing`.

## Development

```bash
pnpm --filter @actor-web/cli dev serve ./topology.mjs   # run via tsx
pnpm --filter @actor-web/cli test                       # vitest
pnpm --filter @actor-web/cli build                      # tsc
```
