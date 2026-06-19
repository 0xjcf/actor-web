# Location-Transparency Architecture Audit — actor-web

Date: 2026-06-19 · Mode: read-only (3 bounded reviewers + root synthesis) · Branch: fas/transport-core

## Question
Does actor-web back its stated claim that actors — and LLM agents — run identically local or distributed (Erlang/Elixir/OTP-style location transparency)?

## Headline verdict
- **API level:** YES. Behaviors are transport-agnostic; the `MessageTransport` seam and the `RuntimePeerDiscoveryProvider` port are well-designed; transports do NOT each reinvent discovery (discovery lives above the transport). The bones are right.
- **Local:** MOSTLY, with a STRUCTURAL crack. Location truth is split across two independently-keyed registries (`DistributedActorDirectory` path→node; `AutoPublishingRegistry` publisherId→direct refs) plus side-channel delivery paths. The emit fan-out bridges them unsafely → the fas-studio dead-letter. The directory is NOT the single source of location truth.
- **Distributed:** honestly-caveated POINT-TO-POINT, not a cluster. Real cross-node send/ask/subscribe works between directly-connected, statically-configured nodes (cross-node subscription delivery is DONE + reconnect-aware). Missing: autonomous membership/discovery (cross-node directory fill is TODO no-op stubs; only static/in-memory discovery providers), multi-hop routing, durable/collision-safe node identity (incarnation=Date.now(), nodeId defaults to nodeAddress, node='local' default), cross-node supervision.
- **Claims honesty:** docs are unusually candid (README:67, runtime README:77-84, API.md:1108-1111, the external-transport spike doc). Dominant risk is DRIFT: hero one-liners assert "distributed/location-transparent" flatly; README:67 is now partly stale-in-your-favor.

## Claimed → Implemented → Missing
| Capability | State | Evidence |
|---|---|---|
| Logical/opaque address | leaky — actor://node/type/id leaks node; `type` constant; node='local' vs concrete diverge | actor-system.ts:98-103; actor-system-impl.ts:982-990; utils/factories.ts:68 |
| Single directory = location truth | NO — two registries + side channels | distributed-actor-directory.ts:112,412; auto-publishing.ts:50,268; actor-system-impl.ts:2688→2714→1688-1701 |
| Local send/emit/subscribe | works except emit-fan-out dead-letter (fas-studio) | verified: emitEventToSubscribers:2684 → enqueueMessage:1688 → error+deadletter:1700-1701 |
| Cross-node send/ask/subscribe (direct edge) | DONE, reconnect-replay aware | actor-system-impl.ts:2898-2931,:3237 |
| Membership/discovery (EPMD/net_kernel) | ABSENT — seam exists, only static providers; directory broadcast = TODO stubs | runtime-peer-discovery.ts:203,215; distributed-actor-directory.ts:447-479 |
| Stable/durable node identity | NO — Date.now() incarnation, node='local' collision hazard | node-websocket-…:630-631; define-transport.ts:267-268; factories.ts:68 |
| Multi-hop routing | NO — point-to-point; disconnect-on-mismatch; router hook queued | transport-core.ts:481-501; deliverMessageRemote:4052-4064 |
| Cross-node supervision / nodedown | NO — node-local only | applySupervisionStrategy:4073; peer-down purge:3240-3277 |
| Delivery guarantee | at-most-once app sends (documented) | runtime README:77-84 |

## Findings (deduped, severity-ordered)
1. HIGH — **Local location truth is not unified.** Two registries + non-uniform delivery paths; emit re-resolves subscriber addresses through the directory and dead-letters on miss. Root of the fas-studio bug; the deepest transparency crack; bites before distribution. Fix: directory = single source; auto-publishing stores addresses (not refs); emit delivers through the same chokepoint as send; reconcile registration; do not TTL-expire own-node entries.
2. HIGH — **Node identity is non-durable & collision-prone.** Date.now() incarnation, nodeId=nodeAddress, node='local' default → directory corruption the moment two nodes sync. (Owned: task-1781628465954.)
3. HIGH (agent north-star) — **Agent-payload transparency is unowned.** Plain-actor transport does NOT cover: (a) streaming tool/agent output across nodes; (b) large-payload framing/chunking (transport queues REJECT on overflow); (c) at-least-once/idempotency for non-idempotent tool side-effects (at-most-once silently drops a write-file/open-PR/send-email). No backlog tasks exist.
4. MEDIUM — **No membership/cluster layer,** but owned-by-design: seams (injectable directory, next-hop hook, identity) are discrete queued tasks; implementation is @actor-web/labs-mesh (deferred), whose brief is a content-free stub.
5. MEDIUM — **TransportCore is single-hop by design** (disconnect-on-mismatch); multi-hop must be higher-layer re-framing via the next-hop router hook, not transport forwarding. Document the contract.
6. LOW/MEDIUM — **Docs drift:** scope the headline claim at first mention; reconcile multi-machine "done" (TASKS.md:535) vs "remaining" (external-transport-design.md:204); refresh README:67.
7. LOW — **Declarative emit/subscribe path under-exercised** through a directory-backed runtime; only caught by an external consumer (fas-studio), not a framework example.

## LLM-agents-as-actors fit
Substrate is CLEAN: an agent is a behavior calling an `llm` tool, inheriting address/directory/supervision/transport; examples/fas-agent-loop already runs two agent nodes over real WebSocket transport. Gaps: the @actor-web/agent package is unbuilt (task-1781123183558); plus the 3 agent-payload gaps in Finding 3 (streaming, framing, at-least-once for side-effecting tools).

## Recommended layered sequence (foundation first)
- L0 (local foundation): unify location truth (incl. TTL fix) [root]; opaque addresses + single minting factory; fix fas-studio as the regression test; add a directory-backed declarative-subscriptions example.
- L1: formalize node identity (durable incarnation, collision protection, reject node='local' for remote).
- L2: injectable directory; next-hop routing hook (+ document single-hop transport contract).
- L3: author labs-mesh design doc; implement labs-mesh (gossip membership + cluster-wide directory + multi-hop).
- L4: transports as thin media — T1 broadcast (bus-aware destination-filter, discovery via membership), T2 webrtc (drives defineTransport smart-pipe growth), Mesh Pong parity demo.
- L5 (agent track, parallel after L0): @actor-web/agent package; streaming; large-payload framing; at-least-once for side-effecting tools.
- L6 (docs/decisions): docs honesty pass; post-mesh scoping (membership graduation tier, cross-node supervision boundary, claim-gating).

## Confidence / open items
Verified firsthand: the two-registries + emit re-lookup dead-letter (linchpin), and the TransportCore point-to-point/disconnect behavior (from P2). Reviewer-cited (high-confidence, specific line refs, not re-run by root): "no autonomous membership," "cross-node subscription is done." NOT pinned: the exact fas-studio 0.1.0 trigger — the brief conflates the subscriber re-lookup dead-letter with a separate `[AUTO_PUBLISHING] no metadata` publisher-tracking miss; pin with a live repro during the fix.
