# Wire topology-declared subscriptions in serveNode and startActorWebNode

## Source
Created with `fas create-task` on 2026-06-10.

## Problem
Created from spike capture direct-1781143982247 on 2026-06-11T02:56:03Z.

Gap identified:
- Topology-declared subscriptions are wired only in the local runtime client (actor-web-client.ts:496-514); serveNode and startActorWebNode ignore topology.subscriptions, so multi-node topologies silently drop declared choreography wiring. severity=high repo=actor-web — prerequisite hardening for any lattice work.

## Automation admission
- Expected operator value: Improves operator leverage around "Topology-declared subscriptions are wired only in the local runtime client (actor-web-client.ts:496-514); serveNode and startActorWebNode ignore topology.subscriptions, so multi-node topologies silently drop declared choreography wiring. severity=high repo=actor-web — prerequisite hardening for any lattice work." by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria
- The change is verified and does not introduce regressions.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution
- Extract the subscription-wiring loop currently inlined in the local runtime client (`packages/actor-core-runtime/src/actor-web-client.ts:484-514`) into a shared helper: iterate `topology.subscriptions`, resolve `from`/`to` actor refs, call `system.subscribe(publisher, { subscriber, events })`, collect teardowns.
- Call the helper from the `serveNode` start path (`serve-actor-web-node.ts`) and the `startActorWebNode` start path (`start-actor-web-node.ts`) after topology actors are spawned; run teardowns in their `stop()` paths (mirror the local client's start/stop parity — see pr-feedback memory on paired-path teardown drift).
- v1 scope: wire only subscriptions whose `from` and `to` actors are both hosted on the started node. For pairs that span nodes, fail loudly (explicit error or logged skip with telemetry) rather than silently dropping — cross-node subscription delivery is out of scope.

## Alternatives considered
- Implement full cross-node subscription delivery now: rejected — requires transport-level event forwarding semantics that do not exist yet (single-node AutoPublishingRegistry); tracked as a follow-on once the lattice design lands.
- Leave wiring client-only and document it: rejected — multi-node topologies silently dropping declared choreography is a correctness trap, and the lattice extension depends on durable declarative wiring.

## Affected files
- packages/actor-core-runtime/src/actor-web-client.ts (extract shared helper)
- packages/actor-core-runtime/src/serve-actor-web-node.ts (wire on start, teardown on stop)
- packages/actor-core-runtime/src/start-actor-web-node.ts (wire on start, teardown on stop)
- packages/actor-core-runtime/src/actor-web-node-runtime.ts (possibly, if actor-handle resolution lives here)
- tests covering serveNode/startActorWebNode subscription wiring and teardown parity

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
- None — this is the first hardening prerequisite in the stigmergic-lattice spike execution order (spike direct-1781143982247).

## Open questions
- Cross-node `from`/`to` pairs: hard error at start vs. logged skip with peer-status telemetry? (Recommend hard error — silent skip recreates the current bug.)
- Should subscription wiring be idempotent against double-start (re-entrant `start()`)? The local client rebuilds on every start; node paths should match.

## Artifact links
- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
