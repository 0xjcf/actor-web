# [fas-studio] Fix extensionless ESM relative imports in actor

## Source

Created with `fas create-task` on 2026-06-09.

## Problem

Reported from the fas-studio integration (sibling repo at ../fas-studio) while relinking against the @actor-web/runtime rename. SYMPTOM: fas-studio's 3 runtime-importing vitest suites (runtime.test.ts, fas-shell.test.ts, xstate-dedupe.test.ts) fail to LOAD with: "Cannot find module '.../@actor-web/runtime/dist/actor-system' imported from '.../dist/actor-system-guardian.js'". 91 non-runtime tests pass; fas-studio typecheck is green, so this is purely a packaging/ESM-resolution defect, not an API issue. ROOT CAUSE: src/actor-system-guardian.ts uses extensionless relative imports ('./actor-system' lines 20-21, and './actor-instance') while sibling imports in the same file correctly use '.js' (./actor-ref.js, ./logger.js, ./utils/factories.js). The package is "type":"module" and tsconfig uses moduleResolution:bundler, which permits extensionless source imports but emits them verbatim into dist; Node's real ESM resolver (used by consumers like fas-studio under vitest) requires explicit extensions, so dist/actor-system-guardian.js cannot resolve './actor-system'. Exactly 1 offender currently breaks at runtime ('./actor-system'), but the source has additional extensionless relative imports that are latent failures. FIX: add explicit '.js' extensions to all relative sibling imports in actor-system-guardian.ts (and audit the wider src/ tree), and/or add a lint/build gate so extensionless relative imports cannot reach dist again. REPRO: in ../fas-studio run 'pnpm install && pnpm test' -> 3 suites fail to import.

## Acceptance criteria

- All relative sibling imports in packages/actor-core-runtime/src/actor-system-guardian.ts use explicit .js extensions (./actor-system.js, ./actor-instance.js)
- A repo-wide gate (lint rule or grep in verify) confirms no extensionless relative imports remain in emitted dist/*.js
- Downstream check: in ../fas-studio 'pnpm test' loads all runtime suites with no 'Cannot find module .../dist/actor-system' error
- actor-web verify.sh --full passes
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

- packages/actor-core-runtime/src/actor-system-guardian.ts

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

- None known at task creation.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
