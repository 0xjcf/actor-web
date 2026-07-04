# Add lattice-mode coordination example beside fas-agent-loop (orchestration baseline + stigmergic lattice + hybrid)

## Source

Created with `fas create-task` on 2026-06-11.

## Problem

Final step of the stigmergic-lattice spike execution order (spike direct-1781143982247; full analysis at .fas/artifacts/stigmergic-lattice-spike/analysis.md). Build an example like examples/fas-agent-loop that models the same Research -> Planning -> Coding -> Review workflow in the three coordination modes from the spike: (A) orchestration — a coordinator actor drives agents via ask/send; examples/fas-agent-loop is the starting point and may need updating to be a clean orchestration baseline (it currently mixes emit/subscribe choreography with a supervisor); (B) stigmergic lattice — agents declare dependsOn artifact types, publish artifacts to the LatticeActor, and activate on DEPENDENCY_SATISFIED, including the rework loop (review-findings everyVersion re-activating coding); (C) hybrid — coordinator publishes the kickoff artifact, registers a dependency on the final approved artifact, and acts as budget/timeout watchdog while agents self-organize through the lattice. Use deterministic tool fakes like fas-agent-loop does. This example is the proving ground for the lattice package and should land with docs walking through the three modes. Depends on: the lattice contract design doc (.fas/tasks/no-persistent-artifact-fact-store-or-dependency-activation-p.md) and the lattice implementation that follows it; the orchestration-baseline cleanup of fas-agent-loop can start earlier.

## Automation admission

- Expected operator value: Improves operator leverage around "Add lattice-mode coordination example beside fas-agent-loop (orchestration baseline + stigmergic lattice + hybrid)" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

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

- examples/fas-agent-loop/fas-topology.ts
- examples/fas-agent-loop/fas-behaviors.ts
- examples/fas-agent-loop/README.md
- examples/vitest.config.ts

## Scope Amendments

- Type: scope-refresh-promotion
- Added at: 2026-07-04
- Trigger: dirty-low-confidence-scope
- Reason: Promoted dirty low-confidence or dependency-reachable task-packet path(s) into affected scope.
- Added paths: examples/fas-agent-loop/fas-topology.ts
- Evidence source: task-packet dirty scope promotion
- Evidence: task-packet dirty scope promotion | .fas/state/task-packet.json | Promoted dirty path(s): examples/fas-agent-loop/fas-topology.ts
- Accuracy signal: Path was dirty in git status and present in task-packet low-confidence/dependency-reachable scope.

- Type: test-lane-alias
- Added at: 2026-07-04
- Trigger: examples-public-lattice-import
- Reason: The fas-agent-loop example now imports @actor-web/lattice by public package name, so the examples Vitest config needs workspace aliases for @actor-web/lattice and @actor-web/runtime/event-sourcing.
- Added paths: examples/vitest.config.ts
- Evidence source: closeout-readiness
- Evidence: closeout-readiness | .fas/state/closeout-readiness/latest.json | Plan alignment reported examples/vitest.config.ts as the only unexpected file after focused checks passed.
- Accuracy signal: The config change is limited to examples test-lane alias resolution and does not change runtime behavior.
- Follow-up needed: None; keep the alias as part of the example test support surface.

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
