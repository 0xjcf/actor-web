# Logistics multi-process deployment prove-out

## Summary

Prove the logistics Actor-Web demo can run runtime nodes as separate localhost
processes before moving to container and multi-machine deployment docs. This
slice keeps the existing single-command demo path, but adds explicit server and
worker process entrypoints plus a regression test that verifies REST ingress,
gateway status, and server-to-worker Actor-Web transport across process
boundaries.

## Mode

- Workflow: 6-agent
- Verification lane: full
- Policy sensitivity: standard
- Blast radius: cross-cutting

## Scope

- Add process entrypoints for the logistics server runtime and worker runtime.
- Keep the browser host as a thin Ignite projection host.
- Keep provider HQ as REST/gateway-driven demo behavior; no separate provider
  runtime process in this slice.
- Use static runtime peer discovery from the worker process to the server
  transport URL.
- Add scripts for starting the server and worker processes directly.
- Add a black-box example test that spawns the server and worker as separate
  processes, creates a shipment through REST, and verifies the server applies a
  worker-owned route plan.

## Non-Goals

- No Docker Compose implementation yet.
- No dynamic service registry beyond the existing discovery provider surface.
- No auth, retry, replay, or backpressure behavior changes.
- No changes to `MessageTransport`.

## Verification

- `pnpm test:examples`
- `pnpm test:runtime`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm architecture:check`
- `fas verify`
