# Define actor-web artifact actor registry contract for Ignite ArtifactSpec interop

## Source
Created with `fas create-task` on 2026-07-09.

## Problem
Design the provider-neutral Actor-Web contract that lets Ignite structured ArtifactSpec records be hosted as actor/lattice-backed artifacts without Actor-Web owning Ignite rendering, provider dialects, voice adapters, or JSX. Define stable artifact ids, lifecycle commands, read models, event and fact shape, relation to Behavior Graph nodes, source and topology routing, optional gateway transport needs, and how Ignite can consume the contract through its existing source and igniteTools surface. This is a design task, not implementation.

## Acceptance criteria
- Defines what Actor-Web owns vs Ignite owns for structured artifact actors
- Specifies stable artifact identity, commands, events, read models, validation, errors-as-data, and observation semantics
- Maps ArtifactSpec-style checklist, form, status-card, and dashboard records to actor and lattice concepts without importing Ignite-specific UI concerns into Actor-Web core
- Explains dependency on Behavior Graph policy composition and lattice observation vocabulary
- Produces a follow-up implementation slice only if the design identifies a minimal provider-neutral runtime primitive
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

- docs/actor-web-artifact-actor-registry-design.md
- docs/actor-web-behavior-graph-runtime-design.md
- docs/site/concepts/actors-and-behaviors.md
- docs/site/concepts/lattice-and-artifacts.md

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

- Depends on task-1783537940318 Design actor-web policy composition and Behavior Graph runtime model.
- Depends on task-1783116444735 Design observation vocabulary for lattice artifact sources.
- Does not block task-1781880961715 Post-mesh scoping unless the design records a concrete location-transparency claim dependency.

## Open questions
- None captured at task creation.

## Artifact links
- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
