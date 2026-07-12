# Mesh Pong remote rooms and spectator channel model

## Source

Created with `fas create-task` on 2026-07-09.

## Problem

Epic: labs-mesh-runtime-substrate. Extend the authoritative Mesh Pong match lifecycle from same-origin play into an online room/table model. Build on the shared Match Coordinator and canonical read model rather than introducing a second room-owned copy of match state. Define create room, join by code or URL, host authority, player seats, MLX seats, read-only spectators, reconnect/resume by session id, and room chat/events. Room membership and authorization are actor/session facts; the room routes lifecycle commands to the authoritative match and projects its current generation to every player and spectator.

## Acceptance criteria

- Users can create a room and join it by code or URL across separate browser sessions using the browser-playable WebSocket path.
- Room state distinguishes host, left seat, right seat, open seats, MLX seats, disconnected seats, and spectators.
- The room references one authoritative Match Coordinator and never duplicates match phase, generation, score, ball, or paddle truth in browser or room-local state.
- Room start authority and readiness gates route an authorized START_MATCH command to the Match Coordinator; accepted lifecycle events update every room projection.
- Either seated player can request restart through the room from any connected node; spectators receive the resulting canonical projection but cannot issue controller or lifecycle commands.
- Spectators receive match read-model updates and room events but cannot send paddle/controller commands or claim a seat without an explicit role change.
- Room chat or event log is modeled as a separate channel/fact stream and does not affect deterministic Pong behaviors.
- Reconnect uses explicit session identity, prevents ghost seats or duplicate claims, and hydrates the current room plus authoritative match generation.
- Tests cover create/join, seat rejection, spectator read-only behavior, reconnect, start gating, lifecycle authorization, and projection convergence through the room model.
- Docs explain local, BroadcastChannel same-machine rooms, labs-mesh topology proof, browser WebSocket remote rooms, and future WebRTC/signaling.
- TDD: a failing test captures each changed behavior before implementation and every production change is covered.
- DDD: deterministic room and match transitions stay side-effect-free; network, storage, clock, timer, and DOM coordination remain adapters that return facts instead of throwing expected failures.
- The work is tracked in .fas/TASKS.md and queued with a reviewed implementation and verification plan.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- examples/mesh-pong/README.md
- examples/mesh-pong/pong-contract.ts
- examples/mesh-pong/pong-behaviors.ts
- examples/mesh-pong/pong-topology.ts
- examples/mesh-pong/ui/main.ts
- examples/mesh-pong/ui/index.html
- examples/mesh-pong/mesh-pong.test.ts
- examples/mesh-pong/modes/websocket.ts

## Scope Amendments

- Type: authoritative-match-convergence-prerequisite
- Added at: 2026-07-09
- Trigger: Operator found that current browser tabs own independent match lifecycles and reset does not converge.
- Reason: Remote rooms must build on one authoritative match lifecycle instead of embedding another copy of game truth in room or browser state.
- Evidence source: source and task review
- Evidence: source and task review | examples/mesh-pong/ui/main.ts | Tab-local matchStarted and resetGame plus out-of-band LobbyChannelMessage expose the missing convergence invariant.
- Accuracy signal: git history, current source, and live queue reviewed
- Follow-up needed: Implement the new authoritative convergence prerequisite before this task.

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
- Depends on task-1783627795146 Mesh Pong authoritative match lifecycle and cross-client projection convergence.
- Blocks task-1783616738973 Mesh Pong Lobby Room Table and Match UI workflow polish.
- Blocks task-1781880961715 post-mesh claim gating.
- Belongs to epic labs-mesh-runtime-substrate as the remote room and spectator validation slice.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
