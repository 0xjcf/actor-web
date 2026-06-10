# @actor-web/cli

> **Status: v0 — in-process runtime host.** A terminal console over the
> actor-web runtime. No network and no LLM yet; remote hosting arrives in v2.
> Design: [`docs/actor-web-cli-runtime-host-design.md`](../../docs/actor-web-cli-runtime-host-design.md).

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
unwatch <target>                stop streaming
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
