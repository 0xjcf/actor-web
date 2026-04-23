# Actor-Web ADR-003 Alignment Spike Prompt

## Status

Prompt/intake material. This is not the completed Actor-Web ADR-003 alignment
decision.

Current spike result:
`docs/spikes/actor-web-adr-003-fas-integration-review.md`

You are working in the `actor-web` repository. Run a read-first spike/review to determine how actor-web should align with the ADR-003 six-layer architecture and how it could integrate with FAS without importing FAS assumptions as facts.

## Context

FAS has adopted ADR-003 as its local architecture vocabulary through ADR 0007. FAS currently owns engineering workflow policy, verification evidence, task packets, review artifacts, structured memory promotion, and repo-local autonomy policy. FAS may integrate with actor-web later, but FAS must remain standalone until actor-web exposes explicit contracts.

Carry forward two recent FAS lessons:

- Deterministic core must not read clocks, randomness, environment, filesystem, network, timers, browser globals, process IO, or subprocess APIs directly.
- Boundary rules must be structurally enforceable from committed source/config, not only from ignored runtime state.

Do not assume actor-web already owns shared orchestration. Prove or disprove that from actor-web files.

## Task

Create a spike/review document in actor-web, using the repo's existing docs convention. If there is no convention, use:

```text
docs/spikes/actor-web-adr-003-fas-integration-review.md
```

## Required Review

Read the actor-web repo before writing conclusions:

- `AGENTS.md` or equivalent repo instructions
- README and package scripts
- ADRs, proposals, architecture docs
- actor/runtime/lifecycle source
- queue, event, lease, recovery, persistence, shell/CLI, and projection/read-model code
- relevant tests and verification commands

Map actor-web to these layers:

1. Intent
2. Deterministic decision
3. Workflow and lifecycle
4. Imperative execution over time
5. Projection
6. Product composition

## Audit Questions

Answer from evidence:

- Which actor-web modules are deterministic decision surfaces?
- Which modules own lifecycle/scheduling/retry/lease/recovery mechanics?
- Which modules perform filesystem, network, browser, persistence, shell, process, timer, or provider IO?
- Which surfaces are projections/read models?
- Which commands or APIs mutate state?
- What existing contract artifacts could FAS consume?
- What contract artifacts are missing?
- Is actor-web ready to own shared orchestration today, or is that target-state?
- What should FAS continue to own?
- What should product repos such as ignite-element continue to own?

## Contract To Evaluate

Evaluate whether actor-web currently exposes, or should expose, these contract surfaces:

- Task/workflow envelope
- Event envelope
- Queue/admission record
- Lease/recovery record
- Verification evidence reference
- Projection/read model
- Capability boundary for audited mutations

Keep the proposed FAS-to-actor-web integration based on explicit contracts, queues, event envelopes, workflow snapshots, artifact references, and read models. Do not propose direct imports from FAS internals or product-repo internals.

## Output Format

The spike document should contain:

- Summary
- Evidence inventory with file paths
- ADR-003 layer map
- Current-fact vs target-state table
- Deterministic-core audit
- Structural import/boundary enforcement audit
- Proposed minimal FAS-to-actor-web contract
- Ownership boundaries across FAS, actor-web, and product repos such as ignite-element
- Recommended next implementation slices
- Verification run
- Residual risks

## Constraints

- Keep the spike read-mostly unless a small documentation artifact is required.
- If implementation changes are made, keep them narrow and run actor-web's verification commands.
- Label unsupported cross-repo claims as target-state.
- Do not require actor-web as a hard dependency for FAS until an explicit contract is implemented and tested.
