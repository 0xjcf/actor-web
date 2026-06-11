# SpawnOptions API honesty: remove unread fields (persistState

## Source

Created with `fas create-task` on 2026-06-11.

## Problem

SpawnOptions (packages/actor-core-runtime/src/actor-system.ts:151-157) declares { id, supervised, persistState, timeout, retries } but actor-system-impl.ts reads exactly one field: id (line 759). Verified 2026-06-11. (1) persistState: zero consumers anywhere; human decision (2026-06-11): remove from the type rather than implement — a boolean is the wrong shape for persistence (the real contract belongs to the event-sourcing decision task / lattice design, cf. EventSourcedActor's explicit events+replay+snapshots shape), and silently resuming pre-crash context fights let-it-crash (poison-state restart loops; Erlang restarts clean deliberately). If snapshot-resume is ever wanted, it should be an explicit supervision strategy (onRestart: 'fresh' | 'resume-snapshot', default fresh) designed in the persistence task — record that pointer in decisions.md. (2) timeout, retries: never read, never passed by any caller — remove. (3) supervised: passed by real call sites (actor-web-node-runtime.ts:166,253 passes supervised: Boolean(actorDescriptor.supervision); actor-system-impl.ts:458 passes supervised: false for the system-event actor) but applySupervisionStrategy (actor-system-impl.ts:3563-3600) hardcodes directive 'restart' for EVERY failed actor — the flag is ignored, so supervised: false does not opt out. Decide: honor it (skip restart tracking / stop-on-failure when false — the system-event call site reads like it expects that) or remove it and clean the three call sites; honoring it is the likely intent but needs a behavioral test for the system-event actor failure path either way. Same retry(3)/guaranteed API-honesty family (see decisions.md 2026-06-11). Mirror precedent: narrow rather than delete where call sites pass the field, delete where nothing does.

## Acceptance criteria

- The change is verified and does not introduce regressions.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- packages/actor-core-runtime/src/actor-system.ts
- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/actor-web-node-runtime.ts

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
