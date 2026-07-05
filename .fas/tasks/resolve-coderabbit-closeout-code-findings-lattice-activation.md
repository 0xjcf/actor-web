# Resolve CodeRabbit closeout code findings: lattice activation IDs and agent-loop test narrowing

## Source

Created with `fas create-task` on 2026-07-04.

## Problem

CodeRabbit review --agent -t committed --base main -c AGENTS.md on branch fas/release-0-2-0 raised closeout findings that need code/test cleanup before batch close. Fix only still-valid issues: lattice activationIdFor must derive activation IDs from the full satisfactionKey instead of a hash to avoid collisions while preserving the dependencyId prefix; agent-loop tests should narrow or cast behavior.onMessage results before reusing started.context because the callback result is typed as unknown. Keep changes minimal and rerun focused tests plus fas validate-task.

## Automation admission

- Expected operator value: Improves operator leverage around "Resolve CodeRabbit closeout code findings: lattice activation IDs and agent-loop test narrowing" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- activationIdFor derives unique activation ids from the full satisfactionKey without hash collision risk and keeps the dependencyId prefix.
- Focused lattice tests cover the new activation id format/uniqueness.
- agent-loop tests narrow or cast onMessage results before reusing context, without changing production behavior.
- fas validate-task passes before snapshot; shared full verify remains the batch close gate.
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

- packages/actor-lattice/src/lattice-actor.ts
- packages/actor-lattice/src/unit/lattice-activation.test.ts
- packages/actor-agent/src/agent-loop.test.ts

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
