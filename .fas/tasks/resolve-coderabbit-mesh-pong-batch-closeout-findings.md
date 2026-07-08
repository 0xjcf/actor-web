# Resolve CodeRabbit Mesh Pong batch closeout findings

## Source

Created with `fas create-task` on 2026-07-07.

## Problem

CodeRabbit committed review for the Mesh Pong batch found three closeout issues: ready button copy does not distinguish ready state, player/lobby handlers should reject unknown or malformed messages instead of falling through with undefined fields, and the browser MLX provider fetch needs a bounded timeout.

## Acceptance criteria

- Ready button copy distinguishes ready and not-ready local session states.
- Player-session and lobby behavior handlers return safe error facts for unknown or malformed messages.
- Browser MLX provider fetches use a bounded timeout and return a timeout failure instead of hanging.
- Mesh Pong tests cover the closeout fixes.
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

- examples/mesh-pong/ui/main.ts
- examples/mesh-pong/pong-contract.ts
- examples/mesh-pong/pong-behaviors.ts
- examples/mesh-pong/mlx-provider.ts
- examples/mesh-pong/mesh-pong.test.ts

## Scope Amendments

- Added 2026-07-07: `pong-contract.ts` is required so malformed player-session
  and lobby commands can return explicit `invalid-command` facts instead of
  overloading existing missing-controller or side-unclaimed reasons.

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
