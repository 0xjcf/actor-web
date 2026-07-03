# Docs hygiene: scrub absolute local-path leaks from committed docs

## Source

Created from `.fas/queue/tasks.json` task `task-1782439279955`.

## Problem

CodeRabbit flagged absolute local filesystem paths leaking the maintainer's
machine layout into committed public documentation. One `.fas` brief instance
was fixed in PR #32, but follow-up grep found additional occurrences outside
that PR diff.

Current sites to re-check:

- `docs/spikes/actor-web-adr-003-fas-integration-review.md`
- `docs/actor-web-dx-naming-handoff.md`
- generated `docs/site/node_modules/.bin/**` shims

Generated dependency shims should be handled by ignore/cleanup policy, not by
editing vendored files.

## Acceptance criteria

- Committed docs do not expose `/Users/joseflores/...` absolute local paths.
- Public docs use repo-relative paths or generic placeholders where needed.
- Generated `docs/site/node_modules` artifacts are ignored or removed from the
  committed surface rather than manually edited.
- `grep -rn "/Users/joseflores" docs/ .fas/ .changeset/` returns only intended
  internal FAS evidence, or no matches if none are intended.
- Markdown lint passes for changed docs.
- The release terminal task is no longer blocked by this docs hygiene task.

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

## Scope Amendments

- None.

## Implementation plan

- Reproduce the leak list with grep.
- Patch only committed docs or ignore rules that are necessary for the leak set.
- Run markdown lint and release-relevant grep verification.

## Verification plan

- Run `grep -rn "/Users/joseflores" docs/ .fas/ .changeset/`.
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
