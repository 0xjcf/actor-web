# Runtime Membership Discovery Provider

## Summary

Add a runtime-native peer discovery provider interface so topology runners can
discover runtime peers dynamically instead of relying only on static `peers`
maps. Keep `MessageTransport` unchanged and keep direct WebSocket transport as
the first concrete topology.

## Scope

- Add discovery record, event, and provider types.
- Add an in-memory discovery provider for tests and local demos.
- Wire `serveActorWebNode(...)` and `startActorWebNode(...)` to:
  - seed peer URL resolution from discovery snapshots,
  - connect available discovered peers,
  - disconnect unavailable peers,
  - register/unregister a served node's listening URL when available.
- Preserve existing static `peers`, `peerUrlResolver`, and `connect` behavior.
- Export browser-safe discovery types/helpers from public entrypoints.

## Non-Goals

- No broker-backed discovery adapter.
- No Kubernetes, Consul, Redis, NATS, or filesystem implementation.
- No durable membership store.
- No change to `MessageTransport`.
- No production deployment scripts in this slice.

## Verification

- `pnpm test:runtime`
- `pnpm test:examples`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm architecture:check`
- `fas verify`
