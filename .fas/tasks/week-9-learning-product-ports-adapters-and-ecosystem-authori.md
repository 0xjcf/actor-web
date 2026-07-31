# Week 9 learning product: ports adapters and ecosystem authority

## Source

Created with `fas create-task` on 2026-07-31.

## Problem

Build the guide, workbook, and lab for hexagonal architecture, functional core and imperative shell, provider-neutral ports, optional adapters, Actor-Web data-plane authority, FAS control-plane governance, Ignite projection authority, and cross-repository handoff contracts.

## Acceptance criteria

- Teach the source-of-truth ownership matrix for Actor-Web, FAS, Ignite Element, application behavior, and human final review.
- Use completed FAS control-plane conformance evidence before labeling the cross-plane mapping current.
- Add exercises that detect leaky adapters, invented downstream schemas, stale evidence, and authority inversion.
- Add an interactive authority-boundary lab that routes proposals, commands, facts, receipts, and projections across optional integrations.
- Keep every repository independently useful and make integrations additive and fail-closed when upstream evidence is unavailable.
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

- Superseded before implementation by task-1785530154445 after live admission proved stack depth 13.

## Open questions

- None. Retained as workflow history only.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
