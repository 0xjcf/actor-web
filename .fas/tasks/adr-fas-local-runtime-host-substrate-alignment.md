# ADR: fas-local Runtime Host Substrate Alignment

## Source

Created with `fas create-task` on 2026-07-01.

## Problem

Create the actor-web ADR recommended by .fas/artifacts/spikes/2026-07-01-fas-local-actor-system-readiness.md. The ADR should capture actor-web as a possible execution/data-plane substrate for fas-local, preserve fas-local ownership of Runtime, Session, Provider, ProviderManager, and CLI APIs, define non-goals, and require explicit contracts rather than mutual imports or hidden coupling.

## Automation admission

- Expected operator value: Improves operator leverage around "ADR: fas-local Runtime Host Substrate Alignment" by reducing manual coordination, repetitive execution, or trust gaps.
- Observability surface: Use authoritative FAS surfaces such as `fas runtime status`, `fas runtime watch`, workflow logs, receipts, or notifications to show whether the automation is active, quiet, stalled, blocked, or complete.
- Recovery path: A human can abort, retry, recover, or rerun this workflow without leaving stale queue, lease, branch, or current-task state.
- Autonomy mode: advisory
- Promotion criteria: Promote beyond advisory only after dogfood runs prove clear operator value, trustworthy observability, and bounded recovery.

## Acceptance criteria

- ADR states actor-web may host fas-local actors only behind explicit contracts while fas-local remains API owner.
- ADR includes non-goals: no actor-web dependency during ProviderManager v1, no process lifecycle in provider-mlx, and no actor-web ownership of FAS/fas-local product semantics.
- ADR covers SessionActor and ProviderActor commands, facts, errors-as-data, projections, supervision policies, effect ports, replay rules, and phasing.
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

- docs
- .fas/artifacts/spikes/2026-07-01-fas-local-actor-system-readiness.md
- docs/0009-fas-local-runtime-host-substrate-alignment.md

## Scope Amendments

- Type: durable-adr-promotion
- Added at: 2026-07-02
- Trigger: final reviewer closeout blocker
- Reason: Promote the reviewed ADR from ignored .fas/artifacts runtime state into a tracked durable actor-web documentation path before closeout.
- Added paths: docs/0009-fas-local-runtime-host-substrate-alignment.md
- Evidence source: fas_reviewer
- Evidence: fas_reviewer | .fas/state/agent-orchestration-execution.json | Reviewer accepted ADR content but found ignored artifact path insufficient for durable closeout.
- Accuracy signal: tracked docs path now exists
- Follow-up needed: Regenerate task-specific verification and review receipts after scope refresh.

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
