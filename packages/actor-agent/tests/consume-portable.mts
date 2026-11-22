import { type ActorRuntimeOptions, createActorRuntime } from '@actor-web/agent/actor-runtime';
import { type AgentRuntime, createAgent, type FocusedAgent } from '@actor-web/agent/portable';
import { structured } from '@actor-web/agent/zod';
import { z } from 'zod';

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
const actorRuntime: AgentRuntime<Task, 'review'> = createActorRuntime(actorOptions);
const raw: Promise<string> = actorRuntime.run({
  purpose: 'review',
  systemPrompt: actorOptions.definition.systemPrompt,
  tools: [],
  task: { allowedPaths: [] },
  signal: new AbortController().signal,
});
void raw;
