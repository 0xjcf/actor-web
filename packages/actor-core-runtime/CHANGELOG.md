# @actor-web/runtime

## 0.2.0

### Minor Changes

- 3abee61: Make actor addresses opaque and mint them through one canonical factory.

  - `ActorAddress.type: string` is now `kind: 'actor' | 'callback'`.
  - Actor address paths drop the redundant `/actor/` segment: an actor is now `actor://<node>/<id>` (callback addresses keep `actor://<node>/callback/<id>`).
  - All actor addresses are minted through a single pure factory `createActorAddress(id, node?, kind?)` with one canonical local-node normalization — `node` is always set and `'local'` is the canonical marker. `createLocalActorAddress(id)` and `createRemoteActorAddress(id, node)` drop their former `type` parameter.

  **Breaking:** the exported `ActorAddress` / `ActorWebActorAddress` types, the `createActorAddress` signature, and the actor address path format have changed. All nodes in a cluster must upgrade together — the actor address wire format is not interoperable across this change (callback addresses are unaffected).

- 9121c1a: Collapse `ActorAddress` to an opaque, branded path string.

  - `ActorAddress` is now a branded `string` (the path IS the address) minted only by `Address.from(input: string | { id; kind?; node? })`. Hand-built or LLM-built object literals can no longer masquerade as an address — the path-vs-fields drift class is eliminated at the type level. Structured reads go through `parse(address): { id, kind, node }`; hot routing keeps the `.includes('/callback/')` fast path and `parseActorPath` stays the wire/ingress parser.
  - `ActorWebActorAddress` (the topology DSL's public address type) collapses onto the same branded string (`export type ActorWebActorAddress = ActorAddress`); the topology DSL and example address literals are minted through `Address.from`.
  - Directory listing moves from `listByType(type: string)` to a typed `find(query: AddressQuery)` specification (`{ id?, kind?, node? }`), matched by the pure `matchesAddressQuery`.
  - The guardian is reconciled onto the uniform sentinel `actor://local/guardian` (wire path moved from the non-uniform `/system/guardian`), and the `guardian` id is reserved by the address factory so no user actor can claim it.

  **Breaking:** the exported `ActorAddress` / `ActorWebActorAddress` types are now branded strings (read `address` directly instead of `address.path`; use `parse(address)` for `id`/`kind`/`node`); `directory.listByType(...)` is replaced by `directory.find(query)`; and the guardian wire path changed to `actor://local/guardian`. All nodes in a cluster must upgrade together.

- 774d077: Prepare the 0.2.0 release line across the public package surface.

  - First-publish `@actor-web/agent` with the standard runtime-hosted LLM loop,
    typed `llm` tool adapter, and errors-as-data agent event contract.
  - First-publish `@actor-web/lattice` with artifact coordination,
    dependency-based activation, runtime wiring, timeout re-emission, and journal
    replay seams.
  - Ship the runtime changes accumulated since 0.1.0, including bounded restart
    behavior that now permanently stops crash-looping actors after their declared
    restart budget, branded string actor addresses, API-honesty removals for
    unsupported delivery modes, and the backpressured runtime transport stream
    host.
  - Keep `@actor-web/testing` in the fixed runtime/testing release group.

  Breaking runtime notes:

  - Consumers relying on the previous unbounded restart bug must now handle
    permanent actor stops after the default budget of 3 restarts per 30 seconds
    or the actor's declared supervision policy.
  - `SendInstruction` no longer exposes unsupported retry or guaranteed delivery
    modes.
  - `SpawnOptions` is narrowed to the supported actor id and supervision options.
    Application-level acknowledgement protocols remain the path for stronger
    delivery guarantees than at-most-once `send`.

- 4af688c: Remove the vestigial standalone `Supervisor`, `BackoffSupervisor`, and `SupervisorTree` classes and their public exports (`Supervisor`, `BackoffSupervisor`, `BackoffStrategy`, `SupervisorOptions`, `BackoffSupervisorOptions`).

  These were dead code: never wired into the runtime (their `handleFailure` call was commented out and nothing instantiated them), and their `restartActor` stopped actors without ever restarting them. The supported supervision path is unchanged — `system.spawn(behavior, { supervision: { strategy, maxRestarts, withinMs } })`, backed by `ActorSystemImpl`, which restarts correctly and is covered by `supervision-policy.test.ts`.

  BREAKING: if you imported `Supervisor` / `BackoffSupervisor` (or their option types) directly, switch to `system.spawn(..., { supervision })`.

## 0.1.0

Initial public release of the Actor-Web runtime.

- Behavior authoring via `defineBehavior` (machine-as-behavior, FSM, or
  `onMessage`); `.build()` is optional.
- Topology + runtime entry points: `defineActorWebTopology`, `startRuntime`,
  `serveNode`.
- Neutral source API (`actor-source`) and neutral cross-node projection
  contract — the runtime depends on no application or UI library.
- Dual ESM + CJS build.
