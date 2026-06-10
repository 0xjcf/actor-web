# Docs: refresh root + runtime READMEs to the real post-rename

## Source

Created with `fas create-task` on 2026-06-10.

## Problem

Docs accuracy audit (2026-06-10). The runtime README ships in the npm tarball, so npmjs.com/package/@actor-web/runtime renders it — fixes only reach npm at the next publish (tie to Release prep 0.2.0). FINDINGS: (1) ROOT README.md — 13 uses of defineActor() (renamed defineBehavior 2026-06-09, defineActor is NOT exported); line ~167 calls createSupervisor() which does not exist (real APIs: Supervisor class, createSupervisorTree); inconsistent .build() messaging (.build() is OPTIONAL since 2026-06-09 — pick one style and say so once). (2) packages/actor-core-runtime/README.md — JSDoc module says @actor-core/runtime; 'Migration Notice' references a legacy /src/core that no longer exists in this repo (confusing on the npm page); FICTIONAL feature claims with zero source behind them: 'Virtual Actor System (Orleans-style)' (0 files), 'tRPC-Inspired Proxies' (0 files), 'HTN planning/AI agent patterns' (1 stray mention); 'Capability Security' overstated (the real mechanism is the toolAccess allow-list). Remove or rewrite claims to match shipped reality. (3) docs/API.md — mostly ACCURATE (correct defineBehavior/startRuntime/serveNode/@actor-web scope); minor: .build() consistency + 11 Ignite-naming references (overlaps queued ignite docs tasks — do not duplicate that scope). (4) packages/actor-core-testing/README.md ACCURATE; cli README ACCURATE (v0). Marketing claims must be provable by a test or source file. Remember: markdown outside .fas/ is NOT verify-linted — run markdownlint-cli2 on touched files.

## Automation admission

- Expected operator value: Improves operator leverage around "Docs: refresh root + runtime READMEs to the real post-rename API (remove fictional feature claims)" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- root README uses only exported APIs (defineBehavior, Supervisor/createSupervisorTree) and every code fence compiles conceptually against the real surface
- runtime README has no claims without corresponding source/tests, no /src/core migration notice, and @actor-web module naming
- .build() optionality stated once and used consistently across README/API.md
- touched markdown passes markdownlint-cli2
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
