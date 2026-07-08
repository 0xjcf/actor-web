# Mesh Pong browser-playable WebSocket transport mode

## Source
Created with `fas create-task` on 2026-07-08.

## Problem
Epic: labs-mesh-runtime-substrate. Follow-up from the Mesh Pong UI transport selector gap: the page exposes WebSocket loopback, but the browser UI currently rejects that mode because the existing WebSocket parity path is a Node loopback test helper. Implement a browser-playable WebSocket transport mode for Mesh Pong by connecting the UI/runtime to an external Actor-Web WebSocket listener or dev helper, while keeping browser nodes outbound-only and preserving local, BroadcastChannel, and labs-mesh modes. The goal is an operator demo where selecting WebSocket activates the mode, reports connection health clearly, and supports the same player/session and MLX controller flows used for the Mesh Pong promotional GIF/blog proof.

## Acceptance criteria
- Selecting WebSocket in the Mesh Pong UI activates a real browser-playable transport mode instead of reverting the selector, when the required external listener/dev helper is available.
- The implementation uses the existing browser/WebWorker WebSocket transport capability and Node listener surfaces; it does not add browser listener support or couple Pong behaviors to transport internals.
- The UI reports explicit connection, listener-missing, and transport-failed states with recovery guidance, without silently falling back to another transport.
- Two MLX players and human/session player modes work through the WebSocket mode with the same lobby readiness and start-gate semantics as local, broadcast, and mesh.
- Parity proof/readme/docs distinguish headless WebSocket loopback, browser-playable WebSocket, BroadcastChannel, local, and labs-mesh modes in operator-friendly language.
- Tests cover WebSocket selector activation, listener-missing failure behavior, and transport parity through the existing headless gate or a focused browser-style integration harness.
- The task records whether this mode should be part of the blog/GIF capture setup and any follow-up needed for production hardening.
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
- examples/mesh-pong/ui/main.ts
- examples/mesh-pong/ui/index.html
- examples/mesh-pong/README.md
- examples/mesh-pong/mesh-pong.test.ts
- examples/mesh-pong/modes/websocket.ts
- examples/vite.config.ts

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
- Depends on task-1783516442115 Benchmark Mesh Pong MLX model and server strategy.
- Blocks task-1781880961715 Post-mesh scoping: membership graduation tier, cross-node supervision boundary, claim gating.
- Belongs to epic labs-mesh-runtime-substrate as a Mesh Pong transport-demo follow-up. It uses the completed Browser/WebWorker WebSocket transport capability but does not reopen that completed runtime task.

## Open questions
- None captured at task creation.

## Artifact links
- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
