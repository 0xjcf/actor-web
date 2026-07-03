# Runtime correctness (CodeRabbit PR#32 full-pass): retry-interceptor unhandled rejection + create-actor-ref parent contract

## Source

Created from `.fas/queue/tasks.json` task `task-1782439276906`.

## Problem

Two pre-existing runtime issues were surfaced by the CodeRabbit PR-bot full pass
on PR #32. They are distinct from `task-1782330154816`, which covers
mailbox-drain, `UPDATE_DEPENDENCIES`, and receive-metrics issues from an
earlier CLI pass.

1. `packages/actor-core-runtime/src/interceptors/retry-interceptor.ts`
   swallows async rejections. The retry path wraps only synchronous setup in
   `try`/`catch`; `this.actorSystem.lookup(actor).then(a => a?.send(message))`
   lets rejections from `lookup()` or `send()` escape the catch, so retry
   failures go unhandled and never call `recordFailure()`. The circuit breaker
   therefore never trips.
2. `packages/actor-core-runtime/src/create-actor-ref.ts` passes a string parent
   id during child spawn, then exposes it as `ActorRef` through `childRef.parent`.
   The child parent contract should expose the actual parent actor ref.

## Acceptance criteria

- Retry failures from rejected lookup/send paths are observed, logged or
  surfaced through the existing failure path, and call `recordFailure()`.
- A missing lookup result records failure where appropriate.
- A regression test proves rejected lookup/send causes failure accounting.
- Child actor refs expose the actual parent `ActorRef`, not a string id cast as
  a ref.
- A regression test asserts `childRef.parent` is the parent actor ref.
- `fas validate-task` passes for the task.
- `.fas/scripts/verify.sh --full` passes before closeout.

## Proposed solution

- Verify the current retry and parent-ref behavior before editing.
- Patch the smallest runtime seams needed for failure accounting and parent ref
  propagation.
- Add focused regression tests before or with the implementation.

## Alternatives considered

- None recorded yet.

## Affected files

- packages/actor-core-runtime/src/interceptors/retry-interceptor.ts
- packages/actor-core-runtime/src/create-actor-ref.ts
- packages/actor-core-runtime/src/unit

## Scope Amendments

- None.

## Implementation plan

- Reproduce the retry rejection and parent contract gaps with focused tests.
- Implement the smallest runtime fixes.
- Run focused tests, `fas validate-task`, and full verification.

## Verification plan

- Run focused runtime tests for the changed files.
- Run `fas validate-task`.
- Run `.fas/scripts/verify.sh --full`.

## Risks

- Retry/circuit-breaker behavior is shared runtime machinery; keep the change
  focused and avoid changing delivery semantics beyond failure accounting.
- Parent ref propagation may affect logging or parent-id projections; verify
  any code that expects `parent` to be an `ActorRef`.

## Dependencies

- None.

## Open questions

- Confirm whether a missing lookup result should always increment the retry
  failure counter or only when the retry path is active.

## Artifact links

- Planning: `.fas/state/planning.json`
- Task packet: `.fas/state/task-packet.json`
- Commit plan: `.fas/state/commit-plan.json`
- Verification: `.fas/state/verification/latest.json`
- Review: `.fas/state/boundary-review-findings.md`
- Workflow: `.fas/state/workflows/`
