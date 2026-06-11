# Decide event-sourcing module fate: promote as lattice journal or deprecate

## Source
Created with `fas create-task` on 2026-06-10.

## Problem
Created from spike capture direct-1781143982247 on 2026-06-11T02:56:03Z.

Gap identified:
- Event sourcing module is vestigial (event-sourcing.ts exported but unwired; integration test skipped). Decide whether to promote it as the lattice journal backend or scope a journal inside the lattice package and deprecate the module. severity=low repo=actor-web.

## Acceptance criteria
- The change is verified and does not introduce regressions.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution
- Decision task with a small implementation tail. `event-sourcing.ts` (InMemoryEventStore, EventSourcedActor, UserAggregate example, lines 98-333) is exported but unwired: not integrated with the actor lifecycle, and its integration test is `describe.skip` (integration/event-sourcing.test.ts:17). Choose one:
  1. **Promote**: keep the `EventStore` append/replay/snapshot contract as the journal interface for the lattice package; un-skip and modernize the integration test; remove the `UserAggregate` demo from the public surface (move to examples or docs).
  2. **Scope-and-deprecate**: define a minimal journal interface inside the lattice package, mark `event-sourcing.ts` exports deprecated, and delete after the lattice ships.
- Either outcome must align with the journal-strategy section of `docs/actor-web-lattice-design.md` — do this task after (or as part of finalizing) that doc. Record the decision in `.fas/memory/decisions.md`.

## Alternatives considered
- Wire event sourcing into the core actor lifecycle (durable state for all actors): rejected for this task — far larger scope than the lattice journal needs; nothing else currently demands it pre-1.0.
- Delete the module immediately: rejected — its store contract is plausibly exactly the lattice journal interface; deleting before the design doc decides wastes a fitting abstraction.

## Affected files
- packages/actor-core-runtime/src/event-sourcing.ts (promote, trim, or deprecate)
- packages/actor-core-runtime/src/index.ts (export surface)
- packages/actor-core-runtime/src/integration/event-sourcing.test.ts (un-skip or remove)
- .fas/memory/decisions.md (record the outcome)

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
- "Author the lattice contract design doc" — the journal-strategy section of that doc drives this decision.

## Open questions
- Promote vs. scope-and-deprecate (the core decision).
- If promoted: does `InMemoryEventStore` stay the only shipped implementation pre-1.0, with durable backends left to adapters?

## Artifact links
- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
