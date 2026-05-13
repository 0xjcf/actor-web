# Make Runtime Ownership and Accounting Instance-Scoped

## Summary

Remove process-global runtime accounting hotspots so multiple actor systems and
component runtimes can coexist without shared capacity, IDs, or hidden ownership.

## Audit Evidence

- `packages/actor-core-runtime/src/actor-system-impl.ts:252`
- `packages/actor-core-runtime/src/actor-system-impl.ts:739`
- `packages/actor-core-runtime/src/actor-system-impl.ts:842`
- `packages/actor-core-runtime/src/actor-system-impl.ts:922`
- `packages/actor-core-runtime/src/create-component.ts:179`
- `packages/actor-core-runtime/src/create-component.ts:421`
- `packages/actor-core-runtime/src/create-component.ts:529`
- `packages/actor-core-runtime/src/create-component.ts:624`

## Scope

- Move actor counts, ID generation, capacity enforcement, and stats to
  per-system state or an explicit injected identity service.
- Replace or isolate the global `createComponent` actor-system singleton.
- Keep component runtime acquisition explicit at the host-owned boundary.
- Add tests for multiple systems in one process.

## Non-Goals

- No full actor system rewrite.
- No topology API redesign unless required to make ownership explicit.
- No changes to unrelated component rendering behavior.

## Acceptance Criteria

- `maxActors` enforcement is instance-scoped.
- `getSystemStats()` reports instance-local totals.
- Multiple actor systems in one process do not share counters or IDs except
  through an explicitly documented identity service.
- Component runtime ownership is explicit and testable.

## Suggested Mode

`6-agent`

## Verification

- `pnpm test:runtime`
- Targeted multi-system and component ownership tests
- `pnpm typecheck`
- `pnpm lint`
- `fas validate-task`
