# Refresh Actor-Web documentation accuracy from CodeRabbit rev

## Source

Created with `fas create-task` on 2026-05-22.

## Problem

Covers CodeRabbit docs findings: absolute filesystem link in ignite-element-host doc, topology/source design summary says two paths while describing three, missing supervisor import in topology example, supervision docs do not clarify metadata-only enforcement, stale spike verification date, and minor compound-adjective grammar fixes.

## Acceptance criteria

- ignite-element-host runnable prove-out link is repository-relative or plain path, not an absolute local filesystem path.
- Topology/source DX design accurately describes the three source-authoring paths or explicitly treats generated client as a sub-case.
- Topology import examples include supervisor where supervisor(...) is used.
- API docs clarify that group supervision strategies are metadata-only until enforcement is implemented and name current fallback behavior.
- Spike verification date is corrected or explicitly clarified.
- Compound adjective grammar fixes are applied in external transport design docs.
- Markdown lint passes for changed docs.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- docs/examples/ignite-element-host.md
- docs/actor-web-topology-source-dx-design.md
- docs/API.md
- docs/spikes/actor-web-adr-003-fas-integration-review.md
- docs/spikes/actor-web-external-transport-design.md

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
