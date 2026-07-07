# ADR: Distributed Runtime Stack

## Status

Proposed

## Context

Actor-Web now has enough distributed runtime pieces that every new transport
adapter risks defining architecture accidentally. The current runtime already
contains several important seams:

- `RuntimeNodeIdentity` identifies a runtime node by logical address, stable
  node id, incarnation, protocol version, and optional capabilities.
- `RuntimePeerDiscoveryProvider` discovers directly reachable peers or bootstrap
  records.
- `MessageTransport` and the internal transport core deliver single-hop runtime
  frames.
- `RemoteMessageRouter` is the next-hop seam used by labs-mesh for multi-hop
  delivery.
- `@actor-web/lattice` coordinates artifact dependencies above runtime
  messaging.

The queued WebRTC adapter is the first transport that forces a stronger
distinction between peer discovery, peer bootstrap/signaling, transport
negotiation, and mesh routing. WebRTC needs SDP/ICE signaling before an
`RTCDataChannel` exists, but that signaling should not become actor-web's full
discovery, capability, or mesh API by accident.

## Decision

Actor-Web treats the distributed runtime as a layered architecture:

```text
Identity
  -> Capabilities
  -> Discovery / Bootstrap
  -> Transport
  -> Mesh Routing
  -> Lattice Coordination
  -> Actors
```

This is a boundary model, not a mandated fluent public API. Implementations may
wire several layers together in a runtime host, but package APIs should preserve
the layer boundaries.

Layer responsibilities:

| Layer | Responsibility | Non-goals |
| --- | --- | --- |
| Identity | Define who a runtime node is, including incarnation and protocol version. | Do not imply reachability or authority by itself. |
| Capabilities | Describe what a node or connection can do and which protocol versions it supports. | Do not grant product permissions without a policy layer. |
| Discovery / Bootstrap | Find peers or exchange enough setup information to attempt a connection. | Do not carry actor messages or choose multi-hop routes. |
| Transport | Deliver runtime frames to directly connected peers. | Do not own discovery, membership, or mesh path selection. |
| Mesh Routing | Maintain membership and choose next hops for multi-hop delivery. | Do not become a transport adapter or remote supervision system. |
| Lattice Coordination | Coordinate durable artifact facts, observations, and activation conditions. | Do not own frame delivery or peer negotiation. |
| Actors | Execute behavior behind location-transparent addresses. | Do not encode transport-specific peer mechanics in behavior code. |

The public API shape should therefore read as separate seams:

```ts
const peer = await discovery.findPeer("phone-runtime");

await transport.connect(peer);

const nextHop = mesh.route({
  destinationNode: "tablet-runtime",
  messageId: "msg-1",
});

await lattice.coordinate({
  artifact: { type: "task.brief", key: "task-1" },
});
```

The exact method names may evolve, but the ownership boundaries should not.
Discovery finds or bootstraps peers, transport connects directly reachable
peers, mesh routes across nodes, lattice coordinates artifacts, and actors
process messages.

## Additional Boundaries

The stack above is the main product-facing model. Several cross-cutting
boundaries remain explicit and should not be hidden inside any single layer:

- Authorization and policy: decides whether identity and capabilities are
  allowed to perform an operation.
- Frame and protocol codec: validates and serializes runtime frames without
  owning network effects.
- Delivery semantics and backpressure: defines at-most-once delivery, duplicate
  suppression, bounded queues, and control-frame acknowledgement behavior.
- Observability: reports connection state, routing decisions, drops, retries,
  and health without changing runtime behavior.
- Persistence and replay: records facts and projections where needed, but does
  not re-run network, filesystem, timer, or process effects during replay.
- Gateway and source edges: expose runtime state to consumers, but remain
  separate from runtime-to-runtime transport.
- Runtime host lifecycle: starts, wires, and stops nodes, but does not own
  product semantics for applications built on top of actor-web.

These are boundary surfaces, not necessarily packages. A new package is justified
only when a boundary gains enough independent lifecycle, reuse, or dependency
pressure.

## WebRTC Scope

The WebRTC adapter must implement only the transport layer:

- wrap an `RTCDataChannel` as a direct-peer `MessageTransport`
- reuse the shared transport core and runtime frame protocol
- accept an explicit bootstrap/signaling port for SDP/ICE exchange
- surface connection and negotiation failures as facts/errors-as-data

The WebRTC adapter must not own:

- general peer discovery
- membership
- mesh routing
- capability policy decisions
- lattice artifact coordination
- actor behavior semantics

Use `signaling` when the API is specifically about WebRTC SDP/ICE exchange. Use
`discovery` only for a broader peer-finding or bootstrap abstraction that can
support WebSocket seed lists, BroadcastChannel local discovery, mDNS, QR-code
pairing, libp2p, manual copy/paste, or other future mechanisms.

Conceptual shape:

```ts
const peer = await discovery.findPeer("browser-b");

const transport = createWebRtcMessageTransport({
  identity: localIdentity,
  signaling: peer.signaling,
});

await transport.connect(peer.identity);
```

The discovery record may carry signaling coordinates, but transport remains
responsible only for negotiating and using the direct data channel.

## Package Guidance

Do not create `@actor-web/discovery` only because WebRTC needs signaling.

Actor-Web should first prove the boundary through the WebRTC adapter and
labs-mesh implementation. A discovery package becomes appropriate when at least
two discovery/bootstrap mechanisms need a shared public contract beyond the
current `RuntimePeerDiscoveryProvider`, or when external users need to compose
discovery independently of the core runtime host.

Until then:

- keep identity and frame contracts in runtime
- keep WebRTC-specific SDP/ICE signaling on the WebRTC adapter surface
- keep mesh membership and routing in `@actor-web/labs-mesh`
- keep lattice coordination in `@actor-web/lattice`

## Consequences

- WebRTC can proceed without defining Actor-Web's entire distributed system
  model.
- Future libp2p, mDNS, QR-code pairing, Bluetooth, USB, or manual bootstrap work
  can plug into the discovery/bootstrap layer without changing transport
  semantics.
- Mesh routing remains above transport and can treat WebSocket, BroadcastChannel,
  WebRTC, and future media as direct-peer links.
- Public API examples should avoid implying that actor behavior depends on a
  concrete transport.
- Capability negotiation can evolve as a runtime protocol concern without being
  baked into one adapter.

## Open Questions

- Should `RuntimePeerDiscoveryProvider` be generalized beyond URL-shaped
  WebSocket records before the WebRTC adapter, or should WebRTC prove the next
  required shape first?
- Which capability vocabulary belongs in the runtime protocol versus
  application policy?
- Should protocol negotiation remain a runtime handshake field, or should it
  become a separate reusable negotiation helper once multiple protocol families
  exist?
- What observability facts should every distributed layer emit so FAS Studio can
  display nodes, capabilities, mesh health, and latency without exposing
  transport internals?
