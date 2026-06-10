# actor-web CLI v3: FAS control-plane integration

## Source
Created with `fas create-task` on 2026-06-10.

## Problem
Design: docs/actor-web-cli-runtime-host-design.md (Phase v3). SEQUENCE AFTER CLI v2. Close the control-plane (FAS) / data-plane (actor-web) loop: FAS emits topology + behaviors + toolAccess boundaries; the cli runs them as supervised actors. FAS must NEVER import actor-web (preserve the completed decoupling) — the handoff is topology-as-code + behavior modules + a toolAccess map only.

## Acceptance criteria
- the cli can run a FAS-emitted topology + behaviors + toolAccess as supervised actors
- FAS does not import actor-web (decoupling preserved)
- toolAccess boundaries defined by FAS are enforced at runtime
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
