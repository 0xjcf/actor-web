# Support legacy orchestration-generation adoption for terminal closeout recovery

## Source

Created with `fas create-task` on 2026-07-28.

## Problem

Actor-Web PR #51 completed a real six-agent workflow before orchestration generation IDs were enforced, passed full verification and reviewer approval, and merged. A later fas done created a new generation, treated the existing delegated evidence as generation unknown, and blocked terminal closeout; acknowledge-root-execution correctly refuses because delegated evidence genuinely exists. Add a narrow FAS-owned, human-approved recovery path that audits and adopts eligible pre-generation evidence or records an equivalent terminal migration receipt without rerunning delegates or editing state by hand. Actor-Web supplies the consumer fixture; the generic implementation belongs in FAS.

## Automation admission

- Expected operator value: Lets operators close genuinely completed legacy workflows without rerunning agents or corrupting provenance.
- Observability surface: The command prints a dry-run audit, writes an append-only recovery receipt, and is reflected by fas status, orchestration compliance, queue, current-task, and workflow read models.
- Recovery path: Fail without mutation unless every legacy-evidence gate passes; retain original evidence and allow the operator to retry after fixing only the reported missing receipt.
- Autonomy mode: manual
- Promotion criteria: Keep recovery human-approved and exceptional; do not make automatic adoption available unless repeated migration fixtures and independent review prove no gate weakening.

## Acceptance criteria

- A human-approved command can close a merged task with complete pre-generation delegated lifecycle, handoffs, verification, review, and merge evidence while preserving the original records unchanged.
- Recovery refuses missing, ambiguous, incomplete, conflicting, unmerged, or post-generation evidence and explains exactly which gate failed.
- The migration writes an append-only audit receipt linking old evidence, adopted generation or terminal record, task, queue row, workflow, PR, merge SHA, verifier, reviewer, and operator reason.
- The command is idempotent and reconciles current-task, queue, workflow, orchestration compliance, and read models without manual JSON mutation or fake delegated events.
- Tests cover successful legacy adoption, repeated invocation, mixed-generation evidence, partial lifecycle, failed verification, missing handoff, objective-unmet outcome, and rollback/failure recovery.
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

- .fas/state
- .fas/queue/tasks.json
- ../FAS/src/pipeline/shell/orchestration-state.ts
- ../FAS/cli/fas

## Scope Amendments

- None.

## Implementation plan

- Freeze the Actor-Web PR #51 pre-generation evidence set as a read-only consumer fixture and specify the exact eligibility/audit contract.
- Implement the generic dry-run plus human-approved adoption or terminal-migration command in FAS with atomic, append-only receipts and no rewriting of delegated history.
- Prove idempotent reconciliation across current-task, queue, workflow, compliance, and projections, then use the released path to close the retained Actor-Web direct-task record.

## Verification plan

- Test complete legacy evidence, partial lifecycle, mixed generations, repeated invocation, failed verification, missing handoff, unmerged PR, objective-unmet, and write-failure rollback.
- Compare every affected FAS read model before/after and assert original evidence bytes remain unchanged.
- Run the owning FAS full verification and an Actor-Web consumer recovery rehearsal before applying it to the live stale record.

## Risks

- A permissive migration could bypass the delegated orchestration gate and legitimize incomplete work.
- Rewriting old evidence would destroy provenance; only append-only linking is acceptable.
- Partial multi-file recovery writes can create worse drift unless the mutation is atomic or safely resumable.

## Dependencies

- No Actor-Web product dependency; this is parallel FAS operational correctness.
- The current direct-1784053051311 record remains review-state until this supported recovery exists; task-1783703419711 is already operator-completed from merged PR #51 evidence.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
