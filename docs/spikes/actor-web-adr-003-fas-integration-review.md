# Actor-Web ADR-003 FAS Integration Review

## Status

Spike result. Current-fact review, not an adoption ADR.

Actor-Web is conceptually aligned with the ADR-003 cross-repo architecture as the
candidate orchestration/runtime layer, but it is not yet operationally aligned as a
shared runtime for FAS, ignite-element, or Blueprint.

The current repo supports Actor-Web owning actor lifecycle, message passing,
mailboxes, runtime adapters, scheduling, supervision, and actor projections. It now
provides an initial ignite-element bridge slice at
`packages/actor-core-runtime/src/integration/ignite-element-bridge.ts` with a host
snapshot source plus typed command entrypoints for `createActorRef()`-backed refs.
Boundary enforcement has started with a narrow deterministic decision map and
checker, and Actor-Web now type-checks its FAS mapping against the real
`@franchise/shared-contracts` definitions through a local package-manager `file:`
dependency. The ignite bridge and contract slices are still incomplete across all
packages.

## Evidence Inventory

Actor-Web files reviewed:

- `AGENTS.md`
- `README.md`
- `package.json`
- `biome.json`
- `docs/API.md`
- `docs/0008-actor-web-adr-003-alignment-spike.md`
- `docs/actor-web-adr-003-alignment-spike.md`
- `docs/examples/ignite-element-host.md`
- `docs/examples/ignite-element-actor-web-north-star.md`
- `packages/actor-core-runtime/package.json`
- `packages/actor-core-runtime/src/index.ts`
- `packages/actor-core-runtime/src/actor-system.ts`
- `packages/actor-core-runtime/src/types.ts`
- `packages/actor-core-runtime/src/runtime-adapter.ts`
- `packages/actor-core-runtime/src/integration/fas-shared-contracts.ts`
- `packages/actor-core-runtime/src/integration/ignite-element-bridge.ts`
- `packages/actor-core-runtime/src/integration/fas-shared-contracts.typecheck.ts`
- `packages/actor-core-runtime/src/unit/fas-shared-contracts.test.ts`
- `packages/actor-core-runtime/src/unit/ignite-element-bridge.test.ts`
- `packages/actor-core-runtime/src/actors/timer-actor.ts`
- `packages/actor-core-runtime/src/actors/scheduler-actor.ts`
- `packages/actor-core-runtime/src/messaging/mailbox.ts`
- `packages/actor-core-runtime/src/utils/factories.ts`
- `packages/agent-workflow-cli/package.json`
- `packages/actor-core-testing/package.json`

Cross-repo context reviewed from local sibling checkouts:

- `/Users/joseflores/Development/fas/docs/adr/0006 - shared-architecture-roadmap.md`
- `/Users/joseflores/Development/fas/docs/adr/0007-fas-adr-003-boundary-foundation.md`
- `/Users/joseflores/Development/fas/packages/shared-contracts/README.md`
- `/Users/joseflores/Development/fas/packages/shared-contracts/index.d.ts`
- `/Users/joseflores/Development/ignite-element/docs/adr-003-shared-arc.md`
- `/Users/joseflores/Development/ignite-element/docs/shared-architecture-model.md`

No local Blueprint checkout was found under `/Users/joseflores/Development`.
Blueprint conclusions in this review are therefore inferred from FAS and
ignite-element docs only.

## ADR-003 Layer Map

