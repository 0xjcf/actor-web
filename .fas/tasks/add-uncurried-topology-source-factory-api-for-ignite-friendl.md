# Add uncurried topology source factory API for Ignite-friendly Actor-Web sources

## Source

Created with `fas create-task` on 2026-07-06.

## Problem

Refactor the topology/runtime source factory DX so the common Ignite path does not require curried source("actor")(...options) calls. Target local shape: runtime.topology.source("home") returns the local read+command source for the actor. Target remote shape: topology.source("home", { gateway }) returns a gateway-backed read+command source.

Align the explicit source variants with Actor-Web's public glossary:

- readModel("home", options) is observe-only.
- source("home", options?) is the common read+command source.
- commands("home", options) is command-only, replacing the awkward commandSource name in public examples.
- session("home", options) is the explicit lifecycle bundle, replacing the vague sourceHandle name in public examples.

Because Actor-Web is still pre-1.0, do not preserve compatibility aliases for the old public names. Replace the public topology/runtime source API with the new glossary in source, tests, docs, and examples. Remove or privatize the old commandSource/sourceHandle/readModelHandle names instead of documenting them as supported public surface. Do not add an Ignite-specific helper; Ignite should continue consuming Actor-Web source shapes directly.

## Acceptance criteria

- runtime.topology.source("home") can be passed directly to igniteCore({ source }) for local runtime actors without an IIFE or explicit source handle plumbing.
- topology.source("home", { gateway }) can be passed directly to igniteCore({ source }) for browser/gateway consumers while preserving actor-key-first ergonomics.
- Existing curried topology.source("home")({ ... }) and explicit commandSource/sourceHandle/readModelHandle public APIs are removed or privatized; tests assert the new public source vocabulary instead of preserving the old one.
- Public docs and examples use the glossary terms readModel, source, commands, and session.
- Docs explain when to use source vs readModel vs commands vs session, including command permission, role-access, and explicit lifecycle ownership guidance.
- Actor-Web + Ignite examples use the uncurried common path and do not introduce igniteActorSource or other Ignite-specific wrappers.
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

- packages/actor-core-runtime/src/topology.ts
- packages/actor-core-runtime/src/actor-web-client.ts
- packages/actor-core-runtime/src/unit/topology.test.ts
- packages/actor-core-runtime/src/unit/actor-web-local-runtime.test.ts
- docs/site/api/topology.md
- docs/site/guides/ignite-element.md
- docs/actor-web-topology-source-dx-design.md
- docs/0011-distributed-runtime-stack.md
- docs/API.md
- docs/actor-web-actor-dx-design.md
- docs/actor-web-documentation-plan.md
- docs/actor-web-ecosystem-alignment.md
- docs/examples/ignite-element-host.md
- docs/site/api/runtimes.md
- docs/site/concepts/sources-and-gateway.md
- docs/site/getting-started/topology-and-runtime.md
- docs/site/guides/testing-actors.md

## Scope Amendments

- Type: docs-consistency
- Added at: 2026-07-07
- Trigger: grep found stale public source API names after runtime implementation
- Reason: Acceptance requires public docs and examples to use readModel/source/commands/session; these docs either carried removed names or were setup artifacts already present on the branch.
- Added paths: docs/0011-distributed-runtime-stack.md, docs/API.md, docs/actor-web-actor-dx-design.md, docs/actor-web-documentation-plan.md, docs/actor-web-ecosystem-alignment.md, docs/examples/ignite-element-host.md, docs/site/api/runtimes.md, docs/site/concepts/sources-and-gateway.md, docs/site/getting-started/topology-and-runtime.md, docs/site/guides/testing-actors.md
- Evidence source: closeout-readiness and stale-term grep
- Evidence: closeout-readiness and stale-term grep | .fas/state/closeout-readiness/latest.json | FAS reported 10 unexpected public docs after fast checks passed; rg found commandSource/sourceHandle/readModelHandle public-doc references.
- Accuracy signal: focused tests, typecheck, and fas validate-task fast checks passed before scope amendment
- Follow-up needed: Keep lower-level createActorWebCommandSource/runtime-gateway handle helpers internal or address-based until a separate package API removal task is planned.

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
