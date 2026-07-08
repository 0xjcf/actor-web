# Design actor-web Advisory Lane primitive for deadline-safe agents

## Source

Created with `fas create-task` on 2026-07-08.

## Problem

Define the actor-web-level Advisory Lane abstraction exposed by the Mesh Pong hybrid AI work: a provider-neutral runtime/control primitive for separating deadline-owned execution from asynchronous advisory planning. Specify API shape, scheduling semantics such as cadence, timeout/deadline and stale TTL, deterministic fallback and merge contracts, telemetry events, relation to actors, lattice artifacts and mesh distribution, and extraction criteria from the Mesh Pong example. The public authoring shape should compose through `defineBehavior().withAdvisoryLane(...)`; a `defineAdvisoryLane(...)` helper may exist only as a reusable declaration helper analogous to `defineFSM(...)`, not as a competing actor API. Actor-web must not import or name LLM providers; FAS and fas-local may define PlannerLane, ReviewerLane or other domain lanes on top of the primitive.

## Acceptance criteria

- Defines the vocabulary for execution lane, advisory lane, intent, fallback, deadline, stale advisory result, merge, and telemetry without coupling the primitive to AI or providers.
- States the responsibility split: actor-web owns scheduling, deadlines, fallback, merge and telemetry semantics; FAS or fas-local owns planner, reviewer, architect, prompt, provider, context and evidence policy.
- Provides a candidate low-ceremony API sketch centered on `defineBehavior().withAdvisoryLane(...)`, with an optional `defineAdvisoryLane(...)` declaration helper for reuse, and explains how it composes with existing actor behavior APIs.
- Rejects standalone public `createAdvisoryLane(...)` as the default API unless planning proves it is internal runtime machinery or an advanced escape hatch rather than a competing behavior authoring surface.
- Defines the lane options for cadence, timeout or deadline, stale TTL, fallback, merge, cancellation and telemetry hooks with explicit units and structured callback arguments.
- Maps the primitive to Mesh Pong hybrid reflex plus LLM planner behavior and at least one non-game actor or agent orchestration scenario.
- Defines observability requirements for advisory age, planner latency, stale or timed-out advisory results, fallback use, intent applied or ignored, and render or execution deadline health.
- Makes an explicit library decision: bake a minimal public primitive into actor-web, keep it experimental, or defer implementation with follow-up criteria based on evidence from Mesh Pong.
- The brief or design explains that the runtime owns execution and advisors only publish advisory facts or intents; no advisor may block the deadline path.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- `DecisionLane`: accurate but too easily implies the asynchronous lane owns the decision. Prefer `AdvisoryLane` unless planning finds a clearer provider-neutral name.
- Standalone `createAdvisoryLane(...)` public API: rejected as the default shape because it competes with `defineBehavior`. If retained, keep it internal or advanced; the idiomatic public surface should be `defineBehavior().withAdvisoryLane(...)`.
- LLM-specific lane APIs: rejected for actor-web. Provider, prompt, model, reviewer, architect, and planner concepts belong in FAS or fas-local layers that compose the generic primitive.

## Affected files

- docs/actor-web-advisory-lane-design.md
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

- Depends on task-1783535362939 Mesh Pong hybrid reflex controller plus LLM planner mode.
- Blocks task-1781880961715 Post-mesh scoping: membership graduation tier, cross-node supervision boundary, claim gating.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
