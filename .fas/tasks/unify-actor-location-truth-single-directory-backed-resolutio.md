# Unify actor location truth: single directory-backed resolution for send and emit/subscribe

## Source

Created with `fas create-task` on 2026-06-19.

## Problem

Location-transparency audit L0 ROOT FIX (highest leverage). Two parallel registries are both location truth: DistributedActorDirectory (path to node) and AutoPublishingRegistry (publisherId to direct ActorRef). emitEventToSubscribers (actor-system-impl.ts:2684) reads subscriber refs from auto-publishing, then enqueueMessage re-resolves each subscriber address via directory.lookup (1688) and dead-letters on miss (1700-1701), the verified root of the fas-studio bug. Make the directory the single source of location truth: auto-publishing stores addresses or directory handles not refs; emit delivers through the same address chokepoint as send; reconcile registration so an actor cannot be subscriber or publisher without a directory entry; stop TTL-expiring own-node entries. Regression test: two co-located topology actors with a declarative subscription plus emit asserting zero dead-letters and zero console.error against a real directory-backed runtime.

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

- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/auto-publishing.ts
- packages/actor-core-runtime/src/distributed-actor-directory.ts
- packages/actor-core-runtime/src/unit/topology-subscriptions.test.ts
- packages/actor-core-runtime/src/unit/message-delivery.test.ts
- packages/actor-core-runtime/src/unit/distributed-actor-directory.test.ts
- packages/actor-core-runtime/src/unit/auto-publishing-actual.test.ts

## Scope Amendments

- **Address-model "A" split into its own predecessor task (2026-06-20):** the branded-path-string migration, `Address.from`, `parse()`, and `AddressQuery`/`find()` are delivered by **`task-1781964585809`** ("Collapse ActorAddress to an opaque branded path string"), which **blocks** this task. This task now *builds on* the finished A address — its scope is the **single directory-backed resolution** core (the fas-studio dead-letter fix): auto-publishing stores addresses/handles not refs, emit delivers through the same address chokepoint as send, registration reconciled so an actor cannot be subscriber/publisher without a directory entry, own-node entries not TTL-expired. Use `directory.find(AddressQuery)` (from the A task) where listing by kind is needed. Rationale: auto-memory `actor-web-address-model-decision`.

- Type: scope-promotion
- Added at: 2026-07-03
- Trigger: FAS commit plan demoted all candidate paths because the original brief had Scope unknown.
- Reason: Promote the task-packet and brief-identified runtime delivery, auto-publishing, directory, and regression-test paths before implementation.
- Added paths: packages/actor-core-runtime/src/actor-system-impl.ts, packages/actor-core-runtime/src/auto-publishing.ts, packages/actor-core-runtime/src/distributed-actor-directory.ts, packages/actor-core-runtime/src/unit/topology-subscriptions.test.ts, packages/actor-core-runtime/src/unit/message-delivery.test.ts
- Evidence source: task-packet
- Evidence: task-packet | .fas/state/task-packet.json | Relevant files and brief summary identify actor-system-impl, auto-publishing, distributed directory, and declarative subscription/message delivery tests.
- Accuracy signal: Exact filenames confirmed with rg --files; scope remains limited to the L0 directory-backed send/emit fix.

- Type: scope-promotion
- Added at: 2026-07-03
- Trigger: Implementation read found the own-node TTL acceptance criterion needs the existing directory unit test file.
- Reason: Add the focused distributed-directory test file for the own-node non-expiry regression.
- Added paths: packages/actor-core-runtime/src/unit/distributed-actor-directory.test.ts
- Evidence source: source-read
- Evidence: source-read | packages/actor-core-runtime/src/distributed-actor-directory.ts | register() assigns TTL to registry entries and lookup()/find()/getAll() filter expired entries.
- Accuracy signal: The test file exists in the same package and already covers directory behavior.

- Type: scope-promotion
- Added at: 2026-07-03
- Trigger: Runtime typecheck surfaced direct AutoPublishingRegistry test-fixture calls that still passed ActorRef values.
- Reason: Add skipped-but-typechecked auto-publishing registry tests to keep the public test fixtures aligned with the address-only subscriber contract.
- Added paths: packages/actor-core-runtime/src/unit/auto-publishing-actual.test.ts
- Evidence source: typecheck
- Evidence: typecheck | packages/actor-core-runtime/src/unit/auto-publishing-actual.test.ts | tsc errors TS2345 on registry.addSubscriber calls after SubscriberInfo became address-only.
- Accuracy signal: File change is limited to expected argument and assertion shape for existing registry unit tests.

- Type: scope-refresh-promotion
- Added at: 2026-07-03
- Trigger: dirty-low-confidence-scope
- Reason: Promoted dirty low-confidence or dependency-reachable task-packet path(s) into affected scope.
- Added paths: packages/actor-core-runtime/src/actor-system-impl.ts, packages/actor-core-runtime/src/distributed-actor-directory.ts, packages/actor-core-runtime/src/unit/message-delivery.test.ts
- Evidence source: task-packet dirty scope promotion
- Evidence: task-packet dirty scope promotion | .fas/state/task-packet.json | Promoted dirty path(s): packages/actor-core-runtime/src/actor-system-impl.ts, packages/actor-core-runtime/src/distributed-actor-directory.ts, packages/actor-core-runtime/src/unit/message-delivery.test.ts
- Accuracy signal: Path was dirty in git status and present in task-packet low-confidence/dependency-reachable scope.

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
