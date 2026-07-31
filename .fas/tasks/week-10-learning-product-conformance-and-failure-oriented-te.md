# Week 10 learning product: conformance and failure-oriented testing

## Source

Created with `fas create-task` on 2026-07-31.

## Problem

Build the final guide, workbook, and lab for executable contracts, public-entrypoint tests, failure matrices, restart and replay fixtures, version negotiation, malformed inputs, receipt evidence, cross-repo consumer verification, and architecture claims that remain bounded by maturity.

## Acceptance criteria

- Consume the published or exact versioned provider-neutral contract surface and state supported, unsupported, and malformed behavior.
- Build a capstone conformance workbook that proves restart, replay, reconciliation, redaction, lineage, and no duplicate irreversible effects.
- Add an interactive failure-matrix lab that correlates each injected fault with authoritative facts, receipts, recovery state, and source tests.
- Produce a concise downstream handoff with package or fixture path, maturity, versions, ownership, join keys, redaction, commands, receipts, and reconfirmation needs.
- Require focused verification, the full gate, external review, and human final merge before marking the curriculum complete.
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

- Superseded before implementation by task-1785530166219 after live admission proved stack depth 14.

## Open questions

- None. Retained as workflow history only.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
