# Design actor-web advisory policy for deadline-safe advice

## Source

Created with `fas create-task` on 2026-07-08.

## Problem

Define the actor-web-level advisory policy abstraction exposed by the Mesh Pong hybrid AI work: a provider-neutral runtime/control primitive for separating deadline-owned execution from asynchronous advisory planning. Specify API shape, scheduling semantics such as cadence, timeout/deadline and stale TTL, deterministic fallback and merge contracts, telemetry events, relation to actors, lattice artifacts and mesh distribution, and extraction criteria from the Mesh Pong example. The preferred public authoring shape should compose through `defineBehavior().withPolicy({ kind: "advisory", ... })`; a `defineAdvisoryPolicy(...)` helper may exist only as a reusable declaration helper analogous to `defineFSM(...)`, not as a competing actor API. Actor-web must not import or name LLM providers; FAS and fas-local may define PlannerLane, ReviewerLane or other domain lanes on top of the primitive.

## Acceptance criteria

- Defines the vocabulary for execution policy, advisory policy, intent, fallback, deadline, stale advisory result, merge, and telemetry without coupling the primitive to AI or providers.
- States the responsibility split: actor-web owns scheduling, deadlines, fallback, merge and telemetry semantics; FAS or fas-local owns planner, reviewer, architect, prompt, provider, context and evidence policy.
- Provides a candidate low-ceremony API sketch centered on `defineBehavior().withPolicy({ kind: "advisory", ... })`, with an optional `defineAdvisoryPolicy(...)` declaration helper for reuse, and explains how it composes with existing actor behavior APIs.
- Evaluates whether `withAdvisoryLane(...)` should exist only as an ergonomic alias, stay internal, or be omitted in favor of the unified `withPolicy(...)` surface.
- Rejects standalone public `createAdvisoryLane(...)` as the default API unless planning proves it is internal runtime machinery or an advanced escape hatch rather than a competing behavior authoring surface.
- Defines the lane options for cadence, timeout or deadline, stale TTL, fallback, merge, cancellation and telemetry hooks with explicit units and structured callback arguments.
- Maps the primitive to Mesh Pong hybrid reflex plus LLM planner behavior and at least one non-game actor or agent orchestration scenario.
- Defines observability requirements for advisory age, planner latency, stale or timed-out advisory results, fallback use, intent applied or ignored, and render or execution deadline health.
- Defines the advisory policy node semantics needed by the later Behavior Graph runtime model, including deterministic/replay visibility, deadline-awareness, cancellation, and stale-state reporting.
- Makes an explicit library decision: bake a minimal public advisory policy primitive into actor-web, keep it experimental, or defer implementation with follow-up criteria based on evidence from Mesh Pong.
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

- `DecisionLane`: accurate but too easily implies the asynchronous lane owns the decision. Prefer `advisory policy` unless planning finds a clearer provider-neutral name.
- Standalone `createAdvisoryLane(...)` public API: rejected as the default shape because it competes with `defineBehavior`. If retained, keep it internal or advanced; the idiomatic public surface should be `defineBehavior().withPolicy({ kind: "advisory", ... })`.
- `withAdvisoryLane(...)` as the primary public API: demoted from target shape. It may be an alias if it clearly improves DX, but the durable authoring model should be policy composition.
- LLM-specific lane APIs: rejected for actor-web. Provider, prompt, model, reviewer, architect, and planner concepts belong in FAS or fas-local layers that compose the generic primitive.

## Affected files

- docs/actor-web-advisory-policy-design.md
- docs/site/concepts/actors-and-behaviors.md
- examples/mesh-pong/README.md

## Scope Amendments

- Type: revisioned-advisory-contract
- Added at: 2026-07-10
- Trigger: Mesh Pong agent-native interaction contract alignment
- Reason: The design must define provider-neutral revisioned proposal envelopes, canonical tick and age admission, typed timeout/stale/superseded/cancelled outcomes, deterministic fallback, and example-local policy ownership before generic extraction.
- Evidence source: Cross-repo agent-native interaction contract amendment
- Evidence: Cross-repo agent-native interaction contract amendment | No public createAdvisoryLane API; models propose, deterministic behavior admits and persists control facts.
- Accuracy signal: The follow-up conformance proof demonstrates the vocabulary before public API extraction.
- Follow-up needed: task-1783717048659 proves the design after this task completes.

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
