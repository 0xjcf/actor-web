type ExampleJson =
  | null
  | boolean
  | number
  | string
  | readonly ExampleJson[]
  | { readonly [key: string]: ExampleJson };

/** A synthetic argument/result pair, not an observation from a running session. */
export interface AgentToolExample {
  readonly input: Readonly<Record<string, ExampleJson>>;
  readonly result: ExampleJson;
}

/** Describes a requested tool; only the host can grant and execute it. */
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly examples?: readonly AgentToolExample[];
}

interface AgentMethod<Purpose extends string> {
  readonly purpose: Purpose;
  readonly systemPrompt: string;
  readonly tools: readonly AgentTool[];
}

export interface AgentTurn<Task, Purpose extends string = string> extends AgentMethod<Purpose> {
  readonly task: Task;
  readonly signal: AbortSignal;
}

export interface AgentRuntime<Task, Purpose extends string = string> {
  readonly run: (turn: AgentTurn<Task, Purpose>) => Promise<string>;
}

/** Flat assignment data; `signal` is reserved for cancellation, not task content. */
export type AgentContext<Task> = Task & { readonly signal: AbortSignal };

export interface FocusedAgent<Content, Task, Purpose extends string = string>
  extends AgentMethod<Purpose> {
  run(context: AgentContext<Task>): Promise<Content>;
}

/** Can also validate text already produced by a session, without starting another turn. */
export interface AgentOutput<Content, Task> {
  readonly instructions?: string;
  readonly parse: (raw: string, task: Task) => Content;
}

export type AgentDefinition<Content, Task, Purpose extends string = string> = AgentMethod<Purpose> &
  (
    | { readonly output: AgentOutput<Content, Task>; readonly parse?: never }
    | { readonly parse: (raw: string, task: Task) => Content; readonly output?: never }
  );

/** Bind a method to a host executor. No actor, session, retry or tool grant is created here. */
export function createAgent<Content, Task extends object, Purpose extends string>(
  runtime: AgentRuntime<Task, NoInfer<Purpose>>,
  definition: AgentDefinition<Content, Task, Purpose>
): FocusedAgent<Content, Task, Purpose> {
  const { purpose, tools, systemPrompt } = definition;
  const output = definition.output;
  const parse = output ? output.parse.bind(output) : definition.parse;
  const method = {
    purpose,
    tools,
    systemPrompt: output?.instructions ? `${systemPrompt}\n${output.instructions}` : systemPrompt,
  };
  return {
    ...method,
    async run({ signal, ...assignment }) {
      // TypeScript can't reconstruct generic Task after removing the reserved context field.
      const task = assignment as Task;
      const raw = await runtime.run({ ...method, task, signal });
      return parse(raw, task);
    },
  };
}
