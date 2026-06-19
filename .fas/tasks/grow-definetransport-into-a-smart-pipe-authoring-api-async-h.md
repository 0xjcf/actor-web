# Grow defineTransport into a smart-pipe authoring API (async handshake/auth, native heartbeat, multi-peer server) so webs

## Source

Created with `fas create-task` on 2026-06-18.

## Problem

Follow-up from P2 (Extract shared transport core, direct-1781732880945). TWO LAYERS exist: (1) the INTERNAL TransportChannel/PeerLink already models smart-pipe needs (async dial handshake returning DialResult ok/reason, optional listen for servers, optional native heartbeat hook) — proven by the migrated node/browser ws transports; (2) the PUBLIC defineTransport sugar (transport/define-transport.ts) currently only sugars DUMB pipes via fromDuplex (postMessage/onmessage/close, immediately usable). PR5-minimal exports defineTransport/fromDuplex for the dumb-pipe path (broadcast-channel/worker one-liners). This task grows the PUBLIC authoring API to cover SMART pipes WITHOUT making authors reach into the internal TransportChannel (which stays internal per the locked API / AC10). Capabilities ESCALATE per transport: websocket = async handshake + auth/identity accept-or-reject + server (listen) + native ws ping/pong heartbeat; webrtc = + out-of-band signaling (SDP offer/answer + ICE) before the DataChannel exists; mesh = + multi-peer topology (seed discovery, gossip, relay). RECOMMENDED SEQUENCING: do NOT design speculatively now — co-evolve with T2 (webrtc) and T3 (mesh) so each real transport drives exactly what the API must express; websocket is the simplest smart pipe and the natural first increment. The webSocketTransport alias re-authoring (mesh-pong README:55-69 one-liner shape) falls out of this naturally; until then createNode/BrowserWebSocketMessageTransport keep their signatures (AC4) and remain the ws seam. Likely splits into increments when planned.

## Acceptance criteria

- defineTransport gains an async-author / handshake-capable form that returns a fact (ok/reason) so websocket-class transports are authorable without the internal TransportChannel
- Public authoring API exposes native-heartbeat opt-in and a richer multi-peer server form than today's bare defineTransport.server
- TransportCore/TransportChannel/PeerLink remain internal (NOT publicly exported); the grown defineTransport surface is the only public authoring seam
- webSocketTransport (and the path for webrtc/mesh) is expressible on the grown API with wire byte-identical to the existing ws factories, validated under the transport conformance suite
- Co-evolution documented: what webrtc signaling and mesh multi-peer routing require of the authoring API, or what intentionally drops to a lower seam
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

- Scope unknown.

## Scope Amendments

- Post-PR5 (2026-06-18): the expanded PR5 (commits 9bffc7f export + 143fc93) ALREADY delivered the
  dumb-pipe path end-to-end, so this follow-up no longer needs the parse seam or a basic identity
  handshake. PR5 added to `transport/define-transport.ts`: (a) `fromDuplex` parses inbound JSON
  strings (drop-on-failure, errors-as-values) and buffers pre-subscribe payloads (FIFO), (b) a
  SYMMETRIC hello handshake in `defineTransport.dial` reusing `createRuntimeTransportHandshakeHello` /
  `validateRuntimeTransportHandshake`, bounded by `connectTimeoutMs` on injected timers, setting
  `link.identity` so the core takes its existing handshaked path (zero core change). So
  `defineTransport(({ port }) => port)` now round-trips with DEFAULT identities. REMAINING scope for
  this task: full AUTH handshake on the dumb-pipe path (hello currently carries identity only, no
  shared-secret verify), native-heartbeat opt-in, a real multi-peer SERVER form, and the smart-pipe
  media (webrtc signaling, mesh multi-peer). The websocket alias re-authoring still belongs here.

## New sub-items surfaced by P2 closeout review (fold into this task)

- Non-blocking handshake: PR5's symmetric hello requires both ends to `connect()` CONCURRENTLY
  (serial awaits deadlock — each side awaits the peer's hello). Acceptable for real cross-context
  peers (they connect independently), but the richer API should offer a non-blocking handshake
  (dial returns immediately; identity binds on first inbound hello) so serial connect is safe.
- `defineTransport.server` listen-handle `close()` is currently a no-op (define-transport.ts ~:474) —
  it does not tear down the author's listener. Fix as part of the multi-peer-server form here.
- Add a handshake-timeout guard test (the "peer never connects -> connect() rejects after
  connectTimeoutMs" branch is currently logic-only, untested; the injected-timers seam makes it
  cheaply deterministic).
- Replace the unbounded `fromDuplex` pre-subscribe FIFO buffer with bounded backpressure.

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
