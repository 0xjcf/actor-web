import {
  type ActorAgentLlmProvider,
  type ActorAgentLlmResult,
  type AgentTraceRecord,
  serializeAgentTraceJsonl,
} from '@actor-web/agent';
import { describe, expect, it } from 'vitest';
import { createAnalyst, expectedSpike } from './analyst.js';
import { scriptedProvider } from './scripted-provider.js';

const task = { productId: 'P005' as const };
function call(name: string, input: unknown, id = 'call-1'): ActorAgentLlmResult {
  return {
    ok: true,
    value: {
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id,
            name,
            input: {
              decision_summary: 'Check the assigned data for the next step.',
              ...(input as Record<string, unknown>),
            },
          },
        ],
      },
    },
  };
}
describe('retail analyst', () => {
  it('uses a fresh actor session and required observations for repeated assignments', async () => {
    const analyst = createAnalyst({ provider: scriptedProvider });
    const first = await analyst.analyze(task);
    const second = await analyst.analyze(task);
    expect(first.analysis).toMatchObject({
      date: '2024-01-12',
      amount_before_increase: 114,
      amount_after_increase: 342,
      percentage_increase: 200,
    });
    expect(first.observations.map((o) => o.name)).toEqual([
      'get_sales_data',
      'find_largest_sales_increase',
      'call_weather_api',
    ]);
    expect(first.observations[1].output).toEqual({
      date: '2024-01-12',
      amount_before_increase: 114,
      amount_after_increase: 342,
      percentage_increase: 200,
    });
    expect(first.metrics).toMatchObject({ modelCalls: 4, toolCalls: 3 });
    expect(first.trace[0]).toMatchObject({ payload: { methodRevision: 'retail-analyst-v4' } });
    expect(second.analysis).toEqual(first.analysis);
    expect(second.observations).toHaveLength(3);
    expect(second.observations).not.toBe(first.observations);
  });
  it('rejects an ungranted tool before any effect', async () => {
    const provider: ActorAgentLlmProvider = () => call('delete_file', { path: '/' });
    await expect(createAnalyst({ provider }).analyze(task)).rejects.toMatchObject({
      code: 'TOOL_DENIED',
    });
  });
  it('rejects invented quantities after retrieving sales', async () => {
    const provider: ActorAgentLlmProvider = (request, context) =>
      request.messages.some((m) => m.role === 'tool')
        ? call('find_largest_sales_increase', { before: 1, after: 999 }, 'call-2')
        : scriptedProvider(request, context);
    await expect(createAnalyst({ provider }).analyze(task)).rejects.toMatchObject({
      code: 'INVALID_TOOL_INPUT',
    });
  });
  it('rejects a correct-looking answer without required tool observations', async () => {
    const provider: ActorAgentLlmProvider = () => ({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: JSON.stringify({ ...expectedSpike(), causes: ['Rain may have contributed.'] }),
        },
      },
    });
    await expect(createAnalyst({ provider }).analyze(task)).rejects.toMatchObject({
      code: 'taskMismatch',
    });
  });
  it('rejects a wrong percentage even after valid tools', async () => {
    const provider: ActorAgentLlmProvider = async (request, context) => {
      const result = await scriptedProvider(request, context);
      if (result.ok && !result.value.message.toolCalls?.length) {
        return {
          ok: true,
          value: {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                ...expectedSpike(),
                percentage_increase: 100,
                causes: ['Rain may have contributed.'],
              }),
            },
          },
        };
      }
      return result;
    };
    await expect(createAnalyst({ provider }).analyze(task)).rejects.toMatchObject({
      code: 'taskMismatch',
    });
  });
  it('keeps concurrent calls independent', async () => {
    const analyst = createAnalyst({ provider: scriptedProvider });
    const results = await Promise.all([analyst.analyze(task), analyst.analyze(task)]);
    expect(results.map((r) => r.observations.length)).toEqual([3, 3]);
  });
});

