# Resolve unenforced SendInstruction delivery modes (retry(3), guaranteed)

## Source
Created with `fas create-task` on 2026-06-11.

## Problem
Resolve unenforced SendInstruction delivery modes (retry(3), guaranteed)

## Acceptance criteria
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution
- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered
- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

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

- 2026-06-11: Human decision recorded — remove both modes (not implement), and make `mode` optional defaulting to `fireAndForget` since it is the only value. Removed `plan-interpreter.ts` from scope (its `instruction.mode || 'fireAndForget'` fallback already handles the optional field; no change needed) and `docs/API.md` (no delivery-mode mentions). Added the two message-plan test files, the docs-site pages that documented the removed modes, and the memory files carrying PR #20 post-merge lessons committed on this branch.

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
