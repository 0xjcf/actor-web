# Clean Up Stale Root Package Metadata

## Summary

Reconcile the root package metadata with the current workspace package model so
build, publish, and docs surfaces no longer point at stale root outputs.

## Audit Evidence

- `package.json:2`
- `package.json:5`
- `package.json:15`
- `package.json:119`
- `pnpm-workspace.yaml:1`
- `packages/actor-core-runtime/package.json:2`
- `packages/actor-core-testing/package.json:2`
- `packages/agent-workflow-cli/package.json:2`
- `README.md:21`
- `fas.domain-map.json:7`

## Scope

- Decide whether the root package is private workspace orchestration or a
  publishable package.
- Update root package name, scripts, files, exports, and publish settings to
  match that decision.
- Remove or regenerate stale root `dist` assumptions from docs and tooling.
- Align README package claims with the active workspace packages.
- Keep workspace package metadata intact.

## Non-Goals

- No runtime API changes.
- No package rename in downstream repos unless the metadata decision requires a
  documented migration.
- No unrelated dependency upgrades.

## Acceptance Criteria

- The root package no longer builds from missing `src/index.ts`.
- Publishable package surfaces match the active `packages/*` workspace model.
- README install/import examples match the authoritative package names.
- Package-oriented build and typecheck verification pass.

## Suggested Mode

`single-agent`

## Verification

- `pnpm typecheck`
- Package build command selected by the implementation plan
- `pnpm lint`
- `fas validate-task`
