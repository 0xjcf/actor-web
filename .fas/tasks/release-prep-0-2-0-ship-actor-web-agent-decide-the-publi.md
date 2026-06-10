# Release prep 0.2.0: ship @actor-web/agent + decide the publi

## Source

Created with `fas create-task` on 2026-06-10.

## Problem

SEQUENCE AFTER @actor-web/agent (CLI v1) ships. Prep the next npm release line: (1) changesets for runtime/testing changes accumulated since 0.1.0 (incl. the shutdown dead-letter fix, PR #18) and the new @actor-web/agent package's first publish; (2) decide @actor-web/cli publish posture (still private; see the deferred cli-publish task); (3) DECISION REQUIRED: public package facade — whether to publish an unscoped 'actor-web' package as the public API surface (re-exporting the supported surface) while keeping @actor-web/*scoped packages as internal implementation, mirroring how ignite-element ships 'ignite-element' (unscoped) over @ignite-element/* internals. Record the decision in docs/ and decisions memory; if adopted, the facade package + changeset fixed-group membership land here; (4) consider the Changesets GitHub Action so releases run via a Version Packages PR instead of local bypass-push (repo main is PR-protected).

## Acceptance criteria

- changesets exist for all publishable changes since 0.1.0
- @actor-web/agent first-publish plumbing verified with npm pack --dry-run
- facade decision recorded (adopted or rejected) in docs/ and .fas memory
- release executed or handed to the user with exact steps
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- Scope unknown.

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
