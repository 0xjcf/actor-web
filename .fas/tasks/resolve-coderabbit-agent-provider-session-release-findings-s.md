# Resolve CodeRabbit agent/provider/session release findings: stale facts, tool re-entry, effect failures

## Source

Created with `fas create-task` on 2026-07-04.

## Problem

CodeRabbit review --agent -t committed --base main -c AGENTS.md on branch fas/release-0-2-0 raised release-blocking findings across the agent and fas-local host contract surfaces. Verify current code and fix only still-valid issues: node-session observeProviderFact must reject stale or duplicate provider facts by monotonic sequence before applying PROVIDER_DELTA, TURN_COMPLETED, TURN_CANCELLED, or TURN_FAILED mutations; ActorAgent must not re-enter LLM execution from OBSERVE_TOOL_RESULT until all pending tool calls resolve, must preserve failed tool-result status, and must emit AGENT_TOOL_RESULT_OBSERVED for processed tool results; node-provider runEffect must convert perform or journal.record throws into structured failures so claims do not remain pending and dispatch does not unexpectedly throw.

## Acceptance criteria

- SessionActor provider fact handling rejects fact.sequence values less than or equal to the current turn sequence before mutation.
- ActorAgent waits for all pending tool calls before the next LLM step and propagates failed tool results as data to model/context observers.
- ProviderActor claimed effects convert perform or journal record exceptions into structured failure results without leaving pending claims stuck.
- Focused tests cover stale sequence rejection, pending tool result gating/failure propagation, and provider effect exception handling.
- fas validate-task passes before snapshot; full verify remains shared for batch close.
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

- packages/actor-core-runtime/src/node-session-actor.ts
- packages/actor-core-runtime/src/node-provider-actor.ts
- packages/actor-agent/src/index.ts
- packages/actor-core-runtime/src/testing/session-actor-conformance.ts
- packages/actor-core-runtime/src/unit/provider-actor-conformance.test.ts
- packages/actor-agent/src/agent-loop.test.ts

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

- Generated from CodeRabbit review of the current release batch. Intentionally has no queue dependsOn edge to the batched agent/provider/session tasks because that would deadlock closeout before FAS supports batched-dependency satisfaction. It blocks release prep instead.

## Open questions

- None captured at task creation.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
