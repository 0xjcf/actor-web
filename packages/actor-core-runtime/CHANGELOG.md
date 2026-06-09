# @actor-web/runtime

## 0.1.0

Initial public release of the Actor-Web runtime.

- Behavior authoring via `defineBehavior` (machine-as-behavior, FSM, or
  `onMessage`); `.build()` is optional.
- Topology + runtime entry points: `defineActorWebTopology`, `startRuntime`,
  `serveNode`.
- Neutral source API (`actor-source`) and neutral cross-node projection
  contract — the runtime depends on no application or UI library.
- Dual ESM + CJS build.
