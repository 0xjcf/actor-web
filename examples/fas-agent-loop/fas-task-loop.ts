import type {
  ActorRef,
  ClosableActorWebSource,
  StartedActorWebNode,
} from '@actor-web/runtime/browser';
import {
  type FasPatch,
  type FasPlan,
  type FasReviewResult,
  type FasTaskBoardCommand,
  type FasTaskBoardContext,
  type FasTaskCommand,
  type FasTaskContext,
  type FasTaskEvent,
  type FasTaskSummary,
  type FasToolInvocation,
  type FasValidationResult,
  type ImplementerAgentCommand,
  type PlannerAgentCommand,
  type ReviewerAgentCommand,
  taskContextToSummary,
  type VerifierAgentCommand,
} from './fas-contract';
import { createFasTaskDashboard } from './fas-dashboard';
import type { fasOrchestration } from './fas-orchestration-topology';

export interface SubmitFasTaskInput {
  readonly taskId: string;
  readonly title: string;
  readonly prompt: string;
}

type TaskRunRef = ActorRef<FasTaskContext, FasTaskCommand>;
type FasStartedNode = StartedActorWebNode<typeof fasOrchestration>;
type FasTaskBoardSource = ClosableActorWebSource<
  FasTaskBoardContext,
  FasTaskBoardCommand,
  FasTaskEvent
>;

export interface FasAgentPorts {
  readonly planner: ActorRef<unknown, PlannerAgentCommand>;
  readonly implementer: ActorRef<unknown, ImplementerAgentCommand>;
  readonly verifier: ActorRef<unknown, VerifierAgentCommand>;
  readonly reviewer: ActorRef<unknown, ReviewerAgentCommand>;
}

interface FasTaskLoopHost {
  readonly coordinator: FasStartedNode;
  readonly worker: FasStartedNode;
  readonly agents: FasAgentPorts;
  createTaskBoardSource(): FasTaskBoardSource;
  stop(): Promise<void>;
}

interface PatchAgentReply {
  readonly patch: FasPatch;
  readonly toolCall: FasToolInvocation;
}

interface ValidationAgentReply {
  readonly result: FasValidationResult;
  readonly toolCall: FasToolInvocation;
}

interface ReviewAgentReply {
  readonly result: FasReviewResult;
  readonly toolCall: FasToolInvocation;
}

async function flush(nodes: {
  readonly coordinator: FasStartedNode;
  readonly worker: FasStartedNode;
}): Promise<void> {
  await nodes.coordinator.system.flush();
  await nodes.worker.system.flush();
}

async function upsertBoard(
  nodes: {
    readonly coordinator: FasStartedNode;
    readonly worker: FasStartedNode;
  },
  task: TaskRunRef
): Promise<FasTaskSummary> {
  const summary = taskContextToSummary(task.getSnapshot().context);
  await nodes.coordinator.requireActor('taskBoard').ask(
    {
      type: 'UPSERT_TASK_SUMMARY',
      task: summary,
    },
    500
  );
  await flush(nodes);
  return summary;
}

export function createFasTaskLoop(host: FasTaskLoopHost) {
  const { coordinator, agents } = host;
  const nodes = host;
  const taskBoard = coordinator.requireActor('taskBoard');
  const taskRuns = new Map<string, TaskRunRef>();
  const taskBoardSources = new Set<FasTaskBoardSource>();
  const createTrackedTaskBoardSource = (): FasTaskBoardSource => {
    const source = host.createTaskBoardSource();
    let closed = false;
    const trackedSource: FasTaskBoardSource = {
      ...source,
      close() {
        if (closed) {
          return;
        }
        closed = true;
        taskBoardSources.delete(trackedSource);
        source.close();
      },
    };
    taskBoardSources.add(trackedSource);
    return trackedSource;
  };

  const submitTask = async (input: SubmitFasTaskInput): Promise<TaskRunRef> => {
    const existing = taskRuns.get(input.taskId);
    if (existing) {
      return existing;
    }

    await coordinator.requireActor('supervisor').ask(
      {
        type: 'TASK_SUBMITTED',
        taskId: input.taskId,
      },
      500
    );
    await taskBoard.ask({ type: 'SUBMIT_TASK', ...input }, 500);
    const taskRun = await coordinator.actors.taskRun.instance(input);
    taskRuns.set(input.taskId, taskRun);
    await upsertBoard(nodes, taskRun);
    return taskRun;
  };

  const runTaskToCompletion = async (input: SubmitFasTaskInput): Promise<FasTaskSummary> => {
    const taskRun = await submitTask(input);

    try {
      const { plan } = await agents.planner.ask<{ plan: FasPlan }>(
        {
          type: 'PLAN_TASK',
          ...input,
        },
        500
      );
      await taskRun.ask({ type: 'REQUEST_PLAN', plan }, 500);
      await upsertBoard(nodes, taskRun);

      for (let attempt = taskRun.getSnapshot().context.attempts + 1; attempt <= 3; attempt += 1) {
        const implementation = await agents.implementer.ask<PatchAgentReply>(
          {
            type: 'IMPLEMENT_TASK',
            taskId: input.taskId,
            plan,
            attempt,
          },
          500
        );
        await taskRun.ask(
          {
            type: 'REQUEST_IMPLEMENTATION',
            patch: implementation.patch,
            toolCall: implementation.toolCall,
          },
          500
        );
        await upsertBoard(nodes, taskRun);

        const verification = await agents.verifier.ask<ValidationAgentReply>(
          {
            type: 'VERIFY_TASK',
            taskId: input.taskId,
            patch: implementation.patch,
          },
          500
        );
        await taskRun.ask(
          {
            type: 'REQUEST_VALIDATION',
            result: verification.result,
            toolCall: verification.toolCall,
          },
          500
        );
        await upsertBoard(nodes, taskRun);

        if (!verification.result.ok) {
          continue;
        }

        const review = await agents.reviewer.ask<ReviewAgentReply>(
          {
            type: 'REVIEW_TASK',
            taskId: input.taskId,
            patch: implementation.patch,
            validation: verification.result,
          },
          500
        );
        await taskRun.ask(
          {
            type: 'REQUEST_REVIEW',
            result: review.result,
            toolCall: review.toolCall,
          },
          500
        );
        const summary = await upsertBoard(nodes, taskRun);
        if (summary.phase === 'completed') {
          return summary;
        }
      }

      await taskRun.ask(
        {
          type: 'BLOCK_TASK',
          reason: 'Workflow reached its retry limit.',
        },
        500
      );
      return upsertBoard(nodes, taskRun);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown deterministic tool failure';
      try {
        await taskRun.ask(
          {
            type: 'BLOCK_TASK',
            reason,
          },
          500
        );
        return upsertBoard(nodes, taskRun);
      } catch {
        throw error;
      }
    }
  };

  return {
    taskBoard,
    submitTask,
    runTaskToCompletion,
    getTask: async (taskId: string) => taskRuns.get(taskId),
    createTaskBoardSource: createTrackedTaskBoardSource,
    createDashboard: () => {
      const source = createTrackedTaskBoardSource();
      return createFasTaskDashboard(source, {
        runTask: runTaskToCompletion,
      });
    },
    stop: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (const source of Array.from(taskBoardSources)) {
        source.close();
      }
      taskBoardSources.clear();
      await host.stop();
    },
  };
}
