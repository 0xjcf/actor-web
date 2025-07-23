/**
 * @module actor-core/runtime/planning/hierarchical-task-network
 * @description Hierarchical Task Networks (HTN) for AI agent planning
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import type { ActorRef } from '../actor-ref.js';
import { Logger } from '../logger.js';
import type { BaseEventObject } from '../types.js';

// ========================================================================================
// HTN CORE TYPES
// ========================================================================================

/**
 * Task types in the HTN system
 */
export type TaskType = 'primitive' | 'compound';

/**
 * Task status during execution
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

/**
 * Base task interface
 */
export interface BaseTask {
  /**
   * Unique identifier for the task
   */
  id: string;

  /**
   * Human-readable name for the task
   */
  name: string;

  /**
   * Task type
   */
  type: TaskType;

  /**
   * Current status of the task
   */
  status: TaskStatus;

  /**
   * Task parameters
   */
  parameters: Record<string, unknown>;

  /**
   * Preconditions that must be met before task execution
   */
  preconditions: Condition[];

  /**
   * Effects that will be true after task completion
   */
  effects: Effect[];

  /**
   * Estimated execution time in milliseconds
   */
  estimatedDuration?: number;

  /**
   * Priority level (1-10, higher is more important)
   */
  priority: number;

  /**
   * Deadline for task completion
   */
  deadline?: Date;

  /**
   * Metadata for task tracking
   */
  metadata?: Record<string, unknown>;
}

/**
 * Primitive task - directly executable action
 */
export interface PrimitiveTask extends BaseTask {
  type: 'primitive';

  /**
   * Actor reference that will execute this task
   */
  executor: ActorRef<BaseEventObject>;

  /**
   * Event to send to the executor
   */
  action: BaseEventObject;

  /**
   * Timeout for task execution
   */
  timeout?: number;
}

/**
 * Compound task - decomposed into subtasks
 */
export interface CompoundTask extends BaseTask {
  type: 'compound';

  /**
   * Methods for decomposing this task
   */
  methods: TaskMethod[];

  /**
   * Currently selected method
   */
  selectedMethod?: TaskMethod;

  /**
   * Subtasks created from decomposition
   */
  subtasks: Task[];
}

/**
 * Union type for all tasks
 */
export type Task = PrimitiveTask | CompoundTask;

/**
 * Condition that must be satisfied
 */
export interface Condition {
  /**
   * Condition identifier
   */
  id: string;

  /**
   * Condition predicate
   */
  predicate: (state: WorldState) => boolean;

  /**
   * Human-readable description
   */
  description: string;
}

/**
 * Effect that will be applied to world state
 */
export interface Effect {
  /**
   * Effect identifier
   */
  id: string;

  /**
   * Function to apply the effect
   */
  apply: (state: WorldState) => WorldState;

  /**
   * Human-readable description
   */
  description: string;
}

/**
 * Method for decomposing a compound task
 */
export interface TaskMethod {
  /**
   * Method identifier
   */
  id: string;

  /**
   * Method name
   */
  name: string;

  /**
   * Preconditions for this method to be applicable
   */
  preconditions: Condition[];

  /**
   * Function to generate subtasks
   */
  decompose: (task: CompoundTask, state: WorldState) => Task[];

  /**
   * Priority of this method (higher is preferred)
   */
  priority: number;

  /**
   * Metadata for method tracking
   */
  metadata?: Record<string, unknown>;
}

/**
 * World state representation
 */
export interface WorldState {
  /**
   * Facts about the world
   */
  facts: Map<string, unknown>;

  /**
   * Active goals
   */
  goals: Set<string>;

  /**
   * Available resources
   */
  resources: Map<string, number>;

  /**
   * Timestamp of last update
   */
  timestamp: number;
}

// ========================================================================================
// HTN PLANNER
// ========================================================================================

/**
 * HTN planner configuration
 */
export interface HTNPlannerConfig {
  /**
   * Maximum planning depth
   */
  maxDepth: number;

  /**
   * Maximum planning time in milliseconds
   */
  maxPlanningTime: number;

  /**
   * Maximum number of tasks in a plan
   */
  maxPlanSize: number;

  /**
   * Enable task prioritization
   */
  enablePrioritization: boolean;

  /**
   * Enable deadline checking
   */
  enableDeadlineChecking: boolean;

  /**
   * Retry failed tasks
   */
  retryFailedTasks: boolean;

  /**
   * Maximum retry attempts
   */
  maxRetries: number;
}

/**
 * Planning result
 */
