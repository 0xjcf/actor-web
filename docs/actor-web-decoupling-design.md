# Actor-Web Decoupling Design — neutral contracts, inverted dependencies

## Status

Proposed (2026-06-09). Pre-1.0, nothing published yet. This is the architecture
to land **before** the first npm release, because every item here is a
public-API / wire-contract decision we would otherwise be stuck supporting.

## Summary

`@actor-web/runtime` is currently the **hub**: it reaches *down* into two
specific consumers and pre-shapes itself for them —

- a **FAS bridge** (`integration/fas-shared-contracts.ts`) exporting `Fas*`
  workflow/command types and a `file:` dependency on `@franchise/shared-contracts`, and
- an **Ignite bridge** (`integration/ignite-element-bridge.ts`) exporting
  `Ignite*` source types + `createIgnite*Source` factories, on which actor-web's
  *own* source API (`startRuntime`, `topology.source(...)`, `browser`) is built.

Both are the same mistake: the **general** library (a pure actor runtime)
depends on / speaks the vocabulary of the **specific** ones (a UI binding lib and
a workflow app). That violates the dependency rule — *specific depends on
general* — and produces real package coupling, conceptual coupling, and
duplicated contracts.

The FAS seam is worse than one-directional: it is a **dependency cycle**.
`@actor-web/runtime` declares a `file:` dependency on `@franchise/shared-contracts`
(a FAS-owned package), while FAS declares a `file:` dependency on
`@actor-core/runtime` — each repo depends on the other. The Ignite seam adds
redundancy: the actor-web↔ignite source contract is defined twice (actor-web's
`Ignite*` and ignite-element's `ActorWeb*`).

Target: actor-web knows about **neither** Ignite nor FAS. It exposes neutral
source and transport contracts. The adapters live with the consumers
(Ignite adapter in ignite-element; FAS mapping in FAS). Each library is usable
standalone; the only place all three meet is the application (fas-studio).

## Principles

1. **Dependencies point general → specific.** A runtime must not import a UI
   library or an application's contracts.
2. **Each library is usable standalone.** ignite-element works with any state
   source (like Zustand/XState) without actor-web. actor-web runs headless
   without any UI lib. FAS is the only one that *depends on* actor-web.
3. **Define each contract once, on the side that owns it.** No parallel mirrors
   that drift.
4. **Adapters live with the dependant, never in the dependency.** The side that
   is allowed to know about both owns the glue.

## Target architecture

```text
fas-studio                      (application — composition root; may use all three)
 ├─ ignite-element              (generic UI state binding; depends on nothing)
 │    └─ @ignite-element/adapters/actor-web   (optional; actor-web as OPTIONAL peerDep)
 ├─ @actor-web/runtime          (generic actor runtime; no app/UI deps)
 └─ fas                         (workflow application; depends on actor-web)
       └─ fas/actor-web-adapter (actor-web → FAS workflow/command mapping)
```

Dependency edges (all point toward the general): `fas → actor-web`,
`@ignite-element/adapters → actor-web` (optional, adapter-only),
`fas-studio → {ignite-element, actor-web, fas}`. No edge between ignite-element
and fas; no edge from actor-web to anything app/UI-specific.

## Evidence: who consumes the cross-node projections

Traced `RuntimeSnapshotProjection` / `RuntimeEventProjection`
(`runtime-transport-protocol.ts`), produced by `createSnapshotProjection` /
`createEventProjection` and consumed by `handleRemoteSnapshotProjection` /
`handleRemoteEventProjection` in `actor-system-impl.ts`:

- **All consumers are inside actor-web** — node-to-node snapshot/event
  replication for distributed actors, plus actor-web's own consumer-facing
  source handle (`actor-web-source.ts`) and gateway (`runtime-gateway*.ts`).
- The **only** fields actually read are generic: `value`, `context`, `sequence`,
  `status`, `phase` (used merely as the actor's state label / "is running"),
  `updatedAt` / `occurredAt` (timestamps), and event `type` / `payload`.
- Every FAS-specific field — `workflowId`, `taskId`, `taskTitle`, `branchName`,
  `baseBranch`, `notes`, `artifacts`, `CommandExecutionRecord` — is **carried
  over the wire but never read**. actor-web round-trips
  `ActorSnapshot → FasWorkflowSnapshot → ActorSnapshot` for nothing.

Conclusion: actor-web does not need FAS's shapes. A neutral projection
(`{ value, context, status, stateLabel, sequence, updatedAt }` +
`{ event: { type, payload, occurredAt }, sequence }`) is sufficient for every
in-runtime consumer. FAS, if it wants `WorkflowSnapshot`s, maps from the neutral
projection on its side.

There is also internal redundancy: a third workflow-snapshot shape,
`RuntimeGatewayWorkflowSnapshot` (`runtime-gateway-projection.ts`), exists
alongside `FasWorkflowSnapshot` and the native `ActorSnapshot`. Neutralization
consolidates these to one native shape.

## Seam A — actor-web ↔ ignite-element

### Current state (redundant, on both sides)

- **actor-web** defines the source contract as `Ignite*`
  (`IgniteReadModelSource`, `IgniteCommandSource`, `IgniteActorSourceSnapshot`)
  plus `createIgnite*Source` factories — and actor-web's own source API is built
  on them, so `topology.source(...)` / `startRuntime` hand back an
  `IgniteActorSource`.
- **ignite-element** *also* defines the contract as `ActorWeb*`
  (`@ignite-element/adapters` → `adapters/ActorWebAdapter.ts`, ~568 lines), a
  **structural hand-copy** (no actor-web import), and implements the full
  `IgniteAdapter` lifecycle binding (StateScope, render, transport status).

The source contract is defined twice (drift risk); actor-web's native source is
literally named `Ignite*`.

### Target

- **actor-web** keeps the source *abstraction* (load-bearing) but **neutralizes
  the naming**: `IgniteReadModelSource → ActorReadModelSource`,
  `IgniteCommandSource → ActorCommandSource`, `IgniteActorSource → ActorSource`,
  etc. Delete the Ignite-only converters. actor-web no longer references Ignite.
- **ignite-element keeps its `ActorWebAdapter`** — it is the rightful owner of
  the binding and already lives in the right place.
- **Define the source shape once.** Either ignite keeps its structural hand-copy
  (zero dep, fully standalone, mild drift risk), **or** `@ignite-element/adapters`
  imports actor-web's neutral source types as an **optional peerDependency** —
  no drift, and ignite-element **core** stays standalone because only the
  optional adapters package pulls actor-web. The latter is the queued
  "stabilize the Ignite source contract" task done in the **correct** direction
  (`ignite-adapters → actor-web`, never `ignite-core → actor-web`).

Outcome: actor-web's `ignite-element-bridge.ts` is deleted; the seam is owned by
ignite-element.

## Seam B — actor-web ↔ FAS

### Current state — a dependency cycle

This seam is not one-directional; **actor-web and FAS depend on each other**:

- **actor-web → FAS:** `@actor-web/runtime` declares a hard `file:` dependency on
  `@franchise/shared-contracts`, which is a **FAS-owned package**
  (`fas/packages/shared-contracts`, name `@franchise/shared-contracts`). It
  exports `Fas*` workflow/command/event types + converters
  (`integration/fas-shared-contracts.ts`), and the runtime's transport/projection
  contract and gateway are written in FAS vocabulary (`FasWorkflowSnapshot`,
  `FasEventEnvelope`, …). Type-only in code, but a real package edge.
- **FAS → actor-web:** FAS's `package.json` declares a hard `file:` dependency on
  `@actor-core/runtime` (the *old* name, too). But its actual usage is **one
  isolated, lazy bridge** — `fas/src/runtime/actor-web/fas-task-bridge.ts` — that
  resolves actor-web via `createRequire().resolve("@actor-core/runtime")` *at
  runtime*, only when FAS's optional actor-runtime feature runs. It is imported
  nowhere else in FAS core.

So FAS is *already* architected to run without actor-web (the pipeline never
touches it); the actor-web bridge is opt-in. What breaks that today is the hard
`dependencies` declarations on both sides (instead of optional/peer) plus the
reciprocal `actor-web → @franchise` edge that closes the loop.

FAS uses actor-web as **one runtime engine** to execute its workflow/task actors
— an opt-in execution backend, not a core requirement. *FAS should be usable
without actor-web*, and structurally it nearly is.

### Target — break the cycle; both cores standalone

Mirror the Ignite seam exactly: the adapter lives with the consumer, is opt-in,
and only the adapter (never the core) depends on actor-web.

- **actor-web** defines neutral transport/projection contracts in its own
  vocabulary — `ActorSnapshotProjection`, `ActorEventProjection`,
  `ActorEventEnvelope` — with no `workflowId`/`taskId`/`phase`/`CommandExecutionRecord`.
  Delete `fas-shared-contracts.ts`, the `Fas*` exports, and the
  `@franchise/shared-contracts` dependency. actor-web depends on **nothing
  downstream**, closing the cycle. (Per the trace above, every consumer inside
  actor-web is satisfied by the neutral shape.)
- **FAS** keeps its `fas-task-bridge` (rightful owner of the mapping), but makes
  `@actor-web/runtime` an **`optionalDependency`/`peerDependency`** (it already
  lazy-resolves), fixes the stale `@actor-core` name, and has the bridge map
  actor-web's **neutral** projections/events ↔ FAS's own
  `@franchise/shared-contracts` (`WorkflowSnapshot` / `WorkflowTransitionRecord`
  / `CommandExecutionRecord`). FAS **core** runs without actor-web; only the
  opt-in actor-runtime bridge needs it.
- **fas-studio** (composition root) enables the actor-web runtime when it wants
  FAS tasks executed on it — it does not own the mapping; FAS provides it via the
  optional bridge.

This also removes the publish blocker: `@actor-web/runtime` no longer carries an
unpublishable `file:` dependency.

## Proposed neutral contracts (illustrative)

```ts
// actor-web — native, neutral projection wire shapes
export interface ActorSnapshotProjection<TContext = unknown> {
  address: ActorAddress;
  value: unknown;          // the machine/FSM state value
  context: TContext;
  status: ActorRuntimeStatus;   // e.g. "active" | "stopped" | "error"
  stateLabel: string;      // string form of `value` (was FAS `phase`)
  sequence: number;
  updatedAt: number;
}

export interface ActorEventProjection<TPayload = Record<string, unknown>> {
  address: ActorAddress;
  event: { type: string; payload: TPayload; occurredAt: number };
  sequence: number;
}
```

No "workflow", "task", or "command-execution" anywhere. `RuntimeGatewayWorkflowSnapshot`
and `FasWorkflowSnapshot` collapse into this single native shape.

## Migration sequencing (before 1.0)

1. **actor-web — FAS seam:** introduce neutral projection types; rewrite
   `createSnapshotProjection`/`createEventProjection`, the transport protocol,
   and the gateway to use them; delete `fas-shared-contracts.ts`, `Fas*`
   exports, and the `@franchise` dependency. (Wire-contract change — architect
   check + full verify. FAS is the only external consumer, so it is controllable.)
2. **actor-web — Ignite seam:** rename `Ignite*` source types/factories to
   neutral `Actor*`; delete `ignite-element-bridge.ts`; update the source API and
   docs.
3. **FAS:** add the actor-web → FAS adapter; keep `@franchise/shared-contracts`
   on the FAS side.
4. **ignite-element:** keep `ActorWebAdapter`; optionally switch
   `@ignite-element/adapters` from hand-copy to importing actor-web's neutral
   source types (optional peerDep); align with the revised contract direction.
5. **fas-studio:** update import sites (see below).
6. **Publish** `@actor-web/*` 1.0.

## Impact on fas-studio (uses all three)

fas-studio is the composition root, so depending on all three is correct. The
change is *where* it imports glue from:

- actor-web topology / behaviors / runtime → `@actor-web/runtime` (unchanged
  besides the already-landed renames).
- actor-web ↔ ignite glue → `@ignite-element/adapters/actor-web` (or
  `ignite-element/actor-web`) instead of actor-web's `Ignite*` exports.
- FAS workflow mapping → FAS's adapter instead of actor-web's `Fas*` exports.

Resulting graph: `fas-studio → {ignite-element(+adapter), actor-web, fas}`,
with `fas → actor-web` and `ignite-adapters → actor-web`. No cycles.

## Revised stance on existing queued tasks

- **"Stabilize the Ignite source contract as public API of @actor-web/runtime"**
  — reframed. The contract direction must be `ignite-adapters → actor-web`
  (adapter-only optional peerDep), and actor-web exposes **neutral** source types
  (not `Ignite*`). It is no longer "actor-web owns Ignite types that
  ignite-element core imports."
- **"Publish the first npm release of @actor-web/\*"** — its `@franchise/shared-contracts`
  blocker is resolved by Seam B (deleting the dependency), not by vendoring.
- **"Docs: document the ignite-element integration surface"** — should document
  the neutral source API + the ignite-owned adapter, not actor-web `Ignite*` types.

## Per-repo task breakdown

### actor-web

1. Neutralize the runtime projection/transport contract (FAS seam): neutral
   `ActorSnapshotProjection`/`ActorEventProjection`; rewrite producers/consumers,
   transport protocol, gateway; remove `Fas*` + `@franchise` dependency.
2. Consolidate the redundant workflow-snapshot shapes
   (`RuntimeGatewayWorkflowSnapshot` + `FasWorkflowSnapshot` → one native shape).
3. Neutralize the source API (Ignite seam): rename `Ignite*` → neutral `Actor*`;
   delete `ignite-element-bridge.ts`; update `startRuntime`/`topology.source`/`browser`.
4. Docs + design-doc updates; refresh the API reference to the neutral contracts.

### ignite-element

1. Keep/curate `@ignite-element/adapters` `ActorWebAdapter` as the canonical
   seam owner.
2. (Optional) replace the structural hand-copy with an optional peerDep import of
   actor-web's neutral source types — adapters package only; keep core standalone.
3. Update the local "unify actor-web source contract" task to the corrected
   direction.

### FAS

1. Update the existing `runtime/actor-web/fas-task-bridge.ts` to map actor-web's
   **neutral** projections/events ↔ FAS's `@franchise/shared-contracts`
   (`WorkflowSnapshot`/`WorkflowTransitionRecord`/`CommandExecutionRecord`),
   instead of relying on actor-web exporting `Fas*` types.
2. Move `@actor-core/runtime` from hard `dependencies` to
   `optionalDependencies`/`peerDependencies` and rename it to
   `@actor-web/runtime` — breaking the cycle and keeping FAS core runnable
   without actor-web (the bridge already lazy-resolves it).
3. Keep `@franchise/shared-contracts` consumption on the FAS side only.

### fas-studio

1. Update imports: ignite glue from `ignite-element/actor-web`, FAS mapping from
   FAS, actor-web runtime from `@actor-web/runtime`. (Composition root — expected
   to depend on all three.)
2. Separately: fix the extensionless-ESM-import bug already filed against
   actor-web (`actor-system-guardian.ts`) — surfaced by fas-studio relinking.
