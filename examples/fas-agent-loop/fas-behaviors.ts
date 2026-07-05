import type { LatticeEvent } from '@actor-web/lattice';
import { defineBehavior, defineFSM } from '@actor-web/runtime';
import type {
  ActorWebAllowedToolRegistry,
  ActorWebTypedDefineActor,
} from '@actor-web/runtime/topology';
import type {
  FasAgentRole,
  FasPlan,
  FasSupervisorCommand,
  FasTaskBoardCommand,
  FasTaskBoardContext,
  FasTaskCommand,
  FasTaskContext,
  FasTaskEvent,
  FasTaskPhase,
  FasTimelineEntry,
  FasToolInvocation,
  ImplementerAgentCommand,
  PlannerAgentCommand,
  ReviewerAgentCommand,
  VerifierAgentCommand,
} from './fas-contract';
import {
  createInitialTaskBoardContext,
  createInitialTaskContext,
  type FAS_AGENT_TOOL_ACCESS,
  taskContextToSummary,
} from './fas-contract';
import type { FasToolRegistry } from './fas-tool-adapters';

type PlannerDefineActor = ActorWebTypedDefineActor<
  ActorWebAllowedToolRegistry<FasToolRegistry, typeof FAS_AGENT_TOOL_ACCESS.planner>
>;
type ImplementerDefineActor = ActorWebTypedDefineActor<
  ActorWebAllowedToolRegistry<FasToolRegistry, typeof FAS_AGENT_TOOL_ACCESS.implementer>
>;
type VerifierDefineActor = ActorWebTypedDefineActor<
  ActorWebAllowedToolRegistry<FasToolRegistry, typeof FAS_AGENT_TOOL_ACCESS.verifier>
>;
type ReviewerDefineActor = ActorWebTypedDefineActor<
  ActorWebAllowedToolRegistry<FasToolRegistry, typeof FAS_AGENT_TOOL_ACCESS.reviewer>
>;

export type FasCoordinationMode = 'orchestration' | 'lattice' | 'hybrid';

export interface FasCoordinationModeDescription {
  readonly mode: FasCoordinationMode;
  readonly coordinator: string;
  readonly artifacts: readonly string[];
  readonly activation: readonly string[];
  readonly rework: string;
}

export interface FasLatticeActivationSummary {
  readonly activationId: string;
  readonly artifactTypes: readonly string[];
  readonly label: string;
  readonly role: FasAgentRole;
  readonly satisfactionKey: string;
}

export interface FasLatticeAgentContext {
  readonly role: FasAgentRole;
  readonly activations: readonly FasLatticeActivationSummary[];
}

type FasLatticeAgentCommand = LatticeEvent | { readonly type: 'GET_LATTICE_AGENT_STATE' };

function timelineEntry(input: {
  label: string;
  phase: FasTaskPhase;
  agent: FasAgentRole;
  detail: string;
}): FasTimelineEntry {
  return input;
}

function toolCall(input: {
  tool: string;
  agent: FasAgentRole;
  taskId: string;
  ok: boolean;
  summary: string;
}): FasToolInvocation {
  return input;
}

function appendTimeline(
  context: Pick<FasTaskContext, 'timeline'>,
  entry: FasTimelineEntry
): readonly FasTimelineEntry[] {
  return [entry, ...context.timeline];
}

function memoryWrittenEvent(taskId: string): Extract<FasTaskEvent, { type: 'MEMORY_WRITTEN' }> {
  return {
    type: 'MEMORY_WRITTEN',
    taskId,
  };
}

function createInitialSupervisorContext(): { readonly submittedTaskIds: readonly string[] } {
  return {
    submittedTaskIds: [],
  };
}

function createInitialLatticeAgentContext(role: FasAgentRole): FasLatticeAgentContext {
  return {
    role,
    activations: [],
  };
}

function labelForArtifactTypes(artifactTypes: readonly string[]): string {
  if (artifactTypes.includes('review.findings')) {
    return 'Review findings observed';
  }
  if (artifactTypes.includes('task.brief')) {
    return 'Task brief observed';
  }
  if (artifactTypes.includes('execution.plan')) {
    return 'Execution plan observed';
  }
  if (artifactTypes.includes('implementation.patch')) {
    return 'Implementation patch observed';
  }
  if (artifactTypes.includes('verification.result')) {
    return 'Verification result observed';
  }
  if (artifactTypes.includes('review.approved')) {
    return 'Approved review observed';
  }
  return 'Workspace artifact observed';
}

