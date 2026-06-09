# Publish the first npm release: @actor-web/runtime + @actor-web/testing 0.1.0 (cli held)

## Source

Created with `fas create-task` on 2026-06-09.

## Problem

First public npm release of the @actor-web scope. Packages: @actor-web/runtime (0.1.0), @actor-web/testing (0.1.0), @actor-web/cli (currently 0.1.0-alpha). Nothing is published yet. KEY BLOCKER: @actor-web/runtime depends on @franchise/shared-contracts via a local 'file:../../../fas/packages/shared-contracts' path that cannot be published — resolve it first (vendor/inline the consumed contract types into the runtime, bundle it via tsup noExternal, or publish/replace it with a real dependency). Also: workspace:* deps in testing+cli must resolve to real version ranges on publish (pnpm publish rewrites the workspace protocol); add publishConfig {access: public} to every scoped package (first publish of a new scope needs --access public); align cli version with runtime/testing (drop -alpha or bump all together); add repository/homepage/bugs fields; give cli a 'files' allowlist (it has none); confirm the @actor-web npm org/scope exists and is owned. Publish order: runtime → testing → cli (consumers of runtime). Prefer npm provenance (publish from CI with --provenance) or document the local publish steps. Coordinate with the queued 'Stabilize the Ignite source contract' task, which finalizes the public API surface that ignite-element will import — that contract should be locked BEFORE the first publish. After publishing, ignite-element and fas-studio can switch from local file:/workspace deps to the published versions.

## Automation admission

- Expected operator value: Improves operator leverage around "Publish the first npm release of @actor-web/* (runtime, testing, cli)" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- @franchise/shared-contracts local file: dependency is removed from the published @actor-web/runtime (vendored, bundled, or replaced with a published dep) and 'npm pack'/'pnpm publish --dry-run' shows no unresolved local/workspace deps in the tarball
- All three packages have publishConfig.access=public, aligned versions, repository/homepage fields, and a correct 'files'/exports allowlist verified via npm pack contents
- Packages build cleanly (pnpm -r build) and are published in dependency order (runtime, then testing, then cli) to the public npm registry under the @actor-web scope
- Post-publish smoke check: a fresh external project can 'npm i @actor-web/runtime' and import defineBehavior/defineActorWebTopology/startRuntime/serveNode with working types
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- Scope unknown.

## Scope Amendments

- None.

## Implementation plan

- Convert the supplied context into a scoped implementation plan before editing.
- Refresh affected-file scope before implementation if the generated hints are incomplete.

## Verification plan

- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- Validate generated scope, acceptance criteria, and verification evidence before closeout to avoid workflow drift.

## Dependencies

- Decoupling design: docs/actor-web-decoupling-design.md — the @franchise/shared-contracts file: blocker is resolved by Seam B (delete the FAS bridge + dependency from actor-web; FAS owns the mapping), NOT by vendoring
- Should follow the actor-web neutralization tasks (FAS-seam + Ignite-seam) so 1.0 ships clean, decoupled public + wire contracts
- Coordinate with the reframed 'Stabilize the Ignite source contract' task

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
