# Runtime telemetry export and durable observability

## Summary

Add runtime-native telemetry export primitives so transport events can be written
to durable sinks before container and multi-machine deployment hardening. This
slice keeps OpenTelemetry out of the runtime package for now and builds on the
existing `RuntimeTransportTelemetryObserver` callback surface.

## Mode

- Workflow: 6-agent
- Verification lane: full
- Policy sensitivity: standard
- Blast radius: cross-cutting

## Scope

- Add reusable transport telemetry exporter and sink types.
- Add in-memory telemetry sink for deterministic tests.
- Add Node-only JSONL file sink for local durable telemetry evidence.
- Let `serveActorWebNode(...)` pass transport telemetry observers through to
  the Node WebSocket transport.
- Document how to use the exporter with topology runners.

## Non-Goals

- No OpenTelemetry dependency.
- No metrics backend, tracing backend, or database integration.
- No transport behavior changes.
- No changes to `MessageTransport`.

## Verification

- `pnpm test:runtime`
- `pnpm test:examples`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm architecture:check`
- `fas verify`