export function describeFasCoordinationModes(): readonly FasCoordinationModeDescription[] {
  return [
    {
      mode: 'orchestration',
      coordinator: 'Coordinator drives planner, implementer, verifier, and reviewer with ask/send.',
      artifacts: [],
      activation: ['TASK_SUBMITTED', 'PLAN_CREATED', 'PATCH_CREATED', 'REVIEW_COMPLETED'],
      rework: 'Coordinator routes validation failures or review rejection back to implementer.',
    },
    {
      mode: 'lattice',
      coordinator: 'No direct agent wiring; agents observe workspace artifacts.',
      artifacts: [
        'task.brief',
        'execution.plan',
        'implementation.patch',
        'verification.result',
        'review.approved',
      ],
      activation: [
        'task.brief -> planner',
        'execution.plan -> implementer',
        'implementation.patch -> verifier',
        'verification.result -> reviewer',
      ],
      rework: 'review.findings everyVersion reactivates the implementer.',
    },
    {
      mode: 'hybrid',
      coordinator:
        'Coordinator publishes task.brief, observes review.approved, and enforces budget.',
      artifacts: ['task.brief', 'review.approved'],
      activation: ['PUBLISH_ARTIFACT task.brief', 'DEPENDENCY_SATISFIED review.approved'],
      rework: 'Agents self-organize through lattice artifacts while coordinator owns watchdogs.',
    },
  ];
}

export function summarizeLatticeActivation(
  role: FasAgentRole,
  event: Extract<LatticeEvent, { readonly type: 'DEPENDENCY_SATISFIED' }>
): FasLatticeActivationSummary {
  const artifactTypes = event.artifacts.map((artifact) => artifact.type);

  return {
    activationId: event.activationId,
    artifactTypes,
    label: labelForArtifactTypes(artifactTypes),
    role,
    satisfactionKey: event.satisfactionKey,
  };
}

function createFasLatticeAgentBehavior(role: FasAgentRole) {
  return defineBehavior<FasLatticeAgentCommand>()
    .withContext(createInitialLatticeAgentContext(role))
    .onMessage(({ message, context }) => {
      if (message.type === 'GET_LATTICE_AGENT_STATE') {
        return { reply: context };
      }

      if (message.type === 'DEPENDENCY_SATISFIED') {
        const activation = summarizeLatticeActivation(role, message);

        return {
          context: {
            role,
            activations: [activation, ...context.activations],
          } satisfies FasLatticeAgentContext,
          reply: activation,
        };
      }

      if (message.type === 'ACTIVATION_TIMED_OUT') {
        return {
          reply: {
            activationId: message.activationId,
            dependencyId: message.dependencyId,
            timedOut: true,
          },
        };
      }

      return { reply: context };
    })
    .build();
}

const taskRunFSM = defineFSM<FasTaskCommand, FasTaskContext, FasTaskPhase>({
  initial: 'submitted',
  states: {
    submitted: {
      on: {
        SUBMIT_TASK: 'submitted',
        REQUEST_PLAN: 'planning',
        BLOCK_TASK: 'blocked',
      },
    },
    planning: {
      on: {
        REQUEST_IMPLEMENTATION: 'implementing',
        BLOCK_TASK: 'blocked',
      },
    },
    implementing: {
      on: {
        REQUEST_VALIDATION: 'validating',
        BLOCK_TASK: 'blocked',
      },
    },
    validating: {
      on: {
        REQUEST_IMPLEMENTATION: 'implementing',
        REQUEST_REVIEW: ({ message }) => (message.result.approved ? 'completed' : 'implementing'),
        BLOCK_TASK: 'blocked',
      },
    },
    reviewing: {
      on: {
        REQUEST_IMPLEMENTATION: 'implementing',
        REQUEST_REVIEW: ({ message }) => (message.result.approved ? 'completed' : 'implementing'),
        COMPLETE_TASK: 'completed',
        BLOCK_TASK: 'blocked',
      },
    },
    completed: {
      on: {},
    },
    blocked: {
      on: {},
    },
  },
});

export function createFasSupervisorBehavior() {
  return defineBehavior<FasSupervisorCommand>()
    .withContext(createInitialSupervisorContext())
    .onMessage(({ message, context }) => {
      if (message.type === 'GET_SUPERVISOR_STATUS') {
        return { reply: context };
      }

      return {
        context: {
          submittedTaskIds: [...context.submittedTaskIds, message.taskId],
        },
        reply: { ok: true, taskId: message.taskId },
      };
    })
    .build();
}

