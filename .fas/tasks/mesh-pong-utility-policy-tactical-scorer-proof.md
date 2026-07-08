# Mesh Pong utility-policy tactical scorer proof

## Source

Created with `fas create-task` on 2026-07-08.

## Problem

Use Mesh Pong to prove a deterministic utility-policy layer after the behavior-tree and Advisory Lane design layers. Add or refactor example-local tactical scoring so the player can rank valid actions such as intercept, center, pressure, bait or recover using synchronous utility scores from the current snapshot plus advisory strategy facts. Utility scoring must be deterministic, explainable and side-effect-free; async intelligence remains in Advisory Lane. The goal is to decide whether utility policies deserve a public actor-web primitive or should remain a pure composition pattern over defineBehavior.

## Acceptance criteria

- Mesh Pong includes an example-local deterministic utility scorer that ranks named tactical actions from the current snapshot and advisory facts.
- Utility scoring is pure, synchronous and replayable; it performs no async, clock, network, provider, DOM or random work.
- The scorer composes with the behavior-tree/reflex controller without replacing FSM phase legality or Advisory Lane planning responsibilities.
- UI telemetry exposes candidate action scores, selected action, rejected candidates and strategy facts used for scoring.
- Tests cover score ordering, tie or fallback behavior, stale or absent advisory facts, and deterministic replay for the same snapshot.
- The README explains utility AI as the layer that ranks valid tactical choices after deterministic branch selection and advisory facts exist.
- The task records whether utility-policy support should remain example-local, become a pure helper, or feed the later actor-web control-policy primitive task.
- The task is queued after actor-web Advisory Lane design and before the behavior-tree/utility-AI primitive evaluation task.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- Public utility-policy API first: rejected for this task. Prove scoring ergonomics in Mesh Pong before promoting a public actor-web primitive.
- Async scorers or LLM-in-the-score-loop: rejected. Slow intelligence belongs in Advisory Lane; utility scoring ranks current facts synchronously.

## Affected files

- examples/mesh-pong/pong-controller.ts
- examples/mesh-pong/pong-contract.ts
- examples/mesh-pong/ui/main.ts
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

- Depends on task-1783536373178 Design actor-web Advisory Lane primitive for deadline-safe agents.
- Blocks task-1783537940318 Evaluate behavior-tree and utility-AI primitives for actor-web behavior composition.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
