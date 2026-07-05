# Document actor-web ecosystem architecture alignment

## Source

Created with `fas create-task` on 2026-07-02.

## Problem

Create an actor-web-local ecosystem alignment document and correct adjacent Actor-Web/Ignite docs so the published guidance matches the current single-source Ignite contract without claiming global governance for sibling repositories.

## Acceptance criteria

- docs/actor-web-ecosystem-alignment.md exists as an internal actor-web-local alignment note.
- The document has governance/source-of-truth mechanics and current-vs-target maturity labels.
- The document separates ownership, call-flow, package/dependency, and projection/read-model diagrams.
- The document scopes FAS, fas-local, actor-web, ignite-element, docs/site, and examples responsibilities without replacing existing ADRs or spikes.
- Actor-Web docs and examples describe Ignite's single source config accurately: gateway source(...) for read/write, readModel(...) for projection-only, and commandSource(...) for command-only control.
- No production source code is changed.
- Verification covers markdown lint, docs build, fas validate-task, and full FAS verification.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Establish the intended approach at a design level before editing code.

## Alternatives considered

- None recorded yet.

## Affected files

- docs/actor-web-ecosystem-alignment.md
- docs/API.md
- docs/actor-web-topology-source-dx-design.md
- docs/examples/ignite-element-host.md
- docs/site/guides/ignite-element.md
- docs/site/api/topology.md
- docs/site/concepts/sources-and-gateway.md

## Scope Amendments

- Type: scope-refresh
- Added at: 2026-07-02
- Added paths: docs/actor-web-ecosystem-alignment.md

- Type: review-scope-expansion
- Added at: 2026-07-03
- Trigger: Accuracy review before commit found adjacent docs still describing the removed Ignite per-config commandSource shape.
- Reason: The alignment note depends on nearby Actor-Web/Ignite docs using the same single-source contract language.
- Added paths: docs/actor-web-ecosystem-alignment.md, docs/API.md, docs/actor-web-topology-source-dx-design.md, docs/examples/ignite-element-host.md, docs/site/guides/ignite-element.md, docs/site/api/topology.md, docs/site/concepts/sources-and-gateway.md
- Evidence source: current-source-review
- Evidence: current-source-review | packages/actor-core-runtime/src/actor-web-source.ts | createActorWebCommandSource uses command-only subscribe mode while topology source(...) is the gateway read/write source.
- Accuracy signal: ignite-element type tests reject per-config commandSource and current actor-web source tests prove command-only gateway mode.
- Follow-up needed: None; docs-only correction included in this task.

## Implementation plan

- Create docs/actor-web-ecosystem-alignment.md as a repo-local architecture alignment note.
- Correct adjacent Actor-Web/Ignite docs so Ignite uses one source key and actor-web source factories are described accurately.
- Preserve sibling-repo ownership boundaries and avoid production source changes.

## Verification plan

- Run markdownlint on the touched Markdown files.
- Run pnpm docs:build for the published docs changes.
- Run fas validate-task for the inner-loop gate.
- Run fas verify --full before commit.

## Risks

- Overstating target-state architecture as current fact would recreate the review concern.
- Leaving the old per-config Ignite commandSource guidance in nearby docs would make the alignment note accurate but the published docs misleading.
- Editing production source would widen the task beyond docs alignment.

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