export interface PlanningResult {
  /**
   * Generated plan
   */
  plan: Task[];

  /**
   * Planning success status
   */
  success: boolean;

  /**
   * Error message if planning failed
   */
  error?: string;

  /**
   * Planning statistics
   */
  stats: {
    planningTime: number;
    tasksExplored: number;
    decompositions: number;
    depth: number;
  };
}

/**
 * HTN Planner for AI agents
 */
export class HTNPlanner {
  private config: HTNPlannerConfig;
  private logger = Logger.namespace('HTN_PLANNER');
  private taskRegistry = new Map<string, Task>();
  private methodRegistry = new Map<string, TaskMethod[]>();

  constructor(config: Partial<HTNPlannerConfig> = {}) {
    this.config = {
      maxDepth: 10,
      maxPlanningTime: 30000, // 30 seconds
      maxPlanSize: 100,
      enablePrioritization: true,
      enableDeadlineChecking: true,
      retryFailedTasks: true,
      maxRetries: 3,
      ...config,
    };

    this.logger.info('HTN Planner initialized', { config: this.config });
  }

  /**
   * Register a task definition
   */
  registerTask(task: Task): void {
    this.logger.debug('Registering task', { taskId: task.id, name: task.name, type: task.type });
    this.taskRegistry.set(task.id, task);
  }

  /**
   * Register methods for a compound task
   */
  registerMethods(taskId: string, methods: TaskMethod[]): void {
    this.logger.debug('Registering methods', { taskId, methodCount: methods.length });
    this.methodRegistry.set(taskId, methods);
  }

  /**
   * Create a planning problem and solve it
   */
  async plan(
    goalTask: Task,
    worldState: WorldState,
    constraints: Condition[] = []
  ): Promise<PlanningResult> {
    const startTime = Date.now();

    this.logger.info('Starting HTN planning', {
      goalTask: goalTask.name,
      worldState: worldState.facts.size,
      constraints: constraints.length,
    });

    try {
      const result = await this.planInternal(goalTask, worldState, constraints, 0);

      const planningTime = Date.now() - startTime;

      if (result.success) {
        this.logger.info('Planning completed successfully', {
          planSize: result.plan.length,
          planningTime,
          depth: result.stats.depth,
        });
      } else {
        this.logger.warn('Planning failed', {
          error: result.error,
          planningTime,
        });
      }

      return {
        ...result,
        stats: {
          ...result.stats,
          planningTime,
        },
      };
    } catch (error) {
      const planningTime = Date.now() - startTime;
      this.logger.error('Planning error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        plan: [],
        success: false,
        error: error instanceof Error ? error.message : 'Unknown planning error',
        stats: {
          planningTime,
          tasksExplored: 0,
          decompositions: 0,
          depth: 0,
        },
      };
    }
  }

