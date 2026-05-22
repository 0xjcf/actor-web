# Harden Actor-Web source and gateway concurrency

## Source

Created with `fas create-task` on 2026-05-22.

## Problem

Covers CodeRabbit runtime concurrency and gateway findings: actor-web-source concurrent send promise overwrite, runtime-gateway processNextFrame re-entry, replay persistence shutdown drift, cleanupStream unsubscribe throw leakage, and runtime peer discovery upsert event ordering under concurrent updates.

## Acceptance criteria

- Concurrent send calls cannot orphan earlier promises; acknowledgements resolve the correct send operation.
- Runtime gateway frame processing has a single sequencing path and cannot re-enter out of order after error handling.
- Replay persistence is completed or deterministically aborted during connection shutdown.
- Stream cleanup always deletes stream state even if unsubscribe handlers throw.
- Peer discovery upserts serialize existence checks and emit available/updated events deterministically.
- Focused runtime tests cover concurrency, error, cleanup, and shutdown cases.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- packages/actor-core-runtime/src/actor-web-source.ts
- packages/actor-core-runtime/src/runtime-gateway.ts
- packages/actor-core-runtime/src/runtime-peer-discovery.ts
- packages/actor-core-runtime/src/unit/actor-web-source.test.ts
- packages/actor-core-runtime/src/unit/runtime-gateway.test.ts
- packages/actor-core-runtime/src/unit/runtime-peer-discovery.test.ts
- packages/agent-workflow-cli/package.json
- pnpm-lock.yaml

## Scope Amendments

- Added `packages/agent-workflow-cli/package.json` and `pnpm-lock.yaml` after fast
  verification exposed an existing direct `xstate` import in the CLI package
  without a package-local dependency. The dependency metadata keeps CLI type
  resolution on the repo-local `xstate@5.30.0` used by `@actor-core/runtime`.

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
