# Runtime Gateway Replay and Resync

## Summary

Add bounded gateway replay and source-side sequence gap recovery so projection
clients can request missed frames after a stream gap. If the gateway cannot
satisfy the requested range from its bounded in-memory replay buffer, it falls
back to a fresh latest snapshot and resumes live updates.

## Scope

- Add a configurable gateway replay buffer for snapshot, event, and transition
  frames.
- Preserve stream sequencing and replay frames without changing
  `MessageTransport`.
- Teach gateway-backed sources to detect sequence gaps and request resync from
  the first missing sequence.
- Accept latest-snapshot fallback during resync as an authoritative catch-up
  point.
- Keep this slice storage-free; durable replay providers remain future work.

## Non-Goals

- No database or durable event store dependency.
- No exact-once delivery guarantees.
- No transport retry/ack changes.
- No gateway auth or backpressure changes beyond already completed slices.

## Verification

- `pnpm test:runtime`
- `pnpm test:examples`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm architecture:check`
- `fas verify`
