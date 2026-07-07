---
title: Transport & multi-node
description: How runtime nodes talk to each other, delivery guarantees, and peer discovery.
---

# Transport & multi-node

A single topology can span multiple **nodes** — a server, a browser tab, a web
worker, a container. The **transport** is how those nodes exchange actor
messages. Crucially, behaviors don't know or care: addressing is
location-transparent, so an actor `send` resolves to an in-process mailbox or a
network hop transparently.

## Transport vs gateway

Two different edges, often confused:

- **Transport** — runtime-to-runtime. How *nodes* exchange actor messages
  (for example WebSocket between runtime hosts, or BroadcastChannel between
  same-origin browser contexts, or WebRTC `RTCDataChannel` between directly
  connected browser peers).
- **Gateway** — runtime-to-consumer. How a *UI* observes projections and sends
  commands (see [Sources & the gateway](/concepts/sources-and-gateway)).

## Delivery guarantees

Actor `send` is **at-most-once** by default — the same guarantee as Erlang. The
transport layer adds message ids, bounded duplicate suppression, and
acknowledgement/retry for *control* traffic, but user `send` semantics stay
at-most-once unless you build stronger guarantees on top. Design behaviors to
tolerate a dropped message rather than assume exactly-once.

**Cross-node subscription forwarding** carries the same guarantee. When a
topology `subscription` spans two nodes, the publisher node forwards each
emitted event to the subscriber actor on the peer node over this transport —
at-most-once, deduplicated only by the bounded frame window. Events emitted
before the subscriber's cross-node handshake is established, or while the peer
is down, are **dropped, not buffered**: there is no replay queue. The
subscriber node re-establishes the edge on reconnect, but events missed during
the outage stay missed.

## Membership & discovery

Nodes find each other through static peer maps or a runtime peer-discovery
provider. The transport tracks peer liveness (heartbeats, stale-socket
rejection, identity/incarnation replacement) so a reconnecting or replaced peer
is handled cleanly.

WebRTC keeps this split explicit: discovery and SDP/ICE signaling are
caller-owned, and the WebRTC adapter receives only a narrow bootstrap port that
opens or listens for `RTCDataChannel` instances. The adapter then runs the
runtime handshake and frame protocol over that direct channel.

## Backpressure

Outbound queues are bounded: a slow or saturated peer can't grow memory without
limit. Overflow surfaces as a rejected `send` with telemetry, not a silent leak.
Cross-node subscription forwards ride the same bounded queue: a forward to a
down or saturated peer drops and is logged, surfacing through the peer status —
it never blocks the publisher's emit or grows memory.

## Practical guidance

- Keep messages **JSON-serializable** — they may cross a wire.
- Don't assume ordering across *different* senders; do rely on FIFO from a single
  sender to a single recipient.
- Put durable state in adapters/stores, not actor memory, so a node restart
  doesn't lose it.
