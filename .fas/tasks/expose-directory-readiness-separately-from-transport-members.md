# Expose directory readiness separately from transport membership status

## Source

Created with `fas create-task` on 2026-07-10.

## Problem

Follow-up from Mesh Pong pre-start lobby projection convergence hardening. Current ActorSystem connected handling marks cluster membership up once transport connectivity exists, before remote directory synchronization completes. Explicit join correctly awaits readiness and projection replay is withheld on sync failure, but operators can briefly observe up while remote actors are not directory-ready. Design and implement a distinct readiness/degraded status fact without weakening transport membership, join correctness, or projection replay semantics.

## Acceptance criteria

- Cluster status distinguishes transport-connected membership from directory-ready availability without changing existing transport membership truth.
- Automatic sync failure is observable as degraded/not-ready with node and failure context.
- Reconnect, link incarnation replacement, explicit join, and projection replay tests preserve current readiness guarantees.
- Operator-facing documentation/tests define the new status semantics and compatibility behavior.
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
- packages/actor-core-runtime/src/runtime-transport-status.ts
- packages/actor-core-runtime/src/unit/broadcast-channel-message-transport.test.ts

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
