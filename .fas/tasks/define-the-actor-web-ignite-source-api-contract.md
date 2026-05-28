# Define the Actor-Web Ignite source API contract

## Source

Created with `fas create-task` on 2026-05-28.

## Problem

Specify the public Actor-Web source API that product apps should use with ignite-element/actor-web. Target DX: product code can pass a typed read-model source such as runtime.dashboard.readModel({ host }) directly to igniteCore without explicit generics, local topology mappers, or imperative loadProjection glue. Preserve the boundary where Actor-Web owns runtime/topology/tool ports, Ignite owns projection UI, and command/control crosses through an explicit command-capable source or commandSource pairing.

## Acceptance criteria

- Follow-up implementation tasks have concrete API hooks and acceptance criteria.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- docs/API.md
- docs/actor-web-topology-source-dx-design.md
- docs/examples/ignite-element-host.md
- packages/actor-core-runtime/src/topology.ts
- packages/actor-core-runtime/src/actor-web-source.ts
- packages/actor-core-runtime/src/actor-web-client.ts

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
