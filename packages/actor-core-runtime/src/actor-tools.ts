export interface ActorToolExecutionContext {
  readonly actorId: string;
  readonly nodeAddress: string;
}

export type ActorToolExecutor<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ActorToolExecutionContext
) => TOutput | Promise<TOutput>;

export type ActorToolRegistry = Record<string, ActorToolExecutor>;

export interface ActorToolbox {
  has(name: string): boolean;
  list(): string[];
  get(name: string): ActorToolExecutor | undefined;
  execute<TOutput = unknown, TInput = unknown>(name: string, input: TInput): Promise<TOutput>;
}

export function createActorToolbox(
  registry: ActorToolRegistry | undefined,
  context: ActorToolExecutionContext,
  allowedToolNames?: readonly string[]
): ActorToolbox {
  const tools = registry ?? {};
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
