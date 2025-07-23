/**
 * @module actor-core/runtime/examples/supervisor-tree-example
 * @description Examples demonstrating supervisor trees for fault tolerance
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import { assign, setup } from 'xstate';
import {
  createSupervisorTree,
  type SupervisorTreeConfig,
  SupervisorTreePatterns,
} from '../actors/supervisor-tree.js';
import { createActorRef } from '../create-actor-ref.js';
import { Logger } from '../logger.js';

// Setup logging
const log = Logger.namespace('SUPERVISOR_TREE_EXAMPLE');

// ========================================================================================
// EXAMPLE ACTOR MACHINES
// ========================================================================================

/**
 * A worker actor that can fail randomly
 */
const workerMachine = setup({
  types: {
    context: {} as {
      workerId: string;
      tasksCompleted: number;
      shouldFail: boolean;
    },
    events: {} as
      | { type: 'PROCESS_TASK'; task: string }
      | { type: 'FAIL_DELIBERATELY' }
      | { type: 'RESET' },
  },
  actions: {
    processTask: assign({
      tasksCompleted: ({ context }) => context.tasksCompleted + 1,
    }),

    failDeliberately: assign({
      shouldFail: () => true,
    }),

    reset: assign({
      tasksCompleted: () => 0,
      shouldFail: () => false,
    }),
  },
}).createMachine({
  id: 'worker',
  initial: 'idle',
  context: {
    workerId: '',
    tasksCompleted: 0,
    shouldFail: false,
  },
  states: {
    idle: {
      on: {
        PROCESS_TASK: {
          target: 'processing',
          actions: 'processTask',
        },
        FAIL_DELIBERATELY: {
          actions: 'failDeliberately',
        },
        RESET: {
          actions: 'reset',
        },
      },
    },
    processing: {
      entry: ({ context }) => {
        if (context.shouldFail) {
          throw new Error(`Worker ${context.workerId} failed deliberately`);
        }
        log.info(`Worker ${context.workerId} completed task`, {
          tasksCompleted: context.tasksCompleted,
        });
      },
      always: 'idle',
    },
  },
});

/**
 * A coordinator actor that manages workers
 */
const coordinatorMachine = setup({
  types: {
    context: {} as {
      coordinatorId: string;
      workers: string[];
      tasksAssigned: number;
    },
    events: {} as
      | { type: 'ASSIGN_TASK'; workerId: string; task: string }
      | { type: 'WORKER_FAILED'; workerId: string }
      | { type: 'WORKER_RECOVERED'; workerId: string },
  },
  actions: {
    assignTask: assign({
      tasksAssigned: ({ context }) => context.tasksAssigned + 1,
    }),

    handleWorkerFailure: assign({
      workers: ({ context, event }) => {
        const { workerId } = event;
        log.warn(`Coordinator ${context.coordinatorId} handling worker failure`, { workerId });
        return context.workers.filter((id) => id !== workerId);
      },
    }),

    handleWorkerRecovery: assign({
      workers: ({ context, event }) => {
        const { workerId } = event;
        log.info(`Coordinator ${context.coordinatorId} handling worker recovery`, { workerId });
        return [...context.workers, workerId];
      },
    }),
  },
}).createMachine({
  id: 'coordinator',
  initial: 'active',
  context: {
    coordinatorId: '',
    workers: [],
    tasksAssigned: 0,
  },
  states: {
    active: {
      on: {
        ASSIGN_TASK: {
          actions: 'assignTask',
        },
        WORKER_FAILED: {
          actions: 'handleWorkerFailure',
        },
        WORKER_RECOVERED: {
          actions: 'handleWorkerRecovery',
        },
      },
    },
  },
});

// ========================================================================================
// SUPERVISOR TREE EXAMPLES
// ========================================================================================

/**
 * Example 1: Simple hierarchical supervisor tree
 */
