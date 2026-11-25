import { describe, expect, it, vi } from 'vitest';
import type {
  ActorAgentLlmProvider,
  ActorAgentLlmResult,
  AgentTraceOptions,
} from '../src/index.js';
import type { AgentRunRequest } from '../src/portable.js';
import { type AgentToolHandler, createAgentRunner } from '../src/runner.js';
import { bindTraceOptions, createRunTrace } from '../src/runner-trace.js';

const traceOptions: AgentTraceOptions = {
  methodRevision: 'test-v1',
  model: { provider: 'fixture', model: 'scripted', settings: { status: 'captured', value: {} } },
  capture: 'content',
};
const definition = {
  purpose: 'test',
  systemPrompt: 'Trusted prompt',
  tools: [
    {
      name: 'read',
      description: 'Read a fixture',
      parameters: {},
      examples: [{ input: { n: 0 }, result: 0 }],
    },
    { name: 'denied', description: 'Not granted', parameters: {} },
  ],
};
const request = (signal = new AbortController().signal): AgentRunRequest<{ secret: string }> => ({
  ...definition,
  systemPrompt: 'Trusted prompt\nReturn JSON.',
  task: { secret: 'private-task' },
  signal,
});
const reply = (
  content: string,
  calls?: { id: string; name: string; input: unknown }[]
): ActorAgentLlmResult => ({
  ok: true,
  value: {
    message: { role: 'assistant', content, ...(calls ? { toolCalls: calls } : {}) },
    usage: { inputTokens: 10, outputTokens: 5 },
  },
});
function setup(
  provider: ActorAgentLlmProvider,
  trace: AgentTraceOptions = traceOptions,
  tool?: AgentToolHandler<{ secret: string }>
) {
  return createAgentRunner({
    definition: { ...definition, output: { instructions: 'Return JSON.' } },
    provider,
    grants: ['read'],
    tools: [
      tool ?? {
        name: 'read',
        validateInput: (input) => ({ value: input }),
        execute: (input) => input,
      },
    ],
    limits: {
      runTimeoutMs: 5000,
      askTimeoutMs: 1000,
      providerTimeoutMs: 500,
      toolTimeoutMs: 500,
      maxToolCallsPerBatch: 2,
      maxModelTurns: 5,
      maxToolAttempts: 5,
      maxPayloadBytes: 100_000,
    },
    toolExampleMode: 'description',
    trace,
  });
}

