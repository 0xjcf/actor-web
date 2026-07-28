# Define provider-neutral agent execution trace and receipt contract

## Source

Created with `fas create-task` on 2026-07-28.

## Problem

Actor-Web has correlation and causation fields on emitted events plus separate command, supervision, effect-journal, and projection surfaces, but no single provider-neutral contract that proves an agent request became an admitted or rejected command, actor fact, effect attempt, durable receipt, reconciliation outcome, and consumer projection. Specify the canonical vocabulary, IDs, envelopes, redaction rules, ordering and idempotency semantics, retention/freshness rules, and testing utilities. Actor-Web owns runtime lifecycle and effect truth; FAS owns policy/evidence interpretation; Ignite only projects admitted read models. Do not import provider, FAS, or Ignite product semantics into the runtime contract.

## Acceptance criteria

- One canonical trace links command request, admission decision, actor transition or emitted fact, tool/effect attempt, receipt, reconciliation, and projection using stable correlation, causation, actor, session, command, and effect identifiers.
- The contract distinguishes declared intent, authorized execution, attempted effect, observed result, reconciled truth, and projected state; rejected and interrupted paths are first-class.
- Sensitive principal, prompt, credential, and tool payload fields have explicit redaction and retention rules while receipts remain audit-useful.
- Runtime and testing packages provide deterministic conformance fixtures for success, rejection, timeout, retry, duplicate suppression, interruption, and stale projection paths.
- Existing ActorEventEnvelope and effect-journal compatibility or migration is documented and versioned without importing consumer semantics.
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

- docs
- packages/runtime/src
- packages/testing/src
- packages/agent/src

## Scope Amendments

- None.

## Implementation plan

- Inventory command, ActorEventEnvelope, supervision, tool/effect journal, reconciliation, and source-projection identifiers and classify compatibility gaps.
- Specify the versioned provider-neutral envelopes, lifecycle vocabulary, redaction/retention rules, ordering/idempotency semantics, and ownership matrix before public API changes.
- Implement runtime/testing conformance fixtures and migration adapters in incremental contract-first slices.

## Verification plan

- Add schema and type conformance tests for every envelope and identifier relationship.
- Exercise success, rejection, timeout, retry, duplicate suppression, interruption, stale projection, redaction, and version-mismatch traces.
- Run affected package tests, contract/docs checks, architecture boundaries, and the repository full verification lane.

## Risks

- A single oversized envelope can couple unrelated lifecycle layers and expose sensitive payloads.
- Reusing correlation as causation or effect identity would make retries and reconciliation ambiguous.
- Calling an event or projection a receipt would overstate execution truth; vocabulary must stay explicit.

## Dependencies

- task-1785250502043 - reviewed dependency-chain admission and graph-truth foundation.
- task-1781273347595 - completed 0.2 public package facade baseline.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
