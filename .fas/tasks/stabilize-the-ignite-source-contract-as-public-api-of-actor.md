# Stabilize the Ignite source contract (neutral actor-web source API; adapter owned by ignite-element)

## Source

Created with `fas create-task` on 2026-06-06.

## Problem

REFRAMED by docs/actor-web-decoupling-design.md (2026-06-09). Original plan made actor-web the source of truth for Ignite*types with ignite-element importing actor-web as a peerDep — WRONG direction: it makes ignite-element depend on actor-web and breaks 'ignite-element usable standalone'. Correct design: (1) actor-web exposes NEUTRAL source types (rename Ignite* -> Actor*: ActorReadModelSource/ActorCommandSource/ActorSource) and DELETES integration/ignite-element-bridge.ts; actor-web no longer references Ignite. (2) ignite-element KEEPS its @ignite-element/adapters ActorWebAdapter as the canonical seam owner. (3) Define the source shape once: either keep ignite's structural hand-copy (zero dep), or have @ignite-element/adapters import actor-web's neutral source types as an OPTIONAL peerDependency (adapters package only — ignite-element CORE stays standalone). Either way the dependency edge is ignite-adapters -> actor-web, never ignite-core -> actor-web. This task now covers the actor-web side: neutralize the source API + delete the ignite bridge. See the design doc for the full cross-repo plan.

## Automation admission

- Expected operator value: Improves operator leverage around "Stabilize the Ignite source contract as public API of @actor-core/runtime" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- Ignite*Source + snapshot types exported as documented public API
- snapshot helpers matches/can/hasTag present on the canonical type
- source teardown standardized on close()
- contract-conformance test added
- published release available for ignite-element to consume
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

- packages/actor-core-runtime/src/integration/ignite-element-bridge.ts
- packages/actor-core-runtime/src/actor-web-source.ts
- packages/actor-core-runtime/src/index.ts

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
