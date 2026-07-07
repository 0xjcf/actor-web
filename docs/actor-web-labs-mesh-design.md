# Actor-Web Labs Mesh Design

## Status

Accepted design contract for `@actor-web/labs-mesh`.

This document is the canonical design boundary for the labs-mesh slice queued by
`task-1781880954222`. It defines the membership, directory propagation, and
multi-hop routing contract that later implementation work must follow.

## Canonical path and purpose

Canonical path: `docs/actor-web-labs-mesh-design.md`

Purpose:

- define the v1 contract for cluster membership, directory propagation, and
  multi-hop routing above the existing Actor-Web runtime seams
- clarify what labs-mesh owns versus what remains owned by the core runtime,
  transport, and topology host layers
- lock the implementation ordering for the later `@actor-web/labs-mesh`
  delivery task without widening into transport-adapter or supervision work

## Problem and motivation

Actor-Web already supports direct remote messaging, direct-edge subscriptions,
and transport-backed runtime control frames. It does not yet provide the missing
cluster layer that turns those direct connections into a routable mesh.

The current gap is specific:

- membership is not autonomous
- cluster-wide directory fill remains unowned
- transport is intentionally single-hop
- multi-hop routing policy is not yet defined
- node-down handling stops at peer disconnect and cache cleanup

That leaves Actor-Web honest as a direct point-to-point distributed runtime, but
not yet a cluster runtime with mesh routing. `@actor-web/labs-mesh` is the
overlay that fills that gap without rewriting the existing transport contract.

## Scope and non-goals

Labs-mesh is an optional overlay package above the current runtime. It is not a
transport replacement and not a hidden expansion of supervision semantics.

In scope for this design:

- membership and failure detection for a mesh of Actor-Web nodes
- cluster-wide propagation of actor-directory registrations
- next-hop routing policy for multi-hop delivery
- node quarantine and node-down semantics at the mesh layer
- eventual-consistency rules for partitions and rejoin

Non-goals for v1:

- no implementation details, wire-format specifics, or package-internal data
  structures
- no transport-level retry or delivery-guarantee changes to the existing runtime
  transport protocol or its at-most-once baseline
- no transport-media design for BroadcastChannel or WebRTC in this task
- no split-brain-safe ownership transfer promise
- no cross-node supervision tree, remote restart, or remote child ownership
- no post-mesh claim, claim-transfer, or supervision scoping decisions

## Placement in the runtime stack

`@actor-web/labs-mesh` sits above the current distributed runtime seams:

- `ActorDirectory` remains the logical address and registration authority used
  by runtime send, ask, snapshot, and subscription flows
- `RuntimePeerDiscoveryProvider` remains the seam for discovering directly
  reachable peers or seed peers
- `RemoteMessageRouter` remains the place where runtime delivery asks for the
  next hop
- the runtime transport protocol remains the single-hop frame and control-plane
  substrate
- topology and runtime host seams remain responsible for boot, wiring, and
  package-owned registration on node start

Contract boundary:

- transport remains single-hop and at-most-once
- labs-mesh owns multi-hop routing above transport
- labs-mesh does not teach transports to forward arbitrary transit traffic on
  their own

This means a transport adapter only needs to deliver frames to directly
connected peers. Mesh path selection, membership state, and directory gossip
live above that layer.

## Membership model

V1 membership uses a SWIM-style model with explicit node identity and
incarnation tracking.

Required node identity fields:

- stable logical node identity
- incarnation value that increases when a node restarts or replaces a prior
  presence
- reachable address or peer coordinates carried through existing runtime
  discovery and transport seams

Required membership states:

- `alive`
- `suspect`
- `dead`
- `left`

Contract rules:

- membership records are keyed by node identity, not only by transport address
- incarnation orders competing records for the same node identity
- a newer incarnation supersedes older liveness or directory information from
  that same node identity
- `left` is an explicit graceful departure and should not be conflated with
  crash detection
- `suspect` is advisory and time-bounded; it is the quarantine window before
  declaring `dead`

SWIM-style is the right v1 fit because it preserves bounded failure detection,
bounded gossip fan-out, and explicit suspicion semantics without introducing a
central coordinator.

## Cluster-wide directory propagation

V1 directory propagation uses anti-entropy, not a CRDT.

Decision:

- actor registrations are node-owned and single-writer
- a node is the only writer for registrations it hosts
- other nodes only replicate, age out, or tombstone what that owner already
  published

Because of that ownership model, a CRDT is unnecessary in v1. The problem is
not arbitrary multi-writer merge. The problem is disseminating single-writer
state across a changing mesh.

Contract rules:

- directory updates propagate through anti-entropy exchange plus incremental
  gossip
- each registration carries owner node identity plus ordering metadata derived
  from node incarnation and per-registration version
- unregister and node-down cleanup produce tombstones rather than silent delete
- tombstones replicate long enough to suppress stale resurrection from lagging
  peers
- the highest-order tuple wins: owner identity must match, then newer
  incarnation supersedes older incarnation, then newer registration version
  supersedes older version within the same incarnation

Implications:

- v1 propagation is eventually consistent
- stale entries may survive briefly during partitions or delayed gossip
- convergence depends on anti-entropy rounds and tombstone retention, not on
  strong consensus

## Multi-hop routing and next-hop policy

Multi-hop routing is a labs-mesh policy layered through `RemoteMessageRouter`.

