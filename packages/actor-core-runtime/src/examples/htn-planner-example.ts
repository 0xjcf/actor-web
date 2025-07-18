/**
 * @module actor-core/runtime/examples/htn-planner-example
 * @description Examples demonstrating Hierarchical Task Networks for AI agent planning
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import { assign, setup } from 'xstate';
import { createActorRef } from '../create-actor-ref.js';
import { Logger } from '../logger.js';
import {
  HTNPlanner,
  createCompoundTask,
  createCondition,
  createEffect,
  createPrimitiveTask,
  createTaskMethod,
  createWorldState,
} from '../planning/hierarchical-task-network.js';
import type { BaseEventObject } from '../types.js';

// Define proper event types for the HTN example
interface NavigationEvent extends BaseEventObject {
  type: 'MOVE_TO' | 'CALCULATE_ROUTE' | 'EXECUTE_MOVEMENT' | 'MOVEMENT_COMPLETE';
  location?: string;
  from?: string;
  to?: string;
  route?: string[];
}

interface ManipulationEvent extends BaseEventObject {
  type: 'PICK_UP' | 'PUT_DOWN' | 'USE_OBJECT' | 'ACTION_COMPLETE';
  object?: string;
  location?: string;
  target?: string;
}

interface PerceptionEvent extends BaseEventObject {
  type: 'OBSERVE' | 'SCAN_AREA' | 'DETECT_OBJECTS' | 'OBSERVATION_COMPLETE';
  target?: string;
  area?: string;
}

// Setup logging
const log = Logger.namespace('HTN_PLANNER_EXAMPLE');

// ========================================================================================
// EXAMPLE ACTOR MACHINES
// ========================================================================================

/**
 * Navigation actor for movement tasks
 */
const navigationMachine = setup({
  types: {
    context: {} as {
      currentLocation: string;
      targetLocation: string;
      route: string[];
    },
    events: {} as
      | { type: 'MOVE_TO'; location: string }
      | { type: 'CALCULATE_ROUTE'; from: string; to: string }
      | { type: 'EXECUTE_MOVEMENT'; route: string[] }
      | { type: 'MOVEMENT_COMPLETE' },
  },
  actions: {
    setTarget: assign({
      targetLocation: ({ event }) => {
        if (event.type === 'MOVE_TO') {
          return event.location;
        }
        return '';
      },
    }),

    calculateRoute: assign({
      route: ({ event }) => {
        if (event.type === 'CALCULATE_ROUTE') {
          // Simple route calculation
          return [event.from, event.to];
        }
        return [];
      },
    }),

    executeMovement: assign({
      currentLocation: ({ context }) => context.targetLocation,
      route: () => [],
    }),
  },
}).createMachine({
  id: 'navigation',
  initial: 'idle',
  context: {
    currentLocation: 'home',
    targetLocation: '',
    route: [],
  },
  states: {
    idle: {
      on: {
        MOVE_TO: {
          target: 'calculating',
          actions: 'setTarget',
        },
      },
    },
    calculating: {
      on: {
        CALCULATE_ROUTE: {
          target: 'moving',
          actions: 'calculateRoute',
        },
      },
    },
    moving: {
      on: {
        EXECUTE_MOVEMENT: {
          target: 'idle',
          actions: 'executeMovement',
        },
      },
    },
  },
});

/**
 * Manipulation actor for object interaction
 */
