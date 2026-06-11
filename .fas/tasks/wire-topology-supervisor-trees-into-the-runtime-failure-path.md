# Wire topology supervisor trees into the runtime failure path

## Source

Created with `fas create-task` on 2026-06-11.

## Problem

Companion to the per-actor policy task (split decision 2026-06-11, human-approved; per-actor runs 4-agent, this runs 6-AGENT — architecture-gated, and pass --mode 6-agent explicitly at bootstrap because a known FAS platform bug silently drops queued task modes). Topology supervisor() declarations — supervisor({ node, strategy: 'one-for-one' | 'one-for-all' | 'rest-for-one' | 'escalate', children: [...] }) (topology.ts:211-215) — are accepted by the DSL, documented in docs/site/concepts/supervision.md, used in examples/fas-agent-loop/fas-topology.ts and the root README, but NEVER consumed by any runtime host: zero references to topology.supervisors in serve-actor-web-node.ts, start-actor-web-node.ts, actor-web-node-runtime.ts, or actor-web-client.ts. The standalone Supervisor/SupervisorTree classes (src/actors/supervisor.ts, supervisor-tree.ts) predate the topology DSL and are not connected to it. ARCHITECTURE QUESTIONS (for the architect step): (1) reuse the standalone classes vs implement tree semantics directly in the system failure path (spike lean: direct implementation; the classes predate the current architecture); (2) restart ordering and in-flight message handling for one-for-all/rest-for-one multi-actor restarts (children's mailboxes are destroyed — define what happens to subscribers and pending asks during a group restart); (3) interaction with per-actor policies (child policy bounds individual restarts; tree strategy decides blast radius — define precedence when both fire); (4) escalate semantics: child failure becomes the supervisor's failure re-evaluated under its policy — define the top-of-tree behavior (system stop? loud event?). DEPENDS ON: per-actor policy wiring (.fas/tasks/wire-per-actor-topology-supervision-policies-into-the-runtim.md) — tree strategies act on top of the per-actor restart machinery. Acceptance: behavioral tests prove one-for-one isolates, one-for-all restarts all children on a single failure, rest-for-one restarts only later-declared children, and escalate propagates; fas-agent-loop's declared supervisors actually supervise; supervision.md tree section matches reality.

## Automation admission

- Expected operator value: Improves operator leverage around "Wire topology supervisor trees into the runtime failure path" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- The defect no longer reproduces.
- A regression test covers the fix.
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

- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/actor-web-node-runtime.ts
- packages/actor-core-runtime/src/serve-actor-web-node.ts
- packages/actor-core-runtime/src/start-actor-web-node.ts
- packages/actor-core-runtime/src/topology.ts
- docs/site/concepts/supervision.md

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
