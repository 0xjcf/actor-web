# Docs hygiene: scrub absolute local-path leaks from committed docs

## Source

Created from `.fas/queue/tasks.json` task `task-1782439279955`.

## Problem

CodeRabbit review --agent -t committed --base main -c AGENTS.md on branch fas/release-0-2-0 flagged docs/test hygiene issues that should remain one release-blocking docs cleanup bucket. Keep the original absolute-path leak cleanup, and also verify/fix: docs/0009-fas-local-runtime-host-substrate-alignment.md contains a machine-local absolute home-path reference that should become repo-relative prose; docs/actor-web-ecosystem-alignment.md overstates maturity with Current labels where the cited evidence is Proposed or partial; src/docs-honesty.test.ts is too loose because shared toContain assertions can pass on later incidental mentions instead of the first-mention hero/frontmatter copy. Verify each finding against current code before editing.

## Acceptance criteria

- fas validate-task passes before snapshot; full verify remains shared for batch close.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Re-run the grep to establish the current leak set.
- Replace committed documentation leaks with repo-relative paths or generic
  examples.
- Adjust ignore/tracking only if generated docs-site dependencies are committed
  or visible to release checks.

## Alternatives considered

- None recorded yet.

## Affected files

- docs/spikes/actor-web-adr-003-fas-integration-review.md
- docs/actor-web-dx-naming-handoff.md
- .gitignore
- docs/site
- docs/0009-fas-local-runtime-host-substrate-alignment.md
- docs/actor-web-ecosystem-alignment.md
- src/docs-honesty.test.ts

## Scope Amendments

- Type: coderabbit-review-followup
- Added at: 2026-07-04
- Trigger: CodeRabbit committed review against main during release batch closeout
- Reason: Consolidate minor docs/test findings into the existing release-blocking docs hygiene task instead of creating duplicate queue items.
- Added paths: docs/0009-fas-local-runtime-host-substrate-alignment.md, docs/actor-web-ecosystem-alignment.md, src/docs-honesty.test.ts, docs/spikes/actor-web-adr-003-fas-integration-review.md, docs/actor-web-dx-naming-handoff.md, .gitignore, docs/site
- Evidence source: coderabbit review --agent -t committed --base main -c AGENTS.md
- Evidence: coderabbit review --agent -t committed --base main -c AGENTS.md | docs/0009-fas-local-runtime-host-substrate-alignment.md | Also includes docs/actor-web-ecosystem-alignment.md and src/docs-honesty.test.ts findings.
- Accuracy signal: reviewer-confirmed
- Follow-up needed: Implement through the existing docs hygiene task before release prep.

## Implementation plan

- Reproduce the leak list with grep.
- Patch only committed docs or ignore rules that are necessary for the leak set.
- Run markdown lint and release-relevant grep verification.

## Verification plan

- Run tracked-file grep for machine-local home paths, for example
  `git grep -n "$HOME" -- docs src .fas .changeset .gitignore`.
- Run markdown lint for changed documentation.
- Run `fas validate-task`.

## Risks

- Some `.fas` artifacts may intentionally preserve provenance. Do not remove
  required FAS evidence without checking whether it is public release material.
- Avoid editing generated `node_modules` shims directly.

## Dependencies

- None.

## Open questions

- Decide during implementation whether `.fas` provenance paths are acceptable
  internal artifacts or must be scrubbed for the 0.2.0 public release.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
