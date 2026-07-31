# Week 2 learning product: actor model and OTP behaviors

## Source

Created with `fas create-task` on 2026-07-31.

## Problem

Build the second vertical learning slice after PR 57: a readable HTML guide, hands-on workbook, and interactive lab that compare Actor-Web actor identity, private context, send/ask/emit, lifecycle, and OTP-inspired behavior machinery with JavaScript objects and Erlang/Elixir processes. Preserve API accuracy around getSnapshot context observation and documented at-most-once boundaries.

## Acceptance criteria

- Add a Week 2 HTML guide that teaches actor identity, behavior, mailbox ownership, lifecycle, and the precise Erlang/Elixir comparison.
- Add a Week 2 workbook with bounded exercises tracing send, ask, emit, getSnapshot, and behavior handlers through current source and tests.
- Add an interactive actor-identity and message-flow lab with bidirectional phase-to-code correlation and explicit projection limitations.
- Update learning navigation and course maps without marking later weeks complete.
- Extend test:learning to verify the new pages, interactions, link integrity, accessibility, and maturity labels.
- Keep runtime packages unchanged unless a separate correctness task authorizes runtime behavior work.
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

- Week 1 seed task task-1785520186056 and PR 57 provide historical context; Week 2 is intentionally queue-independent.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
