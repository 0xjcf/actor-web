# Mesh Pong session lobby and human controller slots

## Source

Created with `fas create-task` on 2026-07-07.

## Problem

Follow-up from the Mesh Pong transport-parity demo. Extend examples/mesh-pong with a session-scoped lobby so each browser tab creates or resumes one PlayerSessionActor, claims a side, marks ready, and starts only after the required controller slots are present. Keep Pong behaviors transport-agnostic and keep controller/session coordination in the example shell. This covers two-human play across separate browser sessions and creates the controller-slot model needed for later LLM players.

## Acceptance criteria

- Opening two same-origin tabs creates two distinct active player sessions without duplicating one browser identity.
- Two-human mode requires both side controllers to be present and ready before START_MATCH is accepted.
- The UI exposes player-count and controller-type choices without adding Ignite-specific Actor-Web helper APIs.
- Human controller input is routed through session/controller actors while Pong ball, paddle, and score behaviors remain transport-agnostic.
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
- examples/mesh-pong/pong-contract.ts
- examples/mesh-pong/pong-behaviors.ts
- examples/mesh-pong/pong-topology.ts
- examples/mesh-pong/ui/index.html
- examples/mesh-pong/ui/main.ts
- examples/mesh-pong/mesh-pong.test.ts

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

- Depends on task-1781724531725 Build Mesh Pong example. Blocks task-1783452033293 Mesh Pong MLX LLM controller adapter and player modes.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
