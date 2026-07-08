# Decouple Mesh Pong simulation and render loop from MLX inference turns

## Source
Created with `fas create-task` on 2026-07-08.

## Problem
Stop pausing deterministic physics and rendering while model requests are in flight. Treat MLX output as a low-frequency paddle intent with bounded timeout, cancellation, and stale-intent policy. Preserve the session/player-slot protocol and transport parity surface while keeping provider calls in the imperative shell.

## Automation admission
- Expected operator value: Improves operator leverage around "Decouple Mesh Pong simulation and render loop from MLX inference turns" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria
- The render loop and deterministic simulation cadence continue while one or both MLX controller requests are pending.
- Each MLX side applies a deterministic last-known, neutral, or stale-intent policy instead of blocking the game clock.
- Controller request concurrency is bounded per side and status updates distinguish awaiting-controller-decision from game-paused or unavailable.
- Tests prove a slow fake MLX provider does not stall simulation ticks and does not regress human or transport-parity behavior.
- The functional Pong behaviors remain deterministic and free of network, clock, and provider reads.
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
- examples/mesh-pong/README.md
- examples/mesh-pong/mesh-pong.test.ts
- examples/mesh-pong/pong-controller.ts
- examples/mesh-pong/ui/main.ts

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
- Depends on task-1783516419352 Mesh Pong performance telemetry and lag budget. Blocks task-1783516442115 Benchmark Mesh Pong MLX model and server strategy.

## Open questions
- None captured at task creation.

## Artifact links
- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
