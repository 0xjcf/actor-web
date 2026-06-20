# Make actor addresses opaque and mint them through one canonical factory

## Source

Created with `fas create-task` on 2026-06-19.

## Problem

Location-transparency audit L0. The actor address actor://node/type/id leaks the physical node, the type segment is a hardcoded constant, and minting is duplicated (system.spawn actor-system-impl.ts:982-990 vs topology.ts:559-573); node=local normalization (utils/factories.ts:68; actor-system.ts:759-767) diverges from concrete node strings, a latent transparency leak. Centralize minting in one factory used by spawn and topology; treat the path as an opaque key end-to-end; one canonical local-node normalization. Foundation for the unified directory.

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

- packages/actor-core-runtime/src/utils/factories.ts
- packages/actor-core-runtime/src/actor-system.ts
- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/topology.ts
- packages/actor-core-runtime/src/actor-web-source.ts
- packages/actor-core-runtime/src/distributed-actor-directory.ts
- packages/actor-core-runtime/src/actor-system-guardian.ts
- packages/actor-core-runtime/src/unit/actor-address.test.ts
- packages/actor-core-runtime/src/unit/actor-source.test.ts
- packages/actor-core-runtime/src/unit/actor-tools.test.ts
- packages/actor-core-runtime/src/unit/actor-web-source.test.ts
- packages/actor-core-runtime/src/unit/component-runtime-ownership.test.ts
- packages/actor-core-runtime/src/unit/cross-node-subscription-delivery.test.ts
- packages/actor-core-runtime/src/unit/cross-node-subscription-integration.test.ts
- packages/actor-core-runtime/src/unit/serve-actor-web-node.test.ts
- packages/actor-core-runtime/src/unit/start-actor-web-node.test.ts
- packages/actor-core-runtime/src/unit/supervisor-trees.test.ts
- packages/actor-core-runtime/src/unit/system-event-actor-processing.test.ts
- packages/actor-core-runtime/src/unit/topology.test.ts
- packages/actor-core-runtime/src/unit/distributed-actor-directory.test.ts
- packages/actor-core-runtime/src/integration/event-emission-debug.test.ts
- examples/ignite-headless-host/logistics-contract.ts
- examples/ignite-headless-host/headless-host.test.ts
- examples/ignite-headless-host/logistics-runtime-status.test.ts
- examples/fas-agent-loop/fas-agent-loop.test.ts
- packages/actor-core-runtime/src/capability-security.ts
- packages/actor-core-runtime/src/create-actor-ref.ts
- packages/actor-core-runtime/src/runtime-gateway.ts
- packages/actor-core-runtime/src/utils/null-actor.ts
- packages/actor-core-runtime/src/unit/auto-publishing-actual.test.ts
- packages/actor-core-runtime/src/unit/message-plan.test.ts
- packages/actor-core-runtime/src/unit/message-plan.unit.test.ts
- packages/actor-core-runtime/src/unit/plan-interpreter.test.ts
- packages/actor-core-runtime/src/unit/runtime-gateway.test.ts
- packages/actor-core-runtime/src/unit/runtime-projection.test.ts
- packages/actor-core-runtime/src/integration/actor-system-guardian.test.ts
- packages/actor-core-runtime/src/integration/guardian-integration.test.ts
- examples/ignite-headless-host/logistics-runtime-status-panel.tsx

## Scope Amendments

