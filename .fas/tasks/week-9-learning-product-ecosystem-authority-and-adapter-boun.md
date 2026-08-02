# Week 9 learning product: ecosystem authority and adapter boundaries

## Source

Created with `fas create-task` on 2026-07-31.

## Problem

Build the synthesis guide, workbook, and lab for hexagonal architecture, functional core and imperative shell, provider-neutral ports, optional adapters, Actor-Web data-plane authority, FAS control-plane governance, Ignite projection authority, and cross-repository handoff contracts. Epic order controls the intended reading sequence; this shallow manual gate prevents supplemental work from joining the bounded product dependency chain.

## Automation admission

- Expected operator value: Improves operator leverage around "Week 9 learning product: ecosystem authority and adapter boundaries" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: manual
- Promotion criteria: Promote beyond manual only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- Teach the source-of-truth ownership matrix for Actor-Web, FAS, Ignite Element, application behavior, and human final review.
- Reconfirm current FAS and Ignite integration evidence at task start and label unavailable mappings candidate or accepted target.
- Add exercises that detect leaky adapters, invented downstream schemas, stale evidence, and authority inversion.
- Add an interactive authority-boundary lab that routes proposals, commands, facts, receipts, and projections across optional integrations.
- Keep every repository independently useful and integrations additive and fail-closed when upstream evidence is unavailable.
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

- Queue prerequisite: task-1785529946967 (Week 4). Epic order recommends studying Weeks 5-8 first, but those edges are intentionally omitted to remain policy-bounded; reconfirm cross-repo maturity at task start.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
