# Mesh Pong agent-native interaction contract conformance

## Source

Created with `fas create-task` on 2026-07-10.

## Problem

Implement the five approved Mesh Pong contract-alignment adjustments: caller-aware capability availability; revisioned advisory proposal admission; typed timeout, stale, superseded, and cancellation outcomes; authenticated transport identity requirements for remote commands; and truthful authority, durability, and telemetry documentation. Preserve Room and MatchCoordinator authority, deterministic reflex fallback, optional Ignite and FAS integration, and the existing dependency graph semantics.

## Acceptance criteria

- Workflow source exposes caller-aware command availability and headless tests prove discovery differs from execution-time authorization.
- Planner proposals carry identity, correlation, base match revision/tick, and timestamps; deterministic admission rejects stale or superseded proposals even when match generation has not changed.
- Controller outcomes are typed for timeout, stale, superseded, cancelled, invalid response, and provider failure; telemetry uses these typed facts rather than error-string matching.
- Remote-room work binds authenticated runtime identity to commands and filters capability discovery without trusting caller-supplied session ids.
- README names Room, MatchCoordinator, advisory data, UI projection, and durability sources of truth and describes metrics as deterministic reductions of observed telemetry.
- Queue preserves existing dependsOn and blocks edges while enforcing room workflow -> contract alignment -> behavior tree -> advisory design -> generic conformance -> utility policy order.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- examples/mesh-pong/workflow/mesh-pong-workflow-source.ts
- examples/mesh-pong/workflow/mesh-pong-workflow.test.ts
- examples/mesh-pong/pong-contract.ts
- examples/mesh-pong/pong-controller.ts
- examples/mesh-pong/ui/main.ts
- examples/mesh-pong/mesh-pong.test.ts
- examples/mesh-pong/README.md
- .fas/tasks/design-actor-web-advisory-lane-primitive-for-deadline-safe-a.md
- .fas/tasks/mesh-pong-behavior-tree-paddle-policy-proof.md
- .fas/tasks/mesh-pong-utility-policy-tactical-scorer-proof.md
- .fas/tasks/mesh-pong-remote-rooms-and-spectator-channel-model.md
- .fas/queue/tasks.json
- .fas/tasks/mesh-pong-revisioned-advisory-policy-conformance-proof.md
- .fas/TASKS.md

## Scope Amendments

- Type: queue-conformance-sequencing
- Added at: 2026-07-10
- Trigger: Staff engineering handoff
- Reason: Create the deferred generic advisory-policy conformance proof and make the queue graph represent the settled order without replacing existing scheduler edges.
- Added paths: .fas/tasks/mesh-pong-revisioned-advisory-policy-conformance-proof.md, .fas/TASKS.md
- Evidence source: fas_staff_engineer handoff
- Evidence: fas_staff_engineer handoff | .fas/state/agent-orchestration-execution.json | The current local contract-alignment task precedes behavior-tree proof; generic extraction evidence follows advisory-policy design and precedes utility proof.
- Accuracy signal: Queue JSON parser and fas queue graph show reciprocal dependsOn and blocks edges.
- Follow-up needed: Implement the generic conformance task only after its advisory-design dependency is complete.

## Implementation plan

- Add caller-aware availability to the workflow source with focused headless tests.
- Introduce typed advisory proposal and outcome contracts, deterministic proposal admission, stale/superseded rejection, and focused controller/turn-stepper tests.
- Update Mesh Pong documentation and downstream task briefs plus queue dependency edges; create the later generic advisory-policy conformance task.

## Verification plan

- Run the focused Mesh Pong workflow and controller tests, then fas validate-task after each commit-plan step.
- Run .fas/scripts/verify.sh --full after delegated QA clearance and compare against the bootstrap baseline.
- Run fas review-boundaries and inspect queue graph plus task briefs for symmetric dependency correctness.

## Risks

- Validate generated scope, acceptance criteria, and verification evidence before closeout to avoid workflow drift.

## Dependencies

- task-1783705173817 Mesh Pong headless room workflow foundation and Lobby Table screens

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
