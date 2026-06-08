import type { ActorToolExecutor } from '@actor-web/runtime';
import type {
  FasPatch,
  FasPlan,
  FasReviewResult,
  FasToolInvocation,
  FasToolName,
  FasValidationResult,
} from './fas-contract';

export interface DeterministicFasToolOptions {
  readonly validationResults?: readonly FasValidationResult[];
  readonly reviewResults?: readonly FasReviewResult[];
  readonly failTool?: FasToolName;
}

export interface DeterministicFasToolState {
  readonly invocations: readonly FasToolInvocation[];
}

export interface DeterministicFasTools {
  readonly registry: FasToolRegistry;
  readonly state: DeterministicFasToolState;
}

export type GeneratePatchInput = {
  readonly taskId: string;
  readonly plan: FasPlan;
  readonly attempt: number;
};

export type PatchToolInput = {
  readonly taskId: string;
  readonly patch: FasPatch;
};

export type ReviewToolInput = {
  readonly taskId: string;
  readonly patch: FasPatch;
  readonly validation: FasValidationResult;
};

export type MemoryWriteInput = {
  readonly taskId: string;
  readonly review: FasReviewResult;
};

export type FasToolRegistry = {
  readonly 'codex.generate_patch': ActorToolExecutor<GeneratePatchInput, FasPatch>;
  readonly 'repo.diff': ActorToolExecutor<
    PatchToolInput,
    { readonly patchId: string; readonly files: readonly string[] }
  >;
  readonly 'verification.run': ActorToolExecutor<PatchToolInput, FasValidationResult>;
  readonly 'review.diff': ActorToolExecutor<ReviewToolInput, FasReviewResult>;
  readonly 'memory.write': ActorToolExecutor<
    MemoryWriteInput,
    { readonly ok: true; readonly taskId: string }
  >;
};

