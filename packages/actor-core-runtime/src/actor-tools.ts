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
  context: ActorToolExecutionContext
): ActorToolbox {
  const tools = registry ?? {};

  return {
    has(name: string): boolean {
      return typeof tools[name] === 'function';
    },
    list(): string[] {
      return Object.keys(tools);
    },
    get(name: string): ActorToolExecutor | undefined {
      return tools[name];
    },
    async execute<TOutput = unknown, TInput = unknown>(
      name: string,
      input: TInput
    ): Promise<TOutput> {
      const executor = tools[name];
      if (!executor) {
        throw new Error(`Actor tool "${name}" is not registered.`);
      }

      return (await executor(input, context)) as TOutput;
    },
  };
}
