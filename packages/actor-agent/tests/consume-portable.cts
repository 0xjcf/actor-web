import agent = require('@actor-web/agent');
import runners = require('@actor-web/agent/runner');
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
const publishedTool: agent.ActorAgentToolDefinition = { name: 'inspect', inputSchema: {} };
const modelTool: agent.ModelToolDefinition = publishedTool;
const registry: typeof agent.createActorAgentToolRegistry = agent.createLlmToolRegistry;
void [modelTool, registry({ llm: provider }).llm];

declare const runner: portable.AgentRunner<{ request: string }, 'build'>;
const sample: portable.AgentToolExample = { input: {}, result: null };
const builder = portable.createAgent(runner, {
  purpose: 'build',
  systemPrompt: 'Implement the assignment.',
  tools: [{ name: 'inspect', description: 'Inspect state.', parameters: {}, examples: [sample] }],
  output: codec.structured(z.strictObject({ summary: z.string() })),
});
const result: Promise<{ summary: string }> = builder.run({
  request: 'Update the component.',
  signal: new AbortController().signal,
});
void result;

declare const runnerOptions: runners.AgentRunnerOptions<{ request: string }, 'build'>;
const { maxToolAttempts, maxPayloadBytes, ...missingToolAndPayloadLimits } = runnerOptions.limits;
runners.createAgentRunner({
  ...runnerOptions,
  // @ts-expect-error The byte limit is required.
  limits: { ...missingToolAndPayloadLimits, maxToolAttempts },
});
runners.createAgentRunner({
  ...runnerOptions,
  // @ts-expect-error The tool-attempt limit is required.
  limits: { ...missingToolAndPayloadLimits, maxPayloadBytes },
});
const local = runners.createAgentRunner({ ...runnerOptions, toolExampleMode: 'off' });
const portableRunner: portable.AgentRunner<{ request: string }, 'build'> = local;
const request: portable.AgentRunRequest<{ request: string }, 'build'> = {
  purpose: 'build',
  systemPrompt: runnerOptions.definition.systemPrompt,
  tools: [],
  task: { request: 'Update the component.' },
  signal: new AbortController().signal,
};
const raw: Promise<string> = portableRunner.run(request);
const handle: runners.AgentRunHandle = local.start(request);
const cleanup: Promise<runners.AgentRunSettlement> = handle.waitForSettlement(100);
const observed: runners.ObservedAgentRunHandle = local.start(request, {
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

const tracePayload: agent.AgentTracePayload = {
  type: 'run.completed',
  output: { status: 'captured', value: { answer: 200 } },
};
const traceCompleteness: agent.AgentTraceCompleteness = { status: 'complete' };
void [tracePayload, traceCompleteness];
const disabledTrace: agent.AgentTraceConfiguration = { profile: 'off' };
const profiled = runners.createAgentRunner({ ...runnerOptions, trace: disabledTrace });
const snapshot = profiled.start(request).readTrace();
if (snapshot) {
  const version: 1 = agent.AGENT_TRACE_SCHEMA_VERSION;
  const jsonl: string = agent.serializeAgentTraceJsonl(snapshot);
  void [version, jsonl];
}