const manipulationMachine = setup({
  types: {
    context: {} as {
      heldObject: string | null;
      targetObject: string;
      actionType: string;
    },
    events: {} as
      | { type: 'PICK_UP'; object: string }
      | { type: 'PUT_DOWN'; object: string; location: string }
      | { type: 'USE_OBJECT'; object: string; target: string }
      | { type: 'ACTION_COMPLETE' },
  },
  actions: {
    pickUp: assign({
      heldObject: ({ event }) => {
        if (event.type === 'PICK_UP') {
          return event.object;
        }
        return null;
      },
    }),

    putDown: assign({
      heldObject: () => null,
    }),

    useObject: assign({
      actionType: ({ event }) => {
        if (event.type === 'USE_OBJECT') {
          return `using ${event.object} on ${event.target}`;
        }
        return '';
      },
    }),
  },
}).createMachine({
  id: 'manipulation',
  initial: 'idle',
  context: {
    heldObject: null,
    targetObject: '',
    actionType: '',
  },
  states: {
    idle: {
      on: {
        PICK_UP: {
          target: 'holding',
          actions: 'pickUp',
        },
        USE_OBJECT: {
          target: 'using',
          actions: 'useObject',
        },
      },
    },
    holding: {
      on: {
        PUT_DOWN: {
          target: 'idle',
          actions: 'putDown',
        },
        USE_OBJECT: {
          target: 'using',
          actions: 'useObject',
        },
      },
    },
    using: {
      on: {
        ACTION_COMPLETE: {
          target: 'idle',
        },
      },
    },
  },
});

/**
 * Perception actor for sensing tasks
 */
const perceptionMachine = setup({
  types: {
    context: {} as {
      lastObservation: string;
      sensorData: Record<string, unknown>;
    },
    events: {} as
      | { type: 'OBSERVE'; target: string }
      | { type: 'SCAN_AREA'; area: string }
      | { type: 'DETECT_OBJECTS'; area: string }
      | { type: 'OBSERVATION_COMPLETE' },
  },
  actions: {
    observe: assign({
      lastObservation: ({ event }) => {
        if (event.type === 'OBSERVE') {
          return `observed ${event.target}`;
        }
        return '';
      },
    }),

    scanArea: assign({
      sensorData: ({ event }) => {
        if (event.type === 'SCAN_AREA') {
          return { scannedArea: event.area, objects: ['table', 'chair', 'book'] };
        }
        return {};
      },
    }),
  },
}).createMachine({
  id: 'perception',
  initial: 'idle',
  context: {
    lastObservation: '',
    sensorData: {},
  },
  states: {
    idle: {
      on: {
        OBSERVE: {
          target: 'observing',
          actions: 'observe',
        },
        SCAN_AREA: {
          target: 'scanning',
          actions: 'scanArea',
        },
      },
    },
    observing: {
      on: {
        OBSERVATION_COMPLETE: {
          target: 'idle',
        },
      },
    },
    scanning: {
      on: {
        OBSERVATION_COMPLETE: {
          target: 'idle',
        },
      },
    },
  },
});

// ========================================================================================
// HTN PLANNING EXAMPLES
// ========================================================================================

/**
 * Example 1: Simple task planning for household robot
 */
