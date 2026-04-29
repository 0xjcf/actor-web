# Runtime Transport Message IDs and Idempotency

## Summary

Add runtime frame message IDs and bounded duplicate suppression to the Node and
browser WebSocket transports. This prepares retry/ack semantics without changing
`MessageTransport` or actor `send` delivery guarantees.

## Scope

- Add `messageId` to `RuntimeTransportFrame`.
- Validate runtime frame IDs in the shared wire contract.
- Track recently seen message IDs per peer with a bounded cache.
- Drop duplicate frames before delivering to runtime subscribers.
- Add telemetry and stats for duplicate drops and cache evictions.

## Non-Goals

- No retry/ack delivery behavior.
- No durable replay.
- No storage dependency.
- No change to `MessageTransport`.

## Verification

- `pnpm test:runtime`
- `pnpm test:examples`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm architecture:check`
- `fas verify`
