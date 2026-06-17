# Build Mesh Pong example (UI demo + headless transport-parity

## Source
Created with `fas create-task` on 2026-06-17.

## Problem
Spike direct-1781363862864. Terminal validation node for the transport/mesh track. Build examples/mesh-pong per its target-state design at examples/mesh-pong/README.md: ball/paddle/score behaviors defined once (transport-agnostic), one shared defineActorWebTopology, four startup modes (local/websocket/broadcast/mesh) that each change exactly one transport line. Two deliverables: (1) a headless behavior-parity test (mesh-pong.test.ts) that drives the SAME topology with a deterministic ball seed across local + broadcast + websocket(loopback) and asserts identical observable score sequences — this is the CI validation gate for topology independence; (2) a playable UI demo (ui/) with a transport switcher mirroring the spike showcase. Acceptance: behaviors import no transport/runtime/topology module; switching transport changes one line with zero behavior/topology edits; parity test passes for local/broadcast/websocket; mesh mode runs across 3 peers with no server.

## Acceptance criteria
- The change is verified and does not introduce regressions.
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
- Scope unknown.

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