function nextResult<T>(results: readonly T[] | undefined, index: number, fallback: T): T {
  return results?.[index] ?? fallback;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected ${field} to be a string.`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') {
    throw new Error(`Expected ${field} to be a number.`);
  }
  return value;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function requirePlan(value: unknown): FasPlan {
  if (!isRecord(value) || typeof value.summary !== 'string' || !isStringArray(value.steps)) {
    throw new Error('Expected plan payload.');
  }
  return {
    summary: value.summary,
    steps: value.steps,
  };
}

function requirePatch(value: unknown): FasPatch {
  if (
    !isRecord(value) ||
    typeof value.patchId !== 'string' ||
    !isStringArray(value.changedFiles) ||
    typeof value.summary !== 'string'
  ) {
    throw new Error('Expected patch payload.');
  }
  return {
    patchId: value.patchId,
    changedFiles: value.changedFiles,
    summary: value.summary,
  };
}

function requireValidation(value: unknown): FasValidationResult {
  if (
    !isRecord(value) ||
    typeof value.ok !== 'boolean' ||
    typeof value.command !== 'string' ||
    !isStringArray(value.failures)
  ) {
    throw new Error('Expected validation payload.');
  }
  return {
    ok: value.ok,
    command: value.command,
    failures: value.failures,
  };
}

function requireReview(value: unknown): FasReviewResult {
  if (!isRecord(value) || typeof value.approved !== 'boolean' || !isStringArray(value.findings)) {
    throw new Error('Expected review payload.');
  }
  return {
    approved: value.approved,
    findings: value.findings,
  };
}

function requireImplementerInput(input: unknown): {
  readonly taskId: string;
  readonly plan: FasPlan;
  readonly attempt: number;
} {
  if (!isRecord(input)) {
    throw new Error('codex.generate_patch requires an object payload.');
  }
  return {
    taskId: requireString(input.taskId, 'taskId'),
    plan: requirePlan(input.plan),
    attempt: requireNumber(input.attempt, 'attempt'),
  };
}

function requirePatchInput(
  input: unknown,
  tool: string
): {
  readonly taskId: string;
  readonly patch: FasPatch;
} {
  if (!isRecord(input)) {
    throw new Error(`${tool} requires an object payload.`);
  }
  return {
    taskId: requireString(input.taskId, 'taskId'),
    patch: requirePatch(input.patch),
  };
}

function requireReviewInput(input: unknown): {
  readonly taskId: string;
  readonly patch: FasPatch;
  readonly validation: FasValidationResult;
} {
  if (!isRecord(input)) {
    throw new Error('review.diff requires an object payload.');
  }
  return {
    taskId: requireString(input.taskId, 'taskId'),
    patch: requirePatch(input.patch),
    validation: requireValidation(input.validation),
  };
}

function requireMemoryInput(input: unknown): {
  readonly taskId: string;
  readonly review: FasReviewResult;
} {
  if (!isRecord(input)) {
    throw new Error('memory.write requires an object payload.');
  }
  return {
    taskId: requireString(input.taskId, 'taskId'),
    review: requireReview(input.review),
  };
}

export function createDeterministicFasTools(
  options: DeterministicFasToolOptions = {}
): DeterministicFasTools {
  const invocations: FasToolInvocation[] = [];
  let validationIndex = 0;
  let reviewIndex = 0;

  const record = (invocation: FasToolInvocation) => {
    invocations.push(invocation);
    return invocation;
  };

  const failIfRequested = (tool: FasToolName): void => {
    if (options.failTool === tool) {
      throw new Error(`Deterministic tool failure: ${tool}`);
    }
  };

  const registry: FasToolRegistry = {
    'codex.generate_patch': (input) => {
      failIfRequested('codex.generate_patch');
      const value = requireImplementerInput(input);
      const patch: FasPatch = {
        patchId: `${value.taskId}-patch-${value.attempt}`,
        changedFiles: [`examples/fas-agent-loop/${value.taskId}.patch.ts`],
        summary: `Generated deterministic patch ${value.attempt} for ${value.taskId}`,
      };
      record({
        tool: 'codex.generate_patch',
        agent: 'implementer',
        taskId: value.taskId,
        ok: true,
        summary: patch.summary,
      });
      return patch;
    },

    'repo.diff': (input) => {
      failIfRequested('repo.diff');
      const value = requirePatchInput(input, 'repo.diff');
      record({
        tool: 'repo.diff',
        agent: 'verifier',
        taskId: value.taskId,
        ok: true,
        summary: `Read diff for ${value.patch.patchId}`,
      });
      return {
        patchId: value.patch.patchId,
        files: value.patch.changedFiles,
      };
    },

    'verification.run': (input) => {
      failIfRequested('verification.run');
      const value = requirePatchInput(input, 'verification.run');
      const result = nextResult<FasValidationResult>(options.validationResults, validationIndex, {
        ok: true,
        command: 'pnpm test:examples',
        failures: [],
      });
      validationIndex += 1;
      record({
        tool: 'verification.run',
        agent: 'verifier',
        taskId: value.taskId,
        ok: result.ok,
        summary: result.ok ? 'Verification passed' : result.failures.join(', '),
      });
      return result;
    },

    'review.diff': (input) => {
      failIfRequested('review.diff');
      const value = requireReviewInput(input);
      const result = nextResult<FasReviewResult>(options.reviewResults, reviewIndex, {
        approved: true,
        findings: [],
      });
      reviewIndex += 1;
      record({
        tool: 'review.diff',
        agent: 'reviewer',
        taskId: value.taskId,
        ok: result.approved,
        summary: result.approved ? 'Review approved' : result.findings.join(', '),
      });
      return result;
    },

    'memory.write': (input) => {
      failIfRequested('memory.write');
      const value = requireMemoryInput(input);
      record({
        tool: 'memory.write',
        agent: 'reviewer',
        taskId: value.taskId,
        ok: true,
        summary: 'Stored workflow outcome in deterministic memory adapter',
      });
      return {
        ok: true,
        taskId: value.taskId,
      };
    },
  };

  return {
    registry,
    state: {
      get invocations() {
        return invocations;
      },
    },
  };
}
