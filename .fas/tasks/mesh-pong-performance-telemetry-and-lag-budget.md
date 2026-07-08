# Mesh Pong performance telemetry and lag budget

## Source
Created with `fas create-task` on 2026-07-08.

## Problem
Add visible and testable Mesh Pong performance telemetry so the example exposes render cadence, simulation cadence, MLX controller latency, controller in-flight state, dropped or held ticks, and last-applied intent age. This should make the current lag attributable before changing scheduling. Keep telemetry in the example shell and return facts as data; do not move timing or provider calls into Pong functional behaviors.

## Acceptance criteria
- The UI exposes a compact performance/debug panel that distinguishes render loop health, deterministic simulation tick health, and MLX controller latency/in-flight state.
- The example records enough structured metrics to answer whether lag is caused by model latency, tick gating, transport delivery, or rendering.
- Tests cover the telemetry reducer, formatter, or equivalent deterministic surface without requiring a live MLX server.
- Documentation explains the expected local latency budget and how to interpret the metrics.
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
- Depends on task-1783452033293 Mesh Pong MLX LLM controller adapter and player modes. Blocks task-1783516431222 Decouple Mesh Pong simulation and render loop from MLX inference turns.

## Open questions
- None captured at task creation.

## Artifact links
- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
