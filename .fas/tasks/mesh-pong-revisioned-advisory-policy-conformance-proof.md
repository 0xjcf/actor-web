# Mesh Pong revisioned advisory-policy conformance proof

## Source

Created with `fas create-task` on 2026-07-10.

## Problem

After the provider-neutral advisory-policy design is accepted, prove its example-local conformance in Mesh Pong without introducing a public API prematurely. Verify revisioned proposal envelopes, canonical tick and age admission, typed timeout/stale/superseded/cancelled outcomes, deterministic fallback, and telemetry evidence. This task generalizes the current contract-alignment slice into extraction evidence for the future Actor-Web policy surface.

## Acceptance criteria

- Consumes only versioned advisory proposal facts and canonical match state; no provider or clock work occurs in deterministic admission or utility policy ticks.
- Proves stale, superseded, cancelled, timed-out, and fresh advisory outcomes with deterministic fallback and telemetry evidence.
- Decides whether the evidence supports experimental Actor-Web advisory policy extraction without introducing a standalone public lane API.
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

- examples/mesh-pong/pong-contract.ts
- examples/mesh-pong/pong-controller.ts
- examples/mesh-pong/ui/main.ts
- examples/mesh-pong/mesh-pong.test.ts
- examples/mesh-pong/README.md
- docs/actor-web-advisory-policy-design.md

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
