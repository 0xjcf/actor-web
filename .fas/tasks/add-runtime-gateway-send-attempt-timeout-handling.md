# Add runtime gateway send-attempt timeout handling

## Source

Created with `fas create-task` on 2026-05-13.

## Problem

Follow-up from Enforce runtime gateway liveness and replay security: outbound send-failure accounting is ordered, but a hung connection.send() promise can prevent later failures from advancing the consecutive-failure counter. Add bounded send-attempt timeout or equivalent cleanup that preserves ordered success/failure handling without leaking dead connections.

## Automation admission

- Expected operator value: Improves operator leverage around "Add runtime gateway send-attempt timeout handling" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- A never-settling connection.send() attempt cannot keep a dead gateway connection alive indefinitely.
- Later send failures still trigger cleanup deterministically when an earlier send hangs.
- Focused runtime gateway tests cover hung send attempt behavior.
- Existing ordered async send outcome behavior remains covered.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Add a bounded timeout around each gateway `connection.send()` attempt or an
  equivalent watchdog in the ordered send-outcome queue.
- Preserve ordered send-outcome processing so a late success from an older send
  does not incorrectly reset newer consecutive failures.
- Treat a timed-out send attempt as a send failure and route terminal cleanup
  through the existing gateway termination path.

## Alternatives considered

- Ignoring hung sends was rejected because a never-settling adapter promise can
  hide later failures and keep dead connections alive.
- Counting later failures out of order was rejected because it can terminate a
  connection even when an earlier queued send eventually succeeds.

## Affected areas

- `packages/actor-core-runtime/src/runtime-gateway.ts`
- `packages/actor-core-runtime/src/unit/runtime-gateway.test.ts`

## Scope Amendments

- None.

## Implementation plan

- Inspect the current send-attempt ordering in `createRuntimeGatewayHub()`.
- Add bounded timeout handling for unresolved send attempts without changing the
  public gateway frame protocol.
- Add focused tests for a never-settling send promise followed by failures, plus
  a guard that existing ordered async outcome behavior remains intact.
- Run focused gateway tests before broader runtime verification.

## Verification plan

- Run `pnpm --filter @actor-core/runtime exec vitest run src/unit/runtime-gateway.test.ts`.
- Run `pnpm test:runtime`.
- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- Timeout duration must be chosen conservatively so slow but healthy adapters are
  not disconnected under normal load.
- Timer cleanup must avoid leaking per-send timeout handles after connection
  termination.

## Dependencies

- Depends on the owner-bound replay and gateway liveness hardening introduced by
  `Enforce runtime gateway liveness and replay security`.

## Open questions

- Should the timeout be derived from `heartbeatMs`, configured independently, or
  kept internal with a fixed conservative default?

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
