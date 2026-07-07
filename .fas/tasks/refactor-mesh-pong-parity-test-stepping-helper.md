# Refactor Mesh Pong parity test stepping helper

## Source

Created with `fas create-task` on 2026-07-07.

## Problem

CodeRabbit's final incremental review on PR #45 noted duplicated tick-stepping flow in driveUntilNextScore and runScoreSequence. Extract the centerPaddles -> GET_PADDLE -> SET_PADDLES -> TICK -> flush sequence into one helper while preserving the current tests' behavior.

## Acceptance criteria

- A shared helper owns the repeated Mesh Pong parity test stepping sequence.
- driveUntilNextScore and runScoreSequence both call the helper while preserving their current scoring behavior.
- The Mesh Pong parity test suite still passes.
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

- examples/mesh-pong/mesh-pong.test.ts

## Code suggestions from review

Target: `examples/mesh-pong/mesh-pong.test.ts`, shared helper for `driveUntilNextScore` and `runScoreSequence`.

```diff
+async function stepSimulation(runtime: StartedMeshPongRuntime, refs: MeshPongTestRefs): Promise<void> {
+  await centerPaddles(runtime, refs);
+  const [left, right] = await Promise.all([
+    refs.paddleA.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
+    refs.paddleB.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
+  ]);
+  await refs.ball.send({ type: 'SET_PADDLES', leftY: left.y, rightY: right.y });
+  await refs.ball.send({ type: 'TICK' });
+  await flush(runtime);
+}
+
 async function driveUntilNextScore(
   runtime: StartedMeshPongRuntime,
   refs: MeshPongTestRefs,
   currentSequenceLength: number
 ): Promise<PongScoreState> {
   for (let tick = 0; tick < 40; tick += 1) {
-    await centerPaddles(runtime, refs);
-
-    const [left, right] = await Promise.all([
-      refs.paddleA.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
-      refs.paddleB.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
-    ]);
-    await refs.ball.send({ type: 'SET_PADDLES', leftY: left.y, rightY: right.y });
-    await refs.ball.send({ type: 'TICK' });
-    await flush(runtime);
+    await stepSimulation(runtime, refs);
 
     const score = await refs.score.ask<PongScoreState>({ type: 'GET_SCORE' });
     if (score.sequence.length > currentSequenceLength) {
       return score;
     }
   }
 }
 
 async function runScoreSequence(runtime: StartedMeshPongRuntime): Promise<string[]> {
   const refs = await resolvePongRefs(runtime);
 
   await refs.ball.send({ type: 'RESET_BALL', seed: DEFAULT_PONG_SEED });
   await refs.score.send({ type: 'RESET_SCORE' });
   await flush(runtime);
 
   for (let tick = 0; tick < 28; tick += 1) {
-    await centerPaddles(runtime, refs);
-
-    const [left, right] = await Promise.all([
-      refs.paddleA.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
-      refs.paddleB.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
-    ]);
-    await refs.ball.send({ type: 'SET_PADDLES', leftY: left.y, rightY: right.y });
-    await refs.ball.send({ type: 'TICK' });
-    await flush(runtime);
+    await stepSimulation(runtime, refs);
   }
```

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
