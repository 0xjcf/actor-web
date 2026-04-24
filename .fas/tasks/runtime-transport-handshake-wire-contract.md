# Runtime Transport Handshake and Wire Contract

## Summary

Prepare Actor-Web for production inter-node transport by defining a stable runtime wire contract and node handshake before adding a WebSocket transport adapter. This task keeps `MessageTransport` as the runtime seam and proves the contract through the existing in-memory transport harness.

## Scope

- Define runtime node identity, protocol version, handshake frames, transport frame envelopes, and validation helpers.
- Export the new contract types/helpers from `@actor-core/runtime`.
- Add tests for identity validation, frame validation, accepted handshakes, malformed frames, self-connection rejection, and incompatible protocol versions.
- Extend the in-memory transport harness so tests can opt into handshake-backed connect/disconnect.
- Update transport roadmap/API docs to record the handshake/wire contract slice as complete and WebSocket transport as next.

## Out of Scope

- Implementing `NodeWebSocketMessageTransport`.
- Adding new package dependencies.
- Changing `MessageTransport`.
- Implementing auth/security, durable replay, membership discovery, or exactly-once/idempotent delivery.

## Acceptance Criteria

- Runtime handshake rejects missing node identity, self-connections, incompatible protocol versions, and malformed frame envelopes.
- Existing remote send, ask, projection, reconnect, and sequence-gap behavior still passes under the in-memory transport.
- Focused checks pass: `pnpm test:runtime`, `pnpm typecheck`, `pnpm lint`, and `pnpm architecture:check`.
- Final `fas verify` passes.

## Review Notes

Use 6-agent mode conceptually because this touches public runtime contracts, architecture boundaries, test behavior, and future production transport design. Only one implementer writes code.