describe('runner evaluation instrumentation', () => {
  it('captures effective inputs and correlates same-name tools, evidence, and host validation', async () => {
    const provider = vi
      .fn<ActorAgentLlmProvider>()
      .mockReturnValueOnce(
        reply('', [
          { id: 'a', name: 'read', input: { n: 1 } },
          { id: 'b', name: 'read', input: { n: 2 } },
        ])
      )
      .mockReturnValue(reply('{"answer":3}'));
    const run = setup(provider).start(request(), { assignmentId: 'test', revision: 1 });
    await expect(run.validateOutput(JSON.parse, { id: 'json', revision: '1' })).resolves.toEqual({
      answer: 3,
    });
    const snapshot = run.readTrace();
    expect(snapshot?.completeness).toEqual({ status: 'complete' });
    expect(snapshot?.metrics).toEqual({
      modelCalls: 2,
      toolCalls: 2,
      usage: { inputTokens: 20, outputTokens: 10 },
    });
    const events = snapshot?.events ?? [];
    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'model.requested',
      'model.returned',
      'tool.requested',
      'tool.requested',
      'tool.observed',
      'tool.observed',
      'model.requested',
      'model.returned',
      'run.completed',
      'output.validated',
    ]);
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    const requested = events.find((event) => event.type === 'model.requested');
    expect(requested).toMatchObject({
      payload: {
        request: {
          status: 'captured',
          value: {
            system: request().systemPrompt,
            tools: ['read'],
            toolDefinitions: [
              { name: 'read', description: expect.stringContaining('Illustrative calls') },
            ],
          },
        },
      },
      evidence: { traceId: run.readEvidence()?.trace.traceId },
    });
    expect(
      events.filter((event) => event.type === 'tool.observed').map((event) => event.payload)
    ).toMatchObject([
      { toolCallId: 'a', turn: 1, output: { value: { n: 1 } } },
      { toolCallId: 'b', turn: 1, output: { value: { n: 2 } } },
    ]);
    expect(events.find((event) => event.type === 'run.completed')).toMatchObject({
      payload: { output: { value: '{"answer":3}' } },
    });
    expect(events.at(-1)).toMatchObject({
      payload: { outcome: 'passed', output: { value: { answer: 3 } } },
    });
    await expect(run.validateOutput(JSON.parse)).rejects.toMatchObject({
      code: 'VALIDATION_ALREADY_REQUESTED',
    });
  });

  it('does not promote failed host validation to a successful answer or failed execution', async () => {
    const run = setup(() => reply('not json')).start(request(), {
      assignmentId: 'test',
      revision: 1,
    });
    await expect(run.validateOutput(JSON.parse)).rejects.toThrow();
    expect(run.readTrace()?.events.slice(-2)).toMatchObject([
      { type: 'run.completed' },
      {
        type: 'output.validated',
        payload: { outcome: 'failed', failure: { code: 'OUTPUT_INVALID' } },
      },
    ]);
  });

  it('defaults to metadata capture and keeps unknown usage unknown without invoking getters', async () => {
    const getter = vi.fn(() => 123);
    const provider: ActorAgentLlmProvider = () => ({
      ok: true,
      value: {
        message: { role: 'assistant', content: 'private-answer' },
        usage: {
          get inputTokens() {
            return getter();
          },
          outputTokens: 0,
        },
      },
    });
    const { capture: _, ...metadataOnly } = traceOptions;
    const run = setup(provider, metadataOnly).start(request());
    await run.result;
    expect(JSON.stringify(run.readTrace())).not.toContain('private-');
    expect(run.readTrace()?.metrics.usage).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });

  it('records rejected batches without dispatching any tool', async () => {
    const execute = vi.fn();
    const run = setup(
      () =>
        reply('', [
          { id: 'a', name: 'read', input: {} },
          { id: 'b', name: 'denied', input: {} },
        ]),
      traceOptions,
      { name: 'read', validateInput: (input) => ({ value: input }), execute }
    ).start(request());
    await expect(run.result).rejects.toMatchObject({ code: 'TOOL_DENIED' });
    expect(execute).not.toHaveBeenCalled();
    expect(run.readTrace()?.events.filter((event) => event.type === 'tool.rejected')).toMatchObject(
      [
        { payload: { toolCallId: 'a', failure: { code: 'BATCH_REJECTED' } } },
        { payload: { toolCallId: 'b', failure: { code: 'TOOL_DENIED' } } },
      ]
    );
    expect(run.readTrace()?.metrics.toolCalls).toBe(0);
  });

  it('records tool failure and skips the remainder without exposing raw errors', async () => {
    const run = setup(
      () =>
        reply('', [
          { id: 'a', name: 'read', input: {} },
          { id: 'b', name: 'read', input: {} },
        ]),
      traceOptions,
      {
        name: 'read',
        validateInput: (input) => ({ value: input }),
        execute() {
          throw new Error('private failure details');
        },
      }
    ).start(request());
    await expect(run.result).rejects.toMatchObject({ code: 'TOOL_FAILED' });
    const snapshot = run.readTrace();
    expect(snapshot?.metrics.toolCalls).toBe(1);
    expect(snapshot?.events.filter((event) => event.type === 'tool.failed')).toHaveLength(1);
    expect(snapshot?.events.filter((event) => event.type === 'tool.rejected')).toMatchObject([
      { payload: { toolCallId: 'b', failure: { code: 'BATCH_INTERRUPTED' } } },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('private failure details');
  });

  it('isolates mutations and async sink rejection, including read snapshots', async () => {
    const onEvent: AgentTraceOptions['onEvent'] = async (event) => {
      if (event.type === 'model.requested' && event.payload.request.status === 'captured') {
        Object.assign(event.payload.request.value, { system: 'tampered' });
      }
      throw new Error('sink unavailable');
    };
    const provider = vi.fn<ActorAgentLlmProvider>(() => reply('{"answer":3}'));
    const run = setup(provider, { ...traceOptions, onEvent }).start(request());
    await expect(run.result).resolves.toBe('{"answer":3}');
    await Promise.resolve();
    expect(provider.mock.calls[0][0].system).toBe(request().systemPrompt);
    expect(run.readTrace()?.deliveryFailures).toBeGreaterThan(0);
    expect(run.readTrace()?.completeness).toMatchObject({
      status: 'incomplete',
      reasons: ['delivery-failed'],
    });
    const snapshot = run.readTrace();
    if (snapshot?.events[0]) Object.assign(snapshot.events[0], { runId: 'tampered' });
    expect(JSON.stringify(run.readTrace())).not.toContain('tampered');
  });

  it('applies redaction to detached values without changing execution', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>(() => reply('answer'));
    const run = setup(provider, {
      ...traceOptions,
      redaction: {
        policyId: 'task-policy',
        redact(value, field) {
          if (field === 'task') Object.assign(value as object, { secret: '[redacted]' });
          return value;
        },
      },
    }).start(request());
    await run.result;
    expect(provider.mock.calls[0][0].messages[0].content).toContain('private-task');
    expect(run.readTrace()?.events[0]).toMatchObject({
      payload: {
        task: { status: 'redacted', policyId: 'task-policy', value: { secret: '[redacted]' } },
      },
    });
  });

  it.each([{ maxEvents: 1 }, { maxBytes: 1 }])(
    'reports bounded loss independently of metrics: %j',
    async (limits) => {
      const run = setup(() => reply('answer'), { ...traceOptions, ...limits }).start(request());
      await expect(run.result).resolves.toBe('answer');
      expect(run.readTrace()?.completeness.status).toBe('incomplete');
      expect(run.readTrace()?.events.length).toBeLessThanOrEqual(1);
      expect(run.readTrace()?.metrics.modelCalls).toBe(1);
    }
  );

  it('does not record a successful late provider completion after cancellation', async () => {
    let resolve: (reply: ActorAgentLlmResult) => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>((done) => {
      entered = done;
    });
    const pending = new Promise<ActorAgentLlmResult>((done) => {
      resolve = done;
    });
    const control = new AbortController();
    const run = setup(() => {
      entered();
      return pending;
    }).start(request(control.signal));
    await started;
    control.abort('private abort reason');
    await expect(run.result).rejects.toMatchObject({ code: 'RUN_ABORTED' });
    resolve(reply('private late answer'));
    await run.waitForSettlement(1000);
    const snapshot = run.readTrace();
    expect(snapshot?.events.some((event) => event.type === 'run.cancelled')).toBe(true);
    expect(snapshot?.events.some((event) => event.type === 'model.returned')).toBe(false);
    expect(snapshot?.events.some((event) => event.type === 'run.completed')).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('private late answer');
    expect(JSON.stringify(snapshot)).not.toContain('private abort reason');
  });

  it('keeps successive invocation IDs and snapshots independent', async () => {
    const runner = setup(() => reply('answer'));
    const first = runner.start(request());
    await first.result;
    const snapshot = first.readTrace();
    const second = runner.start(request());
    await second.result;
    expect(first.readTrace()).toEqual(snapshot);
    expect(second.readTrace()?.runId).not.toBe(snapshot?.runId);
  });
});

describe('trace content safety', () => {
  it('omits invalid JSON and oversized content without executing accessors', () => {
    const trace = createRunTrace(bindTraceOptions({ ...traceOptions, maxContentBytes: 10 }));
    const get = vi.fn(() => 'secret');
    const invalid = Object.defineProperty({}, 'value', { enumerable: true, get });
    expect(trace.capture('task', invalid)).toEqual({ status: 'omitted', reason: 'invalid-json' });
    expect(trace.capture('output', 'x'.repeat(20))).toEqual({
      status: 'omitted',
      reason: 'size-limit',
    });
    expect(trace.capture('output', null)).toEqual({ status: 'captured', value: null });
    expect(get).not.toHaveBeenCalled();
  });

  it('turns redaction failure into omitted content rather than execution failure', async () => {
    const run = setup(() => reply('answer'), {
      ...traceOptions,
      redaction: {
        policyId: 'broken',
        redact() {
          throw new Error('private policy failure');
        },
      },
    }).start(request());
    await expect(run.result).resolves.toBe('answer');
    expect(run.readTrace()?.completeness).toMatchObject({
      status: 'incomplete',
      reasons: ['capture-failed'],
    });
    expect(JSON.stringify(run.readTrace())).not.toContain('private policy failure');
  });
});
