# Mesh Pong authoritative match lifecycle and cross-client projection convergence

## Source
Created with `fas create-task` on 2026-07-09.

## Problem
Correct the Mesh Pong terminal validation architecture before remote rooms and UI workflow polish. Replace tab-local match lifecycle truth and the out-of-band always-on lobby BroadcastChannel control plane with one authoritative match coordinator/read model addressed through the selected Actor-Web transport. The coordinator owns phase, match generation, controller configuration, lifecycle authority, and canonical game snapshot while deterministic simulation has exactly one driver. Browser tabs, remote players, and spectators are projections that converge after start, pause, restart, return-to-room, and rematch commands. Preserve the same topology and behavior contracts across local, BroadcastChannel, labs-mesh, and browser WebSocket modes; local mode remains an intentional single-runtime case rather than silently using BroadcastChannel for multiplayer.

## Acceptance criteria
- A Match Coordinator actor or equivalent deterministic aggregate owns match phase, generation, controller mode, lifecycle authority, and canonical projection state.
- Start, pause, restart-match, return-to-room, and rematch are actor commands with explicit authorization and errors-as-data results; either seated player may request restart while spectators remain read-only.
- Simulation ticks have exactly one authority per match, and non-authoritative tabs never advance independent game copies.
- All cross-session lifecycle and controller traffic uses the selected Actor-Web transport; the global lobby BroadcastChannel is not shared truth outside BroadcastChannel mode.
- BroadcastChannel, labs-mesh, and browser WebSocket sessions address one shared match rather than starting a full isolated three-node topology in every tab.
- Every UI derives lifecycle, score, paddles, controller slots, and status from the authoritative read model; reconnecting and late-joining projections hydrate from the latest generation.
- A real multi-session test starts two clients, issues restart from each player in turn, and proves both projections converge on identical phase, generation, score, ball, and paddle state.
- Transport-parity tests cover lifecycle convergence as well as independent deterministic score-sequence parity.
- TDD: failing convergence and reset tests are recorded before implementation and every production change has test coverage.
- DDD: deterministic match transitions stay in the functional core; transport, timer, storage, and DOM adapters remain in the imperative shell and return facts instead of throwing expected failures.
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
- examples/mesh-pong/pong-contract.ts
- examples/mesh-pong/pong-behaviors.ts
- examples/mesh-pong/pong-topology.ts
- examples/mesh-pong/ui/main.ts
- examples/mesh-pong/mesh-pong.test.ts
- examples/mesh-pong/modes/local.ts
- examples/mesh-pong/modes/broadcast.ts
- examples/mesh-pong/modes/mesh.ts
- examples/mesh-pong/modes/websocket.ts
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
- Depends on task-1783546072913 Mesh Pong browser-playable WebSocket transport mode.
- Blocks task-1783616720644 Mesh Pong remote rooms and spectator channel model.
- Blocks task-1783538961865 Mesh Pong behavior-tree paddle policy proof so later Mesh Pong policy examples build on the corrected runtime.
- Belongs to epic labs-mesh-runtime-substrate as the authoritative convergence prerequisite.

## Open questions
- Decide during architecture whether Match Coordinator owns the full game aggregate or coordinates existing ball, score, and paddle actors while publishing an atomic generation snapshot.
- Decide the minimum single-authority driver contract needed for local, BroadcastChannel, labs-mesh, and browser WebSocket without prematurely solving coordinator failover.

## Artifact links
- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