describe('analyst evaluation tracing and examples', () => {
  it('does not change model inputs or accepted results when switching capture profiles', async () => {
    const run = async (traceProfile: 'evaluation' | 'metadata' | 'off') => {
      const requests: unknown[] = [];
      const provider: ActorAgentLlmProvider = (request, context) => {
        requests.push(structuredClone(request));
        return scriptedProvider(request, context);
      };
      const execution = createAnalyst({ provider, traceProfile }).startAnalysis(task);
      const { analysis, observations } = await execution.result;
      return { analysis, observations, requests, snapshot: execution.readTrace() };
    };
    const { snapshot: detailed, ...expected } = await run('evaluation');
    expect(detailed?.events.at(-1)).toMatchObject({
      type: 'output.validated',
      payload: { outcome: 'passed', output: { status: 'captured', value: expected.analysis } },
    });
    const { snapshot: metadata, ...metadataExecution } = await run('metadata');
    expect(metadataExecution).toEqual(expected);
    expect(metadata?.metrics).toEqual(detailed?.metrics);
    expect(metadata?.events.map((event) => event.type)).toEqual(
      detailed?.events.map((event) => event.type)
    );
    expect(metadata?.events.at(-1)).toMatchObject({
      type: 'output.validated',
      payload: { outcome: 'passed', output: { status: 'omitted', reason: 'disabled' } },
    });
    const { snapshot: disabled, ...untracedExecution } = await run('off');
    expect(untracedExecution).toEqual(expected);
    expect(disabled).toBeUndefined();
  });

  it('advertises only the maximum tool and does not accept model-supplied calculation data', async () => {
    const provider: ActorAgentLlmProvider = (request, context) => {
      expect(request.tools).toEqual([
        'get_sales_data',
        'find_largest_sales_increase',
        'call_weather_api',
      ]);
      const maximum = request.toolDefinitions?.find(
        (tool) => tool.name === 'find_largest_sales_increase'
      );
      expect(maximum?.inputSchema).toMatchObject({
        additionalProperties: false,
        required: ['decision_summary'],
      });
      if (
        !maximum?.inputSchema ||
        typeof maximum.inputSchema !== 'object' ||
        Array.isArray(maximum.inputSchema)
      ) {
        throw new Error('Expected maximum tool schema.');
      }
      expect(Object.keys(maximum.inputSchema.properties as object)).toEqual(['decision_summary']);
      return scriptedProvider(request, context);
    };
    await expect(createAnalyst({ provider }).analyze(task)).resolves.toMatchObject({
      metrics: { modelCalls: 4, toolCalls: 3 },
    });
  });
  it('refuses the removed pairwise calculator', async () => {
    const provider: ActorAgentLlmProvider = () =>
      call('percentage_increase', { before: 114, after: 342 });
    await expect(createAnalyst({ provider }).analyze(task)).rejects.toMatchObject({
      code: 'TOOL_DENIED',
    });
  });
  it('requires observed sales before finding the maximum', async () => {
    const provider: ActorAgentLlmProvider = () => call('find_largest_sales_increase', {});
    await expect(createAnalyst({ provider }).analyze(task)).rejects.toMatchObject({
      code: 'INVALID_TOOL_INPUT',
    });
  });
  it('requires the maximum observation before weather', async () => {
    const provider: ActorAgentLlmProvider = (request, context) =>
      request.messages.some((message) => message.role === 'tool')
        ? call('call_weather_api', { date: '2024-01-12' }, 'early-weather')
        : scriptedProvider(request, context);
    await expect(createAnalyst({ provider }).analyze(task)).rejects.toMatchObject({
      code: 'INVALID_TOOL_INPUT',
    });
  });
  it('rejects weather for an observed date that is not the maximum date', async () => {
    const provider: ActorAgentLlmProvider = (request, context) =>
      request.messages.some((message) => message.toolName === 'find_largest_sales_increase')
        ? call('call_weather_api', { date: '2024-01-11' }, 'wrong-weather')
        : scriptedProvider(request, context);
    await expect(createAnalyst({ provider }).analyze(task)).rejects.toMatchObject({
      code: 'INVALID_TOOL_INPUT',
    });
  });
  it.each(['get_sales_data', 'find_largest_sales_increase', 'call_weather_api'])(
    'rejects a repeated %s execution',
    async (name) => {
      const observed: string[] = [];
      const provider: ActorAgentLlmProvider = (request, context) =>
        request.messages.some((message) => message.role === 'tool' && message.toolName === name)
          ? call(name, name === 'call_weather_api' ? { date: '2024-01-12' } : {}, 'repeat')
          : scriptedProvider(request, context);
      await expect(
        createAnalyst({
          provider,
          onTrace(event) {
            if (event.type === 'tool.observed') observed.push(event.payload.name);
          },
        }).analyze(task)
      ).rejects.toMatchObject({ code: 'INVALID_TOOL_INPUT' });
      expect(observed.filter((tool) => tool === name)).toHaveLength(1);
    }
  );
  it('rejects an answer after sales alone even when its numeric facts are correct', async () => {
    const provider: ActorAgentLlmProvider = (request, context) =>
      request.messages.some((message) => message.role === 'tool')
        ? {
            ok: true,
            value: {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  ...expectedSpike(),
                  causes: ['Rain may have contributed.'],
                }),
              },
            },
          }
        : scriptedProvider(request, context);
    await expect(createAnalyst({ provider }).analyze(task)).rejects.toMatchObject({
      code: 'taskMismatch',
    });
  });
  it('uses the maximum observation rather than a fixture oracle in the scripted provider', async () => {
    const maximum = {
      date: '2020-02-02',
      amount_before_increase: 10,
      amount_after_increase: 20,
      percentage_increase: 100,
    };
    const result = await scriptedProvider(
      {
        messages: [
          { role: 'tool', toolName: 'get_sales_data', content: '{"ok":true,"output":[]}' },
          {
            role: 'tool',
            toolName: 'find_largest_sales_increase',
            content: JSON.stringify({ ok: true, output: maximum }),
          },
        ],
        tools: [],
      },
      { actorId: 'fixture', nodeAddress: 'local', signal: new AbortController().signal }
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        message: {
          toolCalls: [
            {
              name: 'call_weather_api',
              input: { date: maximum.date },
            },
          ],
        },
      },
    });
  });
  it('correlates explanations, requests, observations, and acceptance without logging opaque state', async () => {
    const received: unknown[] = [];
    let replayed = false;
    const provider: ActorAgentLlmProvider = async (request, context) => {
      if (request.messages.some((m) => m.providerState?.reasoningItems.length)) replayed = true;
      const result = await scriptedProvider(request, context);
      if (!result.ok) return result;
      return {
        ok: true,
        value: {
          ...result.value,
          message: {
            ...result.value.message,
            reasoningSummaries: ['A provider-supplied test summary.'],
            providerState: {
              format: 'openai-responses',
              reasoningItems: [
                { type: 'reasoning', id: 'rs-test', encrypted_content: 'opaque-not-for-logs' },
              ],
            },
          },
        },
      };
    };
    const result = await createAnalyst({
      provider,
      onTrace: (event) => {
        received.push(event);
      },
    }).analyze(task, { runId: 'eval-1' });
    expect(replayed).toBe(true);
    expect(result.trace.map((event) => event.sequence)).toEqual(
      result.trace.map((_, index) => index + 1)
    );
    expect(result.trace.every((event) => event.runId === 'eval-1')).toBe(true);
    expect(result.trace.filter((event) => event.type === 'model.returned')).toHaveLength(4);
    const requestIds = result.trace.flatMap((event) =>
      event.type === 'tool.requested' ? [event.payload.toolCallId] : []
    );
    expect(
      result.trace.flatMap((event) =>
        event.type === 'tool.observed' ? [event.payload.toolCallId] : []
      )
    ).toEqual(requestIds);
    expect(result.trace.slice(-2).map((event) => event.type)).toEqual([
      'run.completed',
      'output.validated',
    ]);
    expect(JSON.stringify(received)).not.toContain('opaque-not-for-logs');
    expect(JSON.stringify(received)).toContain('provider-supplied test summary');
    expect(result.metrics).toMatchObject({ modelCalls: 4, toolCalls: 3, usage: null });
  });
  it('shows examples only as descriptions and supports disabling them', async () => {
    for (const toolExampleMode of ['description', 'off'] as const) {
      const descriptions: string[] = [];
      const provider: ActorAgentLlmProvider = (request, context) => {
        descriptions.push(...(request.toolDefinitions ?? []).map((tool) => tool.description ?? ''));
        return scriptedProvider(request, context);
      };
      const result = await createAnalyst({ provider, toolExampleMode }).analyze(task);
      expect(descriptions.some((text) => text.includes('Illustrative calls and results'))).toBe(
        toolExampleMode === 'description'
      );
      expect(result.observations).toHaveLength(3);
      expect(result.observations[0].output).not.toEqual([{ date: '2020-02-01' }]);
      expect(JSON.stringify(result.observations)).not.toContain('2020-02-02');
    }
  });
  it('does not accept synthetic example quantities as assignment evidence', async () => {
    const provider: ActorAgentLlmProvider = (request, context) =>
      request.messages.some((m) => m.role === 'tool')
        ? call('find_largest_sales_increase', { before: 100, after: 150 }, 'example-call')
        : scriptedProvider(request, context);
    await expect(createAnalyst({ provider }).analyze(task)).rejects.toMatchObject({
      code: 'INVALID_TOOL_INPUT',
    });
  });
  it('keeps observer failures from changing execution', async () => {
    const result = await createAnalyst({
      provider: scriptedProvider,
      onTrace(event) {
        if (event.type === 'run.started' && event.payload.task.status === 'captured') {
          const task = event.payload.task.value;
          if (task && typeof task === 'object' && !Array.isArray(task)) task.productId = 'tampered';
        }
        throw new Error('sink unavailable');
      },
    }).analyze(task);
    expect(result.analysis.percentage_increase).toBe(200);
    expect(result.traceDeliveryFailures).toBeGreaterThan(0);
    expect(JSON.stringify(result.trace)).not.toContain('tampered');
  });
  it('exports failed validation and a summary without publishing an accepted result', async () => {
    const provider: ActorAgentLlmProvider = () => ({
      ok: true,
      value: { message: { role: 'assistant', content: '{}' } },
    });
    const run = createAnalyst({ provider }).startAnalysis(task, { runId: 'invalid-answer' });
    await expect(run.result).rejects.toMatchObject({ code: 'schemaMismatch' });
    const snapshot = run.readTrace();
    if (!snapshot) throw new Error('Expected a rejected run trace.');
    const records: AgentTraceRecord[] = serializeAgentTraceJsonl(snapshot)
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records.slice(-3)).toMatchObject([
      { type: 'run.completed' },
      { type: 'output.validated', payload: { outcome: 'failed' } },
      {
        type: 'agent.trace.summary',
        runId: 'invalid-answer',
        completeness: { status: 'complete' },
        metrics: { modelCalls: 1, toolCalls: 0, usage: null },
      },
    ]);
    expect(records.some((record) => record.type === 'run.failed')).toBe(false);
  });
});

