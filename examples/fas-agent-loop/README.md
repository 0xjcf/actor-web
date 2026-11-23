# Actor Workflow Dashboard

This integration example pairs headless Actor-Web state with an Ignite Element
dashboard. The browser page projects the orchestration baseline; the accompanying
topology also demonstrates lattice and hybrid coordination. For the SDLC learning
path, start with [Parallel SDLC Teams](../parallel-sdlc-teams/index.html) instead.

## Orchestration baseline

The browser dashboard starts both nodes in-process with `startRuntime`. The
Node integration fixture still uses real WebSocket transports and a gateway.
Both hosts run the same task loop.

`startFasAgentLoopExample()` drives the workflow directly:

- `taskBoard` accepts the task.
- The coordinator asks `plannerAgent`, `implementerAgent`, `verifierAgent`, and
  `reviewerAgent` in order.
- Validation failures and review rejection loop back to `implementerAgent`.
- The deterministic tool registry keeps the example reproducible.

One coordinator owns ordering, timeouts, retries, and the progress projected to
the dashboard.

The example now points at the neutral CLI v3 conformance surface in
`@actor-web/testing` rather than treating this topology as the runtime contract
itself. Consumers should prove their adapter against
`getControlPlaneConformanceFixture()` and the fixed scenario list:
`success`, `rejection`, `interruption_resume`, `duplicate_suppression`,
`stale_projection`, and `operator_reconciliation`.

## Stigmergic lattice

The same topology also declares a `workspace` lattice actor plus dependency
driven agents:

- `latticePlanner` observes `task.brief`.
- `latticeImplementer` observes `execution.plan`.
- `latticeVerifier` observes `implementation.patch`.
- `latticeReviewer` observes `verification.result`.
- `latticeImplementer` also observes `review.findings` with `everyVersion`, so
  each review finding version can reactivate coding.

The agents do not point at each other. They observe artifacts in the workspace
environment, and `@actor-web/lattice` derives registrations and subscriptions
from the topology. A task-specific runtime must scope artifact `key` values to a
task/session identifier, or another equivalent namespace, so concurrent runs do
not share activation state. This reusable example leaves placeholder keys open
only to describe the artifact contract rather than one task instance.

## Hybrid

`hybridCoordinator` demonstrates the mixed model:

- The coordinator publishes the kickoff `task.brief` artifact.
- Agents self-organize through lattice artifacts.
- The coordinator observes `review.approved`.
- Budget, timeout, cancellation, and human gates stay with the coordinator.

No runtime mode switch is required. The hybrid coordinator is just another actor
declaring an artifact dependency while retaining direct ask/send for transactional
control.
