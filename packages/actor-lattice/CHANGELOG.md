# @actor-web/lattice

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [3abee61]
- Updated dependencies [9121c1a]
- Updated dependencies [774d077]
- Updated dependencies [4af688c]
  - @actor-web/runtime@0.2.0

## 0.2.0

Initial public release of the Actor-Web lattice package.

- Artifact store and dependency matching primitives.
- `lattice()` and `dependsOn()` topology helpers.
- Runtime wiring for dependency registration, subscriptions, and activation
  timeout checks.
- Event-store-backed lattice journal seam for replay.
- Dual ESM and CJS build.
