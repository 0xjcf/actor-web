# actor-web CLI v0: in-process runtime host (serve/spawn/send/

## Source

Created with `fas create-task` on 2026-06-10.

## Problem

Design: docs/actor-web-cli-runtime-host-design.md (Phase v0). Build the first runtime-host commands in @actor-web/cli (currently a stub after PR #15) on current runtime APIs — IN-PROCESS only, NO network, NO LLM. Commands: serve ./topology.ts --node key (host an in-process node via createActorSystem/serveNode from a topology module); ls (list live actors via the directory); spawn ./behavior.ts --id id (dynamic spawn); send actor://path json and ask path json [--timeout]; watch actor://path (stream emitted events via subscribeEvent). Goal: prove the operator-console shape over the runtime and surface introspection gaps (the system snapshot reports the wrapper state, not inner machine state — see PR #14 findings). Keep cli private. Convention: user output via console.log, diagnostics via runtime Logger.

## Automation admission

- Expected operator value: Improves operator leverage around "actor-web CLI v0: in-process runtime host (serve/spawn/send/watch)" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- serve/ls/spawn/send/ask/watch work against an in-process node built from a topology module
- No network transport and no LLM dependency are introduced in v0
- @actor-web/cli remains private and changeset-ignored
- verify.sh --full passes
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
