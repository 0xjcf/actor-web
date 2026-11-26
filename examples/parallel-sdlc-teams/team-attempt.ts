import type { ActorAddress, ActorSystem } from '@actor-web/runtime';
import { type ExecuteCheck, pinCandidate } from './check-protocol.js';
import { ok, type Result, refuse, type Task } from './definitions.js';
import type { StageSession, stageSessions } from './stage-sessions.js';
import type { Candidate } from './stages.js';
import { type CheckBinding, type TaskCheckReply, taskCheckBehavior } from './task-check.js';

export type CheckTarget = Pick<CheckBinding, 'workspaceId' | 'executorId' | 'executorGeneration'>;
export type OpenAttempt = {
  ownerAddress: ActorAddress;
  candidate: Candidate;
  execute: ExecuteCheck;
};
export type PendingAttempt = OpenAttempt & { test: StageSession };

export function validTarget(target: CheckTarget): boolean {
  return (
    typeof target?.workspaceId === 'string' &&
    !!target.workspaceId.trim() &&
    typeof target.executorId === 'string' &&
    !!target.executorId.trim() &&
    Number.isSafeInteger(target.executorGeneration) &&
    target.executorGeneration > 0
  );
}

export async function openAttempt(
  system: ActorSystem,
  sessions: ReturnType<typeof stageSessions>,
  teamId: string,
  task: Task,
  candidate: Candidate,
  { workspaceId, executorId, executorGeneration }: CheckTarget
): Promise<Result<PendingAttempt>> {
  const binding: CheckBinding = {
    ...(await pinCandidate(workspaceId, new TextEncoder().encode(candidate.label))),
    taskId: task.id,
    taskRevision: task.revision,
    checkId: 'expected-label',
    attemptId: crypto.randomUUID(),
    executorId,
    executorGeneration,
  };
  const owner = await system.spawn(taskCheckBehavior(binding), {
    id: `${teamId}-task-check`,
    supervision: { strategy: 'stop' },
  });
  const decision = await owner.ask<TaskCheckReply>({ type: 'DISPATCH_CHECK' });
  if (!('value' in decision) || decision.value !== 'awaitingReceipt') {
    await owner.stop();
    return refuse('CHECK_NOT_DISPATCHED');
  }
  // Preparing a request is not a passing check. Only the owner can later settle this stage.
  const { stage, result } = await sessions.run<ExecuteCheck>('test', (testSessionId) => ({
    type: 'EXECUTE_CHECK',
    binding,
    trace: { teamId, testSessionId },
    expectedLabel: task.expectedLabel,
  }));
  if (!result.ok) {
    sessions.settle(stage, result);
    await owner.stop();
    return result;
  }
  return ok({ ownerAddress: owner.address, candidate, execute: result.value, test: stage });
}
