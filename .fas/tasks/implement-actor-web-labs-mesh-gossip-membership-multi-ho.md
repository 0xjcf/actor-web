# Implement @actor-web/labs-mesh (gossip membership + multi-hop routing + directory propagation)

## Source

Created with `fas create-task` on 2026-06-16.

## Problem

Spike direct-1781363862864. The real Mesh: arbitrary node graph where an actor on A reaches an actor on Z with no direct edge, dynamic join/leave via gossip, cluster-wide directory. Built as a labs package on the injectable directory (P3), the next-hop routing hook (P4), formalized node identity (P5), and the shared transport core (P2) + existing RuntimePeerDiscoveryProvider. broadcastRegister/Unregister/Lookup in distributed-actor-directory.ts are no-op stubs today and propagation is point-to-point only.

## Acceptance criteria

- The new functionality works as described.
- Existing behavior is not broken.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- packages/actor-labs-mesh/package.json
- packages/actor-labs-mesh/tsconfig.json
- packages/actor-labs-mesh/vitest.config.ts
- packages/actor-labs-mesh/README.md
- packages/actor-labs-mesh/CHANGELOG.md
- packages/actor-labs-mesh/LICENSE
- packages/actor-labs-mesh/src/index.ts
- packages/actor-labs-mesh/src/membership.ts
- packages/actor-labs-mesh/src/directory.ts
- packages/actor-labs-mesh/src/routing.ts
- packages/actor-labs-mesh/src/mesh.ts
- packages/actor-labs-mesh/src/unit/labs-mesh.test.ts
- package.json
- tsconfig.json
- .fas/TASKS.md

## Scope Amendments

- Type: explicit-scope-promotion
- Added at: 2026-07-06
- Trigger: Planner produced no explicit planned paths for the labs-mesh implementation task.
- Reason: Repo inspection shows labs-mesh is an optional overlay package that should depend on existing runtime seams without changing transport semantics.
- Added paths: packages/actor-labs-mesh/package.json, packages/actor-labs-mesh/tsconfig.json, packages/actor-labs-mesh/vitest.config.ts, packages/actor-labs-mesh/README.md, packages/actor-labs-mesh/CHANGELOG.md, packages/actor-labs-mesh/LICENSE, packages/actor-labs-mesh/src/index.ts, packages/actor-labs-mesh/src/membership.ts, packages/actor-labs-mesh/src/directory.ts, packages/actor-labs-mesh/src/routing.ts, packages/actor-labs-mesh/src/mesh.ts, packages/actor-labs-mesh/src/unit/labs-mesh.test.ts, package.json, tsconfig.json, .fas/TASKS.md
- Evidence source: task brief, merged labs-mesh design doc, and runtime package layout
- Evidence: task brief, merged labs-mesh design doc, and runtime package layout | docs/actor-web-labs-mesh-design.md | Implement a new @actor-web/labs-mesh workspace package with membership, anti-entropy directory propagation, and next-hop routing core plus root build/test/typecheck wiring.
- Accuracy signal: human-approved mesh boundary: mesh owns reachability; lattice owns artifacts; transport remains single-hop

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
