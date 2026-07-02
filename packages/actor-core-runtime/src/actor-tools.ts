export interface ActorToolHostContext {
  readonly actorId: string;
  readonly nodeAddress: string;
}

export interface ActorToolExecutionContext extends ActorToolHostContext {
  readonly signal: AbortSignal;
}

export interface ActorToolExecutionOptions {
  readonly timeoutMs?: number;
}

export type ActorToolTimerHandle = ReturnType<typeof setTimeout>;

export interface ActorToolTimers {
  setTimeout(callback: () => void, delayMs: number): ActorToolTimerHandle;
  clearTimeout(handle: ActorToolTimerHandle): void;
}

export interface ActorToolboxOptions {
  readonly defaultTimeoutMs?: number;
  readonly timers?: ActorToolTimers;
}

export class ActorToolTimeoutError extends Error {
  readonly code = 'ACTOR_TOOL_TIMEOUT';
  readonly toolName: string;
  readonly timeoutMs: number;
  readonly actorId: string;
  readonly nodeAddress: string;

  constructor(input: {
    readonly toolName: string;
    readonly timeoutMs: number;
    readonly actorId: string;
    readonly nodeAddress: string;
  }) {
    super(`Actor tool "${input.toolName}" timed out after ${input.timeoutMs}ms.`);
    this.name = 'ActorToolTimeoutError';
    this.toolName = input.toolName;
    this.timeoutMs = input.timeoutMs;
    this.actorId = input.actorId;
    this.nodeAddress = input.nodeAddress;
  }
}

export type ActorToolExecutor<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ActorToolExecutionContext
) => TOutput | Promise<TOutput>;

export type ActorToolRegistry = Record<string, ActorToolExecutor<never, unknown>>;
export type UntypedActorToolRegistry = Record<string, ActorToolExecutor<unknown, unknown>>;

type ActorToolInput<TTool> = TTool extends (
  input: infer TInput,
  context: ActorToolExecutionContext
) => unknown
  ? TInput
  : unknown;

type ActorToolOutput<TTool> = TTool extends (
  input: never,
  context: ActorToolExecutionContext
) => infer TOutput
  ? Awaited<TOutput>
  : unknown;

export interface ActorToolbox<TTools extends ActorToolRegistry = UntypedActorToolRegistry> {
  has(name: string): boolean;
  list(): string[];
  get(name: string): ActorToolExecutor | undefined;
  execute<TName extends keyof TTools & string>(
    name: TName,
    input: ActorToolInput<TTools[TName]>,
    options?: ActorToolExecutionOptions
  ): Promise<ActorToolOutput<TTools[TName]>>;
  execute<TOutput = unknown, TInput = unknown>(
    name: string,
    input: TInput,
    options?: ActorToolExecutionOptions
  ): Promise<TOutput>;
}

const defaultActorToolTimers: ActorToolTimers = {
  setTimeout(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    clearTimeout(handle);
  },
};

function resolveToolTimeoutMs(
  toolName: string,
  callOptions: ActorToolExecutionOptions | undefined,
  toolboxOptions: ActorToolboxOptions
): number | undefined {
  const timeoutMs = callOptions?.timeoutMs ?? toolboxOptions.defaultTimeoutMs;
  if (timeoutMs === undefined) {
    return undefined;
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Actor tool "${toolName}" timeoutMs must be a positive finite number.`);
  }
  return timeoutMs;
}

export function createActorToolbox<TTools extends ActorToolRegistry = UntypedActorToolRegistry>(
  registry: TTools | undefined,
  context: ActorToolHostContext,
  allowedToolNames?: readonly string[],
  options: ActorToolboxOptions = {}
): ActorToolbox<TTools> {
  const tools = (registry ?? {}) as UntypedActorToolRegistry;
  const allowedTools = allowedToolNames ? new Set(allowedToolNames) : null;
  const timers = options.timers ?? defaultActorToolTimers;

  const isAllowed = (name: string): boolean => {
    return !allowedTools || allowedTools.has(name);
  };

  return {
    has(name: string): boolean {
      return isAllowed(name) && typeof tools[name] === 'function';
    },
    list(): string[] {
      return Object.keys(tools).filter((name) => isAllowed(name));
    },
    get(name: string): ActorToolExecutor | undefined {
      if (!isAllowed(name)) {
        return undefined;
      }

      return tools[name];
    },
    async execute<TOutput = unknown, TInput = unknown>(
      name: string,
      input: TInput,
      callOptions?: ActorToolExecutionOptions
    ): Promise<TOutput> {
      const executor = tools[name];
      if (!isAllowed(name) || !executor) {
        throw new Error(`Actor tool "${name}" is not registered.`);
      }

      const controller = new AbortController();
      const executionContext: ActorToolExecutionContext = {
        ...context,
        signal: controller.signal,
      };
      const timeoutMs = resolveToolTimeoutMs(name, callOptions, options);
      const execution = Promise.resolve().then(() => executor(input, executionContext));

      if (timeoutMs === undefined) {
        return (await execution) as TOutput;
      }

      let timeoutHandle: ActorToolTimerHandle | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = timers.setTimeout(() => {
          const error = new ActorToolTimeoutError({
            toolName: name,
            timeoutMs,
            actorId: context.actorId,
            nodeAddress: context.nodeAddress,
          });
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      });

      execution.catch(() => undefined);

      try {
        return (await Promise.race([execution, timeout])) as TOutput;
      } finally {
        if (timeoutHandle !== undefined) {
          timers.clearTimeout(timeoutHandle);
        }
      }
    },
  };
}
