import type {
  ActorRef,
  ActorWebGatewaySocket,
  ClosableActorWebSource,
} from '@actor-web/runtime/browser';
import type { ServedActorWebNode } from '@actor-web/runtime/node';
import { serveActorWebNode } from '@actor-web/runtime/node';
import type {
  FasAgentRole,
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
  ImplementerAgentCommand,
  PlannerAgentCommand,
  ReviewerAgentCommand,
  VerifierAgentCommand,
} from './fas-contract';
import { FAS_AGENT_TOOL_ACCESS, taskContextToSummary } from './fas-contract';
import { createFasTaskDashboard } from './fas-dashboard';
import {
  createDeterministicFasTools,
  type DeterministicFasToolOptions,
  type DeterministicFasTools,
} from './fas-tool-adapters';
import { FAS_WORKER_NODE, fasAgentLoop } from './fas-topology';

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
type FasServedNode = ServedActorWebNode<typeof fasAgentLoop>;
type PlannerAgentRef = ActorRef<unknown, PlannerAgentCommand>;
type ImplementerAgentRef = ActorRef<unknown, ImplementerAgentCommand>;
type VerifierAgentRef = ActorRef<unknown, VerifierAgentCommand>;
type ReviewerAgentRef = ActorRef<unknown, ReviewerAgentCommand>;
type GatewaySocketFactory = (url: string) => ActorWebGatewaySocket;

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
  getRuntimeTopology(): FasAgentLoopRuntimeTopology;
  submitTask(input: SubmitFasTaskInput): Promise<TaskRunRef>;
  runTaskToCompletion(input: SubmitFasTaskInput): Promise<FasTaskSummary>;
  getTask(taskId: string): Promise<TaskRunRef | undefined>;
  createTaskBoardSource(): ReturnType<typeof createFasTaskBoardSource>;
  createDashboard(): FasTaskDashboard;
  stop(): Promise<void>;
}

export interface FasAgentLoopRuntimeTopology {
  readonly coordinatorNode: string;
  readonly workerNode: string;
  readonly gatewayUrl: string;
  readonly coordinatorTransportUrl: string;
  readonly workerTransportUrl: string;
  readonly workerPeer: ReturnType<FasServedNode['getPeerStatus']>;
  readonly toolPorts: Readonly<Record<FasAgentRole, readonly string[]>>;
}

function createFasTaskBoardSource(
  gatewayUrl: string,
  createSocket: GatewaySocketFactory
): ClosableActorWebSource<FasTaskBoardContext, FasTaskBoardCommand, FasTaskEvent> {
  return fasAgentLoop.actors.taskBoard.source({
    gateway: {
      url: gatewayUrl,
    },
    createSocket,
  });
}

async function resolveGatewaySocketFactory(): Promise<GatewaySocketFactory> {
  if (typeof globalThis.WebSocket !== 'undefined') {
    return (url) => new globalThis.WebSocket(url) as ActorWebGatewaySocket;
  }

  const { WebSocket: NodeWebSocket } = await import('ws');
  return (url) => new NodeWebSocket(url) as unknown as ActorWebGatewaySocket;
}

async function flush(nodes: {
  readonly coordinator: FasServedNode;
  readonly worker: FasServedNode;
}): Promise<void> {
  await nodes.coordinator.system.flush();
  await nodes.worker.system.flush();
}

