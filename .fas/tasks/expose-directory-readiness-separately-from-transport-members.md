# Expose directory readiness separately from transport membership status

## Source

Created with `fas create-task` on 2026-07-10.

## Problem

Follow-up from Mesh Pong pre-start lobby projection convergence hardening. Current ActorSystem connected handling marks cluster membership up once transport connectivity exists, before remote directory synchronization completes. Explicit join correctly awaits readiness and projection replay is withheld on sync failure, but operators can briefly observe up while remote actors are not directory-ready. Design and implement a distinct readiness/degraded status fact without weakening transport membership, join correctness, or projection replay semantics.

The architectural issue is observability, not the ordering itself. In Actor-Web,
transport membership and directory readiness are different facts:

- membership `up` means the runtime has admitted a live transport link to the
  peer;
- directory `ready` means the current link incarnation has completed the
  directory handshake and this runtime can resolve the peer's exported actor
  addresses;
- location transparency means local and remote `ActorRef` values retain the
  same programming interface; it does not promise identical latency,
  availability, buffering, or delivery guarantees while a remote link is
  synchronizing or unavailable.

The runtime should therefore record transport membership as soon as the link is
connected and use that event to start directory synchronization. Consumers that
require remote address resolution must gate on directory readiness, not infer
readiness from membership `up`.

## Acceptance criteria

- Cluster status distinguishes transport-connected membership from directory-ready availability without changing existing transport membership truth.
- Automatic sync failure is observable as degraded/not-ready with node and failure context.
- Reconnect, link incarnation replacement, explicit join, and projection replay tests preserve current readiness guarantees.
- Operator-facing documentation/tests define the new status semantics and compatibility behavior.
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

### Architecture decision

Treat per-peer directory readiness as an additive ActorSystem status fact, not
as a transport status and not as a new actor-model primitive.

The public contract belongs on `ClusterState`, which is already returned by
`ActorSystem.getClusterState()` and `getSystemStats()`. Preserve the existing
`nodes`, `leader`, and `status` fields unchanged. Add a compatibility-safe
optional `directoryReadiness` collection whose entries form a discriminated
union:

- `syncing`: a sync attempt for the current link incarnation is in flight;
- `ready`: the current incarnation's directory snapshot was accepted;
- `degraded`: the attempt failed, with a serializable failure code and message.

Each fact includes `nodeAddress` and, when the transport provides them,
`nodeId` and `incarnation`. Do not expose the private serialized
`connectionKey`, a Promise, or a raw `Error` object.

Compatibility semantics:

- `directoryReadiness === undefined` means the producer does not support
  readiness reporting;
- `directoryReadiness: []` means readiness reporting is supported and there
  are no remote peers;
- Actor-Web's own `ActorSystemImpl` always supplies the collection after this
  change;
- making the field optional avoids breaking third-party `ActorSystem`
  implementations, mocks, and existing `ClusterState` object literals.

### Internal ownership and state transitions

Keep two internal structures separate:

1. an in-flight synchronization cache containing the attempt Promise and an
   opaque attempt/link token;
2. a serializable readiness-fact map used to derive public snapshots.

This separation preserves retry behavior: a failed Promise is removed so a
later call can retry, while the `degraded` fact remains observable until a new
attempt changes it to `syncing`.

Required transitions:

1. Transport connected: retain/add membership `up`; create `syncing` for the
   current incarnation; start or join the deduplicated directory sync.
2. Sync succeeded: change `syncing` to `ready` only if the completing attempt is
   still current; then replay remote projections and outbound topology
   subscriptions.
3. Sync failed: change the current attempt to `degraded`, record failure data,
   remove only the failed in-flight attempt, and do not replay projections or
   subscriptions.
4. Same-address new incarnation: replace the old attempt and fact with a new
   `syncing` generation; late completion from the old generation must not
   overwrite the new fact.
5. Disconnect: remove membership, remote directory entries, the in-flight
   attempt, and the readiness fact for that peer.

`join()` and automatic transport-connected handling already use
`ensureRemoteDirectoryReady()`. Change `lookup()`'s on-demand miss recovery to
use the same method instead of calling `requestDirectorySync()` directly. This
gives connection handling, explicit join, and lookup one deduplicated lifecycle
and one observable status source.

`getClusterState()` and `getSystemStats()` must return consistent snapshots.
Copy the readiness collection and nested failure data so callers cannot mutate
internal status through a value that is only compile-time `readonly`.

### Actor-model and location-transparency contract

This ordering is appropriate for Actor-Web's current scoped cluster model as
long as `up` is documented as transport membership rather than actor-namespace
readiness. Actor runtimes commonly separate failure-detector or link liveness
from service/discovery readiness. Delaying membership `up` until directory sync
would collapse two useful facts, hide connected-but-degraded peers, and make
diagnosis harder.

The change does not make remote communication perfectly available. Actor-Web
continues to provide scoped location transparency: the same `ActorRef` API is
used locally and remotely, while ordinary `send` remains at-most-once and can
dead-letter during unavailability. This task does not add send buffering,
automatic application-message retry, durable delivery, consensus membership,
or transparent failover.