describe('provider failure tracing', () => {
  it('records thrown provider failures without exposing exception details', async () => {
    const events: unknown[] = [];
    const provider: ActorAgentLlmProvider = () => {
      throw new Error('private diagnostic');
    };
    await expect(
      createAnalyst({
        provider,
        onTrace: (event) => {
          events.push(event);
        },
      }).analyze(task)
    ).rejects.toMatchObject({ code: 'LLM_PROVIDER_FAILED' });
    expect(JSON.stringify(events)).toContain('model.failed');
    expect(JSON.stringify(events)).toContain('run.failed');
    expect(JSON.stringify(events)).not.toContain('private diagnostic');
  });
});

describe('required decision summaries', () => {
  it('advertises and executes a structured summary for every tool even with no assistant prose', async () => {
    const provider: ActorAgentLlmProvider = (request, context) => {
      for (const tool of request.toolDefinitions ?? []) {
        expect(tool.inputSchema).toMatchObject({
          required: expect.arrayContaining(['decision_summary']),
          properties: expect.objectContaining({
            decision_summary: expect.objectContaining({
              type: 'string',
              minLength: 1,
              maxLength: 320,
            }),
          }),
        });
      }
      return scriptedProvider(request, context);
    };
    const result = await createAnalyst({ provider }).analyze(task);
    const decisions = result.trace.filter(
      (event) =>
        event.type === 'model.returned' &&
        event.payload.message.status === 'captured' &&
        event.payload.message.value.toolCalls?.length
    );
    expect(decisions).toHaveLength(3);
    expect(
      decisions.every(
        (event) =>
          event.type === 'model.returned' &&
          event.payload.message.status === 'captured' &&
          event.payload.message.value.content === ''
      )
    ).toBe(true);
    for (const observed of result.observations)
      expect(observed.input).toMatchObject({ decision_summary: expect.stringMatching(/\S/) });
  });
  for (const summary of [undefined, '', '   ', 'x'.repeat(321)]) {
    it(`refuses ${summary === undefined ? 'missing' : `${summary.length}-character`} summaries before any observation`, async () => {
      const events: { type: string }[] = [];
      const provider: ActorAgentLlmProvider = () => ({
        ok: true,
        value: {
          message: {
            role: 'assistant',
            content: 'Optional commentary cannot replace a required argument.',
            toolCalls: [
              {
                id: 'missing-summary',
                name: 'get_sales_data',
                input: summary === undefined ? {} : { decision_summary: summary },
              },
            ],
          },
        },
      });
      await expect(
        createAnalyst({
          provider,
          onTrace: (event) => {
            events.push(event);
          },
        }).analyze(task)
      ).rejects.toMatchObject({ code: 'INVALID_TOOL_INPUT' });
      expect(events.some((event) => event.type === 'tool.observed')).toBe(false);
      expect(events.at(-1)?.type).toBe('run.failed');
    });
  }
});
