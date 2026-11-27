import { dependsOn, lattice } from '@actor-web/lattice';
import { defineTopology, supervisor } from '@actor-web/runtime/topology';
import {
  createFasHybridCoordinatorBehavior,
  createFasLatticeImplementerBehavior,
  createFasLatticePlannerBehavior,
  createFasLatticeReviewerBehavior,
  createFasLatticeVerifierBehavior,
} from './fas-behaviors';
import { fasOrchestrationConfig } from './fas-orchestration-topology';

export { FAS_COORDINATOR_NODE, FAS_WORKER_NODE } from './fas-orchestration-topology';

export const fasAgentLoop = defineTopology({
  ...fasOrchestrationConfig,
  actors: {
    ...fasOrchestrationConfig.actors,

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
    ...fasOrchestrationConfig.supervisors,

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
