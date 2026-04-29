# Runtime Transport Bounded Queues and Backpressure

## Summary

Add bounded outbound queues to Node and browser WebSocket transports so slow or
saturated peers cannot create unbounded memory growth. Keep `MessageTransport`
unchanged: overflow is reported as rejected `send(...)` work with telemetry and
stats.

## Scope

- Add per-peer `outboundQueueLimit`.
- Reject data frames when the outbound queue is full.
- Track queue depth, dropped outbound frames, and backpressure drops.
- Keep ack/heartbeat control frames direct and minimal.
- Preserve actor `send` semantics and existing retry behavior.

## Non-Goals

- No durable buffering.
- No broker adapter.
- No projection replay or resync.
- No automatic slow-consumer eviction beyond explicit overflow errors.

## Verification

- `pnpm test:runtime`
- `pnpm test:examples`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm architecture:check`
- `fas verify`
