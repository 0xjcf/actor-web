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
  (currently a WebSocket `MessageTransport`).
- **Gateway** — runtime-to-consumer. How a *UI* observes projections and sends
  commands (see [Sources & the gateway](/concepts/sources-and-gateway)).

## Delivery guarantees

Actor `send` is **at-most-once** by default — the same guarantee as Erlang. The
transport layer adds message ids, bounded duplicate suppression, and
acknowledgement/retry for *control* traffic, but user `send` semantics stay
at-most-once unless you build stronger guarantees on top. Design behaviors to
tolerate a dropped message rather than assume exactly-once.

## Membership & discovery

Nodes find each other through static peer maps or a runtime peer-discovery
provider. The transport tracks peer liveness (heartbeats, stale-socket
rejection, identity/incarnation replacement) so a reconnecting or replaced peer
is handled cleanly.

## Backpressure

Outbound queues are bounded: a slow or saturated peer can't grow memory without
limit. Overflow surfaces as a rejected `send` with telemetry, not a silent leak.

## Practical guidance

- Keep messages **JSON-serializable** — they may cross a wire.
- Don't assume ordering across *different* senders; do rely on FIFO from a single
  sender to a single recipient.
- Put durable state in adapters/stores, not actor memory, so a node restart
  doesn't lose it.
