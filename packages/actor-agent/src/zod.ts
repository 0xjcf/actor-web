import type { ActorToolExecutionContext } from '@actor-web/runtime/browser';
import { z } from 'zod';
import type { AgentOutput, AgentToolDeclaration, AgentToolExample } from './portable.js';
import type { AgentToolHandler } from './runner.js';
import { snapshotJson } from './runner-json.js';

export type AgentOutputErrorCode = 'invalidJson' | 'schemaMismatch' | 'taskMismatch';

export class AgentOutputError extends Error {
  constructor(
    readonly code: AgentOutputErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AgentOutputError';
  }
}

/** Synchronous JSON output. A check returns a reason on rejection, or nothing on success. */
export function structured<Schema extends z.ZodType, Task = unknown>(
  schema: Schema,
  options: { readonly check?: (content: z.output<Schema>, task: Task) => string | undefined } = {}
): AgentOutput<z.output<Schema>, Task> {
  const jsonSchema = z.toJSONSchema(schema, { io: 'input' });
  const { check } = options;
  return {
    instructions: `Return one JSON value matching this schema:\n${JSON.stringify(jsonSchema)}`,
    parse(raw, task) {
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new AgentOutputError('invalidJson', 'Agent output is not valid JSON');
      }
      const result = schema.safeParse(value);
      if (!result.success) {
        throw new AgentOutputError('schemaMismatch', 'Agent output does not match the schema');
      }
      const reason = check?.(result.data, task);
      if (reason !== undefined) throw new AgentOutputError('taskMismatch', reason);
      return result.data;
    },
  };
}

/** A model declaration and its trusted implementation; granting it remains a host decision. */
export interface DefinedTool<Task> {
  readonly declaration: AgentToolDeclaration;
  readonly handler: AgentToolHandler<Task>;
}

/** Bind a JSON-representable Zod contract to a typed tool handler. */
export function defineTool<
  Input extends z.ZodType,
  Output extends z.ZodType,
  Task = unknown,
>(options: {
  readonly name: string;
  readonly description: string;
  readonly input: Input;
  readonly output: Output;
  /** Synthetic wire-input/result pairs, never executed or treated as task observations. */
  readonly examples?: readonly {
    readonly input: z.input<Input>;
    readonly result: z.input<Output>;
  }[];
  /** Synchronous assignment-specific authorization. Throw to refuse; promises are not accepted. */
  readonly check?: (input: z.output<Input>, task: Task) => void;
  readonly execute: (
    input: z.output<Input>,
    task: Task,
    context: ActorToolExecutionContext
  ) => z.input<Output> | Promise<z.input<Output>>;
}): DefinedTool<Task> {
  // Zod's generated schema includes non-enumerable Standard Schema metadata.
  // Normalize only this generated declaration; arbitrary tool payloads remain strictly checked.
  const parameters = JSON.parse(
    JSON.stringify(z.toJSONSchema(options.input, { io: 'input' }))
  ) as Record<string, unknown>;
  const { name, description, input, output, check, execute } = options;
  const examples = options.examples?.map((example) => {
    const wireInput = snapshotJson(example.input, 4096).value;
    input.parse(wireInput);
    const result = snapshotJson(output.parse(example.result), 4096).value;
    return { input: wireInput, result } as AgentToolExample;
  });
  return {
    declaration: { name, description, parameters, ...(examples === undefined ? {} : { examples }) },
    handler: {
      name,
      validateInput(value, task) {
        const parsed = input.parse(value);
        const checked: unknown = check?.(parsed, task);
        if (
          checked !== null &&
          (typeof checked === 'object' || typeof checked === 'function') &&
          'then' in checked &&
          typeof checked.then === 'function'
        ) {
          // Observe a late rejection, but never treat async settlement as authorization.
          void Promise.resolve(checked).catch(() => {});
          throw new TypeError('Tool authorization checks must be synchronous.');
        }
        return { value: parsed };
      },
      async execute(value, task, context) {
        // The runner dispatches a detached JSON copy of validateInput's returned value.
        return output.parse(await execute(value as z.output<Input>, task, context));
      },
    },
  };
}
