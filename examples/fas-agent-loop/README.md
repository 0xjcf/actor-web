# FAS Agent Loop Coordination Modes

This example keeps the existing runtime demo as the orchestration baseline and
adds lattice declarations beside it so the same Research -> Planning -> Coding
-> Review workflow can be inspected in three coordination styles.

## Orchestration baseline

`startFasAgentLoopExample()` drives the workflow directly:

- `taskBoard` accepts the task.
- The coordinator asks `plannerAgent`, `implementerAgent`, `verifierAgent`, and
  `reviewerAgent` in order.
- Validation failures and review rejection loop back to `implementerAgent`.
- The deterministic tool registry keeps the example reproducible.

This is the near-term FAS control-plane shape: one coordinator owns ordering,
timeouts, retries, and user-facing progress.

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
declaring an artifact dependency while retaining direct ask/send where FAS needs
transactional control.
