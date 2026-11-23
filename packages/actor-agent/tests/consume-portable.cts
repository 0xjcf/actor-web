import agent = require('@actor-web/agent');
import actors = require('@actor-web/agent/actor-runtime');
import portable = require('@actor-web/agent/portable');
import codec = require('@actor-web/agent/zod');

import { z } from 'zod';

const llm: 'llm' = agent.ACTOR_WEB_LLM_TOOL_NAME;
const providerOptions: agent.LlmProviderOptions = {
  endpoint: 'https://example.invalid',
  model: 'test',
};
const provider: agent.ActorAgentLlmProvider = agent.createLlmProvider(providerOptions);
void [llm, provider, agent.createAgentLoopBehavior()];

declare const runtime: portable.AgentRuntime<{ request: string }, 'build'>;
const builder = portable.createAgent(runtime, {
  purpose: 'build',
  systemPrompt: 'Implement the assignment.',
  tools: [],
  output: codec.structured(z.strictObject({ summary: z.string() })),
});
const result: Promise<{ summary: string }> = builder.run({
  request: 'Update the component.',
  signal: new AbortController().signal,
});
void result;

declare const actorOptions: actors.ActorRuntimeOptions<{ request: string }, 'build'>;
const { maxToolAttempts, maxPayloadBytes, ...missingToolAndPayloadLimits } = actorOptions.limits;
actors.createActorRuntime({
  ...actorOptions,
  // @ts-expect-error The byte limit is required.
  limits: { ...missingToolAndPayloadLimits, maxToolAttempts },
});
actors.createActorRuntime({
  ...actorOptions,
  // @ts-expect-error The tool-attempt limit is required.
  limits: { ...missingToolAndPayloadLimits, maxPayloadBytes },
});
const local = actors.createActorRuntime(actorOptions);
const actorRuntime: portable.AgentRuntime<{ request: string }, 'build'> = local;
const turn: portable.AgentTurn<{ request: string }, 'build'> = {
  purpose: 'build',
  systemPrompt: actorOptions.definition.systemPrompt,
  tools: [],
  task: { request: 'Update the component.' },
  signal: new AbortController().signal,
};
const raw: Promise<string> = actorRuntime.run(turn);
const handle: actors.ActorRuntimeExecution = local.start(turn);
const cleanup: Promise<actors.ActorRuntimeSettlement> = handle.waitForSettlement(100);
const observed: actors.ObservedActorRuntimeExecution = local.start(turn, {
  assignmentId: 'fixture.1',
  revision: 0,
});
const validated: Promise<{ length: number }> = observed.validateOutput((raw) => ({
  length: raw.length,
}));
// @ts-expect-error Unbound execution handles do not expose validation evidence.
void handle.validateOutput(String);
void raw;
void cleanup;
void validated;
void observed.readEvidence();
