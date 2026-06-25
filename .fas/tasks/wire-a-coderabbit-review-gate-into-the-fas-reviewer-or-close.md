# [actor-web] Wire a CodeRabbit review gate into the FAS reviewer or closeout step so fas done blocks on a clean pass

## Source

Created with `fas create-task` on 2026-06-20. Filed from the **actor-web** project (external source) — the work targets the FAS platform repo, so the `[actor-web]` title tag marks where it originated.

## Problem

PLATFORM change targeting the FAS platform repo (not actor-web). The CodeRabbit-CLI-before-fas-done gate has been skipped twice (P2, then addr-opacity PR #31) because the autonomous 6-agent flow has no CodeRabbit step and relies on the orchestrator remembering, so the bot leaves post-closeout threads (churn). Add a CodeRabbit pass to the FAS reviewer or closeout step so fas done cannot complete without a clean or explicitly-triaged CodeRabbit review. Until shipped, the orchestrator must run coderabbit review --base main before allowing closeout on every task. Context: actor-web .fas/memory/pr-feedback.md and the coderabbit-pre-mr-review note.

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