export async function demonstrateSimpleTaskPlanning(): Promise<void> {
  log.info('🤖 Simple Task Planning Example');

  // Create actor instances
  const navigationActor = createActorRef(navigationMachine, { id: 'navigation' });
  const manipulationActor = createActorRef(manipulationMachine, { id: 'manipulation' });
  const perceptionActor = createActorRef(perceptionMachine, { id: 'perception' });

  // Start actors
  navigationActor.start();
  manipulationActor.start();
  perceptionActor.start();

  // Create HTN planner
  const planner = new HTNPlanner({
    maxDepth: 5,
    maxPlanningTime: 10000,
    enablePrioritization: true,
  });

  // Define world state
  const worldState = createWorldState(
    {
      robotLocation: 'living_room',
      bookLocation: 'table',
      tableLocation: 'living_room',
      shelfLocation: 'bedroom',
      robotHolding: null,
    },
    ['book_on_shelf'],
    {
      battery: 80,
      time: 100,
    }
  );

  // Define primitive tasks
  const moveToTable = createPrimitiveTask(
    'move_to_table',
    'Move to table',
    navigationActor,
    { type: 'MOVE_TO', location: 'table' } as NavigationEvent,
    {
      preconditions: [
        createCondition(
          'robot_not_at_table',
          'Robot is not at table',
          (state) => state.facts.get('robotLocation') !== 'table'
        ),
      ],
      effects: [
        createEffect('robot_at_table', 'Robot is at table', (state) => {
          const newState = { ...state };
          newState.facts.set('robotLocation', 'table');
          return newState;
        }),
      ],
      priority: 7,
    }
  );

  const pickUpBook = createPrimitiveTask(
    'pick_up_book',
    'Pick up book',
    manipulationActor,
    { type: 'PICK_UP', object: 'book' } as ManipulationEvent,
    {
      preconditions: [
        createCondition(
          'robot_at_table',
          'Robot is at table',
          (state) => state.facts.get('robotLocation') === 'table'
        ),
        createCondition(
          'book_on_table',
          'Book is on table',
          (state) => state.facts.get('bookLocation') === 'table'
        ),
        createCondition(
          'robot_hands_free',
          'Robot hands are free',
          (state) => state.facts.get('robotHolding') === null
        ),
      ],
      effects: [
        createEffect('robot_holding_book', 'Robot is holding book', (state) => {
          const newState = { ...state };
          newState.facts.set('robotHolding', 'book');
          newState.facts.set('bookLocation', 'robot');
          return newState;
        }),
      ],
      priority: 8,
    }
  );

  const moveToShelf = createPrimitiveTask(
    'move_to_shelf',
    'Move to shelf',
    navigationActor,
    { type: 'MOVE_TO', location: 'shelf' } as NavigationEvent,
    {
      preconditions: [
        createCondition(
          'robot_not_at_shelf',
          'Robot is not at shelf',
          (state) => state.facts.get('robotLocation') !== 'shelf'
        ),
      ],
      effects: [
        createEffect('robot_at_shelf', 'Robot is at shelf', (state) => {
          const newState = { ...state };
          newState.facts.set('robotLocation', 'shelf');
          return newState;
        }),
      ],
      priority: 7,
    }
  );

  const putBookOnShelf = createPrimitiveTask(
    'put_book_on_shelf',
    'Put book on shelf',
    manipulationActor,
    { type: 'PUT_DOWN', object: 'book', location: 'shelf' } as ManipulationEvent,
    {
      preconditions: [
        createCondition(
          'robot_at_shelf',
          'Robot is at shelf',
          (state) => state.facts.get('robotLocation') === 'shelf'
        ),
        createCondition(
          'robot_holding_book',
          'Robot is holding book',
          (state) => state.facts.get('robotHolding') === 'book'
        ),
      ],
      effects: [
        createEffect('book_on_shelf', 'Book is on shelf', (state) => {
          const newState = { ...state };
          newState.facts.set('bookLocation', 'shelf');
          newState.facts.set('robotHolding', null);
          return newState;
        }),
      ],
      priority: 9,
    }
  );

  // Define compound task with method
  const moveBookToShelfMethod = createTaskMethod(
    'move_book_method',
    'Move book to shelf method',
    (task, state) => {
      log.debug('Decomposing move book task', { state: Object.fromEntries(state.facts) });
      return [moveToTable, pickUpBook, moveToShelf, putBookOnShelf];
    },
    {
      preconditions: [
        createCondition(
          'book_exists',
          'Book exists',
          (state) => state.facts.get('bookLocation') !== undefined
        ),
      ],
      priority: 10,
    }
  );

  const moveBookToShelf = createCompoundTask(
    'move_book_to_shelf',
    'Move book to shelf',
    [moveBookToShelfMethod],
    {
      preconditions: [
        createCondition(
          'book_not_on_shelf',
          'Book is not on shelf',
          (state) => state.facts.get('bookLocation') !== 'shelf'
        ),
      ],
      effects: [
        createEffect('book_moved_to_shelf', 'Book moved to shelf', (state) => {
          const newState = { ...state };
          newState.goals.add('book_on_shelf');
          return newState;
        }),
      ],
      priority: 10,
    }
  );

  // Register tasks
  planner.registerTask(moveToTable);
  planner.registerTask(pickUpBook);
  planner.registerTask(moveToShelf);
  planner.registerTask(putBookOnShelf);
  planner.registerTask(moveBookToShelf);

  // Plan the task
  log.info('Starting planning...');
  const result = await planner.plan(moveBookToShelf, worldState);

  if (result.success) {
    log.info('Planning successful!', {
      planSize: result.plan.length,
      planningTime: result.stats.planningTime,
      tasksExplored: result.stats.tasksExplored,
    });

    // Execute the plan
    log.info('🚀 Executing plan...', {
      totalTasks: result.plan.length,
      planStructure: result.plan.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        priority: t.priority,
      })),
    });

    let currentState = worldState;

    for (let i = 0; i < result.plan.length; i++) {
      const task = result.plan[i];
      log.info(`📋 Executing task ${i + 1}/${result.plan.length}: ${task.name}`, {
        taskId: task.id,
        taskType: task.type,
        currentWorldState: Object.fromEntries(currentState.facts),
      });

      if (task.type === 'primitive') {
        // Log actor interaction
        log.debug('🎭 Sending action to actor', {
          taskName: task.name,
          actorId: task.executor.id,
          action: task.action,
          expectedEffects: task.effects.map((e) => ({ id: e.id, description: e.description })),
        });

        // Simulate task execution
        const executionStart = Date.now();
        task.executor.send(task.action);
        await new Promise((resolve) => setTimeout(resolve, 500));
        const executionTime = Date.now() - executionStart;

        // Apply effects
        const previousState = currentState;
        currentState = task.effects.reduce((state, effect) => {
          log.debug('🌍 Applying effect', {
            taskName: task.name,
            effectId: effect.id,
            effectDescription: effect.description,
            stateBefore: Object.fromEntries(state.facts),
          });
          const newState = effect.apply(state);
          log.debug('🌍 Effect applied', {
            effectId: effect.id,
            stateAfter: Object.fromEntries(newState.facts),
          });
          return newState;
        }, currentState);

        log.info('✅ Task completed successfully', {
          taskId: task.id,
          taskName: task.name,
          executionTime,
          worldStateChanges: {
            before: Object.fromEntries(previousState.facts),
            after: Object.fromEntries(currentState.facts),
          },
          resourcesUsed: Object.fromEntries(currentState.resources),
        });
      }
    }

    log.info('Plan execution completed successfully');
  } else {
    log.error('Planning failed', { error: result.error });
  }

  // Cleanup
  await navigationActor.stop();
  await manipulationActor.stop();
  await perceptionActor.stop();

  log.info('✅ Simple task planning example completed');
}

