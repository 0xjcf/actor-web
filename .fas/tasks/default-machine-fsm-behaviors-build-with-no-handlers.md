# Default machine/FSM behaviors: build() with no handlers

## Source

Created with `fas create-task` on 2026-06-08.

## Problem

Actor DX design (docs/actor-web-actor-dx-design.md). Make defineActor().withMachine(m).build() and .withFSM(f).build() legal with NO onTransition/onMessage handlers. Default per event: transition the machine/FSM; ask resolves with the snapshot (gen_server {reply,State}); send stays fire-and-forget. Un-overridden events get the default; handlers only for imperative effects. Removes the 20 identical reply handlers in fas-studio behaviors.ts.

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
- packages/actor-core-runtime/src/otp-types.ts
- docs/site/concepts/actors-and-behaviors.md
- docs/site/concepts/state-and-machines.md
- docs/site/api/define-actor.md

## Scope Amendments

- Type: scope-refresh
- Added at: 2026-06-08
- Added paths: docs/site/concepts/actors-and-behaviors.md, docs/site/concepts/state-and-machines.md, docs/site/api/define-actor.md

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
