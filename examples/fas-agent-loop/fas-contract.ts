export type FasTaskPhase =
  | 'submitted'
  | 'planning'
  | 'implementing'
  | 'validating'
  | 'reviewing'
  | 'completed'
  | 'blocked';

export type FasAgentRole = 'supervisor' | 'planner' | 'implementer' | 'verifier' | 'reviewer';

export interface FasPlan {
  readonly summary: string;
  readonly steps: readonly string[];
}

export interface FasPatch {
  readonly patchId: string;
  readonly changedFiles: readonly string[];
  readonly summary: string;
}

export interface FasValidationResult {
  readonly ok: boolean;
  readonly command: string;
  readonly failures: readonly string[];
}

export interface FasReviewResult {
  readonly approved: boolean;
  readonly findings: readonly string[];
}

export interface FasToolInvocation {
  readonly tool: string;
  readonly agent: FasAgentRole;
  readonly taskId: string;
  readonly ok: boolean;
  readonly summary: string;
}

export interface FasTimelineEntry {
  readonly label: string;
  readonly phase: FasTaskPhase;
  readonly agent: FasAgentRole;
  readonly detail: string;
}

export interface FasTaskSummary {
  readonly taskId: string;
  readonly title: string;
  readonly prompt: string;
  readonly phase: FasTaskPhase;
  readonly activeAgent: FasAgentRole;
  readonly plan: FasPlan | null;
  readonly patch: FasPatch | null;
  readonly validation: FasValidationResult | null;
  readonly review: FasReviewResult | null;
  readonly latestToolCall: FasToolInvocation | null;
  readonly timeline: readonly FasTimelineEntry[];
}

export interface FasTaskContext extends FasTaskSummary {
  readonly attempts: number;
}

export interface FasTaskBoardContext {
  readonly activeTaskId: string | null;
  readonly tasks: readonly FasTaskSummary[];
  readonly timeline: readonly FasTimelineEntry[];
  readonly latestToolCall: FasToolInvocation | null;
  readonly completedCount: number;
  readonly blockedCount: number;
}

export interface FasTaskDashboardView extends Readonly<Record<string, unknown>> {
  readonly activeTaskId: string | null;
  readonly phase: FasTaskPhase | 'idle';
  readonly activeAgent: FasAgentRole | 'none';
  readonly latestToolCall: FasToolInvocation | null;
  readonly validationStatus: 'none' | 'passed' | 'failed';
  readonly reviewStatus: 'none' | 'approved' | 'rejected';
  readonly timeline: readonly FasTimelineEntry[];
  readonly taskCount: number;
  readonly completedCount: number;
  readonly blockedCount: number;
}

export type FasTaskCommand =
  | { type: 'SUBMIT_TASK'; taskId: string; title: string; prompt: string }
  | { type: 'REQUEST_PLAN'; plan: FasPlan }
  | { type: 'REQUEST_IMPLEMENTATION'; patch: FasPatch; toolCall: FasToolInvocation }
  | { type: 'REQUEST_VALIDATION'; result: FasValidationResult; toolCall: FasToolInvocation }
  | { type: 'REQUEST_REVIEW'; result: FasReviewResult; toolCall: FasToolInvocation }
  | { type: 'COMPLETE_TASK' }
  | { type: 'BLOCK_TASK'; reason: string }
  | { type: 'GET_TASK' };

export type FasTaskBoardCommand =
  | { type: 'SUBMIT_TASK'; taskId: string; title: string; prompt: string }
  | { type: 'UPSERT_TASK_SUMMARY'; task: FasTaskSummary }
  | { type: 'GET_DASHBOARD' };

export type FasSupervisorCommand =
  | { type: 'TASK_SUBMITTED'; taskId: string }
  | { type: 'GET_SUPERVISOR_STATUS' };

export type PlannerAgentCommand = {
  type: 'PLAN_TASK';
  taskId: string;
  title: string;
  prompt: string;
};

export type ImplementerAgentCommand = {
  type: 'IMPLEMENT_TASK';
  taskId: string;
  plan: FasPlan;
  attempt: number;
};

