# Runtime Transport Observability Foundation

## Summary

Add runtime-native transport telemetry before auth, delivery, replay, and
backpressure hardening. This slice exposes public telemetry event and stats
types, adds optional observer callbacks to Node and browser WebSocket
transports, and provides immutable stats snapshots for tests and dashboards.

## Workflow

- Mode: 6-agent
- Verification lane: full
- Blast radius: cross-cutting
- Owner: implementer

## Scope

- Add public telemetry types exported from `@actor-core/runtime` and
  `@actor-core/runtime/browser`.
- Extend Node and browser WebSocket transport options with
  `telemetry?: RuntimeTransportTelemetryObserver`.
- Add `getStats()` and `getPeerStats(nodeAddress)` to both WebSocket
  transports.
- Track connection state, handshakes, disconnects, heartbeat timeouts, sent and
  received frames, malformed/validation drops, sequence gaps, and last-seen
  timestamps.

## Non-Goals

- No OpenTelemetry dependency.
- No auth/security implementation.
- No message id, retry, durable replay, or backpressure semantics.
- No `MessageTransport` interface change.

## Verification

- `pnpm test:runtime`
- `pnpm test:examples`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm architecture:check`
- `fas verify`

## Dependencies

- `.fas/tasks/runtime-transport-message-id-idempotency.md` should land first
  because observability for duplicate suppression, peer-level frame identity,
  and message-level correlation depends on stable runtime `messageId` handling.
- `.fas/tasks/runtime-transport-ack-retry-semantics.md` should land first
  because ack/retry counters, retry exhaustion signals, and pending-ack state
  are the reliability events this telemetry slice is expected to expose rather
  than invent independently.
