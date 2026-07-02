# Delivery semantics: at-least-once and idempotency for non-idempotent agent tool side-effects

## Source

Created with `fas create-task` on 2026-06-19.

## Problem

Location-transparency audit L5 (agent-payload gap, UNOWNED). Application sends are at-most-once (runtime README:77-84); silently dropping a non-idempotent tool side-effect (write file, open PR, send email) is a correctness bug not latency. Add protocol-level ack plus timeout-re-emit plus idempotent activation IDs for side-effecting agent tool calls. Builds on the at-most-once delivery contract.

## Acceptance criteria

- The change is verified and does not introduce regressions.
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

- packages/actor-core-runtime/src/actor-tool-delivery.ts
- packages/actor-core-runtime/src/unit/actor-tool-delivery.test.ts
- packages/actor-core-runtime/src/index.ts
- packages/actor-core-runtime/src/browser.ts
- packages/actor-core-runtime/src/node.ts

## Scope Amendments

- Type: implementation-scope
- Added at: 2026-07-02
- Trigger: Planner generated unknown scope for active task
- Reason: Implementation will add a pure actor-tool delivery semantics contract, fake-port tests, and public entrypoint exports only.
- Added paths: packages/actor-core-runtime/src/actor-tool-delivery.ts, packages/actor-core-runtime/src/unit/actor-tool-delivery.test.ts, packages/actor-core-runtime/src/index.ts, packages/actor-core-runtime/src/browser.ts, packages/actor-core-runtime/src/node.ts
- Evidence source: root-session source review
- Evidence: root-session source review | .fas/state/task-packet.json | Relevant files pointed at actor-tools/topology; safe implementation slice is a pure delivery semantics module plus tests and entrypoint exports.
- Accuracy signal: explicit root implementation plan before editing

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