export function createTaskBoardBehavior() {
  return defineBehavior<FasTaskBoardCommand, FasTaskEvent>()
    .withContext(createInitialTaskBoardContext())
    .onMessage(({ message, context }) => {
      if (message.type === 'GET_DASHBOARD') {
        return { reply: context };
      }

      if (message.type === 'SUBMIT_TASK') {
        const task = taskContextToSummary(createInitialTaskContext(message));
        const tasks = [task, ...context.tasks.filter((item) => item.taskId !== task.taskId)];

        return {
          context: {
            activeTaskId: task.taskId,
            tasks,
            timeline: task.timeline,
            latestToolCall: null,
            completedCount: tasks.filter((item) => item.phase === 'completed').length,
            blockedCount: tasks.filter((item) => item.phase === 'blocked').length,
          } satisfies FasTaskBoardContext,
          reply: task,
          emit: [{ type: 'TASK_SUBMITTED', taskId: task.taskId, title: task.title }],
        };
      }

      const tasks = [
        message.task,
        ...context.tasks.filter((item) => item.taskId !== message.task.taskId),
      ];

      return {
        context: {
          activeTaskId: message.task.taskId,
          tasks,
          timeline: message.task.timeline,
          latestToolCall: message.task.latestToolCall,
          completedCount: tasks.filter((item) => item.phase === 'completed').length,
          blockedCount: tasks.filter((item) => item.phase === 'blocked').length,
        } satisfies FasTaskBoardContext,
        reply: message.task,
      };
    })
    .build();
}

export function createTaskRunBehavior(input: {
  readonly taskId: string;
  readonly title: string;
  readonly prompt: string;
}) {
  return defineBehavior<FasTaskCommand, FasTaskEvent>()
    .withContext(createInitialTaskContext(input))
    .withFSM(taskRunFSM)
    .onTransition({
      SUBMIT_TASK: ({ message }) => {
        const context = createInitialTaskContext(message);
        return {
          context,
          reply: taskContextToSummary(context),
          emit: [{ type: 'TASK_SUBMITTED', taskId: message.taskId, title: message.title }],
        };
      },

      REQUEST_PLAN: ({ message, context }) => {
        const nextContext: FasTaskContext = {
          ...context,
          phase: 'planning',
          activeAgent: 'planner',
          plan: message.plan,
          timeline: appendTimeline(
            context,
            timelineEntry({
              label: 'Plan created',
              phase: 'planning',
              agent: 'planner',
              detail: message.plan.summary,
            })
          ),
        };
        return {
          context: nextContext,
          reply: taskContextToSummary(nextContext),
          emit: [{ type: 'PLAN_CREATED', taskId: context.taskId, plan: message.plan }],
        };
      },

      REQUEST_IMPLEMENTATION: ({ message, context }) => {
        const nextContext: FasTaskContext = {
          ...context,
          phase: 'implementing',
          activeAgent: 'implementer',
          patch: message.patch,
          latestToolCall: message.toolCall,
          attempts: context.attempts + 1,
          timeline: appendTimeline(
            context,
            timelineEntry({
              label: 'Patch created',
              phase: 'implementing',
              agent: 'implementer',
              detail: message.patch.summary,
            })
          ),
        };
        return {
          context: nextContext,
          reply: taskContextToSummary(nextContext),
          emit: [{ type: 'PATCH_CREATED', taskId: context.taskId, patch: message.patch }],
        };
      },

      REQUEST_VALIDATION: ({ message, context }) => {
        const phase: FasTaskPhase = 'validating';
        const nextContext: FasTaskContext = {
          ...context,
          phase,
          activeAgent: 'verifier',
          validation: message.result,
          latestToolCall: message.toolCall,
          timeline: appendTimeline(
            context,
            timelineEntry({
              label: message.result.ok ? 'Validation passed' : 'Validation failed',
              phase,
              agent: 'verifier',
              detail: message.result.ok
                ? `${message.result.command} passed`
                : message.result.failures.join(', '),
            })
          ),
        };
        return {
          context: nextContext,
          reply: taskContextToSummary(nextContext),
          emit: [
            message.result.ok
              ? { type: 'VALIDATION_PASSED', taskId: context.taskId, result: message.result }
              : { type: 'VALIDATION_FAILED', taskId: context.taskId, result: message.result },
          ],
        };
      },

      REQUEST_REVIEW: ({ message, context }) => {
        const phase: FasTaskPhase = message.result.approved ? 'completed' : 'implementing';
        const nextContext: FasTaskContext = {
          ...context,
          phase,
          activeAgent: 'reviewer',
          review: message.result,
          latestToolCall: message.toolCall,
          timeline: appendTimeline(
            context,
            timelineEntry({
              label: message.result.approved ? 'Review approved' : 'Review rejected',
              phase,
              agent: 'reviewer',
              detail:
                message.result.findings.length > 0
                  ? message.result.findings.join(', ')
                  : 'No review findings',
            })
          ),
        };
        return {
          context: nextContext,
          reply: taskContextToSummary(nextContext),
          emit: [
            { type: 'REVIEW_COMPLETED', taskId: context.taskId, result: message.result },
            ...(message.result.approved ? [memoryWrittenEvent(context.taskId)] : []),
          ],
        };
      },

      COMPLETE_TASK: ({ context }) => {
        const nextContext: FasTaskContext = {
          ...context,
          phase: 'completed',
          activeAgent: 'supervisor',
          timeline: appendTimeline(
            context,
            timelineEntry({
              label: 'Task completed',
              phase: 'completed',
              agent: 'supervisor',
              detail: context.title,
            })
          ),
        };
        return { context: nextContext, reply: taskContextToSummary(nextContext) };
      },

      BLOCK_TASK: ({ message, context }) => {
        const nextContext: FasTaskContext = {
          ...context,
          phase: 'blocked',
          activeAgent: 'supervisor',
          timeline: appendTimeline(
            context,
            timelineEntry({
              label: 'Task blocked',
              phase: 'blocked',
              agent: 'supervisor',
              detail: message.reason,
            })
          ),
        };
        return {
          context: nextContext,
          reply: taskContextToSummary(nextContext),
          emit: [{ type: 'TASK_BLOCKED', taskId: context.taskId, reason: message.reason }],
        };
      },
    })
    .build();
}