export async function demonstrateSimpleHierarchy(): Promise<void> {
  log.info('🌳 Simple Hierarchy Example');

  // Create a simple 3-level hierarchy
  const treeConfig: SupervisorTreeConfig = {
    root: {
      id: 'root',
      strategy: 'escalate',
      children: [
        {
          id: 'coordinator-supervisor',
          strategy: 'restart-on-failure',
          children: [
            {
              id: 'worker-supervisor',
              strategy: 'restart-on-failure',
              options: {
                maxRestarts: 3,
                restartDelay: 1000,
              },
            },
          ],
        },
      ],
    },
    defaultOptions: {
      maxRestarts: 5,
      restartWindow: 60000,
    },
    onUnhandledFailure: (error, actorId, supervisorPath) => {
      log.error('Unhandled failure in hierarchy', {
        error: error.message,
        actorId,
        supervisorPath,
      });
    },
  };

  const tree = createSupervisorTree(treeConfig);

  // Create some actors
  const coordinatorActor = createActorRef(coordinatorMachine, {
    id: 'coordinator-1',
    input: { coordinatorId: 'coordinator-1' },
  });

  const workerActor1 = createActorRef(workerMachine, {
    id: 'worker-1',
    input: { workerId: 'worker-1' },
  });

  const workerActor2 = createActorRef(workerMachine, {
    id: 'worker-2',
    input: { workerId: 'worker-2' },
  });

  // Start actors
  coordinatorActor.start();
  workerActor1.start();
  workerActor2.start();

  // Supervise actors at different levels
  tree.supervise(coordinatorActor, 'coordinator-supervisor');
  tree.supervise(workerActor1, 'worker-supervisor');
  tree.supervise(workerActor2, 'worker-supervisor');

  // Show tree structure
  log.info('Tree structure:', tree.getStructure());

  // Simulate some work
  workerActor1.send({ type: 'PROCESS_TASK', task: 'task-1' } as {
    type: 'PROCESS_TASK';
    task: string;
  });
  workerActor2.send({ type: 'PROCESS_TASK', task: 'task-2' } as {
    type: 'PROCESS_TASK';
    task: string;
  });

  // Wait a bit
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Simulate a failure
  log.info('Simulating worker failure...');
  workerActor1.send({ type: 'FAIL_DELIBERATELY' });

  // This should trigger the supervisor to restart the worker
  try {
    workerActor1.send({ type: 'PROCESS_TASK', task: 'task-3' } as {
      type: 'PROCESS_TASK';
      task: string;
    });
  } catch (_error) {
    log.info('Worker failure handled by supervisor tree');
  }

  // Wait for potential restart
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Show final stats
  log.info('Final tree stats:', tree.getStats());

  // Cleanup
  await coordinatorActor.stop();
  await workerActor1.stop();
  await workerActor2.stop();
  tree.cleanup();

  log.info('✅ Simple hierarchy example completed');
}

/**
 * Example 2: One-for-one supervision pattern
 */
