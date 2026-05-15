# Make runtime ownership and accounting instance-scoped

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

## Scope Amendments

- Type: actor-web-scope-correction
- Added at: 2026-05-15
- Trigger: The generated commit plan selected FAS verification pipeline files even
  though the task brief targets Actor-Web runtime ownership hotspots.
- Reason: Make the Actor-Web runtime and component ownership scope explicit
  before delegated implementation starts.
- Added paths: packages/actor-core-runtime/src/actor-system-impl.ts, packages/actor-core-runtime/src/create-component.ts, packages/actor-core-runtime/src/unit/runtime-ownership.test.ts, packages/actor-core-runtime/src/unit/component-runtime-ownership.test.ts
- Removed planned paths: packages/actor-core-runtime/src/actor-system.ts
- Evidence source: root-plan-review
- Evidence: root-plan-review | .fas/state/commit-plan.json |
  plannedPathDetails referenced FAS verification files instead of Actor-Web
  runtime ownership files.
- Accuracy signal: high
- Follow-up needed: FAS commit-plan domain hints should prefer task brief audit
  evidence and explicit runtime file references over generic self-improvement
  verification hints.

## Implementation plan

- Move ActorSystemImpl actor ID generation, actor counts, maxActors enforcement,
  and getSystemStats totals to per-system state.
- Keep actor IDs unique inside each system and document any remaining
  time-based identity behavior without adding a new global service.
- Replace the createComponent process-wide actor-system singleton with explicit
  component runtime ownership supplied by component config or component-class
  factory options.
- Preserve existing component creation behavior through an isolated default
  runtime path when hosts do not provide one.
- Add focused multi-system and component runtime ownership regression coverage.

## Verification plan

- `pnpm --dir packages/actor-core-runtime exec vitest run --config vitest.config.ts src/unit/runtime-ownership.test.ts src/unit/component-runtime-ownership.test.ts`
- `pnpm test:runtime`
- `pnpm typecheck`
- `pnpm lint`
- `fas validate-task`
- `.fas/scripts/verify.sh --full` at final closeout.

## Affected files

- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/create-component.ts
- packages/actor-core-runtime/src/unit/runtime-ownership.test.ts
- packages/actor-core-runtime/src/unit/component-runtime-ownership.test.ts
