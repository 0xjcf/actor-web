# Design observation vocabulary for lattice artifact sources (observe/requires/prefer)

## Source

Created with `fas create-task` on 2026-07-03.

## Problem

Post-0.2 API design follow-up. Capture whether actor-web should introduce an observation vocabulary around actor({ observe: [artifact({ source, type, key })] }) or an extension-safe equivalent. Evaluate observe, requires, prefer, source/environment resolution, and reusable ArtifactMatcher contracts for FAS/fas-local context consumers. Do not change the 0.2.0 lattice API, do not make core actor() lattice-aware without an explicit extension-boundary decision, and do not replace the current dependsOn({ dependencies }) contract in this task.

## Acceptance criteria

- A design artifact compares the 0.2.0 dependsOn/dependencies/requires contract with an observation vocabulary around observe, requires, prefer, and artifact({ source, type, key }).
- The design decides whether observation declarations belong on core actor descriptors, lattice topology extensions, or a separate artifact-source abstraction.
- The design defines source/environment resolution for one lattice, multiple lattices, and non-lattice artifact sources without hidden coupling to core actor().
- The design records FAS/fas-local implications for shared ArtifactMatcher and Context Builder consumption.
- No production API is changed; implementation tasks are created only after the design decision is accepted.
- The task remains post-0.2 unless a later explicit queue edit makes it release-gating.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- docs/actor-web-observation-vocabulary.md
- docs/actor-web-lattice-contract-design.md

## Scope Amendments

- None.

## Implementation plan

- Draft docs/actor-web-observation-vocabulary.md or an ADR-level design note that captures observe, requires, prefer, artifact source matching, and extension-boundary options.
- Update docs/actor-web-lattice-contract-design.md only to cross-link the future vocabulary from the current v1 lattice contract, without changing the v1 API.
- Create implementation follow-up tasks only after the design decision is accepted.

## Verification plan

- Run markdownlint for the changed docs and task brief.
- Run fas validate-task for the queued task when it is started.

## Risks

- Prematurely moving observe onto core actor() could make actor-core depend on lattice semantics.
- Changing the public 0.2.0 lattice API during this follow-up would destabilize the release contract.

## Dependencies

- Depends on task-1781273347595 so the vocabulary work starts after the 0.2.0 release terminal and does not block the current release path.

## Open questions

- Should the public word be source, environment, or artifact source?
- Can FAS/fas-local Context Builder share the same ArtifactMatcher contract without importing actor-web runtime internals?

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
