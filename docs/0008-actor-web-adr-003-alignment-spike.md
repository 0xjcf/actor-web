# Actor-Web ADR-003 Alignment Spike

## Status

Planning/intake slice. This is not the completed Actor-Web ADR-003 adoption
decision.

Current spike result:
`docs/spikes/actor-web-adr-003-fas-integration-review.md`

## Purpose

This spike/review slice prepares `actor-web` for cross-repo architecture alignment with FAS and `ignite-element` using the ADR-003 six-layer vocabulary:

1. Intent
2. Deterministic decision
3. Workflow and lifecycle
4. Imperative execution over time
5. Projection
6. Product composition

The goal is not to move FAS runtime code into `actor-web`. The goal is to determine, from `actor-web` repo evidence, what orchestration responsibility `actor-web` can own and what contract FAS would need before depending on it.

## FAS Lessons To Carry Forward

Recent FAS ADR 0007 work exposed two concrete alignment risks:

- Deterministic core code must not read clocks, randomness, environment, filesystem, network, timers, browser globals, process IO, or subprocess APIs directly. Those facts must enter through adapters/effects as explicit inputs.
- Structural import rules must be enforceable from committed source/config, not only from ignored local runtime files.

Actor-web should be reviewed for the same risks before any cross-repo ownership claim is made.

## Review Questions

Use repo-local actor-web evidence to answer:

- Which actor-web directories own deterministic decisions?
- Which directories own actor lifecycle, scheduling, retry, leases, and recovery?
- Which modules perform imperative execution, persistence, network IO, browser IO, or shell/process work?
- Which surfaces are projections/read models rather than mutation paths?
- Does actor-web already expose contracts that FAS could consume without importing actor-web internals?
- Is actor-web currently capable of being a shared orchestration runtime, or is that still target-state?
- What would remain owned by FAS even if actor-web becomes the shared runtime?
- What would remain owned by product repos such as ignite-element?

## Expected Deliverables In Actor-Web

Create one spike/review artifact in the actor-web repo, preferably under the repo's existing docs/spikes/proposals location:

```text
docs/spikes/actor-web-adr-003-fas-integration-review.md
```

If actor-web uses a different convention, follow that convention.

The artifact should include:

- Evidence inventory: exact files/directories reviewed.
- ADR-003 layer map for actor-web directories and runtime artifacts.
- Current-fact vs target-state table.
- Deterministic-core audit findings.
- Structural import/boundary enforcement gaps.
- Proposed minimal FAS-to-actor-web contract.
- Explicit non-goals and risks.
- Recommended next implementation slices.

## Minimal Contract To Evaluate

Do not assume this contract exists. Evaluate whether actor-web can own or expose it.
Do not create a parallel FAS contract before comparing against FAS's existing
`@franchise/shared-contracts` package.

Existing FAS shared-contracts surfaces to compare:

- `EventEnvelope`
- `WorkflowSnapshot`
- `WorkflowTransitionRecord`
- `WorkflowCommand`
- `WorkflowFact`
- `CommandExecutionRecord`
- `ArtifactReference`
- `ActorAddress`
- `OrchestrationContract`
- `ClientMapping`

Candidate FAS-to-actor-web contract:

- Task/workflow envelope: task id, repo id, phase, owner, status, policy classification, artifact references.
- Event envelope: workflow started, command requested, command completed, heartbeat, blocked, recovered, failed, closed.
- Queue/admission record: requested work, source, autonomy policy, dependency state, priority.
- Lease/recovery record: workspace owner, lease expiry, recovery action, stale-work handling.
- Verification evidence reference: receipt path/id, mode, result, log reference.
- Projection/read model: actor status, workflow state, recent events, blocked reasons, recovery options.
- Capability boundary: which mutations actor-web may request, which remain audited through FAS CLI commands.

FAS should remain standalone until this contract is explicit and tested.

## Ownership Boundaries To Preserve

- FAS owns engineering workflow policy, artifact discipline, verification gates, task packets, review evidence, memory promotion, and repo-local autonomy policy.
- Actor-web may own shared actor lifecycle, scheduling, leases, retries, event delivery, and recovery mechanics if actor-web evidence supports that role.
- Ignite-element and other product repos own product-domain intent, domain policy, UI/product composition, and application-specific behavior.
- MCP/read-model surfaces should remain projections unless the owning repo explicitly documents an audited mutation command.

## Suggested Spike Procedure

1. Read actor-web `AGENTS.md`, README, package scripts, ADRs/proposals, runtime/actor source, tests, and verification commands.
2. Identify the actor-web equivalent of deterministic core, actors/lifecycle, adapters/effects, persistence, shell/CLI, and projections.
3. Search deterministic decision surfaces for direct clock, randomness, environment, filesystem, network, timer, process, and browser IO reads.
4. Search for import-boundary or architecture-drift enforcement. If none exists, document the gap and propose a minimal committed rule source.
5. Identify current contract artifacts and event/state envelopes already available to external repos.
6. Draft the layer map and contract proposal from evidence only.
7. Run actor-web's focused verification commands. If only documentation changes are made, run the repo's docs/format checks if available.

## Done Criteria

- Actor-web has a committed spike/review document grounded in actor-web files.
- The document distinguishes current facts from target-state.
- FAS integration is described through explicit contracts, not internal imports.
- Any deterministic-core or structural-boundary gaps are listed as follow-up implementation slices.
- The actor-web agent reports verification commands run and any residual risk.
