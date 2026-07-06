# Carry labs-mesh route tokens through runtime remote routing protocol

## Source

Created with `fas create-task` on 2026-07-06.

## Problem

CodeRabbit PR #40 committed review found that createMeshRemoteMessageRouter returns the next hop but discards the updated MeshRouteToken because RemoteMessageRouter currently resolves only to a string and __runtime.remote.send has no route-token field. This is a runtime contract gap for docs/actor-web-labs-mesh-design.md lines 184-189: relays must preserve bounded hop count and visited-node state rather than starting each hop fresh. Keep this out of PR #40 implementation scope; address it before transport adapters and Mesh Pong claim full loop/hop-limit safety.

## Automation admission

- Expected operator value: Improves operator leverage around "Carry labs-mesh route tokens through runtime remote routing protocol" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- RemoteMessageRouter supports a backward-compatible route decision shape carrying nextHop plus opaque/labs route token while preserving existing string routers.
- __runtime.remote.send carries the route token and relay handling passes it into the next routing decision.
- Remote transport tests prove a multi-hop relay preserves visited-node and hop-limit state across at least two hops and fails closed on exhausted/looping tokens.
- labs-mesh router adapter tests cover propagation through the updated runtime seam.
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

- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/runtime-transport-protocol.ts
- packages/actor-core-runtime/src/unit/remote-transport.test.ts
- packages/actor-labs-mesh/src/routing.ts
- packages/actor-labs-mesh/src/unit/labs-mesh.test.ts
- .fas-config.json

## Scope Amendments

- Type: closeout-readiness
- Added at: closeout-readiness
- Trigger: verifier-blocked
- Reason: Closeout readiness required the labs-mesh package test lane to be explicit in .fas-config.json so full FAS verification covers changed labs-mesh tests.
- Added paths: packages/actor-core-runtime/src/actor-system-impl.ts, packages/actor-core-runtime/src/runtime-transport-protocol.ts, packages/actor-core-runtime/src/unit/remote-transport.test.ts, packages/actor-labs-mesh/src/routing.ts, packages/actor-labs-mesh/src/unit/labs-mesh.test.ts, .fas-config.json
- Evidence source: closeout-readiness
- Evidence: closeout-readiness | .fas/state/closeout-readiness/latest.json | PACKAGE_TESTS_COVERED_BY_VERIFICATION reported packages/actor-labs-mesh/src/unit/labs-mesh.test.ts outside the configured FAS test command.
- Accuracy signal: closeout-discovered

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
