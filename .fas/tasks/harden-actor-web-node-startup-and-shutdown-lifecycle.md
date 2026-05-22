# Harden Actor-Web node startup and shutdown lifecycle

## Source

Created with `fas create-task` on 2026-05-22.

## Problem

Covers CodeRabbit runtime lifecycle findings: serveActorWebNode partial startup leaks, startActorWebNode partial startup leaks, fallback runtime reference-counted cleanup, actor instance spawn race, stop ordering clearing actors before system.stop, HTTP listen event handler race, and peerUrlResolver shadowed parameter cleanup.

## Acceptance criteria

- serveActorWebNode and startActorWebNode roll back transport, system, gateway, discovery, and running state when partial startup fails.
- Fallback component runtime has reference-counted acquisition and release on disconnect.
- Actor-Web actor instance spawning deduplicates concurrent cache-key spawns.
- Node stop clears actor caches only after system and transport shutdown complete.
- HTTP listen uses once handlers and removes the opposite listener on resolve or reject.
- Peer URL resolver naming is unambiguous and behavior is unchanged.
- Focused lifecycle tests cover partial-start failure and teardown paths.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- packages/actor-core-runtime/src/serve-actor-web-node.ts
- packages/actor-core-runtime/src/start-actor-web-node.ts
- packages/actor-core-runtime/src/create-component.ts
- packages/actor-core-runtime/src/actor-web-node-runtime.ts
- packages/actor-core-runtime/src/serve-actor-web-http.ts
- packages/actor-core-runtime/src/unit/serve-actor-web-node.test.ts
- packages/actor-core-runtime/src/unit/start-actor-web-node.test.ts
- packages/actor-core-runtime/src/unit/serve-actor-web-http.test.ts
- packages/actor-core-runtime/src/unit/component-runtime-ownership.test.ts

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
