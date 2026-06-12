# Supervision observability polish: reason-coded respawn-failu

## Source

Created with `fas create-task` on 2026-06-11.

## Problem

Follow-ups from the per-actor supervision policy review (4-agent, 2026-06-11; reviewer verdict READY-WITH-FOLLOW-UPS). AMENDED 2026-06-12 after the PR #26 fix round (commits 0522154/c169b96/9913b4e): the spawn-time validation nit is CLOSED (0522154 validates maxRestarts/withinMs with runtime-pin tests), and item (1) is REWORDED — the PR established a single-emission contract ("exactly one actorStopped per stop; callers must not emit their own", actor-system-impl.ts ~668-673), and in the respawn-throw path stopActor has ALREADY completed (its plain actorStopped emitted), so a second reason-coded actorStopped would violate the contract. (1) When a respawn throws inside restartActorWithLimits (catch ~line 3838), emit a DISTINCT event type (e.g. actorRespawnFailed, following the actorEscalated precedent) carrying the path, error message, and restart count — not a second actorStopped. (2) actorStopped events for supervision-stop / max-restarts-exceeded carry reason but not the error message, unlike actorEscalated/actorResumed — include error in the payload. (3) Export ActorSupervisionPolicy/ActorSupervisionStrategy from index.ts under their own names (currently reachable only via the ActorWebSupervisionPolicy/ActorWebSupervisionStrategy topology aliases). Optional nit if touching the same lines: escalate currently logs warn while stop logs error (align until tree propagation lands).

## Acceptance criteria

- The defect no longer reproduces.
- A regression test covers the fix.
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

- packages/actor-core-runtime/src/actor-system-impl.ts
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
