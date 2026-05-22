# Fix runtime dependency resolution and async context fallback

## Source

Created with `fas create-task` on 2026-05-22.

## Problem

Covers CodeRabbit runtime critical findings: broken @franchise/shared-contracts dependency in packages/actor-core-runtime/package.json and async-unsafe FallbackContextStorage in actor-context-manager.ts. Fix dependency resolution first so install/build is trustworthy, then make fallback context storage preserve context across async continuations.

## Automation admission

- Expected operator value: Improves operator leverage around "Fix runtime dependency resolution and async context fallback" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- @franchise/shared-contracts resolves through a valid package, workspace, or local file path and install/build resolution is verified.
- FallbackContextStorage.run preserves context until async completion and restores previous context on sync throw, async settle, and sync return.
- Regression coverage covers async fallback context behavior and dependency resolution evidence is recorded.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- packages/actor-core-runtime/package.json
- packages/actor-core-runtime/src/actor-context-manager.ts
- pnpm-lock.yaml

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
