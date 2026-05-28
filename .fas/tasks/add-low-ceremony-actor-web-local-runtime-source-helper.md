# Add low-ceremony Actor-Web local runtime source helper

## Source

Created with `fas create-task` on 2026-05-28.

## Problem

Add a small public helper for single-process demos and product proofs that starts an Actor-Web topology, exposes typed actor readModel({ host }) and commandSource(...) surfaces for Ignite, and owns cleanup. This should remove Freedom Air-style manual loops over topology nodes, custom in-memory transport wiring, and separate runOnce/loadProjection bridge code for normal local proofs.

## Automation admission

- Expected operator value: Improves operator leverage around "Add low-ceremony Actor-Web local runtime source helper" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- Focused tests cover source creation, read-model/command-source pairing, lifecycle cleanup, and type inference.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- packages/actor-core-runtime/src/actor-web-node-runtime.ts
- packages/actor-core-runtime/src/actor-web-client.ts
- packages/actor-core-runtime/src/browser.ts
- packages/actor-core-runtime/src/index.ts
- packages/actor-core-runtime/src/unit
- docs/API.md
- docs/examples/ignite-element-host.md

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
