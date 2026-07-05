# Add batch subscribers[] overload to system.subscribe

## Source

Created with `fas create-task` on 2026-06-07.

## Problem

Subscriptions design T1. Add a subscribers: ActorRef[] batch overload to system.subscribe alongside the singular form; loop addSubscriber per subscriber. Removes call-site redundancy when fanning one event to many actors. Independent/foundational, no deps. See docs/actor-web-declarative-subscriptions-design.md (T1).

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

- packages/actor-core-runtime/src/actor-system.ts
- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/auto-publishing.ts
- docs/site/concepts/subscriptions-and-events.md
- packages/actor-core-runtime/src/unit/message-delivery.test.ts

## Scope Amendments

- Type: scope-refresh
- Added at: 2026-06-08
- Added paths: docs/site/concepts/subscriptions-and-events.md

- Type: scope-promotion
- Added at: 2026-07-03T18:52:00Z
- Trigger: TDD acceptance requires direct test coverage
- Reason: Promote the existing message delivery unit test because it exercises system.subscribe event delivery and can capture the batch subscribers overload.
- Added paths: packages/actor-core-runtime/src/unit/message-delivery.test.ts
- Evidence source: repo-search
- Evidence: repo-search | packages/actor-core-runtime/src/unit/message-delivery.test.ts | Existing tests cover singular system.subscribe and emitted-event delivery.
- Accuracy signal: rg found direct system.subscribe coverage in message-delivery.test.ts.
- Follow-up needed: None.

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
