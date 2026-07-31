# Week 7 learning product: authentication authorization and capabilities

## Source

Created with `fas create-task` on 2026-07-31.

## Problem

Build the guide, workbook, and lab for authenticated principal context, credential redaction, schema admission, domain acceptance, execution authorization, approval and revision checks, capability discovery, and fail-closed command admission.

## Acceptance criteria

- Teach that capability discovery is descriptive and execution must recheck command, payload, principal, approval, revision, idempotency, and policy.
- Trace current principal and admission contracts through public entrypoints, source, and conformance tests.
- Add stale approval, revision mismatch, missing principal, malformed payload, denied policy, and redaction exercises.
- Add an interactive three-stage admission lab whose outcome facts preserve identity and rejection reason.
- Keep policy deterministic and application-owned without FAS or Ignite product semantics in runtime packages.
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

- Queue prerequisites: task-1785529973489 (Week 6) and completed principal/admission proof task-1785250545761.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
