# Build Mesh Pong example (UI demo + headless transport-parity test)

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

- examples/mesh-pong/README.md
- examples/mesh-pong/pong-contract.ts
- examples/mesh-pong/pong-behaviors.ts
- examples/mesh-pong/pong-topology.ts
- examples/mesh-pong/modes/local.ts
- examples/mesh-pong/modes/broadcast.ts
- examples/mesh-pong/modes/websocket.ts
- examples/mesh-pong/modes/mesh.ts
- examples/mesh-pong/ui/index.html
- examples/mesh-pong/ui/main.ts
- examples/mesh-pong/ui/pong-canvas.ts
- examples/mesh-pong/mesh-pong.test.ts
- examples/vite.config.ts
- examples/vitest.config.ts
- examples/index.html
- packages/actor-core-runtime/src/actor-context-manager.ts
- packages/actor-core-runtime/src/actor-system-impl.ts
- examples/mesh-pong/parity-proof.ts
- .fas/TASKS.md
- .fas/tasks/mesh-pong-session-lobby-and-human-controller-slots.md
- .fas/tasks/mesh-pong-mlx-llm-controller-adapter-and-player-modes.md
- .fas/tasks/post-mesh-scoping-membership-graduation-tier-cross-node-supe.md
- .fas/memory/pr-feedback.md

## Scope Amendments

- Type: scope-refresh
- Added at: 2026-07-07
- Added paths: examples/mesh-pong/README.md, examples/mesh-pong/pong-contract.ts, examples/mesh-pong/pong-behaviors.ts, examples/mesh-pong/pong-topology.ts, examples/mesh-pong/modes/local.ts, examples/mesh-pong/modes/broadcast.ts, examples/mesh-pong/modes/websocket.ts, examples/mesh-pong/modes/mesh.ts, examples/mesh-pong/ui/index.html, examples/mesh-pong/ui/main.ts, examples/mesh-pong/ui/pong-canvas.ts, examples/mesh-pong/mesh-pong.test.ts, examples/vite.config.ts, examples/vitest.config.ts, examples/index.html

- Type: scope-refresh
- Added at: 2026-07-07
- Added paths: packages/actor-core-runtime/src/actor-context-manager.ts, packages/actor-core-runtime/src/actor-system-impl.ts

- Type: operator-follow-up-and-ui-clarity
- Added at: 2026-07-07
- Trigger: Operator asked to queue Mesh Pong multiplayer/LLM follow-ups and make transport parity visible in the current example UI.
- Reason: Queue updates are part of the requested dependency chain, and parity-proof metadata is needed so the browser demo shows the same topology and behavior invariants validated by mesh-pong.test.ts.
- Added paths: examples/mesh-pong/parity-proof.ts, .fas/TASKS.md, .fas/tasks/mesh-pong-session-lobby-and-human-controller-slots.md, .fas/tasks/mesh-pong-mlx-llm-controller-adapter-and-player-modes.md
- Evidence source: operator request
- Evidence: operator request | .fas/state/current-task.json | Current task remains the transport-parity example; multiplayer and MLX work are queued as follow-ups.
- Accuracy signal: live queue verified after fas create-task
- Follow-up needed: Run the queued session lobby task before post-mesh claim gating.

- Type: queue-dependency-chain-clarity
- Added at: 2026-07-07
- Trigger: Operator requested the dependency chain be updated for Mesh Pong multiplayer and LLM follow-ups.
- Reason: The post-mesh claim-gating brief now records its dependency on the new Mesh Pong MLX/player-modes task, matching the live queue edge.
- Added paths: .fas/tasks/post-mesh-scoping-membership-graduation-tier-cross-node-supe.md
- Evidence source: fas create-task and fas edit-task
- Evidence: fas create-task and fas edit-task | .fas/queue/tasks.json | task-1781880961715 depends on task-1783452033293; task-1783452033293 depends on task-1783452020274; task-1783452020274 depends on task-1781724531725.
- Accuracy signal: jq verification of live queue rows
- Follow-up needed: Proceed with task-1783452020274 after current Mesh Pong task closes.

- Type: pr-babysit-feedback-memory
- Added at: 2026-07-07
- Trigger: PR #45 CodeRabbit babysit sweep found reusable review lessons while fixing Mesh Pong review comments.
- Reason: FAS babysit requires durable PR feedback memory after each sweep, and the memory entry records recurring review patterns for future Mesh Pong and transport-example work.
- Added paths: .fas/memory/pr-feedback.md
- Evidence source: PR #45 review comments
- Evidence: CodeRabbit review | .fas/memory/pr-feedback.md | Recorded reusable lessons for partial startup unwind, single-owner actor state, crossing-test collisions, and async UI generation guards.
- Accuracy signal: PR comments re-read before update
- Follow-up needed: None.

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
