# Week 4 learning product: behaviors FSMs and statecharts

## Source

Created with `fas create-task` on 2026-07-31.

## Problem

Build the guide, workbook, and lab for deterministic behaviors, finite-state machines, XState statecharts, guards, actions, effects, and the boundary between model proposals and application-owned legal transitions.

## Acceptance criteria

- Teach behavior, FSM, statechart, policy, capability, functional-core, and imperative-shell vocabulary without collapsing their authority.
- Trace current defineBehavior, withFSM, and withMachine surfaces through source and focused tests.
- Add exercises that reject invalid transitions and contrast schema-admitted, domain-accepted, and execution-authorized decisions.
- Add an interactive state-transition lab with bidirectional transition-to-code correlation.
- Update navigation and verification without adding application semantics to runtime packages.
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

- Queue prerequisite: task-1785529934191 (Week 3 supervision and failure domains).

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
