# Resolve CodeRabbit lattice release findings: artifact hashing, replay hydration, scheduler errors

## Source

Created with `fas create-task` on 2026-07-04.

## Problem

CodeRabbit review --agent -t committed --base main -c AGENTS.md on branch fas/release-0-2-0 raised release-blocking findings in @actor-web/lattice. Verify current code and fix only still-valid issues: artifact contentHash must use a stronger digest than the current 32-bit hash; lattice actor journal hydration must not cache replay state in the reusable behavior closure across respawns or failed replay; and default timeout scheduling must not silently discard CHECK_ACTIVATION_TIMEOUTS failures. Preserve the locked 0.2.0 public API: lattice(), dependsOn({ id, node, behavior, dependencies }), and no observe vocabulary implementation in this task.

## Acceptance criteria

- Content hashing uses a collision-resistant digest and publishArtifact still deduplicates identical payloads deterministically.
- Lattice journal hydration state is per actor context/state and can retry after replay failure or respawn.
- Scheduled timeout-check failures are surfaced through a narrow reporting/logging path without making reducers read clocks or effects.
- Focused lattice tests cover all fixed findings, including failure/retry behavior where applicable.
- fas validate-task passes before snapshot; full verify remains shared for batch close.
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

- packages/actor-lattice/src/artifact.ts
- packages/actor-lattice/src/lattice-actor.ts
- packages/actor-lattice/src/runtime.ts
- packages/actor-lattice/src/unit/lattice-artifact.test.ts
- packages/actor-lattice/src/unit/lattice-journal.test.ts
- packages/actor-lattice/src/unit/lattice-activation.test.ts

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

- Generated from CodeRabbit review of the current release batch. Intentionally has no queue dependsOn edge to the batched lattice implementation because that would deadlock closeout before FAS supports batched-dependency satisfaction. It blocks the lattice example and release prep instead.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
