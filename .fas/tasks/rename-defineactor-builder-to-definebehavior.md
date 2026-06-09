# Rename defineActor builder to defineBehavior

## Source

Updated with `fas edit-task` on 2026-06-08.

## Problem

Rename defineActor builder to defineBehavior

## Acceptance criteria

- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Scope Amendments

- Type: scope-refresh-promotion
- Added at: 2026-06-08
- Trigger: dirty-low-confidence-scope
- Reason: Promoted dirty low-confidence or dependency-reachable task-packet path(s) into affected scope.
- Added paths: packages/actor-core-runtime/src/create-actor.ts, packages/actor-core-runtime/src/fluent-behavior-builder.ts, packages/actor-core-runtime/src/integration/fluent-builder.test.ts, packages/actor-core-runtime/src/topology.ts, packages/actor-core-runtime/src/unit/message-delivery.test.ts, packages/actor-core-runtime/src/unit/topology-plain-behavior.test.ts
- Evidence source: task-packet dirty scope promotion
- Evidence: task-packet dirty scope promotion | .fas/state/task-packet.json | Promoted dirty path(s): packages/actor-core-runtime/src/create-actor.ts, packages/actor-core-runtime/src/fluent-behavior-builder.ts, packages/actor-core-runtime/src/integration/fluent-builder.test.ts, packages/actor-core-runtime/src/topology.ts, packages/actor-core-runtime/src/unit/message-delivery.test.ts, packages/actor-core-runtime/src/unit/topology-plain-behavior.test.ts
- Accuracy signal: Path was dirty in git status and present in task-packet low-confidence/dependency-reachable scope.

- Type: scope-refresh-promotion
- Added at: 2026-06-09
- Trigger: dirty-low-confidence-scope
- Reason: Promoted dirty low-confidence or dependency-reachable task-packet path(s) into affected scope.
- Added paths: packages/actor-core-runtime/src/create-actor.ts, packages/actor-core-runtime/src/fluent-behavior-builder.ts, packages/actor-core-runtime/src/integration/fluent-builder.test.ts, packages/actor-core-runtime/src/topology.ts, packages/actor-core-runtime/src/unit/message-delivery.test.ts, packages/actor-core-runtime/src/unit/topology-plain-behavior.test.ts
- Evidence source: task-packet dirty scope promotion
- Evidence: task-packet dirty scope promotion | .fas/state/task-packet.json | Promoted dirty path(s): packages/actor-core-runtime/src/create-actor.ts, packages/actor-core-runtime/src/fluent-behavior-builder.ts, packages/actor-core-runtime/src/integration/fluent-builder.test.ts, packages/actor-core-runtime/src/topology.ts, packages/actor-core-runtime/src/unit/message-delivery.test.ts, packages/actor-core-runtime/src/unit/topology-plain-behavior.test.ts
- Accuracy signal: Path was dirty in git status and present in task-packet low-confidence/dependency-reachable scope.

## Implementation plan

- Rename the public `defineActor` builder export to `defineBehavior` across packages, examples, and docs (preserve `defineActorWebTopology`/`defineActorWebApp`).
- Make `.build()` optional: detect an un-built builder in `materializeActorWebBehavior` and build it under the hood.
- Carry phantom `__contextType`/`__messageType`/`__emittedType` on `UnifiedActorBuilder` and extend the topology event extractor so an un-built builder still infers correctly.
- Rename the docs API page `define-actor.md` -> `define-behavior.md` and update nav/links.

## Verification plan

- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- Note any regression, rollout, or coordination risk before implementation begins.

## Dependencies

- List blocking tasks, PRs, docs, or external inputs.

## Open questions

