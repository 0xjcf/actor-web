# Fix Mesh Pong pre-start lobby projection convergence and transport readiness

## Source

Created with `fas create-task` on 2026-07-10.

## Problem

Manual two-tab BroadcastChannel validation found asymmetric pre-start projections: after both sessions claimed seats and readied, one tab reached 2/2 while the other remained stale at 1/2 until Start caused later convergence. Browser logs also reported repeated remote-directory sync failures and startup actor-not-connected errors from projection watcher/ref resolution. Diagnose and fix the authoritative pre-start convergence/readiness path before remote rooms or Ignite UI work. Actor-Web actors remain lifecycle truth; do not repair state in DOM handlers or Ignite.

## Acceptance criteria

- A red multi-client regression reproduces the asymmetric pre-start 1/2 versus 2/2 projection without relying on DOM state.
- Both BroadcastChannel clients converge to the same roster, seat, readiness, and start-gate projection before Start is enabled.
- Startup and reconnect wait for usable transport/directory readiness without actor-not-connected projection races or swallowed sync failures.
- Start remains an authoritative actor command and cannot be enabled from tab-local state.
- Focused tests, fas validate-task, full verification, and a repeated two-tab browser validation pass.
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
- examples/mesh-pong/modes/broadcast.ts
- examples/mesh-pong/mesh-pong.test.ts
- packages/actor-core-runtime/src/broadcast-channel-message-transport.ts
- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/unit/broadcast-channel-message-transport.test.ts
- packages/actor-core-runtime/src/actor-web-client.ts
- packages/actor-core-runtime/src/unit/actor-web-local-runtime.test.ts
- packages/actor-core-runtime/src/unit/start-actor-web-node.test.ts

## Scope Amendments

- Type: architecture-root-cause-scope-correction
- Added at: 2026-07-10
- Trigger: Architect and staff-engineer source inspection localized the observed two-tab failure to BroadcastChannel handshake/directory readiness plus Mesh Pong disconnected controller refs and Start gating.
- Reason: The generated example-only scope omitted the runtime cause and incorrectly included Vite configuration, which has no startup or directory responsibility.
- Added paths: packages/actor-core-runtime/src/broadcast-channel-message-transport.ts, packages/actor-core-runtime/src/actor-system-impl.ts, packages/actor-core-runtime/src/unit/broadcast-channel-message-transport.test.ts
- Evidence source: fas_architect and fas_staff_engineer handoffs
- Evidence: fas_architect and fas_staff_engineer handoffs | packages/actor-core-runtime/src/broadcast-channel-message-transport.ts | Promote Broadcast transport, ActorSystem join readiness, and focused runtime tests; retain Mesh Pong broadcast/UI/test; demote examples/vite.config.ts.
- Accuracy signal: Live source inspection aligned with manual two-tab console and projection evidence.
- Follow-up needed: Regenerate task packet and commit plan before code writing.

- Type: architecture-reassessment-two-phase-local-startup
- Added at: 2026-07-10
- Trigger: Broader validation reproduced a real local-runtime timeout after join began awaiting directory readiness: startRuntime started and joined nodes sequentially before peer ActorSystems were listening.
- Reason: Preserve the stronger join readiness contract by separating local node startup from the peer join/readiness phase instead of weakening readiness or special-casing Broadcast.
- Added paths: packages/actor-core-runtime/src/actor-web-client.ts, packages/actor-core-runtime/src/unit/actor-web-local-runtime.test.ts
- Evidence source: fas_senior_engineer regression plus fas_architect reassessment
- Evidence: fas_senior_engineer regression plus fas_architect reassessment | packages/actor-core-runtime/src/actor-web-client.ts | Promote actor-web-client.ts and actor-web-local-runtime.test.ts for two-phase startup, immediate cross-node resolution, and rollback coverage.
- Accuracy signal: Serial existing Mesh Pong test timed out at the directory request timeout; source inspection confirmed peers were not yet listening.
- Follow-up needed: Refresh packet and plan; correct provisional UI gate before validation and commits.

- Type: full-verification-test-fixture-compatibility
- Added at: 2026-07-10
- Trigger: Unrestricted full verification reproduced the discovery-provider test timing out after join correctly began awaiting directory readiness.
- Reason: The synthetic TestMessageTransport advertised connectivity but discarded subscriptions and runtime directory protocol messages; update the fixture rather than weakening production readiness.
- Added paths: packages/actor-core-runtime/src/unit/start-actor-web-node.test.ts
- Evidence source: root full verify and same-actor retry diagnosis
- Evidence: root full verify and same-actor retry diagnosis | packages/actor-core-runtime/src/unit/start-actor-web-node.test.ts | Retain/unset the fixture listener and answer empty correlated directory sync responses for addressed synthetic peers.
- Accuracy signal: Focused existing test consistently times out at the directory request timeout; production real transports already pass readiness suites.
- Follow-up needed: Rerun focused test, impacted runtime tests, fast validation, QA, and full verification.

## Implementation plan

- Add failing BroadcastChannel early-frame and ActorSystem join-readiness regressions before production edits.
- Make BroadcastChannel peer activation lossless during handshake and make ActorSystem join await retryable deduplicated directory readiness.
- Change local startRuntime to two phases: start all nodes with no peers, then join selected peers after every ActorSystem is listening; preserve reverse-order rollback.
- Add local-runtime cross-node readiness and join-failure cleanup tests.
- Add the independent Mesh Pong client convergence regression, connect clients to addressed controller nodes, and derive Start eligibility from authoritative projection plus requester, mode, and generation domain validation without tab-local writes.
- Keep runtime and example changes in separate rollback-safe commits; stop and replan if generic TransportCore, public APIs, topology, or actor behavior must change.

## Verification plan

- Run the focused runtime BroadcastChannel test and record the red failure.
- Run the focused Mesh Pong example test, @actor-web/runtime tests, and example tests.
- Run fas validate-task, then root-owned full verification after QA/SRE/reviewer clearance.
- Repeat two-tab BroadcastChannel validation and capture synchronized 2/2 pre-start state plus clean console evidence.

## Risks

- Strengthening join readiness affects all remote transports; preserve standalone startActorWebNode behavior and test custom/local transport compatibility.
- Two-phase local startup must preserve deterministic node construction, deferred cross-node subscription replay, and reverse-order rollback.
- Rejected readiness promises must be evicted so later explicit join can recover; disconnect must clear readiness.
- One-player and synthetic-controller flows must remain usable while Start gating derives only from authoritative projections.
- Reconnect must not duplicate sync work or retain buffered frames after close.

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