export async function demonstrateOneForOne(): Promise<void> {
  log.info('👥 One-for-One Pattern Example');

  const treeConfig: SupervisorTreeConfig = {
    root: SupervisorTreePatterns.oneForOne('one-for-one-supervisor', 'restart-on-failure'),
    defaultOptions: {
      maxRestarts: 3,
      restartDelay: 500,
    },
  };

  const tree = createSupervisorTree(treeConfig);

  // Create multiple worker actors
  const workers = Array.from({ length: 3 }, (_, i) => {
    const actor = createActorRef(workerMachine, {
      id: `worker-${i + 1}`,
      input: { workerId: `worker-${i + 1}` },
    });
    actor.start();
    return actor;
  });

  // Supervise all workers under the same supervisor
  workers.forEach((worker) => {
    tree.supervise(worker, 'one-for-one-supervisor');
  });

  log.info('All workers supervised under one-for-one pattern');

  // Process some tasks
  workers.forEach((worker, i) => {
    worker.send({ type: 'PROCESS_TASK', task: `task-${i + 1}` } as {
      type: 'PROCESS_TASK';
      task: string;
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Fail one worker - only it should be restarted
  log.info('Failing worker-2...');
  workers[1].send({ type: 'FAIL_DELIBERATELY' });

  try {
    workers[1].send({ type: 'PROCESS_TASK', task: 'failing-task' } as {
      type: 'PROCESS_TASK';
      task: string;
    });
  } catch (_error) {
    log.info('Worker-2 failure handled, other workers continue');
  }

  // Other workers should continue working
  workers[0].send({ type: 'PROCESS_TASK', task: 'task-after-failure' } as {
    type: 'PROCESS_TASK';
    task: string;
  });
  workers[2].send({ type: 'PROCESS_TASK', task: 'task-after-failure' } as {
    type: 'PROCESS_TASK';
    task: string;
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  log.info('Final stats:', tree.getStats());

  // Cleanup
  await Promise.all(workers.map((worker) => worker.stop()));
  tree.cleanup();

  log.info('✅ One-for-one pattern example completed');
}

/**
 * Example 3: Complex hierarchical tree with multiple strategies
 */
export async function demonstrateComplexHierarchy(): Promise<void> {
  log.info('🏗️ Complex Hierarchy Example');

  const treeConfig: SupervisorTreeConfig = {
    root: SupervisorTreePatterns.hierarchical('application-root', [
      {
        id: 'web-server-supervisor',
        strategy: 'restart-on-failure',
        children: [
          {
            id: 'request-handler-supervisor',
            strategy: 'restart-on-failure',
            options: { maxRestarts: 10, restartDelay: 100 },
          },
          {
            id: 'middleware-supervisor',
            strategy: 'stop-on-failure',
          },
        ],
      },
      {
        id: 'database-supervisor',
        strategy: 'escalate',
        children: [
          {
            id: 'connection-pool-supervisor',
            strategy: 'restart-on-failure',
            options: { maxRestarts: 5, restartDelay: 2000 },
          },
          {
            id: 'query-executor-supervisor',
            strategy: 'restart-on-failure',
          },
        ],
      },
      {
        id: 'background-jobs-supervisor',
        strategy: 'restart-on-failure',
        children: [
          {
            id: 'job-queue-supervisor',
            strategy: 'restart-on-failure',
          },
          {
            id: 'job-worker-supervisor',
            strategy: 'restart-on-failure',
          },
        ],
      },
    ]),
    onUnhandledFailure: (error, actorId, supervisorPath) => {
      log.error('CRITICAL: Unhandled failure in application', {
        error: error.message,
        actorId,
        supervisorPath,
      });
      // In a real application, this might trigger alerts, graceful shutdown, etc.
    },
  };

  const tree = createSupervisorTree(treeConfig);

  // Create actors for different parts of the system
  const actors = [
    {
      actor: createActorRef(workerMachine, { id: 'request-handler-1' }),
      supervisor: 'request-handler-supervisor',
    },
    {
      actor: createActorRef(workerMachine, { id: 'request-handler-2' }),
      supervisor: 'request-handler-supervisor',
    },
    {
      actor: createActorRef(workerMachine, { id: 'middleware-1' }),
      supervisor: 'middleware-supervisor',
    },
    {
      actor: createActorRef(workerMachine, { id: 'db-connection-1' }),
      supervisor: 'connection-pool-supervisor',
    },
    {
      actor: createActorRef(workerMachine, { id: 'db-connection-2' }),
      supervisor: 'connection-pool-supervisor',
    },
    {
      actor: createActorRef(workerMachine, { id: 'query-executor-1' }),
      supervisor: 'query-executor-supervisor',
    },
    {
      actor: createActorRef(workerMachine, { id: 'job-queue-1' }),
      supervisor: 'job-queue-supervisor',
    },
    {
      actor: createActorRef(workerMachine, { id: 'job-worker-1' }),
      supervisor: 'job-worker-supervisor',
    },
    {
      actor: createActorRef(workerMachine, { id: 'job-worker-2' }),
      supervisor: 'job-worker-supervisor',
    },
  ];

  // Start all actors and supervise them
  actors.forEach(({ actor, supervisor }) => {
    actor.start();
    tree.supervise(actor, supervisor);
  });

  log.info('Complex application hierarchy created');
  log.info('Tree structure:', tree.getStructure());

  // Simulate normal operation
  actors.forEach(({ actor }) => {
    actor.send({ type: 'PROCESS_TASK', task: 'normal-operation' } as {
      type: 'PROCESS_TASK';
      task: string;
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Simulate various failures
  log.info('Simulating request handler failure...');
  actors[0].actor.send({ type: 'FAIL_DELIBERATELY' });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  log.info('Simulating database connection failure...');
  actors[3].actor.send({ type: 'FAIL_DELIBERATELY' });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  log.info('Simulating job worker failure...');
  actors[7].actor.send({ type: 'FAIL_DELIBERATELY' });

  await new Promise((resolve) => setTimeout(resolve, 2000));

  log.info('Final system stats:', tree.getStats());

  // Cleanup
  await Promise.all(actors.map(({ actor }) => actor.stop()));
  tree.cleanup();

  log.info('✅ Complex hierarchy example completed');
}

// ========================================================================================
// MAIN EXAMPLE RUNNER
// ========================================================================================

/**
 * Run all supervisor tree examples
 */
export async function runSupervisorTreeExamples(): Promise<void> {
  try {
    log.info('🚀 Starting Supervisor Tree Examples');

    await demonstrateSimpleHierarchy();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await demonstrateOneForOne();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await demonstrateComplexHierarchy();

    log.info('✅ All supervisor tree examples completed successfully');
  } catch (error) {
    log.error('❌ Supervisor tree examples failed:', error);
    throw error;
  }
}

// Export for use in tests or demos
export { runSupervisorTreeExamples as default };

// Run the examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runSupervisorTreeExamples().catch(console.error);
}