- Capture unresolved decisions that need confirmation before closeout.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`

## Affected files

- docs/API.md
- docs/actor-web-actor-dx-design.md
- docs/actor-web-declarative-subscriptions-design.md
- docs/actor-web-documentation-plan.md
- docs/actor-web-topology-source-dx-design.md
- docs/actor-web-xstate-transition-dx-design.md
- docs/site/.vitepress/config.ts
- docs/site/api/define-behavior.md
- docs/site/api/index.md
- docs/site/api/topology.md
- docs/site/concepts/actors-and-behaviors.md
- docs/site/concepts/state-and-machines.md
- docs/site/getting-started/installation.md
- docs/site/getting-started/your-first-actor.md
- docs/site/guides/xstate-transitions.md
- docs/site/index.md
- docs/site/overview/what-is-actor-web.md
- docs/spikes/actor-web-adr-003-fas-integration-review.md
- examples/fas-agent-loop/fas-behaviors.ts
- examples/ignite-headless-host/logistics-operations-behaviors.ts
- examples/ignite-headless-host/logistics-provider-hq-behavior.ts
- examples/ignite-headless-host/logistics-provider-runtime-behavior.ts
- examples/ignite-headless-host/logistics-provider-shipment-behavior.ts
- examples/ignite-headless-host/logistics-routing-behavior.ts
- examples/ignite-headless-host/logistics-service-worker-behavior.ts
- examples/ignite-headless-host/logistics-shipment-behavior.ts
- examples/ignite-headless-host/logistics-shipment-directory-behavior.ts
- packages/actor-core-runtime/README.md
- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/actor-system.ts
- packages/actor-core-runtime/src/actor-web-node-runtime.ts
- packages/actor-core-runtime/src/actors/system-event-actor.ts
- packages/actor-core-runtime/src/actors/timer-actor.ts
- packages/actor-core-runtime/src/browser.ts
- packages/actor-core-runtime/src/create-actor.ts
- packages/actor-core-runtime/src/create-component.ts
- packages/actor-core-runtime/src/examples/flat-message-demo.ts
- packages/actor-core-runtime/src/examples/otp-style-demo.ts
- packages/actor-core-runtime/src/fluent-behavior-builder.ts
- packages/actor-core-runtime/src/index.ts
- packages/actor-core-runtime/src/integration/ask-pattern-safeguards.test.ts
- packages/actor-core-runtime/src/integration/async-messaging.test.ts
- packages/actor-core-runtime/src/integration/event-emission-debug.test.ts
- packages/actor-core-runtime/src/integration/event-emission-layered.test.ts
- packages/actor-core-runtime/src/integration/event-emission.test.ts
- packages/actor-core-runtime/src/integration/fluent-builder.test.ts
- packages/actor-core-runtime/src/integration/graceful-shutdown.test.ts
- packages/actor-core-runtime/src/integration/xstate-bridge.test.ts
- packages/actor-core-runtime/src/performance/benchmark.ts
- packages/actor-core-runtime/src/testing/event-collector.ts
- packages/actor-core-runtime/src/testing/timer-actor-validation.test.ts
- packages/actor-core-runtime/src/topology.ts
- packages/actor-core-runtime/src/unified-actor-builder.ts
- packages/actor-core-runtime/src/unit/actor-behavior-emit.test.ts
- packages/actor-core-runtime/src/unit/actor-tools.test.ts
- packages/actor-core-runtime/src/unit/actor-web-local-runtime.test.ts
- packages/actor-core-runtime/src/unit/browser-websocket-message-transport.test.ts
- packages/actor-core-runtime/src/unit/ignite-element-bridge.test.ts
- packages/actor-core-runtime/src/unit/machine-actor-emit.test.ts
- packages/actor-core-runtime/src/unit/message-delivery.test.ts
- packages/actor-core-runtime/src/unit/node-websocket-runtime.test.ts
- packages/actor-core-runtime/src/unit/on-transition-builder.test.ts
- packages/actor-core-runtime/src/unit/remote-transport.test.ts
- packages/actor-core-runtime/src/unit/serve-actor-web-http.test.ts
- packages/actor-core-runtime/src/unit/serve-actor-web-node.test.ts
- packages/actor-core-runtime/src/unit/start-actor-web-node.test.ts
- packages/actor-core-runtime/src/unit/topology-plain-behavior.test.ts
- packages/actor-core-runtime/src/unit/topology-subscriptions.test.ts
- packages/actor-core-runtime/src/unit/topology.test.ts
- packages/actor-core-testing/README.md
- packages/agent-workflow-cli/src/actors/git-actor.ts
- packages/agent-workflow-cli/src/core/cli-actor-system.ts
