# Complete runtime telemetry and discovery hygiene

## Source

Created with `fas create-task` on 2026-05-22.

## Problem

Covers remaining CodeRabbit runtime hygiene findings: telemetry JSONL sink uses synchronous fs calls, runtime peer discovery URL sanitization preserves fragments, and runtime peer discovery upsert needs serialized event ordering if not handled by the concurrency task.

## Automation admission

- Expected operator value: Improves operator leverage around "Complete runtime telemetry and discovery hygiene" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- Telemetry JSONL sink initializes and writes through async fs APIs without blocking the Node event loop, and sink typing permits async writes safely.
- Runtime peer discovery URL sanitization strips hash fragments before returning sanitized ws/wss URLs.
- Runtime peer discovery upserts emit available then updated deterministically under concurrent calls, either here or via the concurrency task with explicit cross-reference.
- Focused telemetry and discovery tests pass.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- packages/actor-core-runtime/src/runtime-transport-telemetry-node.ts
- packages/actor-core-runtime/src/runtime-transport-telemetry.ts
- packages/actor-core-runtime/src/runtime-peer-discovery.ts
- packages/actor-core-runtime/src/unit/runtime-transport-telemetry.test.ts
- packages/actor-core-runtime/src/unit/runtime-peer-discovery.test.ts

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
