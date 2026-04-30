# Logistics provider runtime and container split

## Source

Created with `fas create-task --queue` on 2026-04-30 from the remaining work
in `docs/actor-web-multi-process-deployment-demo-design.md`.

## Roadmap Position

1. Logistics runtime topology and status panel
2. Logistics provider runtime and container split
3. Runtime durable gateway replay storage
4. Runtime restart-persistent idempotency
5. Production discovery and secure deployment adapters
6. Logistics multi-machine deployment prove-out
7. Actor-Web production operations runbooks

## Problem

The current Docker and localhost logistics slices prove server and worker
runtime boundaries, but Provider HQ remains server-owned. The roadmap goal is
to demonstrate server-owned, worker-owned, and provider/external actors as
distinct deployable units. Provider integration needs its own runtime boundary
before Stage 3 can honestly model a separate provider machine.

## Mode

- Workflow: 6-agent
- Verification lane: full
- Policy sensitivity: standard
- Blast radius: cross-cutting

## Scope

- Introduce a provider runtime process entrypoint for the selected provider
  integration slice.
- Move the chosen provider-owned actor or adapter boundary out of the server
  process while preserving the existing manual Provider HQ UI path.
- Route server-to-provider communication through Actor-Web runtime boundaries
  for this slice.
- Add an optional provider-runtime service to the logistics Compose topology.
- Show provider signal source in status: manual UI, simulator process, or
  provider container.
- Keep `pnpm examples:logistics` as the simple local developer path.

## Non-Goals

- No external provider API integration.
- No durable provider event store.
- No production deployment adapter.
- No broker-backed transport.

## Acceptance Criteria

- A provider runtime process can own the selected provider behavior or adapter.
- The server runtime communicates with provider runtime across an Actor-Web
  boundary for provider work covered by this slice.
- Docker Compose can run server, worker, provider, and web roles without
  breaking the existing three-service path when provider runtime is disabled.
- Provider status clearly distinguishes manual, simulator, and provider
  container sources.
- Existing provider console workflows continue to work.

## Implementation Plan

1. Choose the smallest provider-owned boundary that proves a separate runtime
   without rewriting the provider domain model.
2. Add a provider process entrypoint and topology node wiring.
3. Update server orchestration to call the provider boundary over Actor-Web
   transport for the selected path.
4. Extend Docker Compose and docs with the optional provider runtime.
5. Update logistics status/UI to expose provider source identity.
6. Add tests for provider runtime routing and compatibility with manual mode.

## Verification

- Focused logistics provider/runtime tests
- `pnpm test:examples`
- `pnpm test:runtime` if runtime topology APIs change
- `pnpm lint`
- `pnpm typecheck`
- `fas verify`
- `pnpm examples:logistics:docker:verify` when Compose behavior changes

## Dependencies

- Logistics runtime topology/status panel should land first so the provider
  runtime has an operator-facing place to appear.

## Risks

- Moving too much provider logic at once could destabilize the flagship demo.
  Keep the first provider runtime split intentionally narrow.

## Open Questions

- Should the first provider split move Provider HQ itself, or introduce a
  provider simulator/runtime adapter that Provider HQ delegates to?
