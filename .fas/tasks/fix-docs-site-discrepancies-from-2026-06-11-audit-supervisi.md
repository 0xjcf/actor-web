# Fix docs-site discrepancies from 2026-06-11 audit (supervisi

## Source

Created with `fas create-task` on 2026-06-11.

## Problem

A 3-agent read-only audit of all docs/site pages against packages/actor-core-runtime/src found two uncovered discrepancies (everything else was either accurate or already covered by open PR #21 and the queued README docs-refresh task). (1) docs/site/concepts/supervision.md:45 says a restarted actor starts from initial context 'or its last persisted state where configured' — persistState?: boolean is declared on SpawnOptions (actor-system.ts:154) but has zero consumers; restart always produces fresh context. DECIDED (2026-06-11, human-approved): do NOT implement the flag — a boolean is the wrong shape for persistence (real designs are explicit behavior contracts like EventSourcedActor), and silently resuming pre-crash state fights let-it-crash (poison-state restart loops). Replace the phrase with plain truth along the lines of: "A restarted actor starts from its initial context. Durable state is not yet a runtime feature; if state must survive restarts, re-derive it from an external source in onStart." The companion type cleanup is the separate "SpawnOptions API honesty" task; the future persistence contract belongs to the event-sourcing decision task. (2) docs/site/concepts/supervision.md:46 says subscriptions are preserved across restart with the same id — true for topology-declared subscriptions (re-wired on start via wireOwnedActorWebSubscriptions) but NOT for imperative system.subscribe ones (in-memory, lost on system restart); add the distinction, consistent with subscriptions-and-events.md:69-70. (3) docs/site/index.md:20 hero card says '(soon) inter-actor subscriptions' — shipped in PR #20; state it as a shipped capability and sweep docs/site for any other stale 'soon/not yet' subscription claims. Audit provenance: full findings in the 2026-06-11 session; accurate pages explicitly verified included all getting-started, guides, api, tools, transport, topology, sources-and-gateway pages.

## Acceptance criteria

- The defect no longer reproduces.
- A regression test covers the fix.
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

- docs/site/concepts/supervision.md
- docs/site/index.md

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