/**
 * Example 2: Multi-agent coordination planning
 */
export async function demonstrateMultiAgentPlanning(): Promise<void> {
  log.info('🤝 Multi-Agent Planning Example');

  // Create multiple agent actors
  const agent1Navigation = createActorRef(navigationMachine, { id: 'agent1-nav' });
  const agent1Manipulation = createActorRef(manipulationMachine, { id: 'agent1-manip' });
  const agent2Navigation = createActorRef(navigationMachine, { id: 'agent2-nav' });
  const agent2Manipulation = createActorRef(manipulationMachine, { id: 'agent2-manip' });

  // Start actors
  [agent1Navigation, agent1Manipulation, agent2Navigation, agent2Manipulation].forEach((actor) => {
    actor.start();
  });

  const planner = new HTNPlanner({
    maxDepth: 8,
    maxPlanningTime: 15000,
    enablePrioritization: true,
  });

  // Define world state for multi-agent scenario
  const worldState = createWorldState(
    {
      agent1Location: 'room_a',
      agent2Location: 'room_b',
      box1Location: 'room_a',
      box2Location: 'room_b',
      targetLocation: 'room_c',
      agent1Holding: null,
      agent2Holding: null,
    },
    ['boxes_in_room_c'],
    {
      agent1Energy: 100,
      agent2Energy: 100,
      timeRemaining: 300,
    }
  );

  // Define coordinated tasks
  const agent1MoveBox = createCompoundTask(
    'agent1_move_box',
    'Agent 1 moves box',
    [
      createTaskMethod('agent1_move_box_method', 'Agent 1 box moving method', (task, state) => [
        createPrimitiveTask('agent1_pickup', 'Agent 1 pick up box', agent1Manipulation, {
          type: 'PICK_UP',
          object: 'box1',
        } as ManipulationEvent),
        createPrimitiveTask('agent1_move', 'Agent 1 move to target', agent1Navigation, {
          type: 'MOVE_TO',
          location: 'room_c',
        } as NavigationEvent),
        createPrimitiveTask('agent1_putdown', 'Agent 1 put down box', agent1Manipulation, {
          type: 'PUT_DOWN',
          object: 'box1',
          location: 'room_c',
        } as ManipulationEvent),
      ]),
    ],
    { priority: 8 }
  );

  const agent2MoveBox = createCompoundTask(
    'agent2_move_box',
    'Agent 2 moves box',
    [
      createTaskMethod('agent2_move_box_method', 'Agent 2 box moving method', (task, state) => [
        createPrimitiveTask('agent2_pickup', 'Agent 2 pick up box', agent2Manipulation, {
          type: 'PICK_UP',
          object: 'box2',
        } as ManipulationEvent),
        createPrimitiveTask('agent2_move', 'Agent 2 move to target', agent2Navigation, {
          type: 'MOVE_TO',
          location: 'room_c',
        } as NavigationEvent),
        createPrimitiveTask('agent2_putdown', 'Agent 2 put down box', agent2Manipulation, {
          type: 'PUT_DOWN',
          object: 'box2',
          location: 'room_c',
        } as ManipulationEvent),
      ]),
    ],
    { priority: 8 }
  );

  const coordinatedBoxMove = createCompoundTask(
    'coordinated_box_move',
    'Coordinated box moving',
    [
      createTaskMethod(
        'parallel_move_method',
        'Parallel box moving method',
        (task, state) => [agent1MoveBox, agent2MoveBox],
        { priority: 10 }
      ),
    ],
    { priority: 10 }
  );

  // Register tasks
  planner.registerTask(agent1MoveBox);
  planner.registerTask(agent2MoveBox);
  planner.registerTask(coordinatedBoxMove);

  // Plan coordinated task
  log.info('Planning coordinated task...');
  const result = await planner.plan(coordinatedBoxMove, worldState);

  if (result.success) {
    log.info('🤝 Multi-agent planning successful!', {
      planSize: result.plan.length,
      planningTime: result.stats.planningTime,
      decompositions: result.stats.decompositions,
      tasksExplored: result.stats.tasksExplored,
    });

    // Show plan structure with actor assignments
    log.info('📋 Multi-agent plan structure:');
    result.plan.forEach((task, index) => {
      if (task.type === 'primitive') {
        log.info(`  ${index + 1}. ${task.name}`, {
          taskId: task.id,
          type: task.type,
          priority: task.priority,
          assignedActor: task.executor.id,
          action: task.action,
          preconditions: task.preconditions.map((p) => p.description),
          effects: task.effects.map((e) => e.description),
        });
      } else {
        log.info(`  ${index + 1}. ${task.name} (compound)`, {
          taskId: task.id,
          type: task.type,
          priority: task.priority,
          subtasks: task.subtasks.length,
        });
      }
    });

    // Simulate coordinated execution
    log.info('🔄 Simulating coordinated execution...');
    for (let i = 0; i < result.plan.length; i++) {
      const task = result.plan[i];
      if (task.type === 'primitive') {
        log.info(`🎯 Agent ${task.executor.id} executing: ${task.name}`, {
          step: i + 1,
          totalSteps: result.plan.length,
          taskId: task.id,
          action: task.action,
        });

        // Simulate parallel execution timing
        const executionTime = Math.random() * 1000 + 500;
        await new Promise((resolve) => setTimeout(resolve, executionTime));

        log.info(`✅ Agent ${task.executor.id} completed: ${task.name}`, {
          executionTime: Math.round(executionTime),
          taskId: task.id,
        });
      }
    }
  } else {
    log.error('❌ Multi-agent planning failed', { error: result.error });
  }

  // Cleanup
  await Promise.all([
    agent1Navigation.stop(),
    agent1Manipulation.stop(),
    agent2Navigation.stop(),
    agent2Manipulation.stop(),
  ]);

  log.info('✅ Multi-agent planning example completed');
}

