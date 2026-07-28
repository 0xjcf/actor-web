# Recover Actor-Web FAS SQLite memory index from curated projections

## Source

Created with `fas create-task` on 2026-07-28.

## Problem

Actor-Web FAS runtime status reports sqlite-unavailable for .fas/memory/memory.db while curated Markdown and JSON memory projections remain present. Recover the project-local index through a timestamped, recoverable backup or move of the unreadable database followed by fas setup --refresh-memory. Compare curated record identities and counts before/after, preserve the original artifact for diagnosis, and verify task bootstrap can retrieve contextualMemory again. This is FAS project-state hygiene, not an Actor-Web runtime feature, and it must not block the evidence-governed product dependency chain.

## Automation admission

- Expected operator value: Restores reliable contextual-memory retrieval for FAS planning and autonomous execution in Actor-Web.
- Observability surface: fas status, fas runtime status, refresh-memory output, curated/index record counts, and a task-packet contextualMemory sample.
- Recovery path: Stop on any mismatch, retain both the original backup and rebuilt database, and restore the original artifact or escalate to FAS platform diagnostics without deleting projections.
- Autonomy mode: manual
- Promotion criteria: Keep this recovery manual; automate only after a separately reviewed backup, parity-check, and rollback contract exists.

## Acceptance criteria

- The unreadable memory.db is preserved at an explicit recoverable backup path before any rebuild; no memory projections are deleted.
- fas setup --refresh-memory rebuilds the SQLite index from curated projections and fas runtime status reports SQLite available.
- Curated memory identity/count sampling and contextualMemory retrieval prove no silent loss or duplicate promotion.
- A rollback/diagnostic note records the original failure, backup path, commands, verification receipt, and escalation path if rebuilding fails.
- The task remains parallel operational readiness work and does not become a dependency of the Evidence-Governed Agent Runtime epic.
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

- .fas/memory
- .fas/state
- .fas/index

## Scope Amendments

- None.

## Implementation plan

- Capture status, curated projection inventory, database metadata, and a timestamped recoverable backup path without opening the unreadable database for writes.
- Run the supported refresh-memory rebuild from curated projections and retain the original artifact until parity checks pass.
- Compare identities/counts and task-packet contextualMemory retrieval, document the receipt and rollback, then decide separately whether a FAS platform incident is warranted.

## Verification plan

- Run fas status and fas runtime status before and after recovery.
- Compare curated Markdown/JSON identities and sampled SQLite records for loss or duplication.
- Bootstrap a bounded task-packet/context retrieval check and verify the index is readable after a fresh process start.

## Risks

- Moving or overwriting the only unreadable artifact without a backup would destroy forensic evidence.
- A successful rebuild can still hide missing or duplicated curated records unless parity is checked.
- Index files are project-local runtime state and should not be committed as product source.

## Dependencies

- No product dependency; this is parallel FAS operational readiness in runtime-correctness-hardening.
- Do not add it to the Evidence-Governed Agent Runtime critical path.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
