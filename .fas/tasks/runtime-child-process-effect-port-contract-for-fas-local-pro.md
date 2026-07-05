# Runtime: child-process effect port contract for fas-local provider hosts

## Source

Created with `fas create-task` on 2026-07-01.

## Problem

Define the actor-web process supervision port/adaptor contract needed before actor-web can host fas-local ProviderActor lifecycle work. Scope covers long-lived Node child processes such as mlx_lm.server, process groups, signal policy, bounded stdout/stderr capture, readiness checks, crash detection, cancellation, idle shutdown hooks, duplicate prevention facts, and errors-as-data. This task must not integrate fas-local or spawn real MLX servers; use fake ports/contracts first.

## Automation admission

- Expected operator value: Improves operator leverage around "Runtime: child-process effect port contract for fas-local provider hosts" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- A public or documented internal ProcessRunner/effect-port contract covers spawn, process groups, signal policy, bounded stdout/stderr capture, readiness checks, crash detection, cancellation, idle shutdown, duplicate-prevention facts, and errors-as-data handling.
- The contract keeps actor core deterministic and keeps Node process effects behind adapters/ports.
- Tests use fake process and readiness ports; no real mlx_lm.server process is required.
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

- packages/actor-core-runtime/src
- tests
- docs

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
