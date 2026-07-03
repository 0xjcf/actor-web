# Actor-Web Lattice Contract Design

## Status

Proposed design contract for the Actor-Web lattice artifact store and dependency
activation surface.

This document is the canonical path for the current execution:
`docs/actor-web-lattice-contract-design.md`. Older planning text that named
`docs/actor-web-lattice-design.md` should be read as referring to this file.

## Problem and motivation

Actor-Web already supports transient choreography through `emit` and declarative
subscriptions, but it does not yet provide a persistent coordination medium.
That gap matters for multi-actor workflows where a participant may start late,
restart, or need to react to durable facts rather than momentary events.

The lattice closes that gap by introducing two minimal primitives:

- `Artifact`: a typed, durable record published into a shared coordination
  medium.
- `Dependency`: a declarative requirement over artifacts that activates an actor
  when satisfied.

The design goal is to add persistent artifact state plus dependable activation
semantics without changing Actor-Web's core runtime transport guarantees or
requiring peer-aware orchestration in every workflow.

## Canonical naming decision

The public contract names are future-facing and locked for this design:

- `Artifact`
- `ArtifactMatcher`
- `Dependency`
- `LatticeActor`
- `lattice()`
- `dependsOn`
- `PUBLISH_ARTIFACT`
- `REGISTER_DEPENDENCY`
- `WITHDRAW_DEPENDENCY`
- `ACK_ACTIVATION`
- `QUERY_ARTIFACTS`
- `ARTIFACT_PUBLISHED`
- `DEPENDENCY_SATISFIED`
- `ACTIVATION_TIMED_OUT`

`Artifact` and `Dependency` are the only required primitives in v1. Everything
else is protocol or topology sugar over those concepts.

## Contract boundaries and non-goals

The lattice is an optional coordination extension built on public Actor-Web
primitives. It does not redefine the core actor model, mailbox model, or
transport contract.

Boundaries:

- The lattice owns artifact persistence, dependency registration, activation
  bookkeeping, and replay-safe re-evaluation.
- The runtime owns actor lifecycle, topology wiring, and message transport.
- Participants interact with the lattice only through messages, emitted events,
  and topology declarations.

Non-goals for v1:

- No `when(ctx => ...)` topology closures. Topology activation must stay
  serializable, declarative, and non-executable at import time.
- No CRDT, multi-writer federation, or cross-lattice merge semantics.
- No core runtime transport changes.
- No stronger delivery promise than the existing at-most-once transport.
- No generic durable-actor or generic actor-persistence API. EventStore-style
  journaling is an internal lattice seam, not a broad runtime promise.

## Artifact model

`Artifact` is a durable, typed, versioned fact published into the lattice.

Required properties:

- Logical identity by artifact type plus optional key.
- Immutable versions.
- Latest-per-key head view for normal reads.
- Append-only durability history.
- JSON-serializable payload and metadata.

Recommended conceptual shape:

```ts
type Artifact = {
  type: string;
  key?: string;
  version: number;
  payload: unknown;
  producer: string;
  publishedAt: number;
  contentHash?: string;
};
```

Contract rules:

- Publishing creates a new immutable version or is treated as an idempotent
  no-op when the producer republishes the same content hash for the same
  artifact identity.
- The lattice may expose both latest-only lookup and full version history, but
  activation semantics always evaluate against durable artifact state, not only
  transient events.
- `ArtifactMatcher` must remain serializable. Matching may include artifact
  types and optional field constraints, but not executable predicates.

## Dependency activation semantics

`dependsOn` is the declarative activation surface. It describes a serializable
dependency over one or more `ArtifactMatcher` entries.

In v1, a `Dependency` is conjunctive over its listed `ArtifactMatcher` entries:
all listed matchers must be satisfied before the dependency activates. Grouped
OR expressions and disjunctive dependency trees are not part of v1; those remain
future declarative work or imperative `QUERY_ARTIFACTS` logic inside actor
behavior.

Every registered dependency has a stable `dependencyId`. Topology-declared
dependencies should provide an explicit `id`; when omitted, v1 derives the
`dependencyId` deterministically from the lattice id, actor key, and zero-based
index of the declaration in that actor's `dependsOn` array. Authors should use an
explicit `id` before reordering declarations, because the index-derived fallback
is stable only while declaration order stays stable.

Rules:

- Evaluation happens at both registration time and publish time.
  Registration-time evaluation gives late joiners and restarted actors correct
  behavior when the needed artifacts already exist.
  Publish-time evaluation activates waiting dependencies when a new artifact
  version arrives.
- Activation modes are `once` and `everyVersion`.
  `once` fires the first time a `dependencyId` is satisfied for a stable
  satisfaction key, such as the canonical ordered set of matched artifact
  identities and versions.
  `everyVersion` fires each time a relevant new artifact version satisfies the
  dependency again.
- Each delivery attempt carries an `activationId`.
  `activationId` is the idempotency key for the delivery protocol. The lattice
  and the consumer both treat repeated deliveries of the same activation as the
  same logical activation.
- Activation state progresses `pending -> delivered -> acknowledged`.
- Because transport remains at-most-once, the lattice must re-emit timed-out
  deliveries rather than assuming transport reliability.

`QUERY_ARTIFACTS` is the imperative escape hatch. It is an ask-style read path,
not a declarative topology primitive.

