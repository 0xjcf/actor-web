# Runtime Transport Ack and Retry Semantics

## Summary

Add transport-level acknowledgement frames and bounded retry for retryable runtime
control traffic. User actor `send` remains at-most-once by default.

## Scope

- Add `runtime.transport.ack` frame shape and validation.
- Send acknowledgements for valid runtime frames.
- Track pending acknowledgements for retryable runtime control messages.
- Retry bounded internal `__runtime.*` traffic with the same `messageId`.
- Emit telemetry and stats for ack, retry, and retry exhaustion.

## Non-Goals

- No exactly-once delivery.
- No retry for user actor messages.
- No durable replay or persistent queues.
- No `MessageTransport` interface change.

## Verification

- `pnpm test:runtime`
- `pnpm test:examples`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm architecture:check`
- `fas verify`
