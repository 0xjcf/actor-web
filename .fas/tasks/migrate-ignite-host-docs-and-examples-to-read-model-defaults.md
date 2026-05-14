# Migrate Ignite host docs and examples to read-model defaults

## Source

Created with `fas create-task` on 2026-05-14.

## Problem

Follow-up from Separate Ignite read-model sources from command surfaces: docs/examples/ignite-element-host.md and examples/ignite-headless-host/logistics-browser-client.ts still teach legacy command-capable createActorWebClient/source paths as the normal Ignite host surface, which blurs the new projection-only read-model default.

## Acceptance criteria

- Compatibility aliases are documented as legacy or command-capable so downstream migration ergonomics are clear.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Describe the intended approach at a design level before diving into code.

## Alternatives considered

- List other approaches you evaluated and why they were rejected.

## Affected areas

- Which packages, modules, or layers does this change touch?

## Scope Amendments

- None.

## Implementation plan

- Describe the intended code or workflow changes in execution order.

## Verification plan

- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- Note any regression, rollout, or coordination risk before implementation begins.

## Dependencies

- List blocking tasks, PRs, docs, or external inputs.

## Open questions

- Capture unresolved decisions that need confirmation before closeout.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
