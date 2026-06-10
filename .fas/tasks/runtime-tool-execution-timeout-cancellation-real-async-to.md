# Runtime: tool execution timeout/cancellation + real-async to

## Source

Created with `fas create-task` on 2026-06-10.

## Problem

Surfaced by the fas-studio agents-with-tools readiness assessment (2026-06-10). tools.execute (packages/actor-core-runtime/src/actor-tools.ts createActorToolbox) awaits a tool promise indefinitely: a hung tool (e.g. a slow/stuck LLM call) wedges its actor forever — no deadline, no cancellation, no fallback. Existing coverage uses only fake synchronous tools (unit actor-tools.test.ts; examples/fas-agent-loop). Needed before agents call real model APIs: (1) deadline support for tool execution — per-call timeout option and/or registry-level default, with an AbortSignal exposed via ActorToolExecutionContext so adapters can cancel underlying requests; (2) timeout produces a typed error/fact the behavior can handle without crashing the actor; (3) an e2e test where a spawned actor calls a REAL async tool (timer-backed) and a hung tool times out while the actor stays responsive; (4) document the timeout pattern for tool authors. Keep the core deterministic — timers via the runtime's existing timeout utilities, not ad-hoc setTimeout in the core.

## Automation admission

- Expected operator value: Improves operator leverage around "Runtime: tool execution timeout/cancellation + real-async tool e2e coverage" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- a hung tool call times out with a typed error and the calling actor remains responsive (tested)
- AbortSignal (or equivalent cancellation hook) reaches the tool executor context
- an e2e test exercises a real async tool from a spawned actor through tools.execute
- timeout behavior is documented for tool authors
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
