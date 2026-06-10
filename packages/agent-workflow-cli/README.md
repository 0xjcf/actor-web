# @actor-web/cli

> **Status: work in progress (stub).** This package is being reconceived as a
> terminal **host for the actor-web runtime**.

## What this is becoming

A terminal console over the actor-web runtime — start a runtime node, spawn
actors/agents, send/ask messages, and watch their event streams from the shell:

```
actor-web serve ./topology.ts --node worker
actor-web spawn ./behaviors/researcher.ts --id r1
actor-web send  actor://worker/agent/r1 '{"type":"START"}'
actor-web watch actor://worker/agent/r1
```

It is the **data-plane executor** in a two-plane split: FAS (control plane)
defines agents, behaviors, and boundaries; this CLI runs them on
`@actor-web/runtime`. See the design doc:
[`docs/actor-web-cli-runtime-host-design.md`](../../docs/actor-web-cli-runtime-host-design.md).

## What was removed

The previous git-workflow surface (`aw` save/ship/sync/worktrees/agent
coordination, plus a stubbed "git actor") was removed. It duplicated FAS and
plain git and was not the foundation for the runtime host. The reusable
state-machine analysis utilities continue to live in `@actor-web/testing`
(`analyzeStateMachine`, `assertNoUnreachableStates`, `generateCoverageReport`).

## Current surface

Until the v0 host commands land, the CLI only reports version/help/info:

```bash
pnpm --filter @actor-web/cli dev --help
pnpm --filter @actor-web/cli dev info
```
