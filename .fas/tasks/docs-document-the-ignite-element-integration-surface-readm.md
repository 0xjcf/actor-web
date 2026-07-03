# Docs: document the ignite-element integration surface (readModel/commandSource/sourceHandle + opts)

## Source

Created with `fas create-task` on 2026-06-06.

## Problem

Cross-repo alignment (spike C10). Document the topology source factories (.readModel(opts), .commandSource(opts), .sourceHandle(opts), .readModelHandle(opts)) and that opts is ActorWebSourceOptions = gateway/transport config { gateway:{url,scope?,auth?}, streamId?, createSocket?, clientVersion? }, NOT actor identity. Explain how each maps to igniteCore's source/commandSource keys, and the read-model-vs-command-source (CQRS/least-privilege) rationale. Reference the ignite-element Actor-Web guide.

## Acceptance criteria

- topology source factories + opts documented
- mapping to igniteCore source/commandSource shown
- read-model vs command-source rationale documented
- TDD: a failing test that captures the new or changed behavior is written before the implementation and lands in the same change.
- TDD: every production code change in the change set is covered by an added or updated test.
- DDD: respect domain boundaries — keep the functional core deterministic and side-effect-free (no reads, writes, network, or clock), confine coordination to the imperative shell, and have adapters return facts instead of throwing.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- docs/
- docs/site/guides/ignite-element.md
- docs/site/concepts/sources-and-gateway.md
- docs/site/api/topology.md
- docs/API.md
- docs/examples/ignite-element-host.md

## Scope Amendments

- Type: scope-promotion
- Added at: 2026-07-03T18:55:00Z
- Trigger: Docs surface narrowed during implementation
- Reason: Promote concrete docs files that already own the Ignite Element integration, source/gateway contract, topology API, API reference, and runnable example note.
- Added paths: docs/site/guides/ignite-element.md, docs/site/concepts/sources-and-gateway.md, docs/site/api/topology.md, docs/API.md, docs/examples/ignite-element-host.md
- Evidence source: repo-search
- Evidence: repo-search | docs/site/guides/ignite-element.md | Existing Ignite Element guide and companion source factory docs contain the target surface.
- Accuracy signal: Targeted rg found exact readModel/commandSource/sourceHandle/opts docs.
- Follow-up needed: None.

## Implementation plan

- Convert the supplied context into a scoped implementation plan before editing.
- Refresh affected-file scope before implementation if the generated hints are incomplete.

## Verification plan

- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.

## Risks

- Validate generated scope, acceptance criteria, and verification evidence before closeout to avoid workflow drift.

## Dependencies

- task-1780800649098 (docs site scaffold/guide prereq from queue row)

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
