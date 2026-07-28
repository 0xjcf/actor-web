# Add durable agent-session checkpoint and rehydration seam

## Source

Created with `fas create-task` on 2026-07-28.

## Problem

The Actor-Web agent loop retains session and provider-loop context in memory; process restart cannot resume the same durable agent session without reconstructing context or risking replay of non-repeatable tool effects. Define a provider-neutral checkpoint port and versioned snapshot envelope for agent/session state, pending commands, trace cursors, provider continuation tokens, tool-call state, and reconciliation position. Rehydrate through Actor-Web lifecycle hooks, reuse the existing effect journal and delivery guarantees, and keep provider adapters responsible for provider-specific serialization.

## Acceptance criteria

- A versioned checkpoint envelope persists the minimum provider-neutral session state plus correlation, causation, command, effect-journal, and reconciliation cursors needed for safe resume.
- Rehydration resumes the same logical actor and session identity without replaying acknowledged non-idempotent effects or silently dropping pending work.
- Provider-specific opaque continuation data is isolated behind an adapter port with size, redaction, expiry, and incompatibility handling.
- Tests cover clean restart, crash between attempt and receipt, duplicate checkpoint, corrupt or stale checkpoint, provider-version mismatch, cancellation, and bounded fallback to manual recovery.
- Checkpoint storage is injectable and works in memory for tests and with a durable adapter for runtime-host conformance.
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

- packages/agent/src
- packages/runtime/src
- packages/testing/src
- docs

## Scope Amendments

- None.

## Implementation plan

- Separate provider-neutral resumable session facts from provider-specific opaque continuation data and define the versioned checkpoint/storage ports.
- Integrate checkpoint ordering with actor lifecycle, delivery semantics, effect journal, cancellation, and reconciliation cursors before adding durable adapters.
- Implement an in-memory conformance adapter, one durable host adapter, rehydration fixtures, and an operator-visible bounded recovery path.

## Verification plan

- Test clean restart, crash before attempt, crash between attempt and receipt, crash after receipt before checkpoint, duplicate checkpoint, corruption, staleness, cancellation, and provider-version mismatch.
- Assert logical actor/session identity and correlation/causation continuity survive resume without duplicate non-idempotent effects.
- Run agent, runtime, testing, storage-adapter, boundary, and repository full verification lanes.

## Risks

- Checkpointing provider prompts or credentials can create retention and privacy exposure.
- Incorrect journal/checkpoint ordering can duplicate irreversible effects or lose pending work.
- Treating opaque provider continuation data as portable would make cross-provider resume dishonest.

## Dependencies

- task-1785250528660 - provider-neutral trace and receipt cursors.
- task-1782940900310 - completed provider lifecycle effect journal.
- task-1781880958725 - completed delivery/idempotency semantics.
- task-1782940917618 - completed SessionActor conformance baseline.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
