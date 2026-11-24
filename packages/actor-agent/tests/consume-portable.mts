import {
  type ActorAgentLlmProvider,
  type ActorAgentToolDefinition,
  createLlmProvider,
  createLlmToolRegistry,
  type ModelToolDefinition,
} from '@actor-web/agent';
import {
  type AgentRunner,
  type AgentRunRequest,
  type AgentToolExample,
  createAgent,
  type FocusedAgent,
} from '@actor-web/agent/portable';
import {
  type AgentRunnerOptions,
  type AgentRunSettlement,
  createAgentRunner,
} from '@actor-web/agent/runner';
import { structured } from '@actor-web/agent/zod';
import { z } from 'zod';

const provider: ActorAgentLlmProvider = createLlmProvider({
  endpoint: 'https://example.invalid',
  model: 'test',
});
const modelTool: ModelToolDefinition = { name: 'read', inputSchema: { type: 'object' } };
const compatibleTool: ActorAgentToolDefinition = modelTool;
void [compatibleTool, createLlmToolRegistry({ llm: provider }).llm];

type Task = { allowedPaths: string[] };
declare const runner: AgentRunner<Task, 'review'>;
const sample = { input: { path: 'example' }, result: ['line'] } as const satisfies AgentToolExample;
const reviewer = createAgent(runner, {
  purpose: 'review',
  systemPrompt: 'Review the supplied files.',
  tools: [{ name: 'read', description: 'Read lines.', parameters: {}, examples: [sample] }],
  output: structured(z.strictObject({ path: z.string() }), {
    check: (finding, task: Task) =>
      task.allowedPaths.includes(finding.path) ? undefined : 'ungranted',
  }),
});
const typed: FocusedAgent<{ path: string }, Task, 'review'> = reviewer;
void typed;
// @ts-expect-error The runner does not support Build.
createAgent(runner, { purpose: 'build', tools: [], systemPrompt: '', parse: String });
// @ts-expect-error A task requires its allowed paths.
void reviewer.run({ signal: new AbortController().signal });
// @ts-expect-error Inferred structured content is not a raw string.
const wrong: Promise<string> = reviewer.run({
  allowedPaths: [],
  signal: new AbortController().signal,
});
void wrong;

declare const runnerOptions: AgentRunnerOptions<Task, 'review'>;
const { maxModelTurns, ...missingModelTurns } = runnerOptions.limits;
const modelTurns: number = maxModelTurns;
void modelTurns;
// @ts-expect-error The model-turn limit is required.
createAgentRunner({ ...runnerOptions, limits: missingModelTurns });
const local = createAgentRunner({ ...runnerOptions, toolExampleMode: 'description' });
const portableRunner: AgentRunner<Task, 'review'> = local;
const request: AgentRunRequest<Task, 'review'> = {
  purpose: 'review',
  systemPrompt: runnerOptions.definition.systemPrompt,
  tools: [],
  task: { allowedPaths: [] },
  signal: new AbortController().signal,
};
const raw: Promise<string> = portableRunner.run(request);
const cleanup: Promise<AgentRunSettlement> = local.start(request).waitForSettlement(0);
const observed = local.start(request, { assignmentId: 'fixture.1', revision: 0 });
const validated: Promise<number> = observed.validateOutput(async (raw) => raw.length);
void raw;
void cleanup;
void observed.readEvidence();
void validated;
