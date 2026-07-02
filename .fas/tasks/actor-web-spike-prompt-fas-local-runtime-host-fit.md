# Actor-Web Spike Prompt: fas-local Runtime Host Fit

## Source

Created with `fas create-task` on 2026-07-01.

## Problem

Original prompt: Actor-Web Spike Prompt: fas-local Runtime Host Fit

Use this prompt from the `../actor-web` repository. The spike is read-only
unless the operator explicitly asks you to create follow-up task briefs or an
ADR draft.

## Goal

Assess whether actor-web's roadmap and runtime model can support the future
fas-local actor system target without forcing actor-web into fas-local before
the runtime API is stable.

Target future shape:

```text
fas-local Runtime
  -> ActorSystem
    -> SessionActor
      -> ProviderActor
      -> WorkspaceActor
      -> ContextActor
      -> ReplayActor
```

Near-term fas-local shape remains non-actor-web:

```text
CLI
  -> ProviderManager
    -> Runtime
      -> Session
        -> Provider
```

## Read-Only Inputs

In `../actor-web`, inspect:

- README and package exports.
- ADRs and spikes that mention FAS, runtime hosts, supervision, replay,
  topology, child actors, or process ownership.
- `.fas/TASKS.md`, `.fas/queue/tasks.json`, and domain maps.
- Existing tests or examples that supervise external effects or long-lived
  resources.

From `../fas-local`, inspect read-only:

- `.fas/tasks/add-provider-manager-lifecycle-orchestration.md`
- `.fas/queue/tasks.json`
- `.fas/artifacts/spikes/2026-07-01-actor-web-fas-local-runtime-host-spike-prompt.md`
- `packages/provider-mlx/src/index.ts`
- `apps/cli/src/index.ts`
- `tests/provider-mlx.test.mjs`
- `tests/cli.test.mjs`
- `.fas/memory/integrations.md`

## Questions To Answer

1. Does actor-web support a Runtime-hosted `ActorSystem` without replacing
   fas-local's public Runtime, Session, Provider, ProviderManager, or CLI APIs?
2. Can actor-web supervise Node child processes such as `mlx_lm.server` safely?
   Cover process groups, signals, stdout/stderr backpressure, readiness checks,
   crash/restart behavior, cancellation, idle shutdown, and duplicate
   prevention.
3. Should fas-local use actor-web inside the CLI process, in a long-lived daemon,
   or behind a separate runtime host? Compare lifecycle and operator tradeoffs.
4. How should actor-web model non-replayable side effects such as process spawn,
   kill, health-check fetch, filesystem probes, and model cache inspection?
   Identify which facts/events are replayable and which effects must be
   guarded by ports or effect journals.
5. What message contracts are needed for `SessionActor` and `ProviderActor`?
   Include commands, events, facts, errors-as-data, projections, and
   supervision policies.
6. What must change in actor-web, if anything, to support fas-local's target?
   What must change in fas-local instead?
7. Where should the durable roadmap artifacts live: actor-web ADR, actor-web
   Epic, fas-local follow-up task, FAS shared contract, or all of the above?

## Constraints

- Do not add actor-web as a fas-local dependency during this spike.
- Do not implement actors in fas-local.
- Do not move Provider Manager process lifecycle into `provider-mlx` or
  `runtime-core`.
- Preserve hexagonal architecture: deterministic functional cores, imperative
  shells for effects, explicit ports, projections, and errors as facts.
- Treat FAS/fas-local as the control-plane/product/runtime API owner and
  actor-web as a potential execution/data-plane substrate.
- Keep integration through explicit contracts, not mutual imports or hidden
  coupling.

## Required Deliverables

Write a spike report in actor-web, suggested path:

```text
.fas/artifacts/spikes/YYYY-MM-DD-fas-local-actor-system-readiness.md
```

The report must include:

- Verdict: `ready-now`, `ready-after-actor-web-work`,
  `ready-after-fas-local-work`, or `not-recommended-yet`.
- Evidence table with actor-web file paths and fas-local file paths.
- Decision matrix comparing:
  - fas-local local state machine only
  - actor-web embedded in CLI
  - actor-web daemon/runtime host
  - separate Provider Manager process outside actor-web
- Child-process supervision assessment for `mlx_lm.server`.
- Replay/effect-safety assessment.
- Proposed minimal first actor-web integration, if recommended.
- Required actor-web ADR outline.
- Required actor-web Epic/task list.
- Required fas-local follow-up task list.
- Risks and open questions.

## Acceptance Criteria

- The spike proves whether actor-web can host `SessionActor` and
  `ProviderActor` without redefining fas-local Runtime APIs.
- The spike explicitly answers whether actor-web can safely supervise the Node
  child processes fas-local needs for MLX servers.
- Any recommendation to adopt actor-web includes a smallest safe integration
  slice and prerequisites.
- Any recommendation to delay actor-web includes concrete missing capabilities
  or contract gaps.
- No production code is changed.

## Suggested Closeout

If actor-web is FAS-managed, run the repo-native read-only spike workflow and
capture a report-only artifact. Do not create implementation tasks unless the
operator explicitly asks for queue mutations.

## Workflow Acceptance Criteria

- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Establish the intended approach at a design level before editing code.

## Alternatives considered

- None recorded yet.

## Affected files

- Scope unknown.

## Scope Amendments

- None.

## Implementation plan

- Build the implementation plan during task planning.

## Verification plan

- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- Identify regression, rollout, or coordination risks during planning.

## Dependencies

- None known at task creation.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