  /**
   * Internal planning implementation
   */
  private async planInternal(
    task: Task,
    worldState: WorldState,
    constraints: Condition[],
    depth: number
  ): Promise<PlanningResult> {
    const indent = '  '.repeat(depth);
    this.logger.debug(`${indent}🎯 Planning task: ${task.name}`, {
      taskId: task.id,
      taskType: task.type,
      depth,
      priority: task.priority,
      worldFacts: Object.fromEntries(worldState.facts),
      worldGoals: Array.from(worldState.goals),
      worldResources: Object.fromEntries(worldState.resources),
    });

    // Check planning limits
    if (depth > this.config.maxDepth) {
      this.logger.warn(`${indent}❌ Maximum planning depth exceeded`, {
        taskName: task.name,
        depth,
        maxDepth: this.config.maxDepth,
      });
      return {
        plan: [],
        success: false,
        error: `Maximum planning depth exceeded: ${this.config.maxDepth}`,
        stats: { planningTime: 0, tasksExplored: 0, decompositions: 0, depth },
      };
    }

    // Check preconditions
    this.logger.debug(`${indent}🔍 Checking preconditions for task: ${task.name}`, {
      preconditions: task.preconditions.map((p) => ({ id: p.id, description: p.description })),
    });

    if (!this.checkPreconditions(task.preconditions, worldState)) {
      this.logger.warn(`${indent}❌ Preconditions not satisfied for task: ${task.name}`, {
        taskId: task.id,
        failedPreconditions: task.preconditions
          .filter((p) => !p.predicate(worldState))
          .map((p) => p.description),
      });
      return {
        plan: [],
        success: false,
        error: `Preconditions not satisfied for task: ${task.name}`,
        stats: { planningTime: 0, tasksExplored: 0, decompositions: 0, depth },
      };
    }

    // Check constraints
    this.logger.debug(`${indent}🔒 Checking constraints`, {
      constraints: constraints.map((c) => ({ id: c.id, description: c.description })),
    });

    if (!this.checkPreconditions(constraints, worldState)) {
      this.logger.warn(`${indent}❌ Planning constraints not satisfied`, {
        failedConstraints: constraints
          .filter((c) => !c.predicate(worldState))
          .map((c) => c.description),
      });
      return {
        plan: [],
        success: false,
        error: 'Planning constraints not satisfied',
        stats: { planningTime: 0, tasksExplored: 0, decompositions: 0, depth },
      };
    }

    if (task.type === 'primitive') {
      // Primitive task - return as-is
      this.logger.debug(`${indent}⚡ Primitive task ready for execution`, {
        taskName: task.name,
        taskId: task.id,
        executor: task.executor.id,
        action: task.action,
        estimatedDuration: task.estimatedDuration,
      });
      return {
        plan: [task],
        success: true,
        stats: { planningTime: 0, tasksExplored: 1, decompositions: 0, depth },
      };
    }

    // Compound task - decompose
    const compoundTask = task as CompoundTask;
    const methods = this.methodRegistry.get(compoundTask.id) || compoundTask.methods;

    this.logger.debug(`${indent}🔧 Decomposing compound task: ${compoundTask.name}`, {
      taskId: compoundTask.id,
      availableMethods: methods.map((m) => ({ id: m.id, name: m.name, priority: m.priority })),
    });

    if (methods.length === 0) {
      this.logger.warn(`${indent}❌ No methods available for compound task: ${compoundTask.name}`, {
        taskId: compoundTask.id,
      });
      return {
        plan: [],
        success: false,
        error: `No methods available for compound task: ${compoundTask.name}`,
        stats: { planningTime: 0, tasksExplored: 0, decompositions: 0, depth },
      };
    }

    // Try methods in priority order
    const sortedMethods = methods
      .filter((method) => this.checkPreconditions(method.preconditions, worldState))
      .sort((a, b) => b.priority - a.priority);

    this.logger.debug(`${indent}📋 Applicable methods found`, {
      taskName: compoundTask.name,
      applicableMethods: sortedMethods.map((m) => ({
        id: m.id,
        name: m.name,
        priority: m.priority,
      })),
      filteredOutMethods: methods
        .filter((m) => !this.checkPreconditions(m.preconditions, worldState))
        .map((m) => ({ id: m.id, name: m.name, reason: 'preconditions not met' })),
    });

    for (const method of sortedMethods) {
      this.logger.debug(`${indent}🔄 Trying method: ${method.name}`, {
        taskId: task.id,
        methodId: method.id,
        methodPriority: method.priority,
        preconditions: method.preconditions.map((p) => ({ id: p.id, description: p.description })),
      });

      try {
        const subtasks = method.decompose(compoundTask, worldState);
        this.logger.debug(`${indent}📝 Method decomposed into ${subtasks.length} subtasks`, {
          methodName: method.name,
          subtasks: subtasks.map((st) => ({
            id: st.id,
            name: st.name,
            type: st.type,
            priority: st.priority,
          })),
        });

        const plan: Task[] = [];
        let currentState = { ...worldState };
        const totalStats = { tasksExplored: 0, decompositions: 1, depth };
        let allSubtasksSucceeded = true;

        // Plan each subtask
        for (let i = 0; i < subtasks.length; i++) {
          const subtask = subtasks[i];
          this.logger.debug(
            `${indent}  📋 Planning subtask ${i + 1}/${subtasks.length}: ${subtask.name}`,
            {
              subtaskId: subtask.id,
              subtaskType: subtask.type,
              currentWorldState: Object.fromEntries(currentState.facts),
            }
          );

          const subResult = await this.planInternal(subtask, currentState, constraints, depth + 1);

          if (!subResult.success) {
            this.logger.warn(`${indent}  ❌ Subtask planning failed: ${subtask.name}`, {
              subtaskId: subtask.id,
              error: subResult.error,
              methodName: method.name,
            });
            allSubtasksSucceeded = false;
            break;
          }

          this.logger.debug(`${indent}  ✅ Subtask planned successfully: ${subtask.name}`, {
            subtaskId: subtask.id,
            planSize: subResult.plan.length,
            tasksExplored: subResult.stats.tasksExplored,
          });

          plan.push(...subResult.plan);
          totalStats.tasksExplored += subResult.stats.tasksExplored;
          totalStats.decompositions += subResult.stats.decompositions;
          totalStats.depth = Math.max(totalStats.depth, subResult.stats.depth);

          // Update world state with effects
          const previousState = currentState;
          currentState = this.applyEffects(subtask.effects, currentState);

          if (subtask.effects.length > 0) {
            this.logger.debug(`${indent}  🌍 World state updated by subtask: ${subtask.name}`, {
              subtaskId: subtask.id,
              effects: subtask.effects.map((e) => ({ id: e.id, description: e.description })),
              previousState: Object.fromEntries(previousState.facts),
              newState: Object.fromEntries(currentState.facts),
            });
          }
        }

        // If we successfully planned all subtasks
        if (allSubtasksSucceeded) {
          this.logger.debug(`${indent}✅ Method succeeded: ${method.name}`, {
            taskName: compoundTask.name,
            methodName: method.name,
            totalPlanSize: plan.length,
            totalStats,
          });
          return {
            plan,
            success: true,
            stats: { planningTime: 0, ...totalStats },
          };
        }
      } catch (error) {
        this.logger.warn(`${indent}❌ Method failed with exception: ${method.name}`, {
          taskId: task.id,
          methodId: method.id,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }

    return {
      plan: [],
      success: false,
      error: `No applicable methods found for task: ${compoundTask.name}`,
      stats: { planningTime: 0, tasksExplored: 0, decompositions: 0, depth },
    };
  }

  /**
   * Check if preconditions are satisfied
   */
  private checkPreconditions(conditions: Condition[], worldState: WorldState): boolean {
    return conditions.every((condition) => {
      try {
        return condition.predicate(worldState);
      } catch (error) {
        this.logger.warn('Precondition check failed', {
          conditionId: condition.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return false;
      }
    });
  }

  /**
   * Apply effects to world state
   */
  private applyEffects(effects: Effect[], worldState: WorldState): WorldState {
    let newState = { ...worldState };

    for (const effect of effects) {
      try {
        newState = effect.apply(newState);
      } catch (error) {
        this.logger.warn('Effect application failed', {
          effectId: effect.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return newState;
  }

  /**
   * Get planning statistics
   */
  getStats(): {
    registeredTasks: number;
    registeredMethods: number;
    config: HTNPlannerConfig;
  } {
    return {
      registeredTasks: this.taskRegistry.size,
      registeredMethods: this.methodRegistry.size,
      config: this.config,
    };
  }
}

// ========================================================================================
// UTILITY FUNCTIONS
// ========================================================================================

/**
 * Create a primitive task
 */
export function createPrimitiveTask(
  id: string,
  name: string,
  executor: ActorRef<BaseEventObject>,
  action: BaseEventObject,
  options: Partial<PrimitiveTask> = {}
): PrimitiveTask {
  return {
    id,
    name,
    type: 'primitive',
    status: 'pending',
    executor,
    action,
    parameters: {},
    preconditions: [],
    effects: [],
    priority: 5,
    ...options,
  };
}

/**
 * Create a compound task
 */
export function createCompoundTask(
  id: string,
  name: string,
  methods: TaskMethod[],
  options: Partial<CompoundTask> = {}
): CompoundTask {
  return {
    id,
    name,
    type: 'compound',
    status: 'pending',
    methods,
    subtasks: [],
    parameters: {},
    preconditions: [],
    effects: [],
    priority: 5,
    ...options,
  };
}

/**
 * Create a condition
 */
export function createCondition(
  id: string,
  description: string,
  predicate: (state: WorldState) => boolean
): Condition {
  return { id, description, predicate };
}

/**
 * Create an effect
 */
export function createEffect(
  id: string,
  description: string,
  apply: (state: WorldState) => WorldState
): Effect {
  return { id, description, apply };
}

/**
 * Create a task method
 */
export function createTaskMethod(
  id: string,
  name: string,
  decompose: (task: CompoundTask, state: WorldState) => Task[],
  options: Partial<TaskMethod> = {}
): TaskMethod {
  return {
    id,
    name,
    decompose,
    preconditions: [],
    priority: 5,
    ...options,
  };
}

/**
 * Create an initial world state
 */
export function createWorldState(
  facts: Record<string, unknown> = {},
  goals: string[] = [],
  resources: Record<string, number> = {}
): WorldState {
  return {
    facts: new Map(Object.entries(facts)),
    goals: new Set(goals),
    resources: new Map(Object.entries(resources)),
    timestamp: Date.now(),
  };
}
