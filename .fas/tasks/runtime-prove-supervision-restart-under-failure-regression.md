# Runtime: prove supervision restart under failure (regression

## Source

Created with `fas create-task` on 2026-06-10.

## Problem

Surfaced by the fas-studio agents-with-tools readiness assessment (2026-06-10). The Supervisor class (packages/actor-core-runtime/src/actors/supervisor.ts) and SupervisionStrategy directives (actor-system.ts RESTART/STOP/ESCALATE/RESUME) exist, and topologies declare supervision (strategy/maxRestarts/withinMs), but ZERO tests exercise an actor failing and being restarted. Before fas-studio relies on supervision for agent orchestration we need regression coverage: (1) actor throws in onMessage -> supervisor restarts it -> actor processes messages again; (2) maxRestarts exceeded within the window -> actor stays stopped; (3) stop/escalate/resume directives behave as documented; (4) supervision declared via defineActorWebTopology supervision field is actually enforced at runtime. Fix any gaps the tests expose (restart may be partially or not wired). SEQUENCE: independent; prioritize before @actor-web/agent work.

## Automation admission

- Expected operator value: Improves operator leverage around "Runtime: prove supervision restart under failure (regression coverage)" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- an e2e test kills an actor via a thrown handler error and proves the supervisor restarts it and it processes again
- maxRestarts within the window is enforced and tested
- topology-declared supervision (strategy/maxRestarts) is exercised end-to-end
- any restart-path gaps found are fixed in the same task
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

- Scope unknown.

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
