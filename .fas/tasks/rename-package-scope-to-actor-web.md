# Rename package scope to @actor-web

## Source

Created with `fas create-task` on 2026-06-08.

## Problem

Re-scope all published packages to match the project name (and mirror ignite-element's scope=project convention): @actor-core/runtime -> @actor-web/runtime, @actor-core/testing -> @actor-web/testing, @agent-workflow/cli -> @actor-web/cli. Update package name fields AND every reference: imports incl. subpath entries (@actor-core/runtime/topology|/browser|/node), tsconfig paths/references, the docs twoslash resolution, root package.json scripts/filters, docs/, examples/. ~205 files / ~1436 occurrences in actor-web. Keep package directory names as-is (pnpm globs packages/*); only the package name/scope changes. MUST run BEFORE the 'Stabilize Ignite source contract' / first release task so the initial publish and ignite-element's new dependency use the final name (no deprecation needed — nothing published yet, all 0.1.0). Cross-repo consumers (fas-studio src/runtime/*, ignite-element) update imports in their own repos as follow-ups.

## Acceptance criteria

- External behavior is unchanged.
- The refactored code meets the stated goal.
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

- .github/workflows/docs-contrast.yml
- .github/workflows/docs.yml
- README.md
- docs/API.md
- docs/actor-web-documentation-plan.md
- docs/actor-web-topology-source-dx-design.md
- docs/actor-web-xstate-transition-dx-design.md
- docs/site/.vitepress/config.ts
- docs/site/api/define-actor.md
- docs/site/api/index.md
- docs/site/api/runtimes.md
- docs/site/api/testing.md
- docs/site/api/topology.md
- docs/site/concepts/actors-and-behaviors.md
- docs/site/concepts/topology.md
- docs/site/getting-started/installation.md
- docs/site/getting-started/topology-and-runtime.md
- docs/site/getting-started/your-first-actor.md
- docs/site/guides/multi-process-deployment.md
- docs/site/guides/testing-actors.md
- docs/site/guides/xstate-transitions.md
- docs/site/package.json
- docs/spikes/actor-web-adr-003-fas-integration-review.md
- docs/spikes/actor-web-external-transport-design.md
- examples/fas-agent-loop/fas-behaviors.ts
- examples/fas-agent-loop/fas-dashboard.ts
- examples/fas-agent-loop/fas-example-runtime.ts
- examples/fas-agent-loop/fas-tool-adapters.ts
- examples/fas-agent-loop/fas-topology.ts
- examples/ignite-headless-host/browser-transport.ts
- examples/ignite-headless-host/headless-host.test.ts
- examples/ignite-headless-host/logistics-browser-client.ts
- examples/ignite-headless-host/logistics-operations-behaviors.ts
- examples/ignite-headless-host/logistics-provider-hq-behavior.ts
- examples/ignite-headless-host/logistics-provider-process.ts
- examples/ignite-headless-host/logistics-provider-runtime-behavior.ts
- examples/ignite-headless-host/logistics-provider-shipment-behavior.ts
- examples/ignite-headless-host/logistics-routing-behavior.ts
- examples/ignite-headless-host/logistics-runtime-status-panel.tsx
- examples/ignite-headless-host/logistics-server-process.ts
- examples/ignite-headless-host/logistics-service-worker-behavior.ts
- examples/ignite-headless-host/logistics-shipment-behavior.ts
- examples/ignite-headless-host/logistics-shipment-directory-behavior.ts
- examples/ignite-headless-host/logistics-snapshots.ts
- examples/ignite-headless-host/logistics-topology.ts
- examples/ignite-headless-host/logistics-worker-process.ts
- examples/ignite-headless-host/server-runtime-gateway.ts
- examples/ignite-headless-host/worker-runtime.ts
- examples/ignite-headless-host/worker-websocket-runtime.ts
- examples/vite.config.ts
- examples/vitest.config.ts
- package.json
- packages/actor-core-runtime/README.md
- packages/actor-core-runtime/package.json
- packages/actor-core-testing/README.md
- packages/actor-core-testing/package.json
- packages/actor-core-testing/src/state-machine-analysis.ts
- packages/actor-core-testing/tsconfig.json
- packages/agent-workflow-cli/package.json
- packages/agent-workflow-cli/src/actors/git-actor.ts
- packages/agent-workflow-cli/src/actors/input-actor.ts
- packages/agent-workflow-cli/src/actors/pure-git-actor.ts
- packages/agent-workflow-cli/src/cli/index.ts
- packages/agent-workflow-cli/src/commands/advanced-git.ts
- packages/agent-workflow-cli/src/commands/agent-coordination.ts
- packages/agent-workflow-cli/src/commands/commit-enhanced.ts
- packages/agent-workflow-cli/src/commands/init.ts
- packages/agent-workflow-cli/src/commands/save.ts
- packages/agent-workflow-cli/src/commands/ship.ts
- packages/agent-workflow-cli/src/commands/state-machine-analysis.ts
- packages/agent-workflow-cli/src/commands/status.ts
- packages/agent-workflow-cli/src/commands/sync.ts
- packages/agent-workflow-cli/src/commands/validate.ts
- packages/agent-workflow-cli/src/core/agent-config.ts
- packages/agent-workflow-cli/src/core/cli-actor-system.ts
- packages/agent-workflow-cli/src/core/git-operations.ts
- packages/agent-workflow-cli/src/core/repo-root-finder.ts
- packages/agent-workflow-cli/src/core/validation.ts
- packages/agent-workflow-cli/src/index.ts
- packages/agent-workflow-cli/src/integration/cli-commands.test.ts
- packages/agent-workflow-cli/src/test-utils.ts
- pnpm-lock.yaml
- src/package-metadata.test.ts
- tsconfig.json

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
