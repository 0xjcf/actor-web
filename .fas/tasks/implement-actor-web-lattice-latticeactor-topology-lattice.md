# Implement @actor-web/lattice: LatticeActor, topology lattice

## Source

Created with `fas create-task` on 2026-06-12.

## Problem

RELEASE FEATURE (decided 2026-06-12: lattice ships in the official release — it is the differentiator vs other actor libraries and the foundation for fas-studio multi-agent coordination). Implements the contract locked by the lattice design doc task (must complete first). Scope per spike direct-1781143982247 and .fas/artifacts/stigmergic-lattice-spike/analysis.md: LatticeActor behavior (artifact store: typed/keyed/versioned, latest-per-key head, content-hash idempotent re-publish; dependency registrations; activation state machine pending->delivered->acknowledged with activationId idempotency and timeout re-emit via pure XState timers), protocol messages (PUBLISH_ARTIFACT, REGISTER_DEPENDENCY, WITHDRAW_DEPENDENCY, ACK_ACTIVATION, QUERY_ARTIFACTS in; ARTIFACT_PUBLISHED, DEPENDENCY_SATISFIED, ACTIVATION_TIMED_OUT out), topology surface (lattice() helper analogous to supervisor(); per-actor dependsOn with serializable matchers — no closures; once vs everyVersion modes), runtime wiring of registrations on node start (same durability pattern as declarative subscriptions), in-memory journal first behind an interface shaped per the event-sourcing decision task. Packaging: separate entry point/package (@actor-web/lattice or @actor-web/runtime/lattice) built ONLY on public primitives — building it without touching core is the test of the framework's extensibility. Pure satisfaction evaluation in the deterministic layer; journal I/O in the execution boundary.

## Acceptance criteria

- The new functionality works as described.
- Existing behavior is not broken.
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

- packages/actor-core-runtime/src/topology.ts

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
