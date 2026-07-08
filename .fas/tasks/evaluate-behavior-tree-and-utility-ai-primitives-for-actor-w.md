# Evaluate behavior-tree and utility-AI primitives for actor-web behavior composition

## Source

Created with `fas create-task` on 2026-07-08.

## Problem

Design whether actor-web should support deterministic behavior-tree or utility-AI composition alongside existing defineBehavior, withMachine, withFSM and the planned withAdvisoryLane API. Distinguish FSM transition legality, behavior-tree hierarchical/reactive selection, utility-AI scoring, and advisory-lane asynchronous planning. Decide whether these should become provider-neutral actor-web primitives, stay example-local, or be documented as composition patterns over existing APIs. Keep evaluation deterministic and side-effect-free; effects must still flow through actor behavior results, emits, or message plans.

## Acceptance criteria

- Audits existing actor-web behavior primitives including withMachine, withFSM, onTransition and the planned withAdvisoryLane API before proposing new surface area.
- Defines the difference between FSMs, behavior trees, utility AI and advisory lanes in actor-web terms, including which problems each should and should not solve.
- Evaluates whether any public API is warranted, such as defineBehavior().withBehaviorTree(...) or defineBehavior().withUtilityPolicy(...), versus keeping the concepts as pure libraries or examples.
- Requires behavior-tree and utility-scoring evaluation to be deterministic and synchronous; async model/provider calls belong in advisory lanes, not tree ticks or utility scorers.
- Maps the concepts to Mesh Pong AI control and at least one non-game actor or agent orchestration workflow.
- Records an explicit decision with implementation follow-up tasks only if a minimal public primitive is justified.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- Public behavior-tree primitive: possible, but only if it composes cleanly with `defineBehavior` and stays deterministic.
- Public utility-policy primitive: possible, but only if scoring is pure/synchronous and does not become an async model-call surface.
- Example-only pattern: acceptable if existing `withFSM`, `withMachine`, `onTransition` and Advisory Lane cover the real needs with less public API.
- External library integration: acceptable if actor-web only needs documentation and adapter examples rather than owning a new engine.

## Affected files

- docs/actor-web-control-policy-primitives-design.md
- docs/site/concepts/state-and-machines.md
- docs/site/concepts/actors-and-behaviors.md
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
- Does not block task-1781880961715 Post-mesh scoping unless the design records a concrete mesh-claim dependency.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
