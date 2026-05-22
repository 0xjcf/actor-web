# Clean up FAS memory and tracker text quality

## Source

Created with `fas create-task` on 2026-05-22.

## Problem

Covers CodeRabbit FAS artifact minor text-quality findings: truncated task titles and references in .fas/TASKS.md, .fas/memory/decisions.md, and .fas/memory/patterns.md.

## Acceptance criteria

- All truncated occurrences of Logistics Docker Compose worker restart recovery verification are expanded to the full word verification.
- All truncated occurrences of Actor-Web docs consistency pass for current runtime guarantees are expanded to the full word guarantees.
- Cross-references between decisions and patterns use consistent full titles.
- Markdown lint and diff check pass for changed FAS memory/tracker files.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- .fas/TASKS.md
- .fas/memory/decisions.md
- .fas/memory/patterns.md

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
