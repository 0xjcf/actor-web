# Mesh Pong remote rooms and spectator channel model

## Source
Created with `fas create-task` on 2026-07-09.

## Problem
Epic: labs-mesh-runtime-substrate. Extend Mesh Pong from same-origin tab play into an online-table model for real remote play. After browser-playable WebSocket exists, define and implement the room/channel contract for create room, join room, invite link or room code, player seats, read-only spectators, reconnect/resume by session id, and room event/chat messages. Keep Pong behaviors transport-agnostic; model room membership, seats, spectators, and chat/event flow as actor/session facts in the example shell or dedicated room actors. This should make the demo credible for two players in different locations and for observers watching a match, similar to online poker/table games.

## Acceptance criteria
- Users can create a room and join it by code or URL across separate browser sessions using the browser-playable WebSocket path.
- Room state distinguishes host, left seat, right seat, open seats, MLX seats, disconnected seats, and spectators.
- Spectators receive match/read-model updates and room events but cannot send paddle/controller commands or claim a seat without an explicit role change.
- Room chat or event log is modeled as a separate channel/fact stream and does not affect deterministic Pong ball, paddle, or score behaviors.
- Reconnect uses an explicit session identity and prevents ghost seats or duplicate player claims.
- Tests cover create/join, seat claim rejection, spectator read-only behavior, reconnect, and start-gate behavior through the room model.
- Docs explain the distinction between local, BroadcastChannel same-machine, mesh topology proof, browser WebSocket remote rooms, and future WebRTC/signaling.
- DDD: keep the functional core deterministic and side-effect-free; network, storage, clock, and room coordination stay in the imperative shell or actor adapters that return facts.
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
- examples/mesh-pong/ui/main.ts
- examples/mesh-pong/ui/index.html
- examples/mesh-pong/mesh-pong.test.ts
- examples/mesh-pong/modes/websocket.ts

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
- Blocks task-1783616738973 Mesh Pong Lobby Room Table and Match UI workflow polish.
- Blocks task-1781880961715 Post-mesh scoping: membership graduation tier, cross-node supervision boundary, claim gating.
- Belongs to epic labs-mesh-runtime-substrate as the Mesh Pong remote-table and spectator validation slice.

## Open questions
- None captured at task creation.

## Artifact links
- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