Decision:

- transport stays single-hop
- labs-mesh computes the next reachable hop toward the destination node
- the runtime asks `RemoteMessageRouter` for that next hop before sending a
  remote frame
- remote send frames may carry optional route-token metadata so relays can
  preserve visited-node and hop-limit state without changing the transport
  delivery baseline

The routing contract is therefore:

1. Resolve the target actor address through `ActorDirectory`.
2. Determine the owner node for that actor registration.
3. If the owner node is directly connected, route directly.
4. Otherwise ask the mesh routing policy for the best next hop toward that owner
   node.
5. Send one single-hop frame to that next hop through the existing transport.

V1 routing policy expectations:

- prefer directly connected owner nodes when available
- otherwise choose a next hop from current membership and adjacency knowledge
- carry a bounded hop count or route token with visited-node state so relays
  cannot forward the same delivery indefinitely
- reject any route that has exhausted its hop limit or would revisit a node
  already present in the route token
- avoid routing through nodes currently in `suspect`, `dead`, or quarantined
  state unless policy explicitly allows a degraded fallback
- fail closed when no safe next hop exists rather than fabricating transport
  reachability
- fail closed when loop-prevention state says the delivery cannot advance
  safely, even if a neighbor is otherwise connected

Alignment requirement:

- ask, snapshot, stop, stats, and runtime control paths must later align to the
  same hop policy rather than leaving multi-hop semantics only on best-effort
  send

## Liveness, node monitoring, and node-down semantics

Node-down is a monitoring and quarantine problem, not a supervision problem.

Labs-mesh owns:

- suspicion timers and node-health interpretation
- quarantine of routes and registrations from unhealthy nodes
- eventual declaration that a node is `dead` or `left`
- cluster-wide dissemination of that conclusion

Labs-mesh does not own:

- restarting actors on another node
- remote supervision directives
- cross-node parent-child relationships

Contract rules:

- a node entering `suspect` should stop being preferred as a next hop
- a node declared `dead` should have its directory entries tombstoned or marked
  unreachable through owner-node-down semantics
- a node declared `left` should be removed through the same dissemination path,
  but with graceful intent preserved for debugging and operations
- node-down handling must not imply that ownership has been transferred to some
  other node

## Partition handling and consistency guarantees

V1 partition handling is eventual, not split-brain-safe.

Guarantees:

- membership and directory state converge after gossip connectivity is restored
- newer incarnation and version data supersede stale records after rejoin
- next-hop policy may degrade or fail closed while a partition is active

Non-guarantees:

- no promise that a partitioned actor registration can be safely re-owned by a
  different node during the split
- no consensus-backed single-owner proof during partition
- no automatic split-brain ownership transfer or lease arbitration

This boundary is intentional. V1 solves cluster visibility and routing, not
distributed ownership consensus.

## Interfaces affected

The design affects these existing seams and contracts:

- `ActorDirectory`: gains a cluster-propagated ownership view rather than only a
  local or directly synchronized cache
- `RuntimePeerDiscoveryProvider`: remains the input for peer/bootstrap
  discovery, but becomes the substrate under mesh membership rather than the
  whole cluster story
- `RemoteMessageRouter`: becomes the formal next-hop selection seam for
  multi-hop delivery
- runtime transport protocol: stays single-hop and at-most-once; it carries mesh
  traffic but does not become a routing protocol itself
- topology/runtime host seams: later package-owned wiring must register mesh
  participation, restore directory state, and align declarative runtime flows
  with membership-aware routing

This design does not require public transport-adapter APIs in the mesh package
itself. The BroadcastChannel adapter has landed as a browser/same-origin
transport medium, and WebRTC now provides a direct `RTCDataChannel` transport
seam with caller-owned signaling/discovery; both must conform to this mesh
contract when used under labs-mesh.

## Rollout and implementation ordering

Implementation must follow the already approved labs-mesh epic ordering:

1. Foundation work first: remote node identity and collision protection, then
   injectable `ActorDirectory`, then next-hop routing hook.
2. This design doc defines the contract after those foundations exist.
3. Mesh implementation lands later as its own branch and PR.
4. BroadcastChannel has landed as a separate transport-adapter slice; WebRTC
   now provides the direct data-channel transport seam while broader
   signaling/discovery integration remains separate follow-up work.
5. Examples, claim scoping, and broader supervision/ownership questions remain
   later slices.

Implementation implications for the follow-up mesh task:

- honor the current single-hop transport and at-most-once delivery baseline
- implement SWIM-style membership above discovery and transport
- implement anti-entropy directory propagation with tombstones and
  incarnation/version ordering
- route all relevant remote control paths through the same next-hop policy
- keep node-down handling limited to monitoring, quarantine, and directory
  convergence

## Open questions or future follow-ups

- What exact adjacency knowledge should v1 routing maintain beyond direct peers:
  full membership-only reachability, path hints, or a richer route cache?
- What tombstone retention window is sufficient to prevent stale resurrection
  without causing excessive directory growth?
- Which runtime control messages should be promoted first to guaranteed hop
  alignment after plain remote send?
- How should later transport adapters expose their direct-peer capabilities to
  mesh policy without leaking adapter-specific routing semantics into the core
  runtime?
- If Actor-Web eventually needs split-brain-safe ownership transfer, should that
  be a separate lease/claim subsystem rather than part of labs-mesh itself?