/**
 * Example 3: Adaptive planning with dynamic world state
 */
export async function demonstrateAdaptivePlanning(): Promise<void> {
  log.info('🔄 Adaptive Planning Example');

  const navigationActor = createActorRef(navigationMachine, { id: 'adaptive-nav' });
  const perceptionActor = createActorRef(perceptionMachine, { id: 'adaptive-perception' });

  navigationActor.start();
  perceptionActor.start();

  const planner = new HTNPlanner({
    maxDepth: 6,
    maxPlanningTime: 12000,
    enablePrioritization: true,
  });

  // Initial world state
  let worldState = createWorldState(
    {
      robotLocation: 'start',
      targetLocation: 'goal',
      pathBlocked: false,
      alternativePathAvailable: true,
      obstacleDetected: false,
    },
    ['reach_goal'],
    {
      energy: 100,
      sensors: 1,
    }
  );

  // Define adaptive navigation methods
  const directPathMethod = createTaskMethod(
    'direct_path_method',
    'Direct path method',
    (task, state) => [
      createPrimitiveTask('move_direct', 'Move directly to goal', navigationActor, {
        type: 'MOVE_TO',
        location: 'goal',
      } as NavigationEvent),
    ],
    {
      preconditions: [
        createCondition(
          'path_clear',
          'Path is not blocked',
          (state) => !state.facts.get('pathBlocked')
        ),
      ],
      priority: 10,
    }
  );

  const alternativePathMethod = createTaskMethod(
    'alternative_path_method',
    'Alternative path method',
    (task, state) => [
      createPrimitiveTask('scan_area', 'Scan for obstacles', perceptionActor, {
        type: 'SCAN_AREA',
        area: 'path',
      } as PerceptionEvent),
      createPrimitiveTask('move_alternative', 'Move via alternative path', navigationActor, {
        type: 'MOVE_TO',
        location: 'goal',
      } as NavigationEvent),
    ],
    {
      preconditions: [
        createCondition('path_blocked', 'Path is blocked', (state) =>
          Boolean(state.facts.get('pathBlocked'))
        ),
        createCondition('alternative_available', 'Alternative path available', (state) =>
          Boolean(state.facts.get('alternativePathAvailable'))
        ),
      ],
      priority: 8,
    }
  );

  const adaptiveNavigation = createCompoundTask(
    'adaptive_navigation',
    'Adaptive navigation to goal',
    [directPathMethod, alternativePathMethod],
    { priority: 9 }
  );

  planner.registerTask(adaptiveNavigation);

  // Plan with initial state
  log.info('🗺️ Planning with clear path...', {
    initialWorldState: Object.fromEntries(worldState.facts),
    goals: Array.from(worldState.goals),
    resources: Object.fromEntries(worldState.resources),
  });

  let result = await planner.plan(adaptiveNavigation, worldState);

  if (result.success) {
    log.info('✅ Initial plan created', {
      method: 'direct_path',
      planSize: result.plan.length,
      planningTime: result.stats.planningTime,
      planStructure: result.plan.map((t) => ({ id: t.id, name: t.name, type: t.type })),
    });

    // Simulate obstacle detection during execution
    log.info('🚧 Simulating obstacle detection during execution...', {
      detectedObstacle: 'path_blocked',
      triggerReason: 'environmental_change',
    });

    const previousState = worldState;
    worldState = createWorldState(
      {
        ...Object.fromEntries(worldState.facts),
        pathBlocked: true,
        obstacleDetected: true,
      },
      ['reach_goal'],
      Object.fromEntries(worldState.resources)
    );

    log.info('🌍 World state changed', {
      stateChanges: {
        before: Object.fromEntries(previousState.facts),
        after: Object.fromEntries(worldState.facts),
      },
      changeReason: 'dynamic_environment',
    });

    // Replan with new state
    log.info('🔄 Replanning with blocked path...', {
      newWorldState: Object.fromEntries(worldState.facts),
      adaptationTrigger: 'obstacle_detection',
    });

    result = await planner.plan(adaptiveNavigation, worldState);

    if (result.success) {
      log.info('🎯 Adaptive replanning successful!', {
        planSize: result.plan.length,
        method: 'alternative_path',
        planningTime: result.stats.planningTime,
        adaptationSuccess: true,
        tasksExplored: result.stats.tasksExplored,
      });

      // Show adapted plan with comparison
      log.info('📋 Adapted plan structure:');
      result.plan.forEach((task, index) => {
        log.info(`  ${index + 1}. ${task.name}`, {
          taskId: task.id,
          type: task.type,
          adaptedStep: true,
          actorAssignment: task.type === 'primitive' ? task.executor.id : undefined,
          action: task.type === 'primitive' ? task.action : undefined,
        });
      });

      // Simulate adaptive execution
      log.info('🚀 Executing adaptive plan...');
      for (let i = 0; i < result.plan.length; i++) {
        const task = result.plan[i];
        if (task.type === 'primitive') {
          log.info(`🎯 Adaptive step ${i + 1}: ${task.name}`, {
            taskId: task.id,
            actorId: task.executor.id,
            adaptiveAction: task.action,
            reason: 'path_blocked_adaptation',
          });

          // Simulate execution with adaptive timing
          const executionTime = Math.random() * 800 + 300;
          await new Promise((resolve) => setTimeout(resolve, executionTime));

          log.info(`✅ Adaptive step completed: ${task.name}`, {
            executionTime: Math.round(executionTime),
            adaptationSuccess: true,
          });
        }
      }
    } else {
      log.error('❌ Adaptive replanning failed', {
        error: result.error,
        adaptationFailed: true,
        originalMethod: 'direct_path',
        failedMethod: 'alternative_path',
      });
    }
  } else {
    log.error('❌ Initial planning failed', {
      error: result.error,
      method: 'direct_path',
      worldState: Object.fromEntries(worldState.facts),
    });
  }

  // Cleanup
  await navigationActor.stop();
  await perceptionActor.stop();

  log.info('✅ Adaptive planning example completed');
}

// ========================================================================================
// MAIN EXAMPLE RUNNER
// ========================================================================================

/**
 * Run all HTN planner examples
 */
export async function runHTNPlannerExamples(): Promise<void> {
  try {
    log.info('🚀 Starting HTN Planner Examples');

    await demonstrateSimpleTaskPlanning();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await demonstrateMultiAgentPlanning();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await demonstrateAdaptivePlanning();

    log.info('✅ All HTN planner examples completed successfully');
  } catch (error) {
    log.error('❌ HTN planner examples failed:', error);
    throw error;
  }
}

// Export for use in tests or demos
export { runHTNPlannerExamples as default };

// Run the examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runHTNPlannerExamples().catch(console.error);
}