- Type: necessary-consumer-update
- Added at: 2026-06-19
- Trigger: breaking ActorAddress.type->kind + dropping /actor/ from actor paths
- Reason: Architect+staff+root verified the full opaque-address surface at HEAD 283a834. Includes a 4th hidden parser (parseAddressKey) and the topology ActorWebActorAddress narrowing. Maintainer approved fixing the 4 first-party examples files in-PR (Option 1) because they are compiled by root tsconfig and run by pnpm test:examples; verify.sh --full requires them green.
- Added paths: packages/actor-core-runtime/src/utils/factories.ts, packages/actor-core-runtime/src/actor-system.ts, packages/actor-core-runtime/src/actor-system-impl.ts, packages/actor-core-runtime/src/topology.ts, packages/actor-core-runtime/src/actor-web-source.ts, packages/actor-core-runtime/src/distributed-actor-directory.ts, packages/actor-core-runtime/src/actor-system-guardian.ts, packages/actor-core-runtime/src/unit/actor-address.test.ts, packages/actor-core-runtime/src/unit/actor-source.test.ts, packages/actor-core-runtime/src/unit/actor-tools.test.ts, packages/actor-core-runtime/src/unit/actor-web-source.test.ts, packages/actor-core-runtime/src/unit/component-runtime-ownership.test.ts, packages/actor-core-runtime/src/unit/cross-node-subscription-delivery.test.ts, packages/actor-core-runtime/src/unit/cross-node-subscription-integration.test.ts, packages/actor-core-runtime/src/unit/serve-actor-web-node.test.ts, packages/actor-core-runtime/src/unit/start-actor-web-node.test.ts, packages/actor-core-runtime/src/unit/supervisor-trees.test.ts, packages/actor-core-runtime/src/unit/system-event-actor-processing.test.ts, packages/actor-core-runtime/src/unit/topology.test.ts, packages/actor-core-runtime/src/unit/distributed-actor-directory.test.ts, packages/actor-core-runtime/src/integration/event-emission-debug.test.ts, examples/ignite-headless-host/logistics-contract.ts, examples/ignite-headless-host/headless-host.test.ts, examples/ignite-headless-host/logistics-runtime-status.test.ts, examples/fas-agent-loop/fas-agent-loop.test.ts
- Evidence source: 6-agent architect+staff briefs (CONFUSION-A/B/C) + root verification of root package.json test + tsconfig include
- Evidence: 6-agent architect+staff briefs (CONFUSION-A/B/C) + root verification of root package.json test + tsconfig include

- Type: scope-refresh-promotion
- Added at: 2026-06-20
- Trigger: dirty-low-confidence-scope
- Reason: Promoted dirty low-confidence or dependency-reachable task-packet path(s) into affected scope.
- Added paths: packages/actor-core-runtime/src/actor-web-source.ts
- Evidence source: task-packet dirty scope promotion
- Evidence: task-packet dirty scope promotion | .fas/state/task-packet.json | Promoted dirty path(s): packages/actor-core-runtime/src/actor-web-source.ts
- Accuracy signal: Path was dirty in git status and present in task-packet low-confidence/dependency-reachable scope.

## Scope Amendments (implementation-discovered consumers)

- Type: necessary-consumer-update
- Added at: 2026-06-19
- Trigger: the atomic ActorAddress.type->kind rename makes additional first-party consumers non-compiling that the original brief scope did not enumerate; the package typecheck (tsc over src/**/*) and root typecheck (examples) both flag them.
- Reason: These are the mechanical fan-out of the LOCKED field rename, not a design change. They mirror the guardian precedent (site 11): non-uniform sentinel/mock addresses ('mock'/'unified'/'null'/'system'/'test'/'worker') coerce their old type to kind:'actor'; runtime-gateway address equality compares kind instead of type. No widening of the kind union. Fixing them is required for fas validate-task (lint/typecheck) and the root gate to go green.
- Added paths: packages/actor-core-runtime/src/capability-security.ts, packages/actor-core-runtime/src/create-actor-ref.ts, packages/actor-core-runtime/src/runtime-gateway.ts, packages/actor-core-runtime/src/utils/null-actor.ts, packages/actor-core-runtime/src/unit/auto-publishing-actual.test.ts, packages/actor-core-runtime/src/unit/message-plan.test.ts, packages/actor-core-runtime/src/unit/message-plan.unit.test.ts, packages/actor-core-runtime/src/unit/plan-interpreter.test.ts, packages/actor-core-runtime/src/unit/runtime-gateway.test.ts, packages/actor-core-runtime/src/unit/runtime-projection.test.ts, packages/actor-core-runtime/src/integration/actor-system-guardian.test.ts, packages/actor-core-runtime/src/integration/guardian-integration.test.ts, examples/ignite-headless-host/logistics-runtime-status-panel.tsx
- Evidence: fas validate-task changeset receipt unexpectedFiles (5 source) + planAlignmentSummary.testCoverageFiles (8 test); full package vitest run 558 passed; root pnpm typecheck + pnpm test:examples (51 passed) green.

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
