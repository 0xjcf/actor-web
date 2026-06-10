# actor-web CLI v2: distributed hosting (--gateway/--transport

## Source
Created with `fas create-task` on 2026-06-10.

## Problem
Design: docs/actor-web-cli-runtime-host-design.md (Phase v2). SEQUENCE AFTER CLI v1. Run agents across processes/machines: serve --gateway (WS gateway) and --transport (peer listen); connect ws://host:port --as <node> to operate against a remote node; remote send/watch. REQUIRES a transport auth story before leaving localhost (the Node WS transport has an auth hook). Maps to startActorWebNode/serveNode gateway+transport options and createActorWebClient.

## Acceptance criteria
- agents can be hosted and addressed across separate processes over the WS transport
- remote send/watch work via connect against a served node
- a documented auth story gates any non-localhost gateway/transport use
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
