# Week 10 learning product: conformance capstone and failure proofs

## Source

Created with `fas create-task` on 2026-07-31.

## Problem

Build the final guide, workbook, and lab for executable contracts, public-entrypoint tests, failure matrices, restart and replay fixtures, version negotiation, malformed inputs, receipt evidence, cross-repo consumer verification, and claims bounded by maturity. Reconfirm publication and runtime-chain state at task start without making this learning capstone part of the product release chain.

## Automation admission

- Expected operator value: Improves operator leverage around "Week 10 learning product: conformance capstone and failure proofs" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: manual
- Promotion criteria: Promote beyond manual only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- Consume the then-current published or exact versioned provider-neutral contract surface and state supported, unsupported, and malformed behavior.
- Build a conformance workbook that proves restart, replay, reconciliation, redaction, lineage, and no duplicate irreversible effects at the maturity actually available.
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

- Queue prerequisite: task-1785530240296 (Week 9). Reconfirm published runtime-contract maturity at task start without joining the product release chain.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