| Layer | Actor-Web current evidence | Current ownership reading |
| --- | --- | --- |
| Intent | `ActorMessage`, `ActorEnvelope`, `BaseEventObject`, `WorkflowCommand`-like user messages in examples | Actor-Web carries intent as typed messages. It does not own product-domain or FAS workflow meaning. |
| Deterministic decision | `defineBehavior`, behavior handlers, XState machine integration, message-plan processing, `architecture.boundaries.json` deterministic decision paths | Actor-local decisions are supported. The first committed map covers message-plan, fan-out, component behavior, type-helper, and validation surfaces. |
| Workflow and lifecycle | `ActorStatus`, `ActorSnapshot`, `ActorSystem`, `ActorRef`, `Supervisor`, guardian actor, event collectors | Actor lifecycle is a strong current fit. FAS task lifecycle is not owned here yet. |
| Imperative execution over time | bounded mailboxes, runtime adapters, transports, timers, scheduler, retry/supervision code | Actor-Web has runtime machinery, but some execution concerns still mix direct clock/random/environment reads with logic surfaces. |
| Projection | snapshots, `getSnapshot`, event collectors, system stats, transport stats | Actor-Web exposes actor/runtime projections. It does not expose FAS workflow read models. |
| Product composition | component actor utilities and examples | Actor-Web touches component integration, but should not own Blueprint product grammar or ignite-element projection ownership. |

## Current Fact vs Target State

| Topic | Current fact | Target state |
| --- | --- | --- |
| Shared orchestration runtime | Actor-Web has runtime primitives, but no completed Actor-Web ADR-003 result doc or FAS contract adoption. | Actor-Web exposes a stable orchestration runtime contract that FAS and product repos can consume without importing internals. |
| FAS integration | FAS remains standalone and has its own runtime, policies, artifacts, queue, verification, and shared-contracts package. | FAS delegates selected runtime mechanics through explicit Actor-Web contracts while retaining policy and evidence ownership. |
| Contract package | Actor-Web has `ActorEnvelope`, `ActorMessage`, snapshots, runtime adapters, actor stats, and a FAS mapping module at `packages/actor-core-runtime/src/integration/fas-shared-contracts.ts` that imports real `@franchise/shared-contracts` types through `packages/actor-core-runtime/package.json`. | Actor-Web can replace the local `file:` dependency with workspace or published package wiring when FAS contracts are promoted. |
| ignite-element bridge | Actor-Web now has a minimal public bridge API at `packages/actor-core-runtime/src/integration/ignite-element-bridge.ts`, a browser-safe public entry at `packages/actor-core-runtime/src/browser.ts`, a concrete host example in `docs/examples/ignite-element-host.md`, and a runnable Ignite custom-element example under `examples/ignite-headless-host/` that consumes `ignite-adapters/actor-web`. The current slice supports `createActorRef()` refs, `ActorSystem.spawn()` refs, emitted-event subscriptions, transport-backed cross-node snapshot/event projection, and host-visible projection status (`local`, `connected`, `replaying`, `degraded`, `disconnected`). The example now separates the runtime harness from the host consumer so browser hosts stay thin while server/worker runtimes own transport/bootstrap, and the browser prove-out uses a service worker as the remote runtime owner. Explicit overrides remain available for foreign transports. | ignite-element can render Actor-Web snapshots and consume typed Actor-Web events through an explicit adapter without per-host boilerplate or fake remote state. |
| Blueprint | No local Blueprint repo evidence was available. | Blueprint owns product composition and consumes projected state without bypassing runtime or workflow contracts. |
| Boundary enforcement | Biome enforces general style/type hygiene. `pnpm architecture:check` now enforces the first deterministic decision slice. | Actor-Web expands committed boundary config and checks until runtime, adapter, projection, and contract surfaces are all explicitly classified. |

## Deterministic-Core Audit

Actor-Web currently has direct nondeterministic reads in runtime code:

- `Date.now()` and `Math.random()` in `packages/actor-core-runtime/src/utils/factories.ts`
- `Date.now()` in `packages/actor-core-runtime/src/actors/timer-actor.ts`
- `Date.now()` and `Math.random()` in `packages/actor-core-runtime/src/actors/scheduler-actor.ts`
- environment and browser global detection in `packages/actor-core-runtime/src/runtime-adapter.ts`
- many additional clock/random/process/file/git reads in `packages/agent-workflow-cli/src`

