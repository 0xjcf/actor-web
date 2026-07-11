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

- Implement `pong-room-contract.ts` as the deterministic pre-match aggregate and expose it through `pong-room-behaviors.ts`; hand a frozen roster contract to the existing MatchCoordinator instead of copying match phase or score into Room.
- Compose the Room and MatchCoordinator Actor-Web refs in `workflow/mesh-pong-workflow-source.ts`, derive screens in `mesh-pong-workflow-core.ts`, and keep subscriptions/rendering in the workflow host and screen adapters.
- Mount the canonical workflow source in `ui/main.ts` so Lobby/Table controls dispatch Room commands, while legacy player-session synchronization remains a compatibility adapter until the remote-room slice owns atomic Match routing.
- Prove two independent sessions converge through the same Room facts and only the projected host can start; use the Broadcast browser flow to confirm seats, readiness, and the transition into the existing Match surface.

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

- Type: cross-repo-agent-native-contract-alignment
- Added at: 2026-07-10
- Trigger: User-approved cross-repo contract amendment and Mesh Pong alignment review
- Reason: Implement caller-aware command availability, revisioned advisory proposal admission, typed advisory outcomes, remote identity-bound command requirements, and truthful source-of-truth and telemetry documentation; align downstream queue dependencies without replacing existing scheduler edges.
- Added paths: examples/mesh-pong/pong-controller.ts, examples/mesh-pong/README.md, .fas/tasks/design-actor-web-advisory-lane-primitive-for-deadline-safe-a.md, .fas/tasks/mesh-pong-utility-policy-tactical-scorer-proof.md, .fas/queue/tasks.json
- Evidence source: 2026-07-10 cross-repo agent-native interaction constraint contract amendment
- Evidence: 2026-07-10 cross-repo agent-native interaction constraint contract amendment | The amendment requires explicit command availability, revision and freshness validation, typed outcomes, identity enforcement boundaries, and accurate durability and determinism claims.
- Accuracy signal: Targeted tests prove caller-aware discovery, stale-proposal rejection within an unchanged match generation, typed timeout classification, and unchanged deterministic fallback behavior.
- Follow-up needed: Create and queue the implementation conformance slice after advisory-policy design; remote room work binds authenticated transport identity.

- Type: follow-up-handoff-clarification
- Added at: 2026-07-10
- Trigger: Pipeline review-to-follow-up transition
- Reason: The cross-repo contract alignment changes were initially recorded while this task was in review, but the review terminal transition required them to move into the dedicated follow-up task Mesh Pong agent-native interaction contract conformance (task-1783716508291 / direct-1783716508276). This task retains only its original room-workflow slice.
- Evidence source: FAS pipeline transition and user-approved follow-up task
- Evidence: FAS pipeline transition and user-approved follow-up task | .fas/tasks/mesh-pong-agent-native-interaction-contract-conformance.md | Do not treat the added affected-path references as original room-workflow implementation scope; the follow-up owns source, tests, README, and queue alignment.
- Accuracy signal: Follow-up commits 398c69ce, 30fbfc51, and c7f8a12d contain the implementation and queue evidence.
- Follow-up needed: Close the predecessor with its own review evidence; review the contract alignment under task-1783716508291.

## Implementation plan

1. Write reducer tests in `workflow/mesh-pong-workflow.test.ts` for membership, disconnected-session rejection, stale rejections, readiness, and host-only start; then implement the pure Room and workflow transitions.
2. Add the Room behavior/topology contract and the immutable `PongMatchRosterHandoff`; verify that Room never advances Match phase and MatchCoordinator remains the match authority.
3. Add Room/Match ports, canonical workflow source, and `igniteTest` coverage using two independent sources over the same actor refs; verify 0/2, 1/2, 2/2, rejection, reconnect trace, and lifecycle projection facts.
4. Mount Lobby/Table adapters in `ui/main.ts` and `ui/screens/`; guard asynchronous source/runtime work against mode switches, then manually validate two Broadcast tabs through seat claim, readiness, host-only start, and Match entry.

## Verification plan

- Run `pnpm exec vitest run --config examples/vitest.config.ts examples/mesh-pong/workflow/mesh-pong-workflow.test.ts` and expect reducer, two-source Ignite, cleanup, and screen-projection cases to pass.
- Run `pnpm typecheck` and targeted Biome checks for the changed Mesh Pong files; expect no type or formatting drift.
- Run `fas validate-task` and expect format, lint, typecheck, and changed-only behavior boundaries to pass.
- Run `.fas/scripts/verify.sh --full` with localhost-listener permission when necessary; expect the full test matrix, architecture drift, behavior boundaries, and semantic index to pass.
- Manually verify two Broadcast tabs: shared Room revision after seat claims, 2/2 readiness, enabled Start only for the host, and both workflow views entering Match.

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
