# Prevent unhandled Actor-Web gateway rejection during example teardown

## Source

Created with `fas create-task` on 2026-08-04.

## Problem

The FAS dashboard example starts an async Ignite story command without awaiting it, then runtime teardown closes raw gateway sockets while the source still owns pending work. The resulting gateway-disconnected rejection escapes after the test and makes pnpm test:all fail intermittently during release.

## Acceptance criteria

- The recorded story command is awaited and its recording subscription is stopped during test cleanup.
- The example runtime owns every task-board source it creates, closes active sources before stopping nodes, and deregisters sources that callers close manually.
- A regression test proves active sources close during runtime teardown and manually closed sources are not closed twice.
- pnpm test:examples, fas validate-task, full FAS verification, and pnpm release:stable --dry-run pass without an unhandled gateway rejection.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Establish the intended approach at a design level before editing code.

## Alternatives considered

- None recorded yet.

## Affected files

- examples/fas-agent-loop/fas-example-runtime.ts
- examples/fas-agent-loop/fas-agent-loop.test.ts

## Scope Amendments

- Type: root-cause-localization
- Added at: 2026-08-04
- Trigger: Release verification reported a post-test unhandled Actor-Web gateway-disconnected rejection.
- Reason: The test leaves story.execute pending and the example runtime tracks transport sockets instead of the sources that own pending requests and subscriptions.
- Added paths: examples/fas-agent-loop/fas-example-runtime.ts, examples/fas-agent-loop/fas-agent-loop.test.ts
- Evidence source: User release output and project PR-feedback memory
- Evidence: User release output and project PR-feedback memory | examples/fas-agent-loop/fas-agent-loop.test.ts | story.execute was not awaited at line 543; .fas/memory/pr-feedback.md requires source registries to deregister manually closed sources.
- Accuracy signal: Direct stack trace and source inspection agree on the teardown race.

## Implementation plan

- Add deterministic regression coverage for source ownership and manual-close deregistration.
- Replace raw gateway-socket cleanup with an idempotent owned-source registry used by both task-board and dashboard factories.
- Await the Ignite story command and stop the story before the dashboard subscription is released.
- Run focused and release-quality verification.

## Verification plan

- Run the focused fas-agent-loop example test and record the failing ownership assertion as TDD red.
- Run pnpm test:examples.
- Run fas validate-task and fas verify --full.
- Run pnpm release:stable --dry-run.

## Risks

- Closing sources in the wrong order could reject in-flight commands; the story command must settle before teardown.
- A source wrapper must preserve the complete ClosableActorWebSource contract and remain idempotent.

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
