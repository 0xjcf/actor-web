# Design actor-web policy composition and Behavior Graph runtime model

## Source

Created with `fas create-task` on 2026-07-08.

## Problem

Design actor-web's durable policy composition model and internal Behavior Graph runtime representation after Mesh Pong proves behavior-tree and utility-policy control layers. Distinguish lifecycle policy, execution policy, decision policy and advisory policy responsibilities, and define how `defineBehavior().withPolicy(...)` composes them without exposing one public API per algorithm. Decide whether behavior trees and utility scoring become provider-neutral policy implementations, stay example-local, or remain documented composition patterns over existing APIs. Keep deterministic policies synchronous and side-effect-free; effects must still flow through actor behavior results, emits, or message plans.

## Acceptance criteria

- Audits existing actor-web behavior primitives including `withMachine`, `withFSM`, `onTransition` and the planned advisory policy API before proposing new surface area.
- Defines lifecycle, execution, decision and advisory policy responsibilities in actor-web terms, including which problems each should and should not solve.
- Evaluates `defineBehavior().withPolicy(...)` as the preferred public authoring API, with algorithm-specific helpers only as optional declarations rather than required top-level methods.
- Defines an internal Behavior Graph model where policies become typed runtime nodes with names, kind, semantics, telemetry and replay metadata.
- Defines Behavior Services as internal runtime architecture only; users author policies, while the runtime executes lifecycle, execution, decision and advisory responsibilities through services.
- Specifies policy semantics metadata for built-in and custom policy kinds, including synchronous/asynchronous, deterministic, deadline-aware, stale-aware, replayable and distributable characteristics.
- Evaluates whether any algorithm-specific public API is warranted, such as `withBehaviorTree(...)` or `withUtilityPolicy(...)`, versus keeping them as pure helpers, policy implementations or examples.
- Requires behavior-tree and utility-scoring evaluation to be deterministic and synchronous; async model/provider calls belong in advisory policies, not tree ticks or utility scorers.
- Maps the concepts to Mesh Pong AI control and at least one non-game actor or agent orchestration workflow.
- Records an explicit decision with implementation follow-up tasks only if a minimal public policy primitive, Behavior Graph artifact or behavior-service runtime change is justified.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- Public behavior-tree primitive: possible, but only if it composes cleanly as a policy implementation and stays deterministic.
- Public utility-policy primitive: possible, but only if scoring is pure/synchronous and does not become an async model-call surface.
- Algorithm-specific `withBehaviorTree(...)`, `withUtilityPolicy(...)`, `withGOAP(...)` methods: rejected as the default direction because they grow the public API around technique names instead of durable policy responsibilities.
- Example-only pattern: acceptable if existing `withFSM`, `withMachine`, `onTransition`, advisory policy and pure helpers cover the real needs with less public API.
- External library integration: acceptable if actor-web only needs documentation and adapter examples rather than owning a new engine.
- Public Behavior Services API: rejected for now. Services are an internal runtime architecture concept behind the Behavior Graph, not an authoring surface.

## Affected files

- docs/actor-web-policy-composition-design.md
- docs/actor-web-behavior-graph-runtime-design.md
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
