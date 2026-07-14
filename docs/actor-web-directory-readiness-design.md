# Actor-Web Directory Readiness

Status: implemented runtime contract.

## Decision

Actor-Web treats transport membership and remote-directory readiness as
separate facts.

- A peer is a transport member when the runtime has admitted a live connection.
- A peer is directory-ready when ActorSystem has synchronized and accepted the
  current connection incarnation's exported actor-address entries.
- Actor code continues to use the same `ActorRef` API for local and remote
  actors. This location transparency does not erase latency, availability, or
  the documented at-most-once delivery boundary.

Transport connection is therefore recorded first and triggers directory
synchronization. Code that needs remote address resolution waits for directory
readiness rather than interpreting membership `up` as readiness.

## Why the two facts must remain separate

Connection and readiness answer different questions:

| Fact | Question answered | Authoritative owner |
| --- | --- | --- |
| Transport membership | Can this runtime exchange frames with the peer? | `MessageTransport` and ActorSystem link lifecycle |
| Directory readiness | Has the current peer incarnation supplied an accepted actor-address snapshot? | ActorSystem directory synchronization |
| Actor projection status | Is one remote actor's projection connected, replaying, degraded, or disconnected? | That actor's projection watcher |

Collapsing these states makes diagnosis and recovery worse. If membership were
held below `up` until synchronization completed, operators could not distinguish
a missing link from a connected peer whose directory handshake failed. If
readiness lived on `RuntimeTransportStatus`, the transport layer would claim
knowledge it does not possess.

## Current flow

ActorSystem currently performs these operations:

1. A transport-connected runtime protocol event reaches
   `handleTransportConnected()`.
2. ActorSystem adds the peer to `clusterState.nodes` and records cluster status
   `up`.
3. `ensureRemoteDirectoryReady()` deduplicates the synchronization attempt for
   the peer and its current connection identity.
4. `requestDirectorySync()` sends `__runtime.directory.sync.request` and waits
   for `__runtime.directory.sync.response`.
5. The request returns candidate `RuntimeDirectoryEntry` values without
   mutating the directory.
6. ActorSystem confirms that the attempt token and peer incarnation are still
   current, then atomically accepts the candidates and publishes `ready`.
   Superseded responses apply nothing.
7. Only after successful synchronization does ActorSystem replay remote
   projection watchers and outbound topology-subscription handshakes.
8. On disconnect, ActorSystem removes the peer's directory entries and projection
   status becomes disconnected.

Explicit `join()` already waits for the same readiness promise. `lookup()` also
requests a directory sync on a connected-peer cache miss, but currently bypasses
the deduplicated readiness method. The implementation should route this lookup
recovery through `ensureRemoteDirectoryReady()` so automatic connection,
explicit join, and on-demand lookup share one attempt lifecycle.

## Target state machine

Readiness is scoped to a peer and link incarnation:

| Event | Membership | Directory readiness | Consequence |
| --- | --- | --- | --- |
| Transport connects | `up` | `syncing` | Start or join one sync attempt |
| Current sync succeeds | `up` | `ready` | Allow projection and subscription replay |
| Current sync fails | `up` | `degraded` | Record failure fact; allow a later retry |
| New incarnation connects | `up` | `syncing` for new incarnation | Ignore late completion from the old attempt |
| Transport disconnects | removed | removed | Remove remote entries and readiness state |

The implementation must separate the in-flight Promise cache from the public
fact map. A failed Promise is evicted so the next join or lookup can retry, while
the degraded fact remains visible until the next attempt begins.

## Public contract

`ClusterState` is already public through `@actor-web/runtime` and
`@actor-web/runtime/browser`, and is returned by `getClusterState()` and
`getSystemStats()`. Directory readiness therefore changes the public type
surface deliberately.

The compatibility-safe shape is an optional readiness collection:

```ts
export type DirectoryReadinessFact =
  | {
      readonly nodeAddress: string;
      readonly nodeId?: string;
      readonly incarnation?: string;
      readonly status: 'syncing';
    }
  | {
      readonly nodeAddress: string;
      readonly nodeId?: string;
      readonly incarnation?: string;
      readonly status: 'ready';
    }
  | {
      readonly nodeAddress: string;
      readonly nodeId?: string;
      readonly incarnation?: string;
      readonly status: 'degraded';
      readonly failure: {
        readonly code: 'directory_sync_failed';
        readonly message: string;
      };
    };

export interface ClusterState {
  readonly nodes: string[];
  readonly leader?: string;
  readonly status: 'joining' | 'up' | 'leaving' | 'down';
  readonly directoryReadiness?: readonly DirectoryReadinessFact[];
}
```

Compatibility meanings:

- `undefined`: the producer does not support readiness reporting;
- `[]`: readiness reporting is supported and there are no remote peers;
- Actor-Web's implementation always returns the collection.

The public fact contains no Promise, raw `Error`, or private serialized
connection key. `nodeId` and `incarnation` are copied as facts when the transport
can provide them. Returned arrays and nested failure objects are defensive
snapshots rather than aliases of ActorSystem's mutable internal maps.

## Actor-model fit

The actor model requires isolated state and message-oriented interaction; it
does not require network membership and actor discovery to become ready in one
atomic step. Distributed actor systems normally expose distinct lifecycle or
health states because a live node can still be joining, synchronizing,
unreachable, or degraded.

Actor-Web's `up` is currently a connected-peer membership fact, not a consensus
cluster state and not proof that every remote actor can be resolved. Recording
it before directory synchronization is therefore correct once the distinction
is explicit.

Location transparency is scoped similarly. The same actor address/reference API
works locally and across directly connected nodes, but remote operations retain
explicit failure semantics:

- `lookup()` may await directory synchronization before returning a remote ref;
- `ask()` has request/response timeout and remote failure behavior;
- ordinary `send()` remains at-most-once and is not automatically buffered or
  retried while a peer is syncing;
- projection subscriptions replay only after directory readiness succeeds.

This feature makes those boundaries observable. It does not promise availability
transparency or durable delivery.

## Existing primitives reused

No new actor authoring primitive is required. The implementation reuses:

- transport lifecycle events;
- `MessageTransport.isConnected()` and `getConnectedNodes()`;
- existing peer identity telemetry;
- the internal directory sync request/response protocol;
- `ensureRemoteDirectoryReady()` for deduplication;
- `ClusterState`, `getClusterState()`, and `getSystemStats()` as the read model;
- existing projection and topology replay paths.

The only new public concept is a node-level runtime status fact. It does not
change behavior definitions, `ActorRef`, topology authoring, message envelopes,
or transport membership.

## Non-goals

- Consensus or gossip membership.
- Automatic actor relocation or failover.
- Buffering or retrying application messages during synchronization.
- Stronger-than-at-most-once `send` delivery.
- A new actor behavior, policy, or topology primitive.
- Making `RuntimeTransportStatus` authoritative for ActorSystem directory state.
- Adding a new cluster-event subscription variant in this slice.

## Verification contract

The implementation must prove:

- `syncing` is observable while a controlled sync is pending;
- success produces `ready` before projection/subscription replay;
- failure produces `degraded` with node and failure context and permits retry;
- disconnect removes the fact and remote directory entries;
- a same-address new incarnation supersedes the old attempt;
- late completion from the old attempt cannot change the new fact;
- `join()` remains pending until ready and rejects on sync failure;
- `lookup()` shares the deduplicated readiness attempt;
- root and browser public entrypoints export the new types;
- existing transport status and at-most-once delivery semantics remain unchanged.