export function createPlannerAgentBehavior(defineBehavior: PlannerDefineActor) {
  return defineBehavior<PlannerAgentCommand, FasTaskEvent>()
    .onMessage(({ message }) => {
      const plan: FasPlan = {
        summary: `Plan ${message.taskId} with deterministic FAS stages`,
        steps: ['inspect task brief', 'prepare patch', 'run verification', 'review diff'],
      };
      return {
        reply: { plan },
        emit: [{ type: 'PLAN_CREATED', taskId: message.taskId, plan }],
      };
    })
    .build();
}

export function createImplementerAgentBehavior(defineBehavior: ImplementerDefineActor) {
  return defineBehavior<ImplementerAgentCommand, FasTaskEvent>()
    .onMessage(async ({ message, tools }) => {
      const patch = await tools.execute('codex.generate_patch', {
        taskId: message.taskId,
        plan: message.plan,
        attempt: message.attempt,
      });
      const invocation = toolCall({
        tool: 'codex.generate_patch',
        agent: 'implementer',
        taskId: message.taskId,
        ok: true,
        summary: patch.summary,
      });
      return {
        reply: { patch, toolCall: invocation },
        emit: [{ type: 'PATCH_CREATED', taskId: message.taskId, patch }],
      };
    })
    .build();
}

export function createVerifierAgentBehavior(defineBehavior: VerifierDefineActor) {
  return defineBehavior<VerifierAgentCommand, FasTaskEvent>()
    .onMessage(async ({ message, tools }) => {
      await tools.execute('repo.diff', {
        taskId: message.taskId,
        patch: message.patch,
      });
      const result = await tools.execute('verification.run', {
        taskId: message.taskId,
        patch: message.patch,
      });
      const invocation = toolCall({
        tool: 'verification.run',
        agent: 'verifier',
        taskId: message.taskId,
        ok: result.ok,
        summary: result.ok ? 'Verification passed' : result.failures.join(', '),
      });
      return {
        reply: { result, toolCall: invocation },
        emit: [
          result.ok
            ? { type: 'VALIDATION_PASSED', taskId: message.taskId, result }
            : { type: 'VALIDATION_FAILED', taskId: message.taskId, result },
        ],
      };
    })
    .build();
}

export function createReviewerAgentBehavior(defineBehavior: ReviewerDefineActor) {
  return defineBehavior<ReviewerAgentCommand, FasTaskEvent>()
    .onMessage(async ({ message, tools }) => {
      const result = await tools.execute('review.diff', {
        taskId: message.taskId,
        patch: message.patch,
        validation: message.validation,
      });
      if (result.approved) {
        await tools.execute('memory.write', {
          taskId: message.taskId,
          review: result,
        });
      }
      const invocation = toolCall({
        tool: 'review.diff',
        agent: 'reviewer',
        taskId: message.taskId,
        ok: result.approved,
        summary: result.approved ? 'Review approved' : result.findings.join(', '),
      });
      return {
        reply: { result, toolCall: invocation },
        emit: [
          { type: 'REVIEW_COMPLETED', taskId: message.taskId, result },
          ...(result.approved ? [memoryWrittenEvent(message.taskId)] : []),
        ],
      };
    })
    .build();
}

export function createFasLatticePlannerBehavior() {
  return createFasLatticeAgentBehavior('planner');
}

export function createFasLatticeImplementerBehavior() {
  return createFasLatticeAgentBehavior('implementer');
}

export function createFasLatticeVerifierBehavior() {
  return createFasLatticeAgentBehavior('verifier');
}

export function createFasLatticeReviewerBehavior() {
  return createFasLatticeAgentBehavior('reviewer');
}

export function createFasHybridCoordinatorBehavior() {
  return createFasLatticeAgentBehavior('supervisor');
}