These reads are not automatically wrong. Many belong in runtime adapters, CLI shell,
metrics, scheduling, or ID-generation boundaries. Actor-Web now declares the first
deterministic decision slice, but it does not yet declare every deterministic
decision surface and execution boundary. Reviewers still need to expand the map
before the FAS ADR-0007 rule is enforced repo-wide.

Recommended classification:

- Deterministic decision candidates: behavior builders, message-plan validation,
  validation helpers, pure behavior handlers, type guards, contract mappers.
- Workflow/lifecycle candidates: actor system, actor refs, actor instances,
  supervisors, guardian actor, scheduler actor state.
- Execution boundary candidates: runtime adapters, transports, storage adapters,
  CLI git operations, CLI shell commands, process/file/network adapters.
- Projection candidates: snapshots, stats, event collectors, MCP/read-model adapters
  if added later.

## Structural Boundary Enforcement Audit

Current enforcement:

- `biome.json` enforces general style, security, no explicit `any`, and unused import
  rules.
- TypeScript project references provide type checking.
- `architecture.boundaries.json` identifies the first ADR-003 layer ownership map.
- `pnpm architecture:check` fails deterministic decision files that import shell,
  adapter, filesystem, process, browser, network, timer, or random APIs.
- `packages/actor-core-runtime/src/integration/fas-shared-contracts.typecheck.ts`
  checks compatibility against real `@franchise/shared-contracts` types.
- `packages/actor-core-runtime/src/unit/fas-shared-contracts.test.ts` covers the
  structural Actor-Web to FAS shared-contract mapping for event envelopes, workflow
  snapshots, transition records, actor addresses, and command execution records.

Missing enforcement:

- deterministic-core coverage is intentionally narrow and needs expansion
- no forbidden import/IO rules for non-deterministic layers yet
- no check equivalent to FAS's behavior-boundary audit
- no published or shared-workspace source for `@franchise/shared-contracts` inside
  Actor-Web yet

Minimum implementation slice:

1. Expand the committed architecture map across the remaining Actor-Web package directories.
2. Replace the local `file:` dependency for `@franchise/shared-contracts` with
   shared workspace or published-package wiring when the package is promoted.
3. Add behavior-boundary checks for runtime adapters, projections, and CLI shell effects.

## FAS Contract Comparison

The prompt documents listed a candidate contract:

- task/workflow envelope
- event envelope
- queue/admission record
- lease/recovery record
- verification evidence reference
- projection/read model
- capability boundary

FAS already has a first-cut package at `@franchise/shared-contracts` with these
nearby surfaces:

- `EventEnvelope`
- `WorkflowSnapshot`
- `WorkflowTransitionRecord`
- `WorkflowCommand`
- `WorkflowFact`
- `CommandExecutionRecord`
- `ArtifactReference`
- `ActorAddress`
- `OrchestrationContract`
- `OrchestrationContractStep`
- `ClientMapping`

Actor-Web should not create a parallel FAS contract. The initial Actor-Web
integration contract now imports the real FAS types through a local package-manager
dependency and maps Actor-Web runtime shapes in
`packages/actor-core-runtime/src/integration/fas-shared-contracts.ts`:

| FAS shared-contracts type | Actor-Web fit | Gap |
| --- | --- | --- |
| `EventEnvelope` | maps to `ActorEnvelope` plus `ActorMessage` metadata | Actor-Web envelope uses `_timestamp` and `_correlationId`; FAS uses string `occurredAt`, `schemaVersion`, source/target actor, workflow/task IDs. |
| `WorkflowSnapshot` | maps to `ActorSnapshot` plus actor address/status | Actor-Web snapshots are actor-local and do not contain FAS task title, branch, artifacts, notes, or workflow IDs. |
| `WorkflowTransitionRecord` | can be emitted from actor state transitions | Actor-Web does not standardize transition records as a public event log schema. |
| `CommandExecutionRecord` | can wrap actor-requested execution through adapters | Actor-Web does not yet own verification receipts or audited command evidence. |
| `ArtifactReference` | should remain FAS-owned evidence metadata | Actor-Web should reference artifacts, not define artifact discipline. |
| `OrchestrationContract` | can describe delegated actor workflow expectations | Actor-Web has no native orchestration-contract consumer today. |

