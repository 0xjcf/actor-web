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
- `packages/actor-core-runtime/src/topology.ts`
- `packages/actor-core-runtime/src/unit/topology.test.ts`
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

- Type: architecture-decision
- Added at: 2026-05-18
- Trigger: fas_architect handoff
- Decision: Implement a bounded protocol-plus-source change. Add a
  backward-compatible gateway subscribe mode where `full` remains the default
  and explicit command sources can opt into `command-only`.
- Runtime scope: In `runtime-gateway.ts`, command-only subscribe must still use
  gateway auth and `resolveScope(scope, authContext)` as the admission boundary,
  register a stream that supports `send` and `ask`, and skip
  snapshot/event/transition subscriptions and replay work.
- Client scope: In `actor-web-source.ts`, explicit command helpers should opt
  into command-only mode and treat the first successful post-subscribe status as
  readiness instead of waiting for an initial snapshot. Legacy combined helpers
  must remain full subscriptions by default.
- Non-goal: Do not move scope onto every `send` or `ask` frame, do not bypass
  gateway-side scope resolution, and do not widen into socket pooling or
  transport changes.

- Type: QA-retry scope amendment
- Added at: 2026-05-18
- Trigger: fas_qa handoff after focused implementation review
- Reason: The topology convenience helpers are the public API path documented for
  split read-model plus explicit command-source usage. QA found that
  `source()` and `commandSource()` needed to preserve the intended compatibility
  split: legacy `source()` stays full and command-capable, while
  `commandSource()` uses the new command-only subscribe mode.
- Added source/test scope: `packages/actor-core-runtime/src/topology.ts` and
  `packages/actor-core-runtime/src/unit/topology.test.ts`.

## Implementation plan

- Inspect current gateway `send`/`ask` command handling and browser command
  source connection behavior.
- Implement the selected command-only subscribe mode in `runtime-gateway.ts`.
- Wire explicit browser command sources in `actor-web-source.ts` to use the
  command-only mode while keeping legacy combined helpers on full mode.
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
