# Decouple runtime gateway core projection contracts

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

## Scope Amendments

- Type: workflow-phase-correction
- Added at: 2026-05-15
- Trigger: fas implement selected validation phase and validation-only delegation for a brief that requires runtime contract implementation
- Reason: Make implementation scope explicit so FAS can plan a code-writing 6-agent workflow instead of a validation-only pass
- Added paths: packages/actor-core-runtime/src/runtime-gateway.ts, packages/actor-core-runtime/src/runtime-gateway-projection.ts, packages/actor-core-runtime/src/integration/fas-shared-contracts.ts, packages/actor-core-runtime/src/integration/ignite-element-bridge.ts, packages/actor-core-runtime/src/unit/runtime-gateway.test.ts, packages/actor-core-runtime/src/unit/fas-shared-contracts.test.ts, packages/actor-core-runtime/src/index.ts, packages/actor-core-runtime/src/browser.ts, docs/spikes/actor-web-adr-003-fas-integration-review.md
- Evidence source: root-plan-review
- Evidence: root-plan-review | .fas/state/planning.md | Planner selected phase=validation and delegated order fas_validator -> fas_documenter -> fas_reviewer despite Scope requiring define/move/preserve/add tests.
- Accuracy signal: high
- Follow-up needed: FAS phase detection should treat Scope and Acceptance Criteria implementation verbs as stronger than validation keywords in audit follow-up briefs.

- Type: architect-verification-correction
- Added at: 2026-05-15
- Trigger: fas_architect found the focused Vitest command used the root vitest.config.ts, which excludes packages/actor-core-runtime tests
- Reason: Use the package-local Vitest config and include a core projection typecheck proof file in planned scope
- Added paths: packages/actor-core-runtime/src/runtime-gateway-projection.typecheck.ts
- Evidence source: fas_architect-handoff
- Evidence: fas_architect-handoff | .fas/state/codex-orchestration.json | Architect recommended runtime-gateway-projection.ts as the core owner and a typecheck file mirroring fas-shared-contracts.typecheck.ts.
- Accuracy signal: high
- Follow-up needed: FAS verification-plan generation should understand package-local test configs in monorepos.

## Implementation plan

- Define runtime-native runtime gateway projection/event/transition types in core without FAS or Ignite imports
- Move FAS workflow snapshot/envelope/transition mapping behind the FAS integration edge
- Move Ignite source-to-gateway source creation behind the Ignite integration edge or compatibility wrapper
- Preserve existing public runtime gateway APIs through compatibility exports where required
- Add tests/type assertions proving core gateway contracts do not import FAS or Ignite adapter types

## Verification plan

- cd packages/actor-core-runtime && pnpm exec vitest run --config vitest.config.ts src/unit/runtime-gateway.test.ts src/unit/fas-shared-contracts.test.ts
- pnpm test:runtime
- pnpm typecheck
- pnpm architecture:check
- pnpm lint
- fas validate-task

## Affected files

- packages/actor-core-runtime/src/runtime-gateway.ts
- packages/actor-core-runtime/src/runtime-gateway-projection.ts
- packages/actor-core-runtime/src/integration/fas-shared-contracts.ts
- packages/actor-core-runtime/src/integration/ignite-element-bridge.ts
- packages/actor-core-runtime/src/unit/runtime-gateway.test.ts
- packages/actor-core-runtime/src/unit/fas-shared-contracts.test.ts
- packages/actor-core-runtime/src/index.ts
- packages/actor-core-runtime/src/browser.ts
- docs/spikes/actor-web-adr-003-fas-integration-review.md
- packages/actor-core-runtime/src/runtime-gateway-projection.typecheck.ts
