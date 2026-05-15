# Plan replay storage compatibility for owner-bound resume key

## Source

Created with `fas create-task` on 2026-05-13.

## Problem

Follow-up from Enforce runtime gateway liveness and replay security: owner-bound hashed replay session keys fix cross-client replay reuse, but rolling forward then back can split replay continuity because older binaries do not read the new keyed format and naive dual-read could reopen the trust issue. Design a compatibility or migration strategy that preserves replay security.

## Acceptance criteria

- Document rollback and rollout behavior for owner-bound replay keys.
- If compatibility reads are added, they must not trust client-supplied lastConnectionId without authenticated owner binding.
- Tests cover old-key/new-key behavior or explicitly document a no-compatibility rollout policy.
- Replay storage error events do not leak raw auth context.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Decide whether owner-bound replay keys are a deliberate breaking storage-key
  change or whether the gateway should support a safe compatibility window.
- If compatibility is required, design a read path that can only consult legacy
  keys when the gateway can prove the legacy replay belongs to the same
  authenticated owner, for example by adding owner metadata to persisted replay
  records before enabling dual-read.
- Document rollout and rollback expectations so operators know whether replay
  continuity can be lost during rollback.

## Alternatives considered

- Naive dual-read from plain `lastConnectionId` keys is rejected because it can
  recreate the cross-client replay reuse issue this task fixed.
- Immediate key migration without rollback guidance is rejected because it leaves
  operators without a clear recovery story if a release is rolled back.

## Affected Files

- `packages/actor-core-runtime/src/runtime-gateway.ts`
- `packages/actor-core-runtime/src/unit/runtime-gateway.test.ts`
- Replay storage provider contract documentation if compatibility behavior is
  documented instead of implemented.

## Scope Amendments

- None.

## Implementation plan

- Inspect current replay storage provider assumptions and owner-bound keying.
- Choose one policy: explicit breaking storage-key change, safe dual-read with
  owner metadata, or migration/drain step.
- Implement only the selected policy and add tests proving cross-owner replay
  isolation still fails closed.
- Update docs or task notes with rollback behavior.

## Verification plan

- Run `pnpm --filter @actor-core/runtime exec vitest run src/unit/runtime-gateway.test.ts`.
- Run `pnpm test:runtime`.
- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- The compatibility path can weaken replay isolation if it reads legacy keys
  without authenticated ownership proof.
- The no-compatibility path can be acceptable for security, but it must be
  explicit because rollback can lose replay continuity.

## Dependencies

- Depends on the owner-bound replay key behavior introduced by `Enforce runtime
  gateway liveness and replay security`.

## Open questions

- Is replay continuity across rollback a required production guarantee for this
  provider, or is a security-first key break acceptable with documentation?

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