## Proposed Minimal FAS-to-Actor-Web Contract

The minimal contract should be additive and type-first:

1. Import `@franchise/shared-contracts` types as the source vocabulary.
2. Map:
   - FAS `EventEnvelope` to Actor-Web messages
   - Actor-Web actor snapshots to FAS `WorkflowSnapshot` projections
   - Actor-Web transition events to FAS `WorkflowTransitionRecord`
   - Actor-Web execution requests to FAS `CommandExecutionRecord`
3. Keep FAS audited mutations routed through FAS commands until Actor-Web has an
   equivalent evidence and capability boundary.
4. Treat leases/recovery as a follow-up contract. Actor-Web has scheduling and
   supervision primitives, but FAS owns workflow recovery meaning today.

## Ownership Boundaries

FAS owns:

- engineering workflow policy
- task and queue meaning
- verification receipts and artifact discipline
- escalation, review evidence, memory promotion
- repo-local autonomy policy
- audited mutation commands

Actor-Web may own:

- actor lifecycle
- message delivery
- mailbox/backpressure mechanics
- scheduling, retry, supervision, recovery mechanics
- runtime adapters and topology
- actor-level projections

ignite-element owns:

- deterministic UI projection and component authoring surfaces
- typed commands from UI surfaces
- adapter-facing state-to-view mapping

Blueprint should own:

- product composition
- design grammar
- reusable product assembly

Blueprint evidence is not grounded from a local checkout in this review.

## Recommended Implementation Slices

1. Keep `docs/actor-web-adr-003-alignment-spike.md` as an intake prompt and point to this result.
2. Keep `docs/0008-actor-web-adr-003-alignment-spike.md` as the numbered planning slice and point to this result.
3. Expand the Actor-Web architecture map with ADR-003 layer ownership by directory.
4. Expand the deterministic-core boundary checker coverage based on that map.
5. Replace the local `@franchise/shared-contracts` `file:` dependency with shared
   workspace or published-package wiring.
6. Replace the current in-memory prove-out transport with a real external runtime transport boundary.
7. Align transport payloads and projection vocabulary to Actor-Web runtime-native core contracts, with `@franchise/shared-contracts` mapping confined to the integration edge.
8. Add remote-host observability for reconnect, replay, lag, and dropped-subscription behavior once the external transport is in place.
9. Only after the contract and bridge exist at that wider surface, evaluate whether FAS can delegate a
   narrow runtime workflow to Actor-Web.

## Verification Run

Historical spike evidence from 2026-04-23:

- `pnpm architecture:check`: passed across five deterministic decision files.
- `pnpm --dir packages/actor-core-runtime exec vitest run
  src/unit/fas-shared-contracts.test.ts`: passed six compatibility tests.
- `pnpm --dir packages/actor-core-runtime exec vitest run
  src/unit/ignite-element-bridge.test.ts`: passed five bridge tests.
- `pnpm --dir packages/actor-core-runtime exec vitest run
  src/unit/remote-transport.test.ts`: passed three transport integration tests.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.

## Residual Risks

- The current Actor-Web package name and export story is inconsistent in examples
  and package metadata (`@actor-web/core` versus `@actor-web/runtime`).
- The repo contains old agent-workflow CLI code that overlaps with FAS concepts but
  is not the same as FAS's current contract model.
- Direct clock/random reads may be acceptable in execution boundaries, but this
  remains ambiguous until Actor-Web expands the boundary map beyond the first
  deterministic decision slice.
- Cross-repo package adoption may require workspace or publishing changes not
  represented in this repo today. Actor-Web currently resolves
  `@franchise/shared-contracts` through a local sibling `file:` dependency.
- Blueprint alignment remains inferred until the Blueprint repo is reviewed directly.