### Existing API reuse

Reuse the current runtime seams:

- transport connected/disconnected protocol events for lifecycle triggers;
- `MessageTransport.isConnected()` / `getConnectedNodes()` for membership;
- peer identity from existing transport telemetry for incarnation protection;
- `requestDirectorySync()` for the wire handshake;
- `ensureRemoteDirectoryReady()` for deduplication and retry ownership;
- `ClusterState`, `getClusterState()`, and `getSystemStats()` for the public
  read model;
- existing projection and topology-subscription replay paths after readiness.

The existing transport-health read model remains transport-only. If a future
operator surface needs a combined view, it should compose transport and cluster
snapshots at a higher layer instead of making transport status authoritative
for directory state.

Canonical design document:
`docs/actor-web-directory-readiness-design.md`.

## Alternatives considered

- Delay membership `up` until directory sync finishes: rejected because it
  hides the live transport fact and conflates liveness with address-resolution
  readiness.
- Put readiness on the transport or peer health read models: rejected
  because the transport cannot authoritatively know whether ActorSystem has
  accepted a directory snapshot.
- Reuse `ActorRef.getTransportStatus()`: rejected because that status describes
  one actor projection stream, not node-level directory readiness.
- Add a new actor behavior primitive: rejected because this is runtime
  lifecycle observability, not behavior authoring or message semantics.
- Buffer/retry actor messages while syncing: rejected for this task because it
  would change the documented at-most-once delivery contract and requires a
  separate delivery-policy design.

## Affected files

- packages/actor-core-runtime/src/actor-system.ts
- packages/actor-core-runtime/src/actor-system-impl.ts
- packages/actor-core-runtime/src/index.ts
- packages/actor-core-runtime/src/browser.ts
- packages/actor-core-runtime/src/unit/broadcast-channel-message-transport.test.ts
- docs/actor-web-directory-readiness-design.md
- docs/API.md
- .changeset/

## Scope Amendments

- Type: public-contract scope promotion
- Added at: 2026-07-14
- Trigger: architect handoff and root architecture review found the generated
  three-file scope omitted the public contract.
- Reason: `ClusterState` is exported from the root and browser package
  entrypoints and returned by `getClusterState()` / `getSystemStats()`.
- Added paths: `packages/actor-core-runtime/src/actor-system.ts`,
  `packages/actor-core-runtime/src/index.ts`,
  `packages/actor-core-runtime/src/browser.ts`.
- Evidence: `.fas/state/agent-orchestration-execution.json` architect handoff;
  current source exports.

- Type: architecture scope correction
- Added at: 2026-07-14
- Trigger: source review established that directory readiness is ActorSystem
  truth, while the transport-status read model only receives a
  `MessageTransport`.
- Reason: preserve the boundary between transport membership/health and
  directory readiness.
- Removed surface: the transport-status production module.
- Replacement scope: public `ClusterState` contract plus ActorSystem
  implementation and entrypoint exports.

- Type: operator-contract and release scope promotion
- Added at: 2026-07-14
- Trigger: acceptance requires operator-facing semantics and the change affects
  the published `@actor-web/runtime` type surface.
- Added paths: `docs/actor-web-directory-readiness-design.md`, `docs/API.md`,
  and one package Changeset.

## Implementation plan

1. Add failing lifecycle tests for `syncing`, `ready`, `degraded`, retry,
   disconnect cleanup, and same-address incarnation replacement. Preserve the
   existing join and replay assertions.
2. Add the optional public readiness fact union to `ClusterState` and export its
   named types from the root and browser entrypoints.
3. Separate the in-flight attempt cache from public readiness facts in
   `ActorSystemImpl`; guard completion by the current attempt/incarnation.
4. Route automatic connection, explicit join, and lookup miss recovery through
   `ensureRemoteDirectoryReady()`; keep projection/subscription replay after
   successful readiness only.
5. Return defensive, consistent status snapshots from `getClusterState()` and
   `getSystemStats()`.
6. Document membership, readiness, compatibility, location transparency, and
   at-most-once delivery boundaries; add a Changeset.
7. Run focused tests and public entrypoint/type checks, then `fas validate-task`
   and `.fas/scripts/verify.sh --full`.

## Verification plan

- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- A late completion from a replaced incarnation can falsely mark the new link
  ready unless updates are guarded by an opaque current-attempt token.
- Retaining a rejected Promise would poison retries; retain only the degraded
  fact and evict the failed attempt.
- Adding readiness to transport status would make the wrong layer authoritative.
- A required `ClusterState` field would break downstream mocks and third-party
  implementations; use the documented optional compatibility contract.
- Extending readiness into send buffering/retry would silently change
  at-most-once semantics and is out of scope.

## Dependencies

- None known at task creation.

## Open questions

- Resolved: membership becomes `up` before directory readiness because they are
  separate facts; `up` is not an application-readiness promise.
- Resolved: this is an additive public runtime status contract, not a new actor
  primitive.
- Resolved: the existing transport-health read model remains transport-only.
- Resolved: no new cluster-event subscription variant is required in this
  slice; the public snapshot is the minimum compatible observability surface.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
