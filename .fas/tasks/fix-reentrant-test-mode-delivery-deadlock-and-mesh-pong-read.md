# Fix reentrant test-mode delivery deadlock and Mesh Pong README JSON

## Source

Created with `fas create-task` on 2026-07-09.

## Problem

`ActorContextManager.safeRunAsync()` always enters the top-level async tail. In
fallback/test mode, `ActorSystemImpl.enqueueMessage()` immediately awaits nested
delivery. When actor A awaits `dependencies.send()` to actor B, B queues behind
A while A waits for B, causing a deadlock.

The Mesh Pong README also contains `0..278` in a JSON example, which is not
valid JSON.

## Acceptance criteria

- The work is tracked in `.fas/TASKS.md`.
- The task has a clear implementation and verification plan before execution starts.
- A red regression test proves awaited A -> B delivery completes in fallback/test mode.
- The runtime uses an explicit reentrant test-delivery signal to bypass only the
  conflicting top-level serialization tail.
- Existing genuinely concurrent top-level calls remain serialized; reentrancy is
  not inferred merely from an active actor frame.
- The Mesh Pong README example is valid JSON and documents numeric ranges outside
  the JSON block.
- Focused runtime tests, `fas validate-task`, full verification, and CodeRabbit
  review complete successfully.

## Proposed solution

- Add the regression test first.
- Thread an explicit reentrant test-delivery path from immediate test-mode
  delivery into the context manager, bypassing the top-level async tail only for
  that nested delivery.
- Keep the default `safeRunAsync()` behavior unchanged for top-level callers.
- Replace the README pseudo-range values with concrete JSON values and list the
  valid ranges in prose.

## Alternatives considered

- Inferring reentrancy from any active actor frame was rejected because fallback
  storage can make a genuinely concurrent top-level call look reentrant.
- Removing top-level serialization was rejected because the existing ordering
  contract and regression coverage must remain intact.

## Affected files

- `packages/actor-core-runtime/src/actor-context-manager.ts`
- `packages/actor-core-runtime/src/actor-system-impl.ts`
- Targeted existing tests under `packages/actor-core-runtime/src/`
- `examples/mesh-pong/README.md`
- `examples/mesh-pong/mesh-pong.test.ts`

## Scope Amendments

- Full verification showed that the Mesh Pong documentation contract test
  asserted the invalid pseudo-JSON values removed from the README. Promote that
  test so it verifies concrete JSON values and the separately documented ranges.

## Implementation plan

1. Add and run a focused red regression for awaited A -> B delivery in
   fallback/test mode, alongside the existing top-level serialization coverage.
2. Implement the smallest explicit reentrant delivery signal and preserve the
   default serialized path.
3. Correct the README JSON example and document the ranges separately.
4. Run the focused runtime suite, task validation, full verification, and review.

## Verification plan

- Run the targeted regression before implementation and confirm it fails by timeout.
- Run the focused actor runtime test file(s), including the existing top-level
  serialization case.
- Run `fas validate-task` for the inner-loop verification gate.
- Run `.fas/scripts/verify.sh --full` at the final release-quality gate when tracked files change.
- Run CodeRabbit again after the final material changes.

## Risks

- An overly broad bypass could weaken top-level serialization and introduce
  concurrent actor-context corruption.
- An implicit active-frame check can misclassify concurrent top-level calls when
  fallback storage is in use.
- Test-mode-only behavior can drift from production context propagation if the
  explicit signal is not narrowly scoped.

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
