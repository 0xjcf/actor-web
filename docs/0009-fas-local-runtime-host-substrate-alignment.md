# ADR: fas-local Runtime Host Substrate Alignment

## Status

Proposed

## Context

fas-local owns the public local-runtime product surface: `Runtime.create(...)`,
`Runtime.createSession(...)`, session and provider contracts, future
`ProviderManager` lifecycle APIs, and the CLI flow that resolves
provider/profile/model state before starting runtime work. That ownership is
consistent with the shared roadmap in
[the FAS shared architecture roadmap](https://github.com/0xjcf/FAS/blob/main/docs/adr/0006%20-%20shared-architecture-roadmap.md),
which keeps FAS as control-plane meaning and actor-web as a possible runtime
and topology substrate reached by extraction and explicit contracts rather than
mutual imports.

actor-web already demonstrates the runtime traits that make it a plausible
future substrate: runtime hosts for CLI/backend-like nodes, actor lifecycle,
mailboxes, topology, supervision, transport, tool boundaries, and projection
surfaces. The local design at `docs/actor-web-cli-runtime-host-design.md`
already states the intended split plainly: FAS defines behaviors and
boundaries, while actor-web runs them as the data plane.

That does not make actor-web the current owner of fas-local runtime semantics.
The spike evidence showed three boundary constraints that must remain true:

1. fas-local owns the meaning of `Runtime`, `Session`, `Provider`,
   `ProviderManager`, and the CLI contract exposed to operators.
2. actor-web is only a candidate execution substrate behind explicit contracts
   for commands, facts, projections, and effect ports.
3. provider lifecycle for `mlx_lm.server` is not ready to move into actor-web
   or `provider-mlx` yet because the required child-process, timeout,
   cancellation, and effect-journal contracts are not stable.

This ADR is therefore a boundary ADR, not an adoption ADR. It defines how the
repos may align without implying that actor-web is already adopted as the
fas-local runtime host.

## Decision

actor-web may become a future execution and data-plane substrate for fas-local,
but only behind explicit fas-local-owned contracts.

fas-local retains ownership of:

- Public `Runtime`, `Session`, `Provider`, `ProviderManager`, and CLI APIs
- Product semantics for provider acquisition, readiness, duplicate prevention,
  shutdown, session turns, replay meaning, and operator-facing errors
- Contract vocabulary for commands, facts, projections, and lifecycle policy

actor-web may later own:

- Actor hosting, mailboxes, scheduling, supervision, topology, and transport
- Node-local runtime execution mechanics for `SessionActor`, `ProviderActor`,
  and related supporting actors
- Runtime enforcement of effect ports and actor capability boundaries

The boundary is explicit: fas-local defines the contracts; actor-web may host
implementations of those contracts. fas-local does not adopt actor-web
vocabulary in its public API, and actor-web does not inherit ownership of
fas-local or FAS product semantics.

## Non-goals

- No actor-web dependency during `ProviderManager` v1.
- No process lifecycle ownership in `provider-mlx`; it remains an HTTP adapter.
- No actor-web ownership of FAS or fas-local product semantics.
- No hidden coupling through direct mutual imports, shared private state, or
  actor-web-specific public API types in fas-local.
- No assumption that actor restart semantics are sufficient for OS child
  process supervision.
- No cross-node failover or distributed provider ownership in the first
  alignment slice.

## Contracts

The alignment surface is a fas-local-owned contract package or vocabulary that
an actor-web host may implement later. The first required actors are
`SessionActor` and `ProviderActor`.

### SessionActor

Commands:

- `CreateSession`
- `AttachProvider`
- `SubmitTurn`
- `CancelTurn`
- `CloseSession`
- `GetSessionProjection`

Facts and errors-as-data:

- `SessionCreated`
- `ProviderAttached`
- `TurnStarted`
- `ProviderDeltaObserved`
- `TurnCompleted`
- `TurnCancelled`
- `TurnFailed`
- `SessionClosed`
- `WorkspaceContextLoaded`
- `ReplayCheckpointRecorded`

`TurnFailed` and related failure facts must be projected as data. Missing
provider readiness, provider crash, model mismatch, cancellation, and timeout
conditions are contract facts, not thrown control flow.

Projection:

- Session identity
- Provider identity and readiness
- Active turn state
- History summary
- Last failure fact
- Cancellation status
- Replay checkpoint cursor

### ProviderActor

Commands:

- `AcquireProvider`
- `StartServer`
- `CheckHealth`
- `EnsureModel`
- `InspectModelCache`
- `CancelStartup`
- `StopServer`
- `GetProviderProjection`

Facts and errors-as-data:

- `EndpointAlreadyRunning`
- `ProcessSpawnRequested`
- `ProcessStarted`
- `ProviderReady`
- `ProviderUnavailable`
- `MissingExecutable`
- `PortConflict`
- `StartupTimeout`
- `ModelMismatch`
- `HealthCheckFailed`
- `ProcessExited`
- `StartupCancelled`
- `ShutdownRequested`
- `ShutdownComplete`
- `DuplicatePrevented`

Projection:

- Provider lifecycle state
- Endpoint and model selection
- PID or process-group handle when present
- Restart count
- Last health/readiness result
- Bounded stdout/stderr tail
- Idle deadline
- Acquisition owner

### Supervision Policy

The first supervision policy is node-local and one-for-one:

- `ProviderActor` crash and transient health failures may restart within a
  bounded budget.
- `MissingExecutable`, `ModelMismatch`, and `PortConflict` stop and project
  actionable facts without restart loops.
- `StartupCancelled` does not trigger restart.
- Permanent provider failure escalates to `SessionActor` as facts, not thrown
  exceptions.

This preserves the actor-web runtime/data-plane role while leaving lifecycle
meaning with fas-local.

## Effects

If actor-web later hosts these actors, every non-deterministic boundary must
stay behind explicit effect ports. Required ports include:

- Process runner for spawn, signal, exit observation, and duplicate prevention
- Health-check fetch port for readiness and model compatibility
- Timer/deadline port for startup timeout, retry backoff, and idle shutdown
- Filesystem or cache-inspection port
- Effect journal or idempotency port for non-idempotent operations

The effect model must preserve errors as data:

- Ports return explicit success/failure facts.
- Timeouts and cancellations are surfaced as contract facts.
- Unreachable invariant failures may still terminate locally, but expected
  operational failures stay in the fact stream.

This is stricter than actor-web's current generic tool execution surface. The
future substrate must support typed failure facts, cancellation, and effect
auditability before it is allowed to own provider lifecycle work.

## Replay

Replay reconstructs decisions and projections from facts. Replay never
re-executes process, network, timer, or filesystem effects directly.

Replay rules:

- Facts are replayable.
- Effects are not replayable.
- Every non-idempotent effect requires an activation key or equivalent
  idempotency handle.
- Replayed state may rebuild `SessionActor` and `ProviderActor` projections,
  but it may not respawn `mlx_lm.server`, resend signals, or reissue readiness
  fetches as a side effect of replay alone.
- Gateway snapshots and transition logs are useful read models, but they are
  not sufficient by themselves to authorize effect re-execution.

This boundary prevents actor-web runtime mechanics from smuggling product
semantics into replay behavior.

## Phasing

1. fas-local completes `ProviderManager` v1 without actor-web.
   This stabilizes commands, facts, projections, duplicate-prevention policy,
   readiness policy, shutdown policy, and CLI integration under fas-local
   ownership.
2. actor-web lands substrate prerequisites.
   These include timeout and cancellation support, typed failure-fact
   boundaries, child-process supervision ports, and effect-journal or
   idempotency semantics.
3. actor-web proves compatibility with fake-port conformance tests.
   `SessionActor` and `ProviderActor` behavior must be validated against
   fas-local-owned contracts before any real provider process is hosted.
4. fas-local evaluates an embedded actor-web host adapter.
   This is the first acceptable adoption slice: same fas-local public APIs,
   actor-web only as an internal execution substrate.
5. A daemon or separate runtime host remains optional future work.
   It is not a prerequisite for substrate alignment and should wait until the
   embedded slice proves operator value.

## Consequences and Risks

Consequences:

- The repo boundary stays coherent: fas-local owns public runtime meaning,
  actor-web may later own execution mechanics.
- Provider lifecycle work proceeds now without blocking on actor-web adoption.
- Future actor-web integration has a narrow contract target instead of an
  architecture-wide rewrite.

Risks:

- Process lifecycle could drift into `provider-mlx` or generic runtime helpers
  unless the `ProviderManager` boundary stays strict.
- Actor restart semantics may be over-read as process supervision, leading to
  weak duplicate-prevention, shutdown, or readiness guarantees.
- Without an effect journal or idempotency contract, replay and retry can
  duplicate non-idempotent process operations.
- A future shared contract package could be promoted too early, freezing
  unstable vocabulary across repos before fas-local finishes proving it.
- A daemonized runtime host may add operator burden before an embedded
  substrate proves its value.

The recommended bias is therefore: fas-local first for product semantics,
actor-web later for execution substrate, with explicit contracts at every seam.
