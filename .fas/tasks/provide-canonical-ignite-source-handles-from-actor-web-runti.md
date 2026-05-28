# Provide canonical Ignite source handles from Actor-Web runti

## Source
Created with `fas create-task` on 2026-05-28.

## Problem
Support the target consumer API where Ignite receives source: runtime.dashboard({ host }) and the returned source handle packages projection reads plus command-capable actor access. This should remove the need for app code to manually wire readModel + commandSource pairs for standard Actor-Web/Ignite integrations while preserving least-privilege runtime boundaries internally.

## Automation admission
- Expected operator value: Improves operator leverage around "Provide canonical Ignite source handles from Actor-Web runtime topology" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria
- Actor-Web exposes or documents a canonical source-handle helper suitable for igniteCore source: runtime.dashboard({ host }).
- The helper packages read-model subscription and command actor access without requiring app-level commandSource wiring.
- Runtime/topology tests cover both projection-only and projection-plus-command source handles.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution
- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered
- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files
- packages/actor-core-runtime/src/topology.ts
- packages/actor-core-runtime/src/runtime-gateway.ts
- packages/actor-core-runtime/src/unit/ignite-element-bridge.test.ts
- examples/ignite-headless-host

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
