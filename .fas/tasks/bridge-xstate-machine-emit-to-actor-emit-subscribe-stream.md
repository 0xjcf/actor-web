# Bridge XState machine emit to actor emit/subscribe stream

## Source

Created with `fas create-task` on 2026-06-08.

## Problem

Actor DX design (docs/actor-web-actor-dx-design.md). Route XState v5 machine emit(...) actions into the actor's emitted-event stream so they reach AutoPublishingRegistry subscribers (and UI subscribeEvent / ignite agent runtime) the same way ActorHandlerResult.emit does. Lets withMachine actors emit domain events (e.g. OUTCOME_RESOLVED) with zero handlers. The FSM/handler path already works via ActorHandlerResult.emit.

## Acceptance criteria

- The change is verified and does not introduce regressions.
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

- packages/actor-core-runtime/src/unified-actor-builder.ts
- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/machine-registry.ts
- docs/site/concepts/subscriptions-and-events.md
- docs/site/concepts/state-and-machines.md

## Scope Amendments

- Type: scope-refresh
- Added at: 2026-06-08
- Added paths: docs/site/concepts/subscriptions-and-events.md, docs/site/concepts/state-and-machines.md

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
