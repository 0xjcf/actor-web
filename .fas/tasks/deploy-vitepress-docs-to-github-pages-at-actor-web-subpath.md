# Deploy VitePress docs to GitHub Pages at /actor-web/ subpath

## Source

Created with `fas create-task` on 2026-06-11.

## Problem

Deploy VitePress docs to GitHub Pages at /actor-web/ subpath

## Acceptance criteria

- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- docs/site/.vitepress/config.ts
- .github/workflows/docs.yml
- .github/workflows/docs-contrast.yml
- README.md
- packages/actor-core-runtime/src/message-plan.ts
- packages/actor-core-runtime/src/otp-message-plan-processor.ts
- packages/actor-core-runtime/src/unit/message-plan.test.ts
- packages/actor-core-runtime/src/unit/message-plan.unit.test.ts
- docs/site/concepts/messages.md
- docs/site/api/define-behavior.md
- .fas/memory/decisions.md
- .fas/memory/pr-feedback.md
- .fas/memory/incidents.md

## Scope Amendments

- 2026-06-11 (closeout-window accounting, not implementation scope): PR #22 (this task) merged to main BEFORE PR #21 (the already-validated "Resolve unenforced SendInstruction delivery modes" task), so the closeout diff window `workflowStartHeadSha..HEAD` unavoidably contains PR #21's files (message-plan.ts, otp-message-plan-processor.ts, two message-plan test files, two docs-site pages, three memory files). Those files belong to the completed sibling task, were reviewed and merged through its own pipeline, and were NOT touched by this task's implementation (which changed only the four files listed first). Added here solely so the NO_UNPLANNED_SOURCE_FILES closeout gate reflects the interleaved-merge reality — the platform-side fix (derive the closeout window from the PR's own merge commit first-parent diff) is filed in the FAS repo queue (2026-06-11).

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
