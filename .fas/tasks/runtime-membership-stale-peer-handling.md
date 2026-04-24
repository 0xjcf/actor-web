# Runtime Membership and Stale Peer Handling

## Summary

Harden `NodeWebSocketMessageTransport` from a static-peer WebSocket prove-out into a basic membership-aware transport. This task adds peer lifecycle state, heartbeat timeout, identity/incarnation replacement rules, and stale socket rejection while keeping `MessageTransport` unchanged.

## Scope

- Add transport-specific peer state and peer snapshot inspection APIs.
- Add heartbeat interval/timeout options using internal WebSocket ping/pong frames.
- Replace peers when the same `nodeAddress` and `nodeId` reconnect with a different incarnation.
- Reject same `nodeAddress` with a different `nodeId`.
- Ignore and close frames from sockets that have been replaced.
- Keep connected notifications after validated peer registration.

## Out of Scope

- Auth/security.
- Durable replay/resync.
- Production backpressure.
- Dynamic peer discovery beyond static peer URLs/resolvers.

## Acceptance Criteria

- Peer state transitions are test-covered.
- Heartbeat timeout emits `__runtime.transport.disconnected`.
- Restart with same node id and new incarnation replaces the old peer.
- Identity conflict is rejected.
- Replaced sockets cannot deliver actor messages.
- Full verification passes with localhost socket permission.
