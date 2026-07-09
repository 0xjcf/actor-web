# Mesh Pong Lobby Room Table and Match UI workflow polish

## Source
Created with `fas create-task` on 2026-07-09.

## Problem
Epic: labs-mesh-runtime-substrate. Give Mesh Pong the proper online-game UX pass after remote rooms and spectator semantics exist. Split the current single-screen control surface into clear lifecycle workflows: Lobby for transport and room creation/joining, Room/Table for seats, players, MLX slots, spectators, readiness and chat/events, and Match for the game surface, score, player controls, spectator view, telemetry, replay/proof, and return/rematch actions. Use online poker/table-game patterns for responsibilities and avoid dumping every diagnostic on the playfield. Validate desktop, tablet, and mobile breakpoints with manual browser evidence.

## Acceptance criteria
- The UI has explicit Lobby, Room/Table, and Match workflow states or screens, with controls scoped to each lifecycle responsibility.
- Lobby owns transport selection, create room, join room, room code or invite URL, connection status, and demo-mode entry points.
- Room/Table owns seat claim/release, player type selection, MLX slot selection, ready state, spectator list, host/start authority, chat or event log, and room lifecycle status.
- Match owns the playfield, score, player-side controls, spectator read-only view, pause/reset/rematch or leave actions, compact performance telemetry, and transport-parity proof.
- The responsive layout is manually validated at desktop, tablet, and mobile widths with no horizontal overflow, clipped controls, inaccessible labels, or overlapping text.
- Controls use domain-appropriate affordances and accessible names; advanced diagnostics are progressively disclosed away from the primary play surface.
- Tests cover workflow state transitions, spectator read-only controls, seat controls, ready/start gating, and stable accessible labels where practical.
- Docs or README screenshots/guidance explain how to capture the promotional GIF with two MLX players and how spectators join.
- DDD: UI state remains an adapter/projection over actor/session facts; Pong functional behaviors stay free of DOM, network, clock, or storage concerns.
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
- examples/mesh-pong/ui/index.html
- examples/mesh-pong/ui/main.ts
- examples/mesh-pong/ui/pong-canvas.ts
- examples/mesh-pong/mesh-pong.test.ts

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
- Depends on task-1783616720644 Mesh Pong remote rooms and spectator channel model.
- Blocks task-1781880961715 Post-mesh scoping: membership graduation tier, cross-node supervision boundary, claim gating.
- Belongs to epic labs-mesh-runtime-substrate as the Mesh Pong online-game workflow and responsive UX polish slice.

## Open questions
- None captured at task creation.

## Artifact links
- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
