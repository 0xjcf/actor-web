# Mesh Pong hybrid reflex controller plus LLM planner mode

## Source

Created with `fas create-task` on 2026-07-08.

## Problem

Add a hybrid AI player mode to Mesh Pong that mirrors game-engine AI architecture: a deterministic reflex controller predicts ball intercepts and moves the paddle immediately, while a slower MLX/LLM planner emits low-frequency strategy intents such as bias, aggression, or target selection. Keep the game simulation deterministic and keep provider calls in the imperative shell. Use the example to decide what should remain example-local versus what belongs in Actor-Web as reusable bounded-agent/deadline-aware control primitives.

## Acceptance criteria

- Mesh Pong exposes controller choices for Human, Reflex AI, LLM Planner, and Hybrid where Hybrid uses deterministic reflex movement plus low-frequency LLM strategy intents.
- The deterministic reflex layer can react to ball position/crossing/intercept windows without waiting on an LLM and without blocking render or simulation cadence.
- The LLM planner layer emits bounded strategy facts/intents at a lower cadence, with timeout/stale-strategy behavior and telemetry that distinguishes game-loop smoothness from planner delay.
- The UI makes the architecture visible with current controller mode, target/intercept or strategy status, decision age, and performance telemetry.
- Tests cover reflex-only, planner-only, hybrid fallback/stale-strategy behavior, and prove slow planner decisions do not stall simulation/render behavior.
- The README explains the game-engine pattern and why LLMs are planners/advisors rather than per-frame controllers.
- Architecture decision: record whether any reusable primitive should be baked into Actor-Web now, deferred as a follow-up, or kept example-local; if deferred, create or reference the follow-up scope.
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

- examples/mesh-pong/ui/main.ts
- examples/mesh-pong/pong-controller.ts
- examples/mesh-pong/pong-contract.ts
- examples/mesh-pong/mesh-pong.test.ts
- examples/mesh-pong/README.md

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

- Depends on task-1783516442115 Benchmark Mesh Pong MLX model and server strategy.
- Blocks task-1781880961715 Post-mesh scoping: membership graduation tier, cross-node supervision boundary, claim gating.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
