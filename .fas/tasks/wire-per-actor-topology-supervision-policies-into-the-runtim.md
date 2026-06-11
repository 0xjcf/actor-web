# Wire per-actor topology supervision policies into the runtim

## Source

Created with `fas create-task` on 2026-06-11.

## Problem

Found during the SpawnOptions honesty task (2026-06-11). The topology DSL accepts per-actor supervision policies — actor({ supervision: { strategy: 'restart', maxRestarts: 3, withinMs: 60_000 } }) — and docs/site/concepts/supervision.md documents them as bounding restarts, but the runtime never consumes them: spawnActorWebActorInstance/spawnOwnedActorWebActors (actor-web-node-runtime.ts) used to collapse the policy to supervised: Boolean(...) (now removed), and applySupervisionStrategy (actor-system-impl.ts:3563) hardcodes directive 'restart' with the global MAX_RESTART_ATTEMPTS=3 / RESTART_WINDOW_MS=30000 constants for every failed actor. Custom maxRestarts/withinMs/strategy values are silently ignored — note the docs example (3 per 60s) differs from the actual global (3 per 30s). Implement: thread the ActorWebSupervisionPolicy from the actor descriptor through spawn (pass the policy object, not a boolean — see decisions.md 2026-06-11), store per-actor policy in the system, and have applySupervisionStrategy honor strategy/maxRestarts/withinMs with the global constants as fallback defaults. Include an opt-out/stop story for system actors if the design calls for it (guardian and system-event actor previously passed supervised: false expecting no restart — decide deliberately this time, with behavioral tests for the system-actor failure path). Until this lands, the supervision.md restart-policies section overstates per-actor bounds — fix the docs in this task if implementation is deferred. Acceptance: behavioral tests prove a custom maxRestarts/withinMs is honored and an exceeded policy escalates/stops per its strategy.

## Automation admission

- Expected operator value: Improves operator leverage around "Wire per-actor topology supervision policies into the runtime failure path" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- The defect no longer reproduces.
- A regression test covers the fix.
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

- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/actor-web-node-runtime.ts
- packages/actor-core-runtime/src/actor-system.ts
- docs/site/concepts/supervision.md

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
