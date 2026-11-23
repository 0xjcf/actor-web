# Agent application DX: learning path

Start with **Actor Basics**, then follow the **SDLC** lessons in order. The
**Transport/UI** examples answer a different question: how to move or project
state without giving the transport or view workflow authority.

## Actor Basics

### Ping/Pong: behaviors only

Ping asks Pong when it receives `START`. Pong replies `PONG` when it receives
`PING`. Both rules live in `defineBehavior`. Spawn the two actors directly,
without a topology or a model.

```ts
import { createActorSystem, defineBehavior } from '@actor-web/runtime';

const system = await createActorSystem({ nodeAddress: 'localhost:0' });
await system.start();

try {
  const pong = await system.spawn(
    defineBehavior<{ type: 'PING' }>().onMessage(() => ({ reply: 'PONG' })),
    { id: 'pong' },
  );
  const ping = await system.spawn(
    defineBehavior<{ type: 'START' }>().onMessage(async () => ({
      reply: await pong.ask<'PONG'>({ type: 'PING' }),
    })),
    { id: 'ping' },
  );
  console.log(await ping.ask<'PONG'>({ type: 'START' })); // PONG
} finally {
  await system.stop();
}
```

The caller starts the exchange; Ping's behavior owns the handoff. A
[topology](../site/getting-started/topology-and-runtime.md) declares where stable
actors start. It does not decide how they respond.

## SDLC

### 1. Parallel SDLC Teams: assignments and orchestration

Run `pnpm examples:dev:local` from Actor-Web and open
[Parallel SDLC Teams](http://127.0.0.1:4173/parallel-sdlc-teams/).

1. **Publish definitions.** Open the registry entries to compare the reviewer
   revisions and their evidence grants. Publishing and revising are data-only.
2. **Allocate teams.** Checkout pins `reviewer@1`; Profile pins `reviewer@2`.
   The stable allocator starts two idle team actors from snapshots of the task
   revisions, definition revisions, and grants. Retirement then blocks new
   allocations that use the reviewer without changing either pin. No specialist
   sessions have opened yet.
3. **Run both teams.** Each team opens a new, single-use actor for each stage,
   with its own session address. Plan, Build, and Test produce typed facts.
   Review sees only its pinned, task-local evidence: v1 gets the Test record
   and candidate artifact; v2 gets the Test record alone. The scripted advisor
   is not a provider and does not own a transition. The team accepts a
   passing check and an advisory approval only for the pinned task revision
   and exact candidate, then produces a deterministic Document summary.

Select **Fail the checkout check** before running to inject a wrong checkout
candidate. Checkout stops at Test without calling Review; Profile still
finishes. The dashboard displays stage observations and team outcomes; it does
not accept evidence or move stages. **Reset** discards the local demo and starts
with an empty registry.

The [terminal demo](../../examples/parallel-sdlc-teams/demo.ts) uses the same
[scenario](../../examples/parallel-sdlc-teams/scenario.ts) and team behavior:
`pnpm examples:parallel-teams` or
`pnpm examples:parallel-teams --fail-checkout`. Both run in-process with no
credentials, provider calls, network transport, or workspace writes. The
example stops its local session actors and team actors; this does not establish
settlement of external work.

### 2. Portable Specialist: one bounded session

After building the workspace packages with `pnpm build`, run
`pnpm --filter @actor-web/example-portable-specialist demo`.
The [scripted CLI](../../examples/portable-specialist/demo.ts) drives one
source review and an in-memory read through one explicit grant. It teaches
the session boundary, not task allocation or stage orchestration. See the
[specialist execution contract](../specialist-execution-contract.md) for the
reusable execution baseline and its limits.

### 3. agent-starter Queue Board: operator policy

The [sibling board](../../../agent-starter/apps/board/README.md) is a separate
application. Stop the examples server before running `pnpm board:dev` from
agent-starter, then open its [operator console](http://127.0.0.1:4173/queue-board/).

- The operator edits the request, confirms checks, and reviews kickoff.
- The board owns admission, including dependencies, the ticket revision,
  and the current workflow lease. Its workflow issues one assignment at a
  time for the ticket, and specialists open in fresh purpose-specific sessions.
- Workers return results; the board validates them and owns stage
  transitions, recovery, and workspace policy. The console observes this state.

Document in Parallel SDLC Teams is a generated summary, not a board column.

## Transport/UI

- [Actor Workflow Dashboard](../../examples/fas-agent-loop/README.md) shows
  headless workflow projection and compares coordination styles. Its gateway,
  lattice, and projection fixtures are integration examples, not SDLC lessons.
- [Ignite Headless Host](ignite-element-host.md) projects Actor-Web snapshots
  and events into a UI.
- [Mesh Pong](../../examples/mesh-pong/ui/index.html) runs one topology across
  several transports. It is not the Ping/Pong message-passing prerequisite.

## Design note: proposed API names

`defineTopology`, `toolHandlers`, `reply.ok`, `reply.refuse`, `ActorResult`,
and `runtime.createClient` are design ideas, not the APIs used by these lessons.
Current examples use `defineActorWebTopology`, `startRuntime`, plain
`{ reply, context }` handler returns, and refs from the started runtime.
The [existing milestones](../todos.md) govern reusable specialist execution.