export type VerifierAgentCommand = {
  type: 'VERIFY_TASK';
  taskId: string;
  patch: FasPatch;
};

export type ReviewerAgentCommand = {
  type: 'REVIEW_TASK';
  taskId: string;
  patch: FasPatch;
  validation: FasValidationResult;
};

export type FasTaskEvent =
  | { type: 'TASK_SUBMITTED'; taskId: string; title: string }
  | { type: 'PLAN_CREATED'; taskId: string; plan: FasPlan }
  | { type: 'PATCH_CREATED'; taskId: string; patch: FasPatch }
  | { type: 'VALIDATION_PASSED'; taskId: string; result: FasValidationResult }
  | { type: 'VALIDATION_FAILED'; taskId: string; result: FasValidationResult }
  | { type: 'REVIEW_COMPLETED'; taskId: string; result: FasReviewResult }
  | { type: 'MEMORY_WRITTEN'; taskId: string }
  | { type: 'TASK_BLOCKED'; taskId: string; reason: string };

export type FasToolInput =
  | { taskId: string; title: string; prompt: string }
  | { taskId: string; plan: FasPlan; attempt: number }
  | { taskId: string; patch: FasPatch }
  | { taskId: string; patch: FasPatch; validation: FasValidationResult }
  | { taskId: string; review: FasReviewResult };

export const FAS_TOOL_NAMES = [
  'codex.generate_patch',
  'repo.diff',
  'verification.run',
  'review.diff',
  'memory.write',
] as const;

export type FasToolName = (typeof FAS_TOOL_NAMES)[number];

export const FAS_AGENT_TOOL_ACCESS = {
  planner: [],
  implementer: ['codex.generate_patch'],
  verifier: ['repo.diff', 'verification.run'],
  reviewer: ['review.diff', 'memory.write'],
} as const;

export function createInitialTaskBoardContext(): FasTaskBoardContext {
  return {
    activeTaskId: null,
    tasks: [],
    timeline: [],
    latestToolCall: null,
    completedCount: 0,
    blockedCount: 0,
  };
}

export function createInitialTaskContext(input: {
  taskId: string;
  title: string;
  prompt: string;
}): FasTaskContext {
  return {
    taskId: input.taskId,
    title: input.title,
    prompt: input.prompt,
    phase: 'submitted',
    activeAgent: 'supervisor',
    plan: null,
    patch: null,
    validation: null,
    review: null,
    latestToolCall: null,
    timeline: [
      {
        label: 'Task submitted',
        phase: 'submitted',
        agent: 'supervisor',
        detail: input.title,
      },
    ],
    attempts: 0,
  };
}

export function taskContextToSummary(context: FasTaskContext): FasTaskSummary {
  return {
    taskId: context.taskId,
    title: context.title,
    prompt: context.prompt,
    phase: context.phase,
    activeAgent: context.activeAgent,
    plan: context.plan,
    patch: context.patch,
    validation: context.validation,
    review: context.review,
    latestToolCall: context.latestToolCall,
    timeline: context.timeline,
  };
}

export function dashboardViewFromContext(
  context: FasTaskBoardContext | undefined
): FasTaskDashboardView {
  const board = context ?? createInitialTaskBoardContext();
  const activeTask = board.tasks.find((task) => task.taskId === board.activeTaskId) ?? null;
  const validationStatus = !activeTask?.validation
    ? 'none'
    : activeTask.validation.ok
      ? 'passed'
      : 'failed';
  const reviewStatus = !activeTask?.review
    ? 'none'
    : activeTask.review.approved
      ? 'approved'
      : 'rejected';

  return {
    activeTaskId: board.activeTaskId,
    phase: activeTask?.phase ?? 'idle',
    activeAgent: activeTask?.activeAgent ?? 'none',
    latestToolCall: board.latestToolCall,
    validationStatus,
    reviewStatus,
    timeline: activeTask?.timeline ?? board.timeline,
    taskCount: board.tasks.length,
    completedCount: board.completedCount,
    blockedCount: board.blockedCount,
  };
}
