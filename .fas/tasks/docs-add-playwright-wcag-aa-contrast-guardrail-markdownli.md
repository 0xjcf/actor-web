# Docs: add Playwright WCAG AA contrast guardrail + markdownli

## Source

Created with `fas create-task` on 2026-06-07.

## Problem

Deferred from Docs D1. (1) Port ignite-element's check-contrast.mjs as docs/site/scripts/check-contrast.mjs: render the built site in Playwright Chromium, assert WCAG AA in both themes (>=3:1 UI/large, >=4.5:1 body text) across nav, sidebar, TOC, inline code, links, callouts; plus a geometry check that interactive controls use the --radius-* tokens. Retarget selectors to VitePress DOM (.VPNav, .VPSidebar, .vp-doc a, .vp-doc :not(pre) > code). Add a docs:contrast root script + wire into .github/workflows/docs.yml. (2) Extend markdownlint to docs/site with a VitePress-aware config (disable MD025 front_matter_title, MD041 for the hero home page, MD033 for VitePress components; exclude docs/site/node_modules and .vitepress) and add docs/site to the lint:md glob. See docs/actor-web-documentation-plan.md (Design system: a11y guardrail).

## Acceptance criteria

- The new functionality works as described.
- Existing behavior is not broken.
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

- docs/site/scripts/check-contrast.mjs
- .github/workflows/docs.yml
- package.json
- .markdownlint.jsonc

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
