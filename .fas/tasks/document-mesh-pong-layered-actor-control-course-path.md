# Document Mesh Pong layered actor-control course path

## Source

Created with `fas create-task` on 2026-07-08.

## Problem

Turn the Mesh Pong progression into a course-style, operator-readable learning path once the proof layers and API decisions are complete. Document the sequence from session/match FSMs, deterministic reflex control, behavior-tree action selection, Advisory Lane planning, utility-policy scoring and public actor-web API extraction. The guide should explain what each layer buys actor-web and where the concept applies outside games, such as agent orchestration, smart-home automation, dispatch and workflow control.

## Acceptance criteria

- Adds a concise Mesh Pong layered-control guide or README section that teaches each layer in implementation order.
- Maps FSM, reflex controller, behavior tree, Advisory Lane and utility policy to concrete Mesh Pong files, telemetry and tests.
- Explains what each layer buys actor-web and when not to use it.
- Connects the pattern to at least two non-game actor-web scenarios such as agent orchestration, workflow control, smart-home automation or dispatch.
- References the final API decisions for withAdvisoryLane, behavior-tree and utility-policy support instead of presenting speculative APIs as shipped.
- The task is queued after the actor-web behavior-tree/utility-AI primitive evaluation task and does not block post-mesh claim gating unless that task records a concrete dependency.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- Course content before API decisions: rejected. The guide must not present speculative APIs as shipped.
- Mesh Pong-only documentation: rejected. The guide should teach the transferable actor-web pattern while staying grounded in the example.

## Affected files

- examples/mesh-pong/README.md
- docs/site/guides/mesh-pong-layered-control.md
- docs/site/concepts/actors-and-behaviors.md

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

- Depends on task-1783537940318 Evaluate behavior-tree and utility-AI primitives for actor-web behavior composition.
- Does not block task-1781880961715 Post-mesh scoping unless an earlier design task records a concrete mesh-claim dependency.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
