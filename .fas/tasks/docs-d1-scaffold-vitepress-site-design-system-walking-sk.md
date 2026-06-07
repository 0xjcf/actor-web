# Docs D1: scaffold VitePress site + design system (walking sk

## Source
Created with `fas create-task` on 2026-06-07.

## Problem
Documentation plan D1, foundational/unblocks D2-D6. Scaffold docs/site VitePress workspace package (+pnpm-workspace.yaml, root docs:* scripts). Establish the design system: .vitepress/theme/tokens.css dark-first both-theme, 6/8/12 radius scale, accent amber #f5a623 (pending sign-off vs violet/emerald). Full IA nav. Three real pages: What is Actor-Web?, Your first actor (counter), Subscriptions & events. Wire @shikijs/vitepress-twoslash typechecked samples. Port contrast/a11y guardrail (check-contrast.mjs) + CI gating docs/site/**. See docs/actor-web-documentation-plan.md.

## Acceptance criteria
- The change is verified and does not introduce regressions.
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
- docs/site
- pnpm-workspace.yaml
- package.json
- .github/workflows

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
