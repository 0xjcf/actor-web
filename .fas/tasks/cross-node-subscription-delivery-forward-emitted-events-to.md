# Cross-node subscription delivery: forward emitted events to remote-node subscribers

## Source

Created with `fas create-task` on 2026-06-12.

## Problem

RELEASE FEATURE (decided 2026-06-12: ships in the official release alongside the lattice — together they make multi-node choreography real for fas-studio). Today topology subscriptions whose from/to actors live on different nodes FAIL LOUDLY at node start (deliberate v1 constraint from PR #20, wireOwnedActorWebSubscriptions in actor-web-node-runtime.ts) because AutoPublishingRegistry is single-node and emitted events are delivered by direct local mailbox enqueue (actor-system-impl.ts emitEventToSubscribers). Implement transport-level event forwarding so a publisher node delivers emitted events to subscriber actors on peer nodes: architecture questions for the architect step — (1) forwarding mechanism (piggyback on the existing WebSocket MessageTransport envelope with its idempotency window vs a dedicated event channel), (2) subscription wiring across nodes (each node wires local-subscriber edges at start and registers interest with the publisher node — re-derived from the shared topology so durability matches the local pattern), (3) delivery semantics stay at-most-once with transport idempotency dedup — document honestly, no false guarantees (cf. retry(3)/guaranteed removal, decisions.md 2026-06-11), (4) peer-down behavior (drop + telemetry, consistent with transport outbound queue semantics), (5) interaction with the lattice: a single lattice actor is location-transparent already, but DEPENDENCY_SATISFIED emissions to cross-node subscribers need this feature for multi-node lattice topologies. Replace the loud cross-node failure in wireOwnedActorWebSubscriptions with real wiring once delivery works; keep the error for topologies without transport configured. Acceptance: multi-node test (serveNode x2 with WebSocket transport) proving a subscriber on node B receives events emitted by a publisher on node A, with restart re-wiring and peer-down telemetry covered; docs/site/concepts/transport.md and subscriptions-and-events.md updated.

## Acceptance criteria

- The change is verified and does not introduce regressions.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- packages/actor-core-runtime/src/actor-web-node-runtime.ts
- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/actor-system.ts
- packages/actor-core-runtime/src/runtime-transport-protocol.ts
- packages/actor-core-runtime/src/unit/cross-node-subscription-delivery.test.ts
- packages/actor-core-runtime/src/unit/cross-node-subscription-integration.test.ts
- docs/site/concepts/transport.md
- docs/site/concepts/subscriptions-and-events.md

## Scope Amendments

- 2026-06-13: Added `runtime-transport-protocol.ts` — the three new wire
  message types (`__runtime.topology.subscribe`/`.event`/`.unsubscribe`) must
  be added to the `RuntimeProtocolMessage` union; the file was reference-only
  demoted in planning but editing it is unavoidable for the feature.
- 2026-06-13: Added the two new unit/integration test files per the architect's
  scope request (sanctioned by the TDD acceptance criteria but absent from the
  generated affected-file hints).
- 2026-06-13: Added `docs/site/concepts/subscriptions-and-events.md` — the brief
  prose names it; it currently has no cross-node content and needs a short
  cross-node-subscriptions paragraph pointing at transport.md's delivery
  guarantees. Architect recommended the amendment over silently editing an
  out-of-scope file.
- 2026-06-13: Replaced `serve-actor-web-node.ts` with `actor-system.ts` in scope.
  Implementation found the `serve-actor-web-node.ts` `createActorSystem` call
  needs no change — the topology wiring helper reads transport presence via the
  new public `ActorSystem.isRemoteTransportConfigured()` method (plus
  `registerTopologyRemoteSubscriber`/`sendTopologySubscribe`), so the public
  interface file `actor-system.ts` is edited instead. Publisher-restart reconnect
  replay is wired in `actor-system-impl.ts` (already in scope), not the host.

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
