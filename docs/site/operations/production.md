---
title: Production operations
description: Deployment lanes, runtime status, telemetry, and incident triage for Actor-Web runtimes.
---

# Production operations

Actor-Web ships a local-first runtime plus the pieces needed to run nodes in
production — transport, gateway, telemetry, and discovery. This page is the map;
the full procedures live in the
[Production Operations Runbook](https://github.com/0xjcf/actor-web/blob/main/docs/operations/actor-web-production-operations.md).

## Deployment lanes

The runbook defines progressive lanes — local demo, staging, production — so you
adopt only the hardening you need. Each lane is explicit about what is proven vs.
what an app must still provide (durable storage, secrets, TLS).

## Ownership boundary

Actor-Web owns runtime behavior, transport, gateway projection, and telemetry
*surfaces*. Your deployment owns process supervision, TLS termination, secret
rotation, durable storage, and alerting. The runbook draws this line precisely so
nothing falls between the two.

## Runtime status & telemetry

- **Status** — each served node exposes a runtime status surface (peers,
  transport health, gateway streams) for liveness checks and dashboards.
- **Telemetry** — transport events can be exported to a durable sink (JSONL by
  default) for inspection; OpenTelemetry wiring is left to the app.

## Incident triage

The runbook includes focused runbooks for the failure modes the transport layer
surfaces:

- Stale-peer and rejected-peer triage (membership/incarnation issues).
- Replay recovery (gateway sequence gaps).
- Duplicate-drop and backpressure incidents (delivery and queue limits).

Each is a short, observable checklist tied to the telemetry the runtime emits.

## Delivery guarantees in production

Actor `send` is **at-most-once** by default. Transport adds idempotency and
retry for *control* traffic, but design application behaviors to tolerate a
dropped message rather than assume exactly-once. See
[Transport](/concepts/transport).

::: warning Not yet production-hardened
Some surfaces (durable replay providers, full OTel integration, hardened node
transport) are intentionally incomplete and tracked as follow-ups in the runbook.
Treat the lanes above as a maturity gradient, not a finished SRE platform.
:::
