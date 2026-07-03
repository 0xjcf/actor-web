# Release prep 0.2.0: ship @actor-web/agent + decide the public package facade

## Source

Created with `fas create-task` on 2026-06-10.

## Problem

SEQUENCE AFTER @actor-web/agent (CLI v1) ships. Prep the next npm release line: (1) changesets for runtime/testing changes accumulated since 0.1.0 (incl. the shutdown dead-letter fix, PR #18) and the new @actor-web/agent package's first publish; (2) decide @actor-web/cli publish posture (still private; see the deferred cli-publish task); (3) DECISION REQUIRED: public package facade — whether to publish an unscoped 'actor-web' package as the public API surface (re-exporting the supported surface) while keeping @actor-web/*scoped packages as internal implementation, mirroring how ignite-element ships 'ignite-element' (unscoped) over @ignite-element/* internals. Record the decision in docs/ and decisions memory; if adopted, the facade package + changeset fixed-group membership land here; (4) consider the Changesets GitHub Action so releases run via a Version Packages PR instead of local bypass-push (repo main is PR-protected); (5) RELEASE-NOTE REQUIRED (added 2026-06-11, per-actor supervision review): behavior change since 0.1.0 — actor restart bounds now actually trip. A base bug (stopActor wiped restart counters during restart) made restarts effectively unbounded; with the fix, a crash-looping actor permanently stops after its bound (default 3 per 30s, or its declared per-actor policy). External consumers relying on the buggy unbounded restarts will see permanent stops. Also note the API-honesty removals shipping in this line: SendInstruction retry(3)/guaranteed modes removed (mode now optional 'fireAndForget'), SpawnOptions narrowed to { id?, supervision? }, and the rewritten npm README. (6) SCOPE EXPANDED (2026-06-12, human decision): the official release is FEATURE-COMPLETE including @actor-web/lattice (first publish — stigmergic coordination is the differentiator vs other actor libraries and the foundation for fas-studio) and cross-node subscription delivery (multi-node choreography). This task is the terminal node of the release DAG in .fas/queue/tasks.json — it depends on every release-gating task (supervisor trees, lattice design+implementation+example, cross-node delivery, decouple pair, ESM fix, CI workflow, tool timeout, batch subscribers, event-sourcing decision, CLI v1 agent, docs pages, observability polish).

## Locked release execution order

Locked on 2026-07-03. `dependsOn` and `blocks` remain the execution
primitive; the `release-0-2-0` Epic is additive roadmap grouping only.

Wave 1: upstream release unblocker.

- `task-1781880513048` — Unify actor location truth.

Wave 2: release prerequisites that can run once their existing dependencies are
clear.

- `task-1780800650668` — Document the ignite-element integration surface.
- `task-1780836640337` — Add batch `subscribers[]` overload.
- `task-1781273347586` — Supervision observability polish.
- `task-1781273347587` — Decide event-sourcing module fate.
- `task-1781880955701` — Large-payload framing or max-payload contract.
- `task-1782439279955` — Docs hygiene for absolute local-path leaks.

Wave 3: lattice design.

- `task-1781273347588` — Author lattice contract design doc. Depends on
  `task-1780836640337` and `task-1781273347587`.

Wave 4: agent package.

- `task-1781123183558` — `@actor-web/agent` package and agent hosting. Depends
  on `task-1781880513048`.

Wave 5: agent-dependent release work.

- `task-1780925230820` — Headless agent runtime docs. Depends on
  `task-1781123183558`.
- `task-1781880957238` — Backpressured agent/tool output stream. Depends on
  `task-1781123183558` and `task-1781880955701`.

Wave 6: lattice implementation and example.

- `task-1781273347589` — Implement `@actor-web/lattice`. Depends on
  `task-1781273347588`.
- `task-1781273347591` — Lattice coordination example. Depends on
  `task-1781273347589` and completed cross-node subscription delivery.

Wave 7: terminal release prep and publish.

- `task-1781273347595` — This task. It must remain deferred until all direct
  and transitive release gates above are complete.

Post actor-web publish:

- Resume the Ignite `task-1782269396312` cleanup after `@actor-web/runtime`
  publishes beyond `0.1.0` with branded string `ActorAddress`.

## Acceptance criteria

- changesets exist for all publishable changes since 0.1.0
- @actor-web/agent first-publish plumbing verified with npm pack --dry-run
- facade decision recorded (adopted or rejected) in docs/ and .fas memory
- release executed or handed to the user with exact steps
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- Scope unknown.

## Scope Amendments

- None.

## Implementation plan

- Convert the supplied context into a scoped implementation plan before editing.
- Refresh affected-file scope before implementation if the generated hints are incomplete.

## Verification plan

- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- Validate generated scope, acceptance criteria, and verification evidence before closeout to avoid workflow drift.

## Dependencies

- Direct queue dependencies are recorded in `.fas/queue/tasks.json`.
- The execution waves above are the release ordering contract for operators.
- Do not replace `dependsOn` or `blocks` with Epic ordering; add or adjust
  dependency edges only when the implementation discovers a real execution
  prerequisite.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
