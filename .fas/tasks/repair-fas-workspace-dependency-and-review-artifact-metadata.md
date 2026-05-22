# Repair FAS workspace dependency and review artifact metadata

## Source

Created with `fas create-task` on 2026-05-22.

## Problem

Covers CodeRabbit FAS artifact critical and major findings: .fas/workspace-dependencies.json references non-existent or inconsistent paths, contracts surfaces use mixed path conventions, runtime transport observability task lacks dependency prerequisites, and reduce-duplicate gateway task still contains placeholder alternatives/dependencies/open questions.

## Acceptance criteria

- All .fas/workspace-dependencies.json project and contract surface paths resolve or are explicitly marked aspirational in a machine-readable way accepted by repo tooling.
- Path convention is consistent across FAS, actor-web, and ignite-element surfaces.
- runtime-transport-observability-foundation brief declares dependency on ack/retry and message-id/idempotency reliability tasks.
- reduce-duplicate-gateway-subscriptions brief replaces placeholder Alternatives, Dependencies, and Open questions with final content.
- JSON and markdown lint pass for changed FAS artifacts.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- .fas/workspace-dependencies.json
- .fas/tasks/runtime-transport-observability-foundation.md
- .fas/tasks/reduce-duplicate-gateway-subscriptions-for-read-model-plus-c.md

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
