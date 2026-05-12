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

## Scope Amendments

- Type: architecture-scope
- Added at: 2026-05-12
- Trigger: fas_architect identified low-confidence retrieval and commit-plan
  drift toward unrelated CLI/graceful-shutdown files.
- Decision: keep this slice on runtime discovery/auth/status seams and
  provider-neutral docs/tests. Do not touch `packages/agent-workflow-cli`.
- Non-goals confirmed: no cloud-provider SDK, Kubernetes/Consul/Nomad adapter,
  broker transport, TLS/certificate manager, or multi-machine logistics proof.
- Follow-up needed: re-run planner and commit planning before spawning the
  code-writing senior engineer.

## Affected files

- packages/actor-core-runtime/src/runtime-peer-discovery.ts
- packages/actor-core-runtime/src/index.ts
- packages/actor-core-runtime/src/node.ts
- packages/actor-core-runtime/src/browser.ts
- packages/actor-core-runtime/src/unit/runtime-peer-discovery.test.ts
- packages/actor-core-runtime/src/unit/runtime-transport-status.test.ts
- packages/actor-core-runtime/src/unit/node-websocket-message-transport.test.ts
- packages/actor-core-runtime/src/unit/browser-websocket-message-transport.test.ts
- docs/API.md
- docs/actor-web-multi-process-deployment-demo-design.md
- docs/spikes/actor-web-external-transport-design.md

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
