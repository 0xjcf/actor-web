import { dependsOn, lattice } from '@actor-web/lattice';
import { actor, defineActorWebTopology, node, supervisor, tool } from '@actor-web/runtime/topology';
import {
  createFasHybridCoordinatorBehavior,
  createFasLatticeImplementerBehavior,
  createFasLatticePlannerBehavior,
  createFasLatticeReviewerBehavior,
  createFasLatticeVerifierBehavior,
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

    workspace: lattice({
      id: 'fas-workspace-lattice',
      node: 'coordinator',
    }),

    latticePlanner: dependsOn({
      id: 'fas-lattice-planner-agent',
      node: 'worker',
      behavior: createFasLatticePlannerBehavior,
      dependencies: [
        {
          id: 'planner-observes-task-brief',
          lattice: 'workspace',
          requires: [{ type: 'task.brief' }],
        },
      ],
    }),

    latticeImplementer: dependsOn({
      id: 'fas-lattice-implementer-agent',
      node: 'worker',
      behavior: createFasLatticeImplementerBehavior,
      dependencies: [
        {
          id: 'implementer-observes-execution-plan',
          lattice: 'workspace',
          requires: [{ type: 'execution.plan' }],
        },
        {
          id: 'implementer-observes-review-findings',
          lattice: 'workspace',
          mode: 'everyVersion',
          requires: [{ type: 'review.findings' }],
        },
      ],
    }),

    latticeVerifier: dependsOn({
      id: 'fas-lattice-verifier-agent',
      node: 'worker',
      behavior: createFasLatticeVerifierBehavior,
      dependencies: [
        {
          id: 'verifier-observes-implementation-patch',
          lattice: 'workspace',
          mode: 'everyVersion',
          requires: [{ type: 'implementation.patch' }],
        },
      ],
    }),

    latticeReviewer: dependsOn({
      id: 'fas-lattice-reviewer-agent',
      node: 'worker',
      behavior: createFasLatticeReviewerBehavior,
      dependencies: [
        {
          id: 'reviewer-observes-verification-result',
          lattice: 'workspace',
          mode: 'everyVersion',
          requires: [{ type: 'verification.result' }],
        },
      ],
    }),

    hybridCoordinator: dependsOn({
      id: 'fas-hybrid-coordinator',
      node: 'coordinator',
      behavior: createFasHybridCoordinatorBehavior,
      dependencies: [
        {
          id: 'hybrid-coordinator-observes-review-approved',
          lattice: 'workspace',
          requires: [{ type: 'review.approved' }],
        },
      ],
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

    latticeEnvironment: supervisor({
      node: 'coordinator',
      strategy: 'one-for-one',
      children: ['workspace', 'hybridCoordinator'],
    }),

    latticeAgents: supervisor({
      node: 'worker',
      strategy: 'one-for-one',
      children: ['latticePlanner', 'latticeImplementer', 'latticeVerifier', 'latticeReviewer'],
    }),
  },
});
