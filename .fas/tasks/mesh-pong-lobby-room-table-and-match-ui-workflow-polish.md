# Mesh Pong Lobby Room Table and Match UI workflow polish

## Source

Created with `fas create-task` on 2026-07-09.

## Problem
Epic: labs-mesh-runtime-substrate. Build the proper online-game workflow only after authoritative match convergence and remote room semantics exist. Split the current control surface into Lobby, Room/Table, Match, and Result/Rematch states. Every screen is a projection over room, session, and match actor facts; DOM state and tab-local variables never decide lifecycle truth. Lobby owns connection and room entry, Room/Table owns seats/controllers/readiness/start, Match owns play and authorized lifecycle commands, and Result owns rematch or return-to-room. Keep diagnostics progressively disclosed and manually validate desktop, tablet, and mobile.


## Acceptance criteria
- The UI has explicit Lobby, Room/Table, Match, and Result/Rematch workflow states with controls scoped to each responsibility.
- Lobby owns local demo entry, online create/join, room code or invite URL, connection status, and advanced transport selection.
- Room/Table owns seat claim/release, Human or MLX controller selection, ready state, spectator list, host/start authority, chat/events, and room lifecycle status.
- Start is enabled only when the authoritative room projection reports all required seats ready; rejection reasons are displayed as domain facts.
- Match owns the playfield, score, player controls, spectator view, pause, restart-match, return-to-room, compact performance telemetry, and transport-parity proof.
- Restart match and return to room are distinct commands; an accepted command from either seated player updates every player and spectator projection to the same generation.
- Result/Rematch owns outcome, rematch readiness/vote, and return-to-room without rebuilding browser-local match truth.
- No UI module owns authoritative matchStarted, match generation, score, seat, readiness, or controller-mode state; reconnect and refresh hydrate from actor read models.
- Advanced diagnostics are disclosed away from primary gameplay while selected transport and authority remain visibly provable.
- Responsive layouts are manually validated at desktop, tablet, and mobile widths without overflow, clipping, inaccessible labels, or overlap.
- Tests cover workflow transitions, projection hydration, spectator restrictions, seat/readiness/start gates, restart convergence, rematch, and stable accessible labels.
- Docs include the two-MLX promotional capture workflow and spectator join flow.
- TDD: failing workflow tests precede implementation and every production change has coverage.
- DDD: UI remains an adapter/projection over actor facts; deterministic behavior contains no DOM, network, storage, clock, or timer effects.
- The work is tracked in .fas/TASKS.md and queued with a reviewed implementation and verification plan.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

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
- Type: projection-only-workflow-contract
- Added at: 2026-07-09
- Trigger: Operator found reset divergence and confusion caused by one screen mixing Lobby, Room, Match, and diagnostics.
- Reason: The workflow task must consume authoritative room and match read models and must not repair lifecycle synchronization inside DOM handlers.
- Evidence source: source and UX review
- Evidence: source and UX review | examples/mesh-pong/ui/main.ts | Current reset and start handlers mix actor commands with tab-local lifecycle mutation.
- Accuracy signal: current source and live queue reviewed
- Follow-up needed: Execute after authoritative convergence and remote room tasks.

## Implementation plan

- Convert the supplied context into a scoped implementation plan before editing.
- Refresh affected-file scope before implementation if the generated hints are incomplete.

## Verification plan

- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- Validate generated scope, acceptance criteria, and verification evidence before closeout to avoid workflow drift.

## Dependencies
- Depends on task-1783616720644 Mesh Pong remote rooms and spectator channel model, which is gated by task-1783627795146 authoritative match convergence.
- Blocks task-1781880961715 post-mesh claim gating.
- Belongs to epic labs-mesh-runtime-substrate as the online-game workflow and responsive UX projection slice.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
