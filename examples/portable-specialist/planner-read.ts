import type { ActorAgentLlmProvider } from '@actor-web/agent';
import type { AgentToolDeclaration } from '@actor-web/agent/portable';
import { AgentRunnerError, createAgent } from '@actor-web/agent/runner';
import { z } from 'zod';

type Assignment = { path: string; source: string };
const firstLine = (source: string) => source.split('\n', 1)[0];
const window = z.strictObject({
  root: z.literal('workspace'),
  path: z.string(),
  startLine: z.literal(1),
  lineCount: z.literal(1),
});

/** Bind the starter's declaration to a fixture handler, not its board or Pi executor. */
export function createPlannerReadSample(
  plannerTools: readonly AgentToolDeclaration[],
  provider: ActorAgentLlmProvider
) {
  const declared = plannerTools.find(({ name }) => name === 'read_plan_file');
  if (!declared) throw new Error('Expected the agent-starter read_plan_file declaration.');
  const file = { root: 'workspace', path: 'examples/plan.txt', startLine: 1 };
  const read = {
    ...declared,
    examples: [{ input: { ...file, lineCount: 1 }, result: { ...file, text: 'Status: draft.' } }],
  } satisfies AgentToolDeclaration;

  const spec = {
    purpose: 'read-plan-line' as const,
    systemPrompt: 'Read and return the first line of the assigned workspace file verbatim.',
    tools: [read],
    parse(text: string, task: Assignment) {
      if (text !== firstLine(task.source))
        throw new Error('Answer does not match the assigned line.');
      return text;
    },
  };
  return createAgent({
    spec,
    provider,
    toolExampleMode: 'description',
    grants: [read.name],
    tools: [
      {
        name: read.name,
        validateInput(input, task) {
          const args = window.safeParse(input);
          if (!args.success || args.data.path !== task.path) {
            throw new AgentRunnerError('READ_DENIED', 'Only the assigned first line may be read.');
          }
          return { value: args.data.path };
        },
        execute(path, task) {
          return { root: 'workspace', path, startLine: 1, text: firstLine(task.source) };
        },
      },
    ],
    encodeTask: ({ path }) => JSON.stringify({ path }),
    limits: {
      runTimeoutMs: 3000,
      askTimeoutMs: 1000,
      providerTimeoutMs: 500,
      toolTimeoutMs: 250,
      maxModelTurns: 2,
      maxToolAttempts: 1,
      maxToolCallsPerBatch: 1,
      maxPayloadBytes: 16 * 1024,
    },
  });
}
