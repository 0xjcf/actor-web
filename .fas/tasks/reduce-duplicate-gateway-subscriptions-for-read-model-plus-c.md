# Reduce duplicate gateway subscriptions for read-model plus c

## Source

Created with `fas create-task` on 2026-05-14.

## Problem

Follow-up from Separate Ignite read-model sources from command surfaces: the recommended browser pattern can pair createActorWebReadModelClient or topology.actors.name.readModel with a separate commandSource for the same actor. Today the explicit command source opens a full gateway-backed source with its own hello/subscribe flow, creating a likely duplicate connection/subscription load tradeoff that is not documented or pinned by tests.

## Acceptance criteria

- If a lighter command-only path is introduced, legacy command-capable helpers remain compatible or receive migration guidance.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Add or document a lighter command path for explicit command sources so a UI can
  pair a projection-only read model with commands without forcing a second full
  projection subscription for the same actor.
- Keep existing command-capable helpers compatible, or document migration
  guidance if the recommended command path changes.
- Pin the behavior with tests so read-model sources remain projection-only and
  explicit command sources do not accidentally subscribe to duplicate
  snapshot/event/transition feeds.

## Alternatives considered

- List other approaches you evaluated and why they were rejected.

## Affected Files

- `packages/actor-core-runtime/src/runtime-gateway.ts`
- `packages/actor-core-runtime/src/actor-web-source.ts`
- `packages/actor-core-runtime/src/unit/runtime-gateway.test.ts`
- `packages/actor-core-runtime/src/unit/actor-web-source.test.ts`
- `docs/API.md`

## Scope Amendments

- Type: plan-correction
- Added at: 2026-05-18
- Trigger: root pre-delegation scope review
- Reason: The generated plan targeted FAS commit-plan and verification internals
  because the brief had no explicit affected files. This task is Actor-Web
  runtime/client work about gateway subscription load.
- Non-goal: Do not edit FAS platform planner, verification, or commit-plan
  internals for this task.

## Implementation plan

- Inspect current gateway `send`/`ask` command handling and browser command
  source connection behavior.
- Decide whether the smallest safe path is a command-only gateway subscription,
  a command frame that carries scope, or documentation-only migration guidance.
- Implement only the chosen path and preserve existing command-capable helpers.
- Add focused tests proving read-model plus explicit command use avoids a
  duplicate full projection subscription where the new path applies.
- Update API guidance for hosts that pair read-model clients with command
  sources.

## Verification plan

- Run focused runtime tests for gateway and browser source behavior.
- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- Command-only paths can weaken command authorization or scope resolution if they
  bypass the gateway's existing source resolution checks.
- A compatibility change can break legacy command-capable helpers if the command
  path no longer waits for gateway readiness correctly.
- Documentation-only guidance may be insufficient if duplicate subscriptions are
  still created by the recommended API path.

## Dependencies

- List blocking tasks, PRs, docs, or external inputs.

## Open questions

- Capture unresolved decisions that need confirmation before closeout.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
