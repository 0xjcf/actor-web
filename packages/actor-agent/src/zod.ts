import { z } from 'zod';
import type { AgentOutput } from './portable.js';

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
