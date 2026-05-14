# Separate Ignite read-model sources from command surfaces

## Summary

Resolve the cross-repo contract conflict where Ignite-facing source and gateway
surfaces expose command/control paths while docs describe Ignite as a projection
and read-model consumer.

## Audit Evidence

- `packages/actor-core-runtime/src/integration/ignite-element-bridge.ts:26`
- `packages/actor-core-runtime/src/integration/ignite-element-bridge.ts:189`
- `packages/actor-core-runtime/src/runtime-gateway.ts:55`
- `packages/actor-core-runtime/src/runtime-gateway.ts:277`
- `docs/API.md:21`
- `docs/API.md:842`
- `docs/operations/actor-web-production-operations.md:29`

## Scope

- Split read-model source APIs from command/control APIs, or explicitly gate the
  command path outside the Ignite read-model adapter.
- Align runtime gateway source docs, Ignite bridge docs, and operations docs.
- Preserve the ability for a host-owned runtime boundary to issue commands.
- Add or update contract tests around the Ignite read-model boundary.

## Non-Goals

- No Ignite implementation changes unless the contract requires fixtures.
- No removal of Actor-Web command APIs from runtime-owned surfaces.
- No broad public API redesign beyond the conflicting boundary.

## Acceptance Criteria

- Ignite-facing read-model consumers are not required to hold mutation-capable
  `send` or `ask` handles.
- Current-state docs no longer claim both read-only consumption and command
  ownership for the same surface.
- Host-owned command/control usage remains explicit and test-covered.
- Focused bridge and runtime tests pass.

## Suggested Mode

`6-agent`

## Verification

- `pnpm test:runtime`
- Relevant Ignite bridge or gateway source tests
- `pnpm typecheck`
- `pnpm lint`
- `fas validate-task`

## Scope Amendments

- Type: audit-scope-correction
- Added at: 2026-05-14T19:40:43Z
- Trigger: Generated commit plan targeted FAS verification pipeline and logistics tests instead of Ignite read-model, runtime gateway, and docs surfaces cited by the task brief
- Reason: Limit implementation to Ignite read-model boundary, host-owned command/control gateway behavior, focused bridge/gateway tests, and docs alignment
- Added paths: packages/actor-core-runtime/src/integration/ignite-element-bridge.ts, packages/actor-core-runtime/src/unit/ignite-element-bridge.test.ts, packages/actor-core-runtime/src/runtime-gateway.ts, packages/actor-core-runtime/src/unit/runtime-gateway.test.ts, docs/API.md, docs/operations/actor-web-production-operations.md
- Evidence source: root plan review
- Evidence: root plan review | .fas/state/commit-plan.json | planned paths were unrelated to .fas/tasks/separate-ignite-read-model-sources-from-command-surfaces.md audit evidence
- Accuracy signal: high
- Follow-up needed: Regenerate commit plan before fas_architect and fas_senior_engineer steps

- Type: architecture-scope-expansion
- Added at: 2026-05-14T19:44:00Z
- Trigger: fas_architect found the corrected plan still omitted public browser/topology source surfaces that export command-capable sources
- Reason: Include the public Actor-Web source/client/topology/serve surfaces needed to make Ignite read-model consumption projection-only while preserving explicit host-owned command/control opt-in
- Added paths: packages/actor-core-runtime/src/integration/ignite-element-bridge.ts, packages/actor-core-runtime/src/unit/ignite-element-bridge.test.ts, packages/actor-core-runtime/src/runtime-gateway.ts, packages/actor-core-runtime/src/unit/runtime-gateway.test.ts, packages/actor-core-runtime/src/actor-web-source.ts, packages/actor-core-runtime/src/unit/actor-web-source.test.ts, packages/actor-core-runtime/src/actor-web-client.ts, packages/actor-core-runtime/src/topology.ts, packages/actor-core-runtime/src/unit/topology.test.ts, packages/actor-core-runtime/src/browser.ts, packages/actor-core-runtime/src/index.ts, docs/API.md, docs/operations/actor-web-production-operations.md, docs/actor-web-topology-source-dx-design.md
- Evidence source: fas_architect handoff
- Evidence: fas_architect handoff | .fas/state/commit-plan.json | commit-plan path details included bridge/gateway/docs, but step list omitted source implementation and public source API files
- Accuracy signal: high
- Follow-up needed: Regenerate commit plan and have fas_staff_engineer produce a bounded execution brief before code writing

## Affected files

- packages/actor-core-runtime/src/integration/ignite-element-bridge.ts
- packages/actor-core-runtime/src/unit/ignite-element-bridge.test.ts
- packages/actor-core-runtime/src/runtime-gateway.ts
- packages/actor-core-runtime/src/unit/runtime-gateway.test.ts
- docs/API.md
- docs/operations/actor-web-production-operations.md
- packages/actor-core-runtime/src/actor-web-source.ts
- packages/actor-core-runtime/src/unit/actor-web-source.test.ts
- packages/actor-core-runtime/src/actor-web-client.ts
- packages/actor-core-runtime/src/topology.ts
- packages/actor-core-runtime/src/unit/topology.test.ts
- packages/actor-core-runtime/src/browser.ts
- packages/actor-core-runtime/src/index.ts
- docs/actor-web-topology-source-dx-design.md
