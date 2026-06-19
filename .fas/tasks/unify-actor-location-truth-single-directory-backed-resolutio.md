# Unify actor location truth: single directory-backed resolution for send and emit/subscribe

## Source

Created with `fas create-task` on 2026-06-19.

## Problem

Location-transparency audit L0 ROOT FIX (highest leverage). Two parallel registries are both location truth: DistributedActorDirectory (path to node) and AutoPublishingRegistry (publisherId to direct ActorRef). emitEventToSubscribers (actor-system-impl.ts:2684) reads subscriber refs from auto-publishing, then enqueueMessage re-resolves each subscriber address via directory.lookup (1688) and dead-letters on miss (1700-1701), the verified root of the fas-studio bug. Make the directory the single source of location truth: auto-publishing stores addresses or directory handles not refs; emit delivers through the same address chokepoint as send; reconcile registration so an actor cannot be subscriber or publisher without a directory entry; stop TTL-expiring own-node entries. Regression test: two co-located topology actors with a declarative subscription plus emit asserting zero dead-letters and zero console.error against a real directory-backed runtime.

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

- Scope unknown.

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
