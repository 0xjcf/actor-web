# Reduce Actor-Web topology and tool typing ceremony

## Source

Created with `fas create-task` on 2026-05-28.

## Problem

Review the current defineActorWebTopology, actor/node/supervisor helpers, tool declarations, and `defineActor().withTools<TRegistry>()` typing path. Design and implement a lower-ceremony DX where app authors can declare topology and allowed tools once, handlers receive inferred/narrowed tools, and withTools remains optional for standalone actors or advanced tests rather than required application boilerplate.

## Acceptance criteria

- A concise topology authoring path is documented or demonstrated with less repeated generic/type ceremony than the current examples.
- Tool access types are inferred from topology/tool declarations where feasible, with least-privilege runtime allowlists preserved.
- withTools is either no longer required in normal topology-authored actors or is explicitly documented as an advanced escape hatch.
- Existing topology, tool execution, and FAS agent-loop examples remain passing after the refactor.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- packages/actor-core-runtime/src/topology.ts
- packages/actor-core-runtime/src/unified-actor-builder.ts
- packages/actor-core-runtime/src/unit/actor-tools.test.ts
- examples/fas-agent-loop

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
