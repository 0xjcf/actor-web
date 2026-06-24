# Complete .address.path migration tail + wire agent-workflow-cli into the test lane (qa-surfaced)

## Source

Created with `fas create-task` on 2026-06-24.

## Problem

Two `.address.path` reads survived the opaque-address migration (task-1781964585809) because they
live in a package/doc that no CI or verify gate exercises. Both are dormant (no functional impact on
the shipped runtime/examples) but are the exact `.address.path`-on-a-branded-string class the migration
eliminates, so they must be completed. Surfaced by the fas_qa review of that task.

## Fixes

1. `packages/agent-workflow-cli/src/host/runtime-host.test.ts` (~L173):
   `host.resolve(byKey?.address.path ?? '')` reads `.path` off a branded-string `ActorRef.address`
   (now `undefined`), so `resolve('')` returns `undefined` and the assertion would FAIL if executed.
   Change to `byKey?.address ?? ''` (the address string IS the path).

2. `docs/site/guides/multi-process-deployment.md` (~L50):
   `coordinator.system.lookup(topology.actors.plannerAgent.address.path)` → `.address`.

## Root cause of the blind spot (the real fix)

`agent-workflow-cli`'s vitest suite is invisible to both gates: the root `test` script is
`test:dom && test:runtime && test:examples` (no cli lane), CI (`.github/workflows/ci.yml:52`) runs
`pnpm test`, and `agent-workflow-cli/tsconfig.json` excludes `**/*.test.ts` from typecheck. So the
package's own tests can rot silently on any shared-contract change (this migration is the first
casualty). Wire `agent-workflow-cli` test into the test lane (root `test`/`test:all` or CI) so
`ActorRef`/address contract changes can't silently break it again.

## Acceptance summary

- Both `.address.path` reads migrated to `.address`; `pnpm --filter @actor-web/cli test` passes.
- `agent-workflow-cli` test suite runs in the verify/CI lane and is green.
- Optional hardening (fas_qa note): a targeted negative test that `_sender` must be a non-empty
  string (object/empty rejected) in `utils/validation.ts`.

## Acceptance criteria

- both .address.path reads migrated to .address; pnpm --filter @actor-web/cli test passes
- agent-workflow-cli test suite runs in the verify/CI test lane and is green
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

- packages/agent-workflow-cli/src/host/runtime-host.test.ts
- docs/site/guides/multi-process-deployment.md
- package.json
- .github/workflows/ci.yml

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
