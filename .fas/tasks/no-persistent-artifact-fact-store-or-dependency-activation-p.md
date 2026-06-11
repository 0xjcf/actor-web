# Author the lattice contract design doc (artifact store + dependency activation)

## Source
Created with `fas create-task` on 2026-06-10.

## Problem
Created from spike capture direct-1781143982247 on 2026-06-11T02:56:03Z.

Gap identified:
- No persistent artifact/fact store or dependency-activation primitive exists (no blackboard, no saga, no fact registry — only transient emit). Needs a lattice contract design doc (protocol messages, artifact versioning, activation state machine with activationId ack/re-emit, journal strategy) before implementation; architecture-gated. severity=medium repo=actor-web.

## Acceptance criteria
- The new functionality works as described.
- Existing behavior is not broken.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution
- Author `docs/actor-web-lattice-design.md` — a contract design doc, no implementation. The spike analysis (`.fas/artifacts/stigmergic-lattice-spike/analysis.md`) is the input; the doc locks:
  1. **Lattice protocol messages**: `PUBLISH_ARTIFACT`, `REGISTER_DEPENDENCY`, `WITHDRAW_DEPENDENCY`, `ACK_ACTIVATION`, `QUERY_ARTIFACTS` (ask) in; `ARTIFACT_PUBLISHED`, `DEPENDENCY_SATISFIED`, `ACTIVATION_TIMED_OUT` out.
  2. **Artifact model**: typed, keyed, versioned (immutable versions, latest-per-key head), append-only journal, content-hash idempotent re-publish.
  3. **Activation semantics**: serializable `dependsOn` matchers (artifact-type conjunctions, optional field matchers — no closures, preserving the declarative non-executable topology rule); evaluation at both publish time and registration time (late-joiner/restart correctness); `once` vs `everyVersion` modes; activation state machine (`pending → delivered → acknowledged`) with `activationId` idempotency and timeout re-emit over the at-most-once transport.
  4. **Topology surface**: `lattice()` helper analogous to `supervisor()`; per-actor `dependsOn` declarations; runtime responsibility to wire registrations on node start (same durability pattern as declarative subscriptions).
  5. **Journal strategy**: in-memory first; interface shaped to accept the event-sourcing module if promoted (see companion decision task).
  6. **Packaging**: separate package/entry point (`@actor-web/lattice` or `@actor-web/runtime/lattice`) built only on public primitives — per the spike recommendation (optional extension, not core).
- Architecture-gated: run as 6-agent with architect-check; the doc is the lockable contract before any implementation brief is cut.

## Alternatives considered
- Implement directly without a contract doc: rejected — this is the architecture-bearing piece of the lattice work; the spike explicitly gated it.
- Build the lattice into core runtime: rejected by the spike — zero core changes are needed, and a separate package is the honest test of framework extensibility.
- Query-based activation (`when(ctx => ...)`) in topology: rejected — violates the locked "topology is declarative, non-executable at import" rule; queries stay imperative (`ask`).

## Affected files
- docs/actor-web-lattice-design.md (new — primary deliverable)
- docs/todos.md or docs index (link the design doc)
- No runtime source changes in this task

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
- "Wire topology-declared subscriptions in serveNode and startActorWebNode" (durable declarative wiring is the pattern lattice registrations reuse).
- "Resolve unenforced SendInstruction delivery modes" (the activation ack/re-emit protocol must cite the real delivery semantics).

## Open questions
- One lattice per topology vs. several (partitioned by artifact type)? Spike leans single-lattice v1 with the DSL leaving room for many.
- Should `DEPENDENCY_SATISFIED` carry artifact payloads inline or references the consumer queries back? (Payload size vs. round-trip tradeoff.)
- Gateway exposure: should the artifact store be observable through the runtime gateway as a read model (operator visibility), and in v1 or later?

## Artifact links
- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
