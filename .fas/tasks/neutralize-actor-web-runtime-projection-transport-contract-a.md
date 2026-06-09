# Neutralize actor-web runtime projection/transport contract a

## Source

Created with `fas create-task` on 2026-06-09.

## Problem

Seam B of docs/actor-web-decoupling-design.md. actor-web's cross-node projection/transport contract is written in FAS vocabulary (FasWorkflowSnapshot/FasEventEnvelope/FasWorkflowTransitionRecord) via integration/fas-shared-contracts.ts, and the package carries a file: dependency on @franchise/shared-contracts. A trace shows every in-runtime consumer (handleRemoteSnapshotProjection/EventProjection, actor-web-source.ts, runtime-gateway*) reads only generic fields (value/context/status/phase->stateLabel/sequence/updatedAt/occurredAt/event type+payload); all FAS-specific fields are carried over the wire but never read. Work: (1) introduce neutral ActorSnapshotProjection/ActorEventProjection/ActorEventEnvelope (no workflowId/taskId/phase/CommandExecutionRecord); (2) rewrite createSnapshotProjection/createEventProjection, runtime-transport-protocol.ts, and the runtime-gateway projection to use them; (3) consolidate the THREE redundant workflow-snapshot shapes (FasWorkflowSnapshot, RuntimeGatewayWorkflowSnapshot, native ActorSnapshot) into one native shape; (4) delete integration/fas-shared-contracts.ts + its .typecheck.ts, the Fas* public exports from index.ts, and the @franchise/shared-contracts dependency; (5) FAS-side mapping moves to a FAS-owned adapter (separate task in the FAS repo). This is a wire-contract change (architect check + full verify); FAS is the only external consumer so it is controllable. Also unblocks the first npm publish (removes the unpublishable file: dep).

## Automation admission

- Expected operator value: Improves operator leverage around "Neutralize actor-web runtime projection/transport contract and remove the FAS bridge + @franchise dependency" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- Neutral ActorSnapshotProjection/ActorEventProjection types replace the Fas* shapes in runtime-transport-protocol.ts, actor-system-impl projection methods, and the runtime gateway; no remaining workflowId/taskId/phase/CommandExecutionRecord in actor-web's transport contract
- integration/fas-shared-contracts.ts (+ .typecheck.ts), all Fas*exports from index.ts, and the @franchise/shared-contracts dependency are deleted; grep for @franchise and Fas* in src is empty
- The redundant workflow-snapshot shapes are consolidated to one native shape
- verify.sh --full passes (architect check, typecheck, tests, boundaries); cross-node projection replication behavior is unchanged (covered by runtime-transport-contract + node-websocket-runtime tests)
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
