# Node WebSocket Transport Prove-Out

## Summary

Implement the first real external inter-node Actor-Web transport using Node WebSockets. This slice keeps `MessageTransport` unchanged, uses the runtime handshake/wire contract, and proves two Actor-Web runtimes can communicate over localhost sockets.

## Scope

- Add a Node-only `NodeWebSocketMessageTransport` built on `ws`.
- Export the transport from `@actor-core/runtime` main entry only, not from `@actor-core/runtime/browser`.
- Support listener lifecycle, static peer URL resolution, handshake hello/accept/reject, runtime frame validation, send/receive, and disconnect notifications.
- Add unit tests for transport lifecycle, handshake, frame delivery, rejection, and disconnect behavior.
- Add runtime tests proving directory sync, remote send/ask, and Ignite snapshot/event projections over real WebSocket transports.
- Update API and transport roadmap docs.

## Out of Scope

- Browser cluster peers.
- Dynamic membership/discovery.
- Auth/security beyond handshake extension points.
- Durable replay, production backpressure, or exactly-once/idempotent delivery.

## Acceptance Criteria

- `connect(nodeAddress)` establishes a validated WebSocket peer connection and emits `__runtime.transport.connected`.
- `send(destination, message)` sends a validated `RuntimeTransportFrame` over an open socket.
- Inbound frames validate protocol, destination identity, sequence, and message shape before delivery.
- Socket close/error emits `__runtime.transport.disconnected`.
- Full verification passes with `fas verify`.
