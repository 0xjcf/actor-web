# Implement @actor-web/transport-webrtc peer adapter

## Source

Created with `fas create-task` on 2026-06-16.

## Problem

Spike direct-1781363862864. Direct browser<->browser data channel over WebRTC; server only brokers the signaling handshake (pluggable). Implement MessageTransport on the shared transport core. Today cross-machine peers must route every message through the websocket server (hub).

## Acceptance criteria

- The new functionality works as described.
- Existing behavior is not broken.
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

- `packages/actor-core-runtime/src/webrtc-message-transport.ts`
- `packages/actor-core-runtime/src/unit/webrtc-message-transport.test.ts`
- `packages/actor-core-runtime/src/browser.ts`
- `docs/0011-distributed-runtime-stack.md`
- `docs/API.md`
- `docs/site/concepts/transport.md`
- `docs/actor-web-labs-mesh-design.md`

## Scope Amendments

- 2026-07-06: `docs/0011-distributed-runtime-stack.md` defines the boundary
  model for WebRTC and later distributed runtime work. This task must implement
  WebRTC as a direct-peer transport over `RTCDataChannel` only. It may accept a
  WebRTC-specific signaling/bootstrap port for SDP/ICE exchange, but it must not
  absorb general peer discovery, capability policy, mesh membership/routing,
  lattice coordination, or actor behavior semantics.

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
