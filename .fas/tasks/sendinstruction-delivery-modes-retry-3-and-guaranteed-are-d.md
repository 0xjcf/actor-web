# Resolve unenforced SendInstruction delivery modes (retry(3), guaranteed)

## Source

Created with `fas create-task` on 2026-06-10.

## Problem

Created from spike capture direct-1781143982247 on 2026-06-11T02:56:03Z.

Gap identified:

- SendInstruction delivery modes retry(3) and guaranteed are declared in types (message-plan.ts:72-79) but unenforced in plan-interpreter.ts:270-305 — misleading API honesty issue that becomes acute once activation correctness matters. Decide: implement minimal retry or remove the modes from the public types. severity=medium repo=actor-web.

## Automation admission

- Expected operator value: Improves operator leverage around "SendInstruction delivery modes retry(3) and guaranteed are declared in types (message-plan.ts:72-79) but unenforced in plan-interpreter.ts:270-305 — misleading API honesty issue that becomes acute once activation correctness matters. Decide: implement minimal retry or remove the modes from the public types. severity=medium repo=actor-web." by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- The new functionality works as described.
- Existing behavior is not broken.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- This is a decide-then-implement task. `SendInstruction.mode` accepts `'fireAndForget' | 'retry(3)' | 'guaranteed'` (message-plan.ts:72-79), but `processSendInstruction` (plan-interpreter.ts:270-305) treats every mode identically as fire-and-forget. Two acceptable outcomes:
  1. **Remove** (recommended for v1): drop `retry(3)`/`guaranteed` from the public type union, document the transport as at-most-once, and leave reliability to protocol-level patterns (ask + timeout, or the planned lattice ack/re-emit protocol). Smallest honest change; aligns with "adapters return facts".
  2. **Implement minimal retry**: honor `retry(N)` in the plan interpreter by reusing the existing retry-interceptor machinery (interceptors/retry-interceptor.ts, exponential backoff + circuit breaker), and remove `guaranteed` (true guaranteed delivery needs durable outbox semantics that do not exist).
- Either way, the type surface must stop promising semantics the runtime does not provide. Record the choice in `.fas/memory/decisions.md`.

## Alternatives considered

- Implement `guaranteed` delivery with a durable outbox: rejected for now — requires persistence machinery (journal/outbox) that is itself pending the event-sourcing decision; disproportionate to the API-honesty problem.
- Do nothing and document the gap: rejected — the lattice activation protocol design will reason about delivery guarantees; a lying type surface invites incorrect designs.

## Affected files

- packages/actor-core-runtime/src/message-plan.ts (mode union, docs)
- packages/actor-core-runtime/src/plan-interpreter.ts (processSendInstruction)
- packages/actor-core-runtime/src/otp-message-plan-processor.ts (if SendInstruction emit path branches on mode)
- packages/actor-core-runtime/src/interceptors/retry-interceptor.ts (only if option 2)
- tests for whichever semantics land; docs/API.md mentions of delivery modes

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

- None hard; sequenced second in the spike execution order (after subscription wiring) because the lattice contract design doc must cite the resolved delivery semantics.

## Open questions

- Remove vs. implement (the core decision — needs a human/architect call; spike recommendation is remove-for-v1).
- If removed: is `mode` deleted entirely or narrowed to the single literal `'fireAndForget'` for forward compatibility?

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
