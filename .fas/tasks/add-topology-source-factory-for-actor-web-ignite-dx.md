# Add topology source factory for Actor-Web Ignite DX

## Source
Created with `fas create-task` on 2026-05-28.

## Problem
Implement the locked target API for Actor-Web topology-owned Ignite sources: defineActorWebTopology(...) should expose topology.source("actorKey") as a lifecycle-safe Actor-Web source-handle factory that preserves actor context/message/event inference from defineActor and defineActorWebTopology. This supports Freedom Air using igniteCore({ source: topology.source("business"), view: ({ context }) => ..., commands: ({ actor, command }) => ... }) without app-level ActorWebSourceHandle generics, custom runtime dashboard wrappers, or custom element runtime injection. Do not change defineActor builder semantics and do not add an Ignite-specific helper.

## Acceptance criteria
- defineActorWebTopology returns a topology.source(actorKey) helper that accepts only valid actor keys and preserves inferred context/message/event types from the selected actor
- topology.source(actorKey) returns a source factory/source handle shape accepted by ignite-element actor-web integration without manual generics
- The helper is lifecycle-safe for local/browser use and closes sources through the existing Actor-Web source handle cleanup path
- Existing actor descriptor source/readModel/commandSource semantics remain backward-compatible
- Runtime and type tests cover topology.source with ignite-compatible sourceHandle behavior and invalid actor-key typing
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution
- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered
- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files
- packages/actor-core-runtime/src/topology.ts
- packages/actor-core-runtime/src/actor-web-client.ts
- packages/actor-core-runtime/src/actor-web-source.ts
- packages/actor-core-runtime/src/unit/topology.test.ts
- packages/actor-core-runtime/src/unit/actor-web-local-runtime.test.ts

## Scope Amendments
- None.

## Implementation plan
- Convert the supplied context into a scoped implementation plan before editing.
- Refresh affected-file scope before implementation if the generated hints are incomplete.

## Verification plan
- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks
- Validate generated scope, acceptance criteria, and verification evidence before closeout to avoid workflow drift.

## Dependencies
- None known at task creation.

## Open questions
- None captured at task creation.

## Artifact links
- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
