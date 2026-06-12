# Supervision observability polish: reason-coded respawn-failu

## Source

Created with `fas create-task` on 2026-06-11.

## Problem

Follow-ups from the per-actor supervision policy review (4-agent, 2026-06-11; reviewer verdict READY-WITH-FOLLOW-UPS). (1) When a respawn throws inside restartActorWithLimits (actor-system-impl.ts ~3811-3819), the actor stays permanently stopped but no reason-coded system event is emitted (only log.error + guardian message, and the guardian does not respawn) — emit actorStopped with reason 'restart-failed' for operator visibility. (2) actorStopped events for supervision-stop / max-restarts-exceeded carry reason but not the error message, unlike actorEscalated/actorResumed — include error in the payload. (3) Export ActorSupervisionPolicy/ActorSupervisionStrategy from index.ts under their own names (currently reachable only via the ActorWebSupervisionPolicy/ActorWebSupervisionStrategy topology aliases at index.ts:377-378). Optional nits if touching the same lines: escalate currently logs warn while stop logs error (align until tree propagation lands); negative maxRestarts/withinMs degrade safely toward stopping but could be validated at spawn alongside the existing strategy validation.

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
