export interface ActorToolExecutionContext {
  readonly actorId: string;
  readonly nodeAddress: string;
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
    input: ActorToolInput<TTools[TName]>
  ): Promise<ActorToolOutput<TTools[TName]>>;
  execute<TOutput = unknown, TInput = unknown>(name: string, input: TInput): Promise<TOutput>;
}

export function createActorToolbox<TTools extends ActorToolRegistry = UntypedActorToolRegistry>(
  registry: TTools | undefined,
  context: ActorToolExecutionContext,
  allowedToolNames?: readonly string[]
): ActorToolbox<TTools> {
  const tools = (registry ?? {}) as UntypedActorToolRegistry;
  const allowedTools = allowedToolNames ? new Set(allowedToolNames) : null;

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
      input: TInput
    ): Promise<TOutput> {
      const executor = tools[name];
      if (!isAllowed(name) || !executor) {
        throw new Error(`Actor tool "${name}" is not registered.`);
      }

      return (await executor(input, context)) as TOutput;
    },
  };
}
