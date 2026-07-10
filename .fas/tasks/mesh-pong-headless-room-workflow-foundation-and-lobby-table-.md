# Mesh Pong headless room workflow foundation and Lobby Table screens

## Source

Created with `fas create-task` on 2026-07-10.

## Problem

Create the first vertical slice of the online Mesh Pong workflow to isolate the remaining multi-tab issues before the full remote-room and spectator implementation. Establish deterministic room and workflow functional cores, actor ownership boundaries, topology contracts, hexagonal ports/adapters, and a headless Ignite projection/command runtime. Mount explicit Lobby and Room/Table screens as adapters over authoritative actor facts. Do not implement final responsive polish, remote WebSocket rooms, full spectator/chat, or DOM-owned lifecycle truth in this slice.

## Acceptance criteria

- A pure Room reducer models create/join, session membership, seat claim/release, controller selection, readiness, authorization, and errors-as-data without DOM, transport, storage, clock, or timers.
- A pure Workflow reducer derives Lobby, Table, Match, and Result states only from room, session, connection/readiness, and authoritative match facts; UI events never mutate lifecycle truth directly.
- Actor boundaries separate RoomRegistry/Room, PlayerSession, MatchCoordinator, controller actors, and future room-event channel responsibilities; the topology makes ownership and message routes explicit.
- Hexagonal ports separate room commands, room projections, match projections, identity/code generation, transport, and rendering adapters; the imperative shell only wires effects and dispatch.
- A headless igniteCore runtime consumes canonical Actor-Web sources and named commands, with igniteTest coverage for two sessions, 0/2 to 1/2 to 2/2 readiness, start gating, reconnect hydration, rejected commands, phase transitions, and traces.
- Lobby and Room/Table screens render explicit connection, room entry, session, seat, controller, readiness, start authority, and rejection facts from projections; diagnostics are secondary and no tab-local variable decides state.
- Two independent browser sessions visibly converge through Lobby and Room/Table before entering the existing Match surface; failures expose the responsible actor/port/readiness fact.
- TDD records failing reducer, actor, headless runtime, and screen-transition tests before implementation; every production change has coverage.
- DDD keeps aggregates and invariants in deterministic functional cores, coordination in actor/application services, and browser/network/Ignite/DOM code in adapters.
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

- examples/mesh-pong/pong-room-contract.ts
- examples/mesh-pong/pong-room-behaviors.ts
- examples/mesh-pong/pong-topology.ts
- examples/mesh-pong/workflow/
- examples/mesh-pong/ui/screens/
- examples/mesh-pong/ui/main.ts
- examples/mesh-pong/ui/index.html
- examples/mesh-pong/mesh-pong.test.ts
- examples/mesh-pong/pong-contract.ts
- examples/mesh-pong/parity-proof.ts
- .fas/tasks/expose-directory-readiness-separately-from-transport-members.md

## Scope Amendments

- Type: contract-handoff
- Added at: 2026-07-10
- Trigger: Staff engineering boundary review
- Reason: Room BEGIN_MATCH must hand an immutable roster value to the existing MatchCoordinator without duplicating match lifecycle ownership.
- Added paths: examples/mesh-pong/pong-contract.ts
- Evidence source: fas_staff_engineer handoff
- Evidence: fas_staff_engineer handoff | examples/mesh-pong/pong-contract.ts | Add only the shared roster handoff type required by Room and MatchCoordinator.
- Accuracy signal: Explicit ownership contract closes Room-to-Match boundary.
- Follow-up needed: Stop and replan if runtime-package changes are required.

- Type: dependency-reachable-correctness
- Added at: 2026-07-10
- Trigger: Mounted workflow proof review
- Reason: The parity proof writes the visible actor inventory and must include the new Room actor so UI ownership evidence matches topology.
- Added paths: examples/mesh-pong/parity-proof.ts
- Evidence source: fas_senior_engineer confusion checkpoint
- Evidence: fas_senior_engineer confusion checkpoint | examples/mesh-pong/parity-proof.ts | Narrow actor-list correction only.
- Accuracy signal: Prevents stale proof actor inventory from overwriting HTML truth.
- Follow-up needed: No remote-room or runtime expansion.

- Type: verification-baseline-hygiene
- Added at: 2026-07-10
- Trigger: Full branch lint baseline
- Reason: A generated follow-up task committed immediately before this slice fails the repository-wide Markdown gate; formatting only is required for a clean verification receipt.
- Added paths: .fas/tasks/expose-directory-readiness-separately-from-transport-members.md
- Evidence source: fas validate-task receipt
- Evidence: fas validate-task receipt | .fas/state/verification/validate-task-1783707814.log | All reported source checks pass; lint errors are missing blank lines in the current and prior generated task briefs.
- Accuracy signal: Targeted markdownlint confirms current brief is clean; prior generated task remains the sole branch baseline blocker.
- Follow-up needed: No product-code changes; keep the formatting-only commit isolated.

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
