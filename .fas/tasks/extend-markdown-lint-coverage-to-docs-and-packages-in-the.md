# Extend markdown lint coverage to docs/ and packages/ in the

## Source

Created with `fas create-task` on 2026-06-10.

## Problem

Surfaced by PR #15 review (CodeRabbit caught MD040/MD060 in docs/ that verify.sh missed). The verify-path lint (pnpm lint -> lint:md) only markdownlints .fas/TASKS.md + .fas/tasks/**; docs/ and packages/**/*.md are only covered by lint:md:all, which is NOT in the verify path. Result: verify.sh --full can be green while new docs fail markdownlint, so the gap is only caught by CodeRabbit. Fix options: (a) fold the lint:md:all globs into lint:md so verify covers all markdown; or (b) add a lightweight pre-push/CI markdownlint over docs/ + packages/. Keep .markdownlint.jsonc as the single config. Acceptance: a fenced block missing a language (MD040) or a compact table separator (MD060) under docs/ or packages/ fails verify.sh locally.

## Acceptance criteria

- markdownlint over docs/ and packages/**/*.md runs in the verify path (or an equivalent pre-merge gate)
- a missing code-fence language (MD040) under docs/ fails verify locally
- .markdownlint.jsonc remains the single source of markdown lint config
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
