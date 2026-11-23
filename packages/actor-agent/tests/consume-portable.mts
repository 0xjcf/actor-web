import { type ActorAgentLlmProvider, createLlmProvider } from '@actor-web/agent';
import {
  type ActorRuntimeOptions,
  type ActorRuntimeSettlement,
  createActorRuntime,
} from '@actor-web/agent/actor-runtime';
import {
  type AgentRuntime,
  type AgentTurn,
  createAgent,
  type FocusedAgent,
} from '@actor-web/agent/portable';
import { structured } from '@actor-web/agent/zod';
import { z } from 'zod';

const provider: ActorAgentLlmProvider = createLlmProvider({
  endpoint: 'https://example.invalid',
  model: 'test',
});
void provider;

type Task = { allowedPaths: string[] };
declare const runtime: AgentRuntime<Task, 'review'>;
const reviewer = createAgent(runtime, {
  purpose: 'review',
  systemPrompt: 'Review the supplied files.',
  tools: [],
  output: structured(z.strictObject({ path: z.string() }), {
    check: (finding, task: Task) =>
      task.allowedPaths.includes(finding.path) ? undefined : 'ungranted',
  }),
});
const typed: FocusedAgent<{ path: string }, Task, 'review'> = reviewer;
void typed;
// @ts-expect-error The runtime does not support Build.
createAgent(runtime, { purpose: 'build', tools: [], systemPrompt: '', parse: String });
// @ts-expect-error A task requires its allowed paths.
void reviewer.run({ signal: new AbortController().signal });
// @ts-expect-error Inferred structured content is not a raw string.
const wrong: Promise<string> = reviewer.run({
  allowedPaths: [],
  signal: new AbortController().signal,
});
void wrong;

declare const actorOptions: ActorRuntimeOptions<Task, 'review'>;
const { maxModelTurns, ...missingModelTurns } = actorOptions.limits;
const modelTurns: number = maxModelTurns;
void modelTurns;
// @ts-expect-error The model-turn limit is required.
createActorRuntime({ ...actorOptions, limits: missingModelTurns });
const local = createActorRuntime(actorOptions);
const actorRuntime: AgentRuntime<Task, 'review'> = local;
const turn: AgentTurn<Task, 'review'> = {
  purpose: 'review',
  systemPrompt: actorOptions.definition.systemPrompt,
  tools: [],
  task: { allowedPaths: [] },
  signal: new AbortController().signal,
};
const raw: Promise<string> = actorRuntime.run(turn);
const cleanup: Promise<ActorRuntimeSettlement> = local.start(turn).waitForSettlement(0);
const observed = local.start(turn, { assignmentId: 'fixture.1', revision: 0 });
const validated: Promise<number> = observed.validateOutput(async (raw) => raw.length);
void raw;
void cleanup;
void observed.readEvidence();
void validated;
