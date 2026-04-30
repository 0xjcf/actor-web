# Production discovery and secure deployment adapters

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

Static peers and Docker service DNS are sufficient for the current demos, but
Stage 3 needs deployment-managed peer discovery and secure runtime peer
admission across host boundaries. Actor-Web should define production adapter
contracts without hard-coding one infrastructure provider into the runtime.

## Mode

- Workflow: 6-agent
- Verification lane: full
- Policy sensitivity: standard
- Blast radius: cross-cutting

## Scope

- Extend or formalize discovery provider contracts for deployment-managed
  runtime peer endpoints.
- Add secure configuration guidance for runtime peer authentication in
  multi-machine deployments.
- Ensure rejected-peer diagnostics are visible through runtime status or
  telemetry.
- Document TLS expectations, secret rotation boundaries, and adapter
  responsibilities.
- Keep tests provider-neutral and avoid a cloud dependency on the default path.

## Non-Goals

- No production cloud provider implementation unless a small local adapter is
  necessary for proof.
- No full certificate management system.
- No broker-backed transport.
- No multi-machine logistics proof in this slice.

## Acceptance Criteria

- Runtime discovery can be backed by deployment-managed endpoint providers
  beyond static maps and Docker DNS.
- Runtime peer auth can be configured with deployment-managed secrets suitable
  for the later multi-machine proof.
- Rejected or stale peers are diagnosable through runtime status or telemetry.
- Docs clearly separate adapter contracts, TLS responsibilities, and secret
  rotation boundaries.
- Default tests remain local and deterministic.

## Implementation Plan

1. Inspect current runtime membership discovery provider APIs.
2. Identify gaps for deployment-managed endpoints and secure peer admission.
3. Add contract or option refinements needed for Stage 3.
4. Add deterministic tests for provider resolution and rejected peer
   diagnostics.
5. Update API docs and deployment design guidance.

## Verification

- `pnpm test:runtime`
- `pnpm lint`
- `pnpm typecheck`
- `fas verify`

## Dependencies

- Existing runtime peer discovery provider and runtime auth hooks.

## Risks

- Too much provider-specific behavior would make Actor-Web look like a
  deployment platform. Keep adapter responsibilities explicit and narrow.

## Open Questions

- What local provider shape best simulates production discovery without adding
  external infrastructure to CI?
