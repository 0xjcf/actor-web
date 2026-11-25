import {
  type ActorAgentLlmProvider,
  type ActorAgentToolDefinition,
  AGENT_TRACE_SCHEMA_VERSION,
  type AgentTraceConfiguration,
  type AgentTraceProfile,
  type AgentTraceRecord,
  createLlmProvider,
  createLlmToolRegistry,
  type ModelToolDefinition,
  serializeAgentTraceJsonl,
} from '@actor-web/agent';
import {
  type AgentRunner,
  type AgentRunRequest,
  type AgentSpec,
  type AgentToolExample,
  createAgent,
  type FocusedAgent,
} from '@actor-web/agent/portable';
import {
  type AgentRunnerOptions,
  type AgentRunSettlement,
  type CreateAgentOptions,
  createAgentRunner,
  createAgent as createLocalAgent,
} from '@actor-web/agent/runner';
import { defineTool, structured } from '@actor-web/agent/zod';
import { z } from 'zod';
import './trace-contract.js';

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
const spec: AgentSpec<{ path: string }, Task, 'review'> = {
  purpose: 'review',
  systemPrompt: 'Review the supplied files.',
  tools: [],
  output: structured(z.strictObject({ path: z.string() }), {
    check: (finding, task: Task) =>
      task.allowedPaths.includes(finding.path) ? undefined : 'ungranted',
  }),
};
const agentOptions: CreateAgentOptions<{ path: string }, Task, 'review'> = {
  ...runnerOptions,
  spec,
};
const localAgent = createLocalAgent({ ...runnerOptions, spec });
const typedLocal: FocusedAgent<{ path: string }, Task, 'review'> = localAgent;
void [agentOptions, typedLocal];
// @ts-expect-error Factory-inferred assignments require allowed paths.
void localAgent.run({ signal: new AbortController().signal });
// @ts-expect-error The factory returns structured content, not raw text.
const wrongLocal: Promise<string> = localAgent.run({
  allowedPaths: [],
  signal: new AbortController().signal,
});
void wrongLocal;
// @ts-expect-error A runner-only spec has no required output parser.
createLocalAgent(runnerOptions);
createLocalAgent({
  ...runnerOptions,
  // @ts-expect-error A spec must choose output or parse, not both.
  spec: { ...spec, parse: (_raw: string, _task: Task) => ({ path: '' }) },
});
const { maxModelTurns, ...missingModelTurns } = runnerOptions.limits;
const modelTurns: number = maxModelTurns;
void modelTurns;
// @ts-expect-error The model-turn limit is required.
createAgentRunner({ ...runnerOptions, limits: missingModelTurns });
const local = createAgentRunner({ ...runnerOptions, toolExampleMode: 'description' });
const portableRunner: AgentRunner<Task, 'review'> = local;
const request: AgentRunRequest<Task, 'review'> = {
  purpose: 'review',
  systemPrompt: runnerOptions.spec.systemPrompt,
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
void observed.readTrace();
void validated;

const tracedRunner = createAgentRunner({
  ...runnerOptions,
  trace: {
    methodRevision: 'test-v1',
    capture: 'content',
    model: {
      provider: 'fixture',
      model: 'scripted',
      settings: { status: 'omitted', reason: 'unavailable' },
    },
    onEvent(event) {
      if (event.type === 'model.requested') {
        const turn: number = event.payload.turn;
        void turn;
      }
    },
  },
});
void tracedRunner.start(request).readTrace()?.completeness;

function traceFor(profile: AgentTraceProfile): AgentTraceConfiguration {
  return profile === 'off'
    ? { profile }
    : {
        profile,
        methodRevision: 'test-v1',
        model: {
          provider: 'fixture',
          model: 'scripted',
          settings: { status: 'omitted', reason: 'unavailable' },
        },
      };
}
const profiled = createAgentRunner({ ...runnerOptions, trace: traceFor('evaluation') });
const snapshot = profiled.start(request).readTrace();
if (snapshot) {
  const version: 1 = AGENT_TRACE_SCHEMA_VERSION;
  const jsonl: string = serializeAgentTraceJsonl(snapshot);
  const record: AgentTraceRecord = JSON.parse(jsonl.trimEnd().split('\n').at(-1) ?? '');
  if (record.type === 'agent.trace.summary') void record.metrics;
  void version;
}
// @ts-expect-error A named profile cannot override capture.
const contradictoryTrace: AgentTraceConfiguration = { profile: 'off', capture: 'content' };
void contradictoryTrace;

const typedTool = defineTool({
  name: 'double',
  description: 'Double a count.',
  input: z.strictObject({ count: z.number() }),
  output: z.strictObject({ doubled: z.number() }),
  execute({ count }) {
    const inferred: number = count;
    // @ts-expect-error Handler inputs are inferred from the input schema.
    const wrong: string = count;
    void wrong;
    return { doubled: inferred * 2 };
  },
});
void typedTool;
