# Separate Ignite Read-Model Sources From Command Surfaces

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
