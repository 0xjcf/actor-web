import type { ActorAddress } from '@actor-web/runtime';
import { type ActorSystem, defineBehavior } from '@actor-web/runtime/browser';
import {
  type Assignment,
  ok,
  type Result,
  type Role,
  refuse,
  type Version,
} from './definitions.js';
import type { StageFact, TaskRevision } from './stages.js';

export type StageSession = { role: Role; definition: Version; sessionAddress: ActorAddress };
export type StageRecord = StageSession & { fact: StageFact };
export type StageProgress = TaskRevision &
  StageSession &
  (
    | { status: 'running' }
    | { status: 'completed'; fact: StageFact }
    | { status: 'refused'; reason: string }
  );

export function stageSessions(
  system: ActorSystem,
  { team, task }: Assignment,
  runId: string,
  observe: (event: StageProgress) => void,
  pace?: (role: Role, task: TaskRevision) => Promise<void>
) {
  const identity = { taskId: task.id, taskRevision: task.revision };
  const records: StageRecord[] = [];

  async function run<T>(role: Role, work: (sessionId: string) => T | Promise<T>) {
    const behavior = defineBehavior<{ type: 'RUN_STAGE' }>()
      .withContext({ used: false })
      .onMessage(async ({ message, context, actor }) => {
        if (message?.type !== 'RUN_STAGE' || context.used) {
          return { reply: refuse('INVALID_STAGE_RUN') };
        }
        try {
          if (pace) await pace(role, { ...identity });
          return { context: { used: true }, reply: ok(await work(actor.id)) };
        } catch {
          return { context: { used: true }, reply: refuse('STAGE_FAILED') };
        }
      });
    const session = await system.spawn(behavior, {
      id: `${runId}-${role}`,
      supervision: { strategy: 'stop' },
    });
    const { id, revision } = team[role];
    const stage = { role, definition: { id, revision }, sessionAddress: session.address };
    observe({ ...identity, ...stage, status: 'running' });
    try {
      const result = await session.ask<Result<T>>({ type: 'RUN_STAGE' }, 2_000);
      return { stage, result };
    } finally {
      await session.stop();
    }
  }

  function settle<F extends StageFact>(stage: StageSession, result: Result<F>): Result<F> {
    if (result.ok) {
      records.push({ ...stage, fact: result.value });
      observe({ ...identity, ...stage, status: 'completed', fact: result.value });
    } else {
      observe({ ...identity, ...stage, status: 'refused', reason: result.reason });
    }
    return result;
  }

  async function step<T, F extends StageFact>(
    role: F['kind'],
    work: () => T | Promise<T>,
    accept: (value: T) => Result<F>
  ) {
    const { stage, result } = await run(role, work);
    return settle(stage, result.ok ? accept(result.value) : result);
  }

  return { run, settle, step, records };
}
