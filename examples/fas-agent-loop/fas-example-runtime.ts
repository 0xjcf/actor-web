import type { ActorRef, StartedActorWebNode } from '@actor-core/runtime/browser';
import { createIgniteActorSource, startActorWebNode } from '@actor-core/runtime/browser';
import type {
  FasPatch,
  FasPlan,
  FasReviewResult,
  FasTaskBoardCommand,
  FasTaskBoardContext,
  FasTaskCommand,
  FasTaskContext,
  FasTaskEvent,
  FasTaskSummary,
  FasToolInvocation,
  FasValidationResult,
} from './fas-contract';
import { taskContextToSummary } from './fas-contract';
import { createFasTaskDashboard } from './fas-dashboard';
import {
  createDeterministicFasTools,
  type DeterministicFasToolOptions,
  type DeterministicFasTools,
} from './fas-tool-adapters';
import { fasAgentLoop } from './fas-topology';

export interface FasAgentLoopExampleOptions {
  readonly tools?: DeterministicFasToolOptions;
}

export interface SubmitFasTaskInput {
  readonly taskId: string;
  readonly title: string;
  readonly prompt: string;
}

type TaskRunRef = ActorRef<FasTaskContext, FasTaskCommand>;
type TaskBoardRef = ActorRef<FasTaskBoardContext, FasTaskBoardCommand>;
type FasStartedNode = StartedActorWebNode<typeof fasAgentLoop>;

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

type FasTaskDashboard = ReturnType<typeof createFasTaskDashboard>;

export interface FasAgentLoopExampleRuntime {
  readonly tools: DeterministicFasTools;
  readonly taskBoard: TaskBoardRef;
  submitTask(input: SubmitFasTaskInput): Promise<TaskRunRef>;
  runTaskToCompletion(input: SubmitFasTaskInput): Promise<FasTaskSummary>;
  getTask(taskId: string): Promise<TaskRunRef | undefined>;
  createTaskBoardSource(): ReturnType<typeof createFasTaskBoardSource>;
  createDashboard(): FasTaskDashboard;
  stop(): Promise<void>;
}

function createFasTaskBoardSource(taskBoard: TaskBoardRef) {
  return createIgniteActorSource<FasTaskBoardContext, FasTaskBoardCommand, FasTaskEvent>(taskBoard);
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

export async function startFasAgentLoopExample(
  options: FasAgentLoopExampleOptions = {}
): Promise<FasAgentLoopExampleRuntime> {
  const tools = createDeterministicFasTools(options.tools);
  const coordinator = await startActorWebNode(fasAgentLoop, {
    node: 'coordinator',
    tools: tools.registry,
  });
  const worker = await startActorWebNode(fasAgentLoop, {
    node: 'worker',
    tools: tools.registry,
  });
  const nodes = { coordinator, worker };
  const taskBoard = coordinator.requireActor('taskBoard');
  const taskRuns = new Map<string, TaskRunRef>();

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
      const planner = worker.actors.plannerAgent.require();
      const { plan } = await planner.ask<{ plan: FasPlan }>(
        {
          type: 'PLAN_TASK',
          ...input,
        },
        500
      );
      await taskRun.ask({ type: 'REQUEST_PLAN', plan }, 500);
      await upsertBoard(nodes, taskRun);

      for (let attempt = taskRun.getSnapshot().context.attempts + 1; attempt <= 3; attempt += 1) {
        const implementer = worker.actors.implementerAgent.require();
        const implementation = await implementer.ask<PatchAgentReply>(
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

        const verifier = worker.actors.verifierAgent.require();
        const verification = await verifier.ask<ValidationAgentReply>(
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

        const reviewer = worker.actors.reviewerAgent.require();
        const review = await reviewer.ask<ReviewAgentReply>(
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
          reason: 'FAS loop exhausted deterministic retries.',
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
    tools,
    taskBoard,
    submitTask,
    runTaskToCompletion,
    getTask: async (taskId) => taskRuns.get(taskId),
    createTaskBoardSource: () => createFasTaskBoardSource(taskBoard),
    createDashboard: () =>
      createFasTaskDashboard(createFasTaskBoardSource(taskBoard), {
        runTask: runTaskToCompletion,
      }),
    stop: async () => {
      await worker.stop();
      await coordinator.stop();
    },
  };
}
