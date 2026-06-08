import { actor, defineActorWebTopology, node, supervisor, tool } from '@actor-web/runtime/topology';
import {
  createFasSupervisorBehavior,
  createImplementerAgentBehavior,
  createPlannerAgentBehavior,
  createReviewerAgentBehavior,
  createTaskBoardBehavior,
  createTaskRunBehavior,
  createVerifierAgentBehavior,
} from './fas-behaviors';
import { FAS_AGENT_TOOL_ACCESS, FAS_TOOL_NAMES, type FasTaskContext } from './fas-contract';
import type { FasToolRegistry } from './fas-tool-adapters';

export const FAS_COORDINATOR_NODE = 'fas-coordinator-runtime';
export const FAS_WORKER_NODE = 'fas-worker-runtime';

type TaskRunParams = Pick<FasTaskContext, 'taskId' | 'title' | 'prompt'>;
const fasActor = actor.withTools<FasToolRegistry>();

export const fasAgentLoop = defineActorWebTopology({
  contractVersion: '0.1.0',

  nodes: {
    coordinator: node(FAS_COORDINATOR_NODE),
    worker: node(FAS_WORKER_NODE),
  },

  tools: FAS_TOOL_NAMES.map((name) => tool(name)),

  actors: {
    supervisor: actor({
      id: 'fas-supervisor',
      node: 'coordinator',
      behavior: createFasSupervisorBehavior,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
    }),

    taskBoard: actor({
      id: 'fas-task-board',
      node: 'coordinator',
      behavior: createTaskBoardBehavior,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
      gateway: true,
    }),

    taskRun: actor({
      id: (params: TaskRunParams) => `fas-task-${params.taskId}`,
      node: 'coordinator',
      behavior: (params: TaskRunParams) => createTaskRunBehavior(params),
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
    }),

    plannerAgent: fasActor({
      id: 'fas-planner-agent',
      node: 'worker',
      behavior: createPlannerAgentBehavior,
      tools: FAS_AGENT_TOOL_ACCESS.planner,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
    }),

    implementerAgent: fasActor({
      id: 'fas-implementer-agent',
      node: 'worker',
      behavior: createImplementerAgentBehavior,
      tools: FAS_AGENT_TOOL_ACCESS.implementer,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
    }),

    verifierAgent: fasActor({
      id: 'fas-verifier-agent',
      node: 'worker',
      behavior: createVerifierAgentBehavior,
      tools: FAS_AGENT_TOOL_ACCESS.verifier,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
    }),

    reviewerAgent: fasActor({
      id: 'fas-reviewer-agent',
      node: 'worker',
      behavior: createReviewerAgentBehavior,
      tools: FAS_AGENT_TOOL_ACCESS.reviewer,
      supervision: {
        strategy: 'restart',
        maxRestarts: 3,
        withinMs: 60_000,
      },
    }),
  },

  supervisors: {
    coordinatorWorkflow: supervisor({
      node: 'coordinator',
      strategy: 'one-for-one',
      children: ['supervisor', 'taskBoard', 'taskRun'],
    }),

    workerAgents: supervisor({
      node: 'worker',
      strategy: 'one-for-one',
      children: ['plannerAgent', 'implementerAgent', 'verifierAgent', 'reviewerAgent'],
    }),
  },
});
