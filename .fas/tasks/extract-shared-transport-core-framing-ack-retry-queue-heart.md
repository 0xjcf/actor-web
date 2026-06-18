# Extract shared transport core (framing/ack-retry/queue/heartbeat/stats + safe listener dispatch)

## Source

Created with `fas create-task` on 2026-06-16.

## Problem

Prerequisite for all new transports (spike direct-1781363862864 readiness audit). ~60% of each websocket transport is duplicated reliability machinery: ack+timeout retry (browser:1107-1145 / node:1264-1302), outbound queue+backpressure (browser:964-1034 / node:1116-1191), heartbeat loop (browser:558-602 / node:1467-1511), stats/telemetry (~600 lines each), message-id gen, sequence tracking. Frame/handshake/idempotency/auth are already shared in runtime-transport-contract.ts / runtime-transport-idempotency.ts / runtime-auth.ts. Extract a transport-core base so a new transport implements only raw send/recv (~100 lines vs ~500). Include a shared safeDispatchListener(listener,event,onError) helper to permanently fix the STRUCTURAL unhandled-rejection hazard (PR#27) that every transport re-trips. Refactor under the green conformance suite (depends on it).

## Automation admission

- Expected operator value: Improves operator leverage around "Extract shared transport core (framing/ack-retry/queue/heartbeat/stats + safe listener dispatch)" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- External behavior is unchanged.
- The refactored code meets the stated goal.
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

- packages/actor-core-runtime/src/transport/transport-channel.ts
- packages/actor-core-runtime/src/transport/transport-reliability.ts
- packages/actor-core-runtime/src/transport/transport-core.ts
- packages/actor-core-runtime/src/transport/define-transport.ts
- packages/actor-core-runtime/src/unit/transport-reliability.test.ts
- packages/actor-core-runtime/src/unit/transport-channel.test.ts
- packages/actor-core-runtime/src/unit/transport-core.test.ts
- packages/actor-core-runtime/src/unit/define-transport.test.ts
- packages/actor-core-runtime/src/node-websocket-message-transport.ts
- packages/actor-core-runtime/src/browser-websocket-message-transport.ts
- packages/actor-core-runtime/src/testing/in-memory-message-transport.ts
- packages/actor-core-runtime/src/message-port-transport.ts
- packages/actor-core-runtime/src/testing/transport-conformance.ts
- packages/actor-core-runtime/src/unit/transport-conformance.test.ts
- packages/actor-core-runtime/src/unit/transport-conformance-node-ws.test.ts
- packages/actor-core-runtime/src/unit/transport-conformance-browser-ws.test.ts
- packages/actor-core-runtime/src/index.ts
- packages/actor-core-runtime/src/browser.ts
- packages/actor-core-runtime/src/node.ts
- packages/actor-core-runtime/src/unit/node-websocket-message-transport.test.ts
- packages/actor-core-runtime/src/unit/browser-websocket-message-transport.test.ts

## Scope Amendments

- Type: scope-refresh
- Added at: 2026-06-18
- Added paths: packages/actor-core-runtime/src/transport/transport-channel.ts, packages/actor-core-runtime/src/transport/transport-reliability.ts, packages/actor-core-runtime/src/transport/transport-core.ts, packages/actor-core-runtime/src/transport/define-transport.ts, packages/actor-core-runtime/src/unit/transport-reliability.test.ts, packages/actor-core-runtime/src/unit/transport-channel.test.ts, packages/actor-core-runtime/src/unit/transport-core.test.ts, packages/actor-core-runtime/src/unit/define-transport.test.ts

- Type: scope-refresh
- Added at: 2026-06-18
- Added paths: packages/actor-core-runtime/src/transport/transport-channel.ts, packages/actor-core-runtime/src/transport/transport-reliability.ts, packages/actor-core-runtime/src/transport/transport-core.ts, packages/actor-core-runtime/src/transport/define-transport.ts, packages/actor-core-runtime/src/unit/transport-reliability.test.ts, packages/actor-core-runtime/src/unit/transport-channel.test.ts, packages/actor-core-runtime/src/unit/transport-core.test.ts, packages/actor-core-runtime/src/unit/define-transport.test.ts, packages/actor-core-runtime/src/node-websocket-message-transport.ts, packages/actor-core-runtime/src/browser-websocket-message-transport.ts, packages/actor-core-runtime/src/testing/in-memory-message-transport.ts, packages/actor-core-runtime/src/message-port-transport.ts, packages/actor-core-runtime/src/testing/transport-conformance.ts, packages/actor-core-runtime/src/unit/transport-conformance.test.ts, packages/actor-core-runtime/src/unit/transport-conformance-node-ws.test.ts, packages/actor-core-runtime/src/unit/transport-conformance-browser-ws.test.ts, packages/actor-core-runtime/src/index.ts, packages/actor-core-runtime/src/browser.ts, packages/actor-core-runtime/src/node.ts, packages/actor-core-runtime/src/unit/node-websocket-message-transport.test.ts, packages/actor-core-runtime/src/unit/browser-websocket-message-transport.test.ts

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
