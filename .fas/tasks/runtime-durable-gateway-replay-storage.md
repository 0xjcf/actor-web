# Runtime durable gateway replay storage

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

Gateway replay/resync currently uses a bounded in-memory replay buffer. That is
enough for live projection gap recovery, but it does not survive server process
restart. Production deployment hardening needs a durable replay storage
boundary while preserving the gateway's role as a projection/control channel,
not runtime cluster transport.

## Mode

- Workflow: 6-agent
- Verification lane: full
- Policy sensitivity: standard
- Blast radius: cross-cutting

## Affected files

- `packages/actor-core-runtime/src/runtime-gateway.ts`
- `packages/actor-core-runtime/src/unit/runtime-gateway.test.ts`
- `packages/actor-core-runtime/src/index.ts`
- `docs/API.md`
- `docs/spikes/actor-web-external-transport-design.md`

## Scope

- Add a storage-provider interface for gateway replay frames.
- Keep the current bounded in-memory replay path as the default.
- Add deterministic durable test storage, preferably file-backed or
  in-memory-with-restart harness depending on existing runtime test patterns.
- Let gateway streams recover missed projection frames across server restart
  when durable replay storage is configured.
- Document the distinction between bounded replay, durable replay storage, and
  event sourcing.

## Non-Goals

- No database dependency in the default runtime package.
- No exactly-once delivery guarantee.
- No event-sourcing rewrite.
- No runtime transport retry/ack behavior changes.

## Acceptance Criteria

- Gateway replay storage is configured through an explicit provider boundary.
- Default behavior remains bounded in-memory replay with no storage dependency.
- A configured durable replay provider can recover missed projection frames
  across a server restart in tests.
- Docs state what durable replay does and does not guarantee.
- Existing source/gateway APIs remain compatible unless the commit plan
  explicitly approves a contract change.

## Implementation Plan

1. Inspect current gateway replay buffer ownership and source resync flow.
2. Define the smallest replay storage provider contract needed by that flow.
3. Wire provider-backed append/read behavior into the gateway.
4. Add deterministic restart/recovery tests.
5. Update API docs and the deployment roadmap with durable replay guidance.

## Verification

- `pnpm test:runtime`
- `pnpm test:examples`
- `pnpm lint`
- `pnpm typecheck`
- `fas verify`

## Dependencies

- Existing bounded gateway replay/resync implementation.

## Risks

- Over-generalizing the provider contract could lock in a premature storage
  abstraction. Keep it narrowly shaped around replay frames.

## Open Questions

- Should the first durable provider be Node-only file storage or a test-only
  harness plus documented external-provider contract?
