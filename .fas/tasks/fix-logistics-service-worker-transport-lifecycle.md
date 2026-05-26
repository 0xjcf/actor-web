# Fix logistics service worker transport lifecycle

## Source

Created with `fas create-task` on 2026-05-22.

## Problem

Covers CodeRabbit logistics critical and major service-worker findings: browser transport bind MessagePort not started, subscribe before ready throws, service-worker runtime rebind leaves runtime node attached to old transport, activation race using registration.active instead of observed candidate, and service-worker envelope guard missing source validation.

## Acceptance criteria

- Browser transport starts the bind MessagePort before worker reply can arrive.
- Subscriptions made before transport readiness are queued or safely initialized without throwing.
- Service-worker runtime stops/recreates runtimeNode when replacing the underlying MessagePort transport.
- Activation flow uses the observed activated ServiceWorker and cleans statechange listeners.
- Service-worker envelope guard rejects malformed envelopes without string source.
- Headless host and service-worker transport tests cover bind, rebind, subscribe-before-ready, and malformed envelope cases.
- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- The task is queued in `.fas/queue/tasks.json` for the runtime.

## Proposed solution

- Use the supplied problem context, acceptance criteria, and affected-file hints to draft the concrete implementation approach during planning.

## Alternatives considered

- None recorded at task creation. Add rejected approaches during planning if scope tradeoffs appear.

## Affected files

- examples/ignite-headless-host/browser-transport.ts
- examples/ignite-headless-host/worker-runtime.ts
- examples/ignite-headless-host/service-worker-transport-protocol.ts
- examples/ignite-headless-host/headless-host.test.ts
- examples/ignite-headless-host/ignite-headless-host-element.test.ts
- packages/actor-core-runtime/src/unit/serve-actor-web-node.test.ts

## Scope Amendments

- 2026-05-26: Added `packages/actor-core-runtime/src/unit/serve-actor-web-node.test.ts` as a test-only full-verification blocker fix after `.fas/scripts/verify.sh --full` surfaced an unhandled runtime rejection in `marks stopped peers disconnected through the runtime status API`. Runtime source remains out of scope.

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
