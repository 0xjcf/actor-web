# Decouple Runtime Gateway Core Projection Contracts

## Summary

Move FAS and Ignite-specific projection shapes out of runtime gateway core so the
gateway owns runtime-native contracts and integrations map at the edges.

## Audit Evidence

- `packages/actor-core-runtime/src/runtime-gateway.ts:1`
- `packages/actor-core-runtime/src/runtime-gateway.ts:43`
- `packages/actor-core-runtime/src/runtime-gateway.ts:80`
- `packages/actor-core-runtime/src/runtime-gateway.ts:172`
- `docs/spikes/actor-web-adr-003-fas-integration-review.md:201`

## Scope

- Define runtime-native gateway projection types in core.
- Move FAS workflow envelope mapping to the FAS integration edge.
- Move Ignite source mapping to the Ignite integration edge.
- Preserve public exports through compatibility wrappers where needed.
- Add tests proving core gateway projections do not depend on FAS or Ignite
  integration types.

## Non-Goals

- No behavior change to gateway frame delivery unless required by type cleanup.
- No FAS policy ownership changes.
- No Ignite rendering changes.

## Acceptance Criteria

- Core gateway contracts can be imported without pulling FAS or Ignite adapter
  types into the native runtime surface.
- FAS and Ignite mappings remain explicit, tested integration adapters.
- Public docs describe dependency direction consistently.
- Runtime typecheck and architecture checks pass.

## Suggested Mode

`6-agent`

## Verification

- `pnpm test:runtime`
- `pnpm typecheck`
- `pnpm architecture:check`
- `pnpm lint`
- `fas validate-task`
