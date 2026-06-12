# Add CI test workflow: run verify lanes on every PR

## Source

Created with `fas create-task` on 2026-06-12.

## Problem

Release gate (decided 2026-06-12). PRs currently run only docs build + contrast — the test suite, typecheck, lint, and boundaries run only locally via verify.sh. Add .github/workflows/ci.yml running the verify.sh lanes (format, lint, typecheck, test, architecture drift, behavior boundaries) on pull_request and main push, with pnpm/node setup mirroring docs.yml. Keep it one job or a small matrix; the semantic-index lane can stay local if it needs FAS platform access. Make it a required check once green.

## Acceptance criteria

- The new functionality works as described.
- Existing behavior is not broken.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- .github/workflows/ci.yml
- architecture.boundaries.json
- package.json
- pnpm-lock.yaml
- tsconfig.json
- examples/vite.config.ts
- examples/vitest.config.ts
- examples/fas-agent-loop/fas-agent-loop-element.tsx
- examples/ignite-headless-host/ignite-headless-host-element.tsx
- examples/ignite-headless-host/logistics-runtime-status-panel.tsx
- examples/ignite-headless-host/provider-console.tsx

## Scope Amendments

- 2026-06-12: Added `architecture.boundaries.json`. The CI architecture lane
  (`pnpm architecture:check`) fails on main because the boundary map still
  references `fas-shared-contracts.ts`/`fas-shared-contracts.typecheck.ts`,
  removed in a81beee. CI cannot ship green without dropping the stale paths.
- 2026-06-12: Added the ignite-element@beta migration set (human-approved).
  CI typecheck fails because examples resolve ignite-element through tsconfig
  paths and vite aliases into the sibling `../ignite-element` checkout, which
  does not exist in CI. Fix: depend on the published `ignite-element@3.0.0-beta.4`
  and use only its public API — drop the sibling path mappings/aliases and the
  redundant `ignite-element/renderers/ignite-jsx` side-effect imports (the
  public adapter entry registers the ignite-jsx render strategy itself).

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
