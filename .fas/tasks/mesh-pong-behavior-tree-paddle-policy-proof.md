# Mesh Pong behavior-tree paddle policy proof

## Source

Created with `fas create-task` on 2026-07-08.

## Problem

Use Mesh Pong as the example-local proving ground for a deterministic behavior-tree paddle policy before promoting any public actor-web behavior-tree API. Refactor or add the controller layer so immediate paddle control is expressed as hierarchical synchronous policy choices such as incoming intercept, recovery, pressure line and guard center. The tree may consume strategy facts produced by the hybrid planner, but tree ticks must not perform network, clock or provider calls. Make selected paths visible in UI telemetry and tests so this layer can teach the difference between FSM phase legality, behavior-tree action selection and advisory planning.

## Acceptance criteria

- Mesh Pong includes an example-local deterministic behavior-tree-style paddle policy with named branches for intercept, recover, pressure or guard-center behavior.
- The behavior-tree policy consumes only current match/controller state and advisory facts already present in context; it performs no async, clock, network, provider or DOM work.
- UI telemetry exposes the selected behavior-tree path, selected action or intent, and enough state to explain why the branch won.
- Tests cover branch selection, fallback branch behavior, deterministic replay for the same snapshot, and non-blocking behavior when advisory facts are stale or absent.
- The README explains this as the next layer after FSM/session lifecycle and reflex control, and before generic actor-web behavior-tree API extraction.
- The implementation records whether behavior-tree support should remain example-local, become a pure helper, or feed the later actor-web control-policy primitive task.
- The task is queued after Mesh Pong hybrid reflex plus LLM planner mode and before actor-web Advisory Lane design.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- Public behavior-tree API first: rejected for this task. Prove the shape in Mesh Pong before promoting a public actor-web primitive.
- Async behavior-tree nodes: rejected. Advisory and provider work belongs in the advisory/planner layer, not tree ticks.

## Affected files

- examples/mesh-pong/pong-controller.ts
- examples/mesh-pong/pong-contract.ts
- examples/mesh-pong/ui/main.ts
- examples/mesh-pong/mesh-pong.test.ts
- examples/mesh-pong/README.md

## Scope Amendments

- Type: contract-alignment-prerequisite
- Added at: 2026-07-10
- Trigger: Cross-repo agent-native interaction contract alignment
- Reason: Behavior-tree proof must consume caller-authorized, revisioned advisory facts from the completed Mesh Pong contract-alignment slice.
- Evidence source: fas_staff_engineer handoff
- Evidence: fas_staff_engineer handoff | .fas/state/agent-orchestration-execution.json | Additive dependency after current room workflow and contract alignment; retain all prior dependencies.
- Accuracy signal: Queue graph shows task-1783716508291 blocks the behavior-tree proof.
- Follow-up needed: No public behavior-tree API extraction in this prerequisite change.

## Implementation plan

- Convert the supplied context into a scoped implementation plan before editing.
- Refresh affected-file scope before implementation if the generated hints are incomplete.

## Verification plan

- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- Validate generated scope, acceptance criteria, and verification evidence before closeout to avoid workflow drift.

## Dependencies

- Depends on task-1783535362939 Mesh Pong hybrid reflex controller plus LLM planner mode.
- Blocks task-1783536373178 Design actor-web Advisory Lane primitive for deadline-safe agents.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