## Protocol messages and state machine

The lattice protocol is message-based and actor-native.

Inbound messages:

- `PUBLISH_ARTIFACT`
- `REGISTER_DEPENDENCY`
- `WITHDRAW_DEPENDENCY`
- `ACK_ACTIVATION`
- `QUERY_ARTIFACTS`

Outbound facts/events:

- `ARTIFACT_PUBLISHED`
- `DEPENDENCY_SATISFIED`
- `ACTIVATION_TIMED_OUT`

Protocol intent:

- `PUBLISH_ARTIFACT` appends or idempotently confirms an artifact version, then
  re-evaluates affected dependencies.
- `REGISTER_DEPENDENCY` records or upserts a declarative dependency by
  `dependencyId`, evaluates it against the current artifact store immediately,
  and creates pending activations when already satisfied. Restart-time
  re-registration with the same `dependencyId` is idempotent.
- `WITHDRAW_DEPENDENCY` targets `dependencyId`, removes that registration, and
  cancels future activation attempts for that dependency.
- `ACK_ACTIVATION` moves the matching activation from `delivered` to
  `acknowledged`.
- `QUERY_ARTIFACTS` returns artifact views via ask and does not change lattice
  state.

Activation state machine:

```text
pending -> delivered -> acknowledged
   |          |
   |          -> timeout -> ACTIVATION_TIMED_OUT -> delivered
   -> withdrawn/cancelled
```

The important boundary is that timeout handling exists to re-emit activations
that may have been lost in transport. It does not upgrade the transport itself
to stronger semantics.

## Topology surface and runtime wiring

The topology-facing surface is an optional `lattice()` helper plus per-actor
`dependsOn` declarations.

Example shape:

```ts
defineActorWebTopology({
  actors: {
    workspace: lattice({ node: "coordinator" }),
    planner: actor({
      dependsOn: [{ id: "planner-inputs", lattice: "workspace", requires: [...] }],
    }),
  },
});
```

Contract direction:

- `lattice()` declares a lattice actor in the topology, analogous in spirit to
  how `supervisor()` declares supervision structure.
- `dependsOn` is declarative and serializable. It belongs in topology metadata,
  not behavior closures.
- Future lattice package/runtime host work should wire dependency registrations
  on node start using the same durable pattern as today's declarative
  subscriptions: spawn actors, derive the intended registrations from topology,
  and register them again on restart. This is the implementation contract for
  the lattice surface, not a claim that current runtime hosts already register
  lattice dependencies.
- Cross-node transport remains transparent at the actor boundary. The lattice
  uses existing public runtime primitives rather than introducing a separate
  control plane.

This preserves the locked topology rule: authors do not rewrite actor behavior
to change deployment topology.

## Journal strategy

The lattice needs durable replay, but the durability seam is specific:
EventStore-style journaling is internal lattice infrastructure.

Decision:

- Use an EventStore-style append/replay seam to persist artifact publications,
  dependency registrations, withdrawals, and activation acknowledgements.
- Treat the journal as the internal source of rebuild truth for the
  `LatticeActor`.
- Do not generalize this into generic actor persistence for v1.

The intended seam aligns with the repo's existing event-store direction:
`BaseEvent`, `EventMetadata`, `EventStore`, `EventProjection`,
`InMemoryEventStore`, and `createEventStore` are the relevant shapes to reuse
or mirror. `EventSourcedActor` is not the public story here.

In-memory journaling is acceptable for the first prove-out as long as the
contract preserves append/replay semantics for later durable adapters.

## Packaging boundary

The lattice should ship as a separate optional package or entry point such as
`@actor-web/lattice`, built on public Actor-Web primitives rather than folded
into the core runtime package surface.

Reasons:

- It keeps the core runtime API smaller and more honest before 1.0.
- It proves that Actor-Web can host higher-level coordination patterns without
  privileged runtime hooks.
- It lets lattice-specific iteration happen without implying that every
  Actor-Web deployment needs artifact coordination.

This packaging boundary is part of the contract decision, not an incidental
implementation detail.

## Verification and rollout notes

Implementation should prove this design in layers:

1. Lock the protocol and topology contract exactly as named in this document.
2. Build an in-memory lattice package using the existing actor/runtime surface.
3. Prove registration-time and publish-time activation behavior.
4. Prove `once` versus `everyVersion` semantics.
5. Prove `activationId` idempotency plus timeout re-emit over at-most-once
   transport.
6. Prove restart recovery through journal replay before claiming durable
   coordination semantics.

Rollout notes:

- `QUERY_ARTIFACTS` stays imperative and ask-based even after the declarative
  `dependsOn` surface lands.
- The lattice contract should be documented as stronger than transient emit
  semantics only because it owns replay, ack, and re-emit at the protocol
  layer, not because Actor-Web transport changed.
- Multi-node or federation semantics beyond a single logical lattice are a
  follow-up design, not part of v1.
- Rollback is package-level. Because the lattice remains separate from the core
  runtime, operators can remove or disable the `@actor-web/lattice` package or
  entry point, or withhold lattice topology declarations. Existing actors,
  transports, mailboxes, and non-lattice topologies continue under the existing
  core runtime guarantees.
- If the replay or journal path proves unstable, the rollout should fall back to
  in-memory or disabled lattice behavior without changing core runtime delivery
  guarantees.