async function upsertBoard(
  nodes: {
    readonly coordinator: FasServedNode;
    readonly worker: FasServedNode;
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

async function waitForWorkerPeer(coordinator: FasServedNode): Promise<void> {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const status = coordinator.getPeerStatus(FAS_WORKER_NODE);
    if (status.connected && status.fresh) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('Timed out waiting for FAS worker runtime peer connection.');
}

async function requireRemoteActor<TRef extends ActorRef>(
  coordinator: FasServedNode,
  path: string,
  label: string
): Promise<TRef> {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const actorRef = await coordinator.system.lookup(path);
    if (actorRef) {
      return actorRef as TRef;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out resolving remote FAS actor "${label}".`);
}

async function createAgentPorts(coordinator: FasServedNode): Promise<{
  readonly planner: PlannerAgentRef;
  readonly implementer: ImplementerAgentRef;
  readonly verifier: VerifierAgentRef;
  readonly reviewer: ReviewerAgentRef;
}> {
  const [planner, implementer, verifier, reviewer] = await Promise.all([
    requireRemoteActor<PlannerAgentRef>(
      coordinator,
      fasAgentLoop.actors.plannerAgent.address.path,
      'plannerAgent'
    ),
    requireRemoteActor<ImplementerAgentRef>(
      coordinator,
      fasAgentLoop.actors.implementerAgent.address.path,
      'implementerAgent'
    ),
    requireRemoteActor<VerifierAgentRef>(
      coordinator,
      fasAgentLoop.actors.verifierAgent.address.path,
      'verifierAgent'
    ),
    requireRemoteActor<ReviewerAgentRef>(
      coordinator,
      fasAgentLoop.actors.reviewerAgent.address.path,
      'reviewerAgent'
    ),
  ]);

  return {
    planner,
    implementer,
    verifier,
    reviewer,
  };
}

export async function startFasAgentLoopExample(
  options: FasAgentLoopExampleOptions = {}
): Promise<FasAgentLoopExampleRuntime> {
  const tools = createDeterministicFasTools(options.tools);
  const worker = await serveActorWebNode(fasAgentLoop, {
    node: 'worker',
    transport: true,
    tools: tools.registry,
  });
  const coordinator = await serveActorWebNode(fasAgentLoop, {
    node: 'coordinator',
    transport: true,
    peers: {
      worker: worker.getTransportUrl() ?? '',
    },
    connect: ['worker'],
    gateway: {
      expose: ['taskBoard'],
    },
  });
  await waitForWorkerPeer(coordinator);
  const agents = await createAgentPorts(coordinator);
  const nodes = { coordinator, worker };
  const gatewayUrl = coordinator.getGatewayUrl();
  const coordinatorTransportUrl = coordinator.getTransportUrl();
  const workerTransportUrl = worker.getTransportUrl();
  if (!gatewayUrl || !coordinatorTransportUrl || !workerTransportUrl) {
    await coordinator.stop();
    await worker.stop();
    throw new Error('FAS agent loop runtime did not expose required gateway and transport URLs.');
  }
  const createSocket = await resolveGatewaySocketFactory();
  const taskBoard = coordinator.requireActor('taskBoard');
  const taskRuns = new Map<string, TaskRunRef>();
  const gatewaySockets = new Set<ActorWebGatewaySocket>();
  const createTrackedSocket: GatewaySocketFactory = (url) => {
    const socket = createSocket(url);
    gatewaySockets.add(socket);
    socket.addEventListener('close', () => {
      gatewaySockets.delete(socket);
    });
    return socket;
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
    getRuntimeTopology: () => ({
      coordinatorNode: fasAgentLoop.nodes.coordinator.address,
      workerNode: fasAgentLoop.nodes.worker.address,
      gatewayUrl,
      coordinatorTransportUrl,
      workerTransportUrl,
      workerPeer: coordinator.getPeerStatus(FAS_WORKER_NODE),
      toolPorts: {
        supervisor: [],
        planner: FAS_AGENT_TOOL_ACCESS.planner,
        implementer: FAS_AGENT_TOOL_ACCESS.implementer,
        verifier: FAS_AGENT_TOOL_ACCESS.verifier,
        reviewer: FAS_AGENT_TOOL_ACCESS.reviewer,
      },
    }),
    submitTask,
    runTaskToCompletion,
    getTask: async (taskId) => taskRuns.get(taskId),
    createTaskBoardSource: () => createFasTaskBoardSource(gatewayUrl, createTrackedSocket),
    createDashboard: () => {
      const source = createFasTaskBoardSource(gatewayUrl, createTrackedSocket);
      return createFasTaskDashboard(source, {
        runTask: runTaskToCompletion,
      });
    },
    stop: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (const socket of Array.from(gatewaySockets)) {
        socket.close();
      }
      gatewaySockets.clear();
      await coordinator.stop();
      await worker.stop();
    },
  };
}
