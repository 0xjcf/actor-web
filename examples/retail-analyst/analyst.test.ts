import type { ActorAgentLlmProvider } from '@actor-web/agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnalyst, fixtureDataPorts } from './analyst.js';
import { sales, weather } from './fixtures.js';
import { scriptedProvider } from './scripted-provider.js';

const task = { productId: 'P005' as const };
const answer =
  (value: unknown): ActorAgentLlmProvider =>
  () => ({
    ok: true,
    value: { message: { role: 'assistant', content: JSON.stringify(value) } },
  });
const advisory = {
  hypotheses: [
    {
      explanation: 'Weather may be associated with the increase; causation is not established.',
      evidence: ['sales.maximum', 'weather.conditions'],
    },
  ],
  causation: 'not-established',
};
afterEach(() => vi.useRealTimers());

describe('application-owned analyst', () => {
  it('reads evidence before one model call and returns facts separately from hypotheses', async () => {
    const order: string[] = [];
    const provider = vi.fn<ActorAgentLlmProvider>((request, context) => {
      order.push('model');
      expect(request.tools).toEqual([]);
      expect(request.toolDefinitions ?? []).toEqual([]);
      const input = JSON.parse(request.messages[0].content);
      expect(input.facts.increase).toEqual({
        date: '2024-01-12',
        amount_before_increase: 114,
        amount_after_increase: 342,
        percentage_increase: 200,
      });
      expect(input.facts.precipitationUnit).toBe('unspecified');
      expect(input.availableReferences).toContain('weather.special_event');
      return scriptedProvider(request, context);
    });
    const analyst = createAnalyst({
      provider,
      data: {
        async readSales(id, signal) {
          order.push('sales');
          return fixtureDataPorts.readSales(id, signal);
        },
        async readWeather(date, signal) {
          order.push('weather');
          expect(date).toBe('2024-01-12');
          return fixtureDataPorts.readWeather(date, signal);
        },
      },
    });
    const result = await analyst.analyze(task);
    expect(order).toEqual(['sales', 'weather', 'model']);
    expect(result.analysis.facts.increase.percentage_increase).toBe(200);
    expect(result.analysis.advisory.causation).toBe('not-established');
    expect(result).toMatchObject({
      hostReads: 2,
      calculations: 1,
      metrics: { modelCalls: 1, toolCalls: 0 },
    });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('calculates changed input rather than comparing against the original fixture oracle', async () => {
    const changed = [
      { product_id: 'P005', date: '2025-02-01', quantity: 10 },
      { product_id: 'P005', date: '2025-02-02', quantity: 30 },
    ];
    const result = await createAnalyst({
      provider: answer(advisory),
      data: {
        readSales: async () => ({ ok: true, value: changed }),
        readWeather: async (date) => ({ ok: true, value: { ...weather[2], date } }),
      },
    }).analyze(task);
    expect(result.analysis.facts.increase).toEqual({
      date: '2025-02-02',
      amount_before_increase: 10,
      amount_after_increase: 30,
      percentage_increase: 200,
    });
  });

  it('supports explicit abstention rather than requiring invented causes', async () => {
    const result = await createAnalyst({
      provider: answer({ hypotheses: [], causation: 'not-established' }),
    }).analyze(task);
    expect(result.analysis.advisory.hypotheses).toEqual([]);
    expect(result.analysis.facts.increase.percentage_increase).toBe(200);
  });

  it.each([
    ['numeric override', { ...advisory, percentage_increase: 999 }, 'schemaMismatch'],
    [
      'invented reference',
      { ...advisory, hypotheses: [{ explanation: 'A claim.', evidence: ['product.category'] }] },
      'schemaMismatch',
    ],
    [
      'duplicate reference',
      {
        ...advisory,
        hypotheses: [{ explanation: 'A claim.', evidence: ['sales.maximum', 'sales.maximum'] }],
      },
      'taskMismatch',
    ],
    ['causal certainty field', { ...advisory, causation: 'established' }, 'schemaMismatch'],
  ])('rejects %s without retry', async (_name, content, code) => {
    const provider = vi.fn(answer(content));
    const run = createAnalyst({ provider }).startAnalysis(task);
    await expect(run.result).rejects.toMatchObject({ code });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(run.readTrace()?.events.at(-1)).toMatchObject({
      type: 'output.validated',
      payload: { outcome: 'failed' },
    });
  });

  it('rejects references to an absent weather event', async () => {
    const provider = answer({
      ...advisory,
      hypotheses: [{ explanation: 'An event may matter.', evidence: ['weather.special_event'] }],
    });
    await expect(
      createAnalyst({
        provider,
        data: {
          ...fixtureDataPorts,
          readWeather: async () => ({
            ok: true,
            value: {
              ...weather[2],
              conditions: { ...weather[2].conditions, special_event: null },
            },
          }),
        },
      }).analyze(task)
    ).rejects.toMatchObject({ code: 'taskMismatch' });
  });

  it('does not pretend schema and citation checks prove narrative truth', async () => {
    const unsupported = {
      ...advisory,
      hypotheses: [
        {
          explanation: 'Customers bought umbrellas because of 2.7 inches of rain.',
          evidence: ['weather.conditions'],
        },
      ],
    };
    const result = await createAnalyst({ provider: answer(unsupported) }).analyze(task);
    expect(result.analysis.advisory.hypotheses[0].explanation).toContain('inches');
    // Semantic evaluation must flag this; structural acceptance is not a quality score.
  });

  it.each([
    ['wrong product', [{ ...sales[0], product_id: 'OTHER' }], 'WRONG_PRODUCT'],
    ['empty sales', [], 'INSUFFICIENT_SALES_DATA'],
    [
      'invalid sales',
      [{ product_id: 'P005', date: 'bad', quantity: -1 }, sales[0]],
      'INVALID_SALES_DATA',
    ],
  ])('stops on %s before weather or the LLM', async (_name, rows, code) => {
    const provider = vi.fn<ActorAgentLlmProvider>();
    const readWeather = vi.fn(fixtureDataPorts.readWeather);
    await expect(
      createAnalyst({
        provider,
        data: { readSales: async () => ({ ok: true, value: rows }), readWeather },
      }).analyze(task)
    ).rejects.toMatchObject({ code });
    expect(readWeather).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it('refuses weather for the wrong date before the LLM', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>();
    await expect(
      createAnalyst({
        provider,
        data: { ...fixtureDataPorts, readWeather: async () => ({ ok: true, value: weather[0] }) },
      }).analyze(task)
    ).rejects.toMatchObject({ code: 'WRONG_WEATHER_DATE' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('preserves expected data-port failures without invoking the model', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>();
    await expect(
      createAnalyst({
        provider,
        data: {
          ...fixtureDataPorts,
          readSales: async () => ({ ok: false, code: 'SALES_UNAVAILABLE' }),
        },
      }).analyze(task)
    ).rejects.toMatchObject({ code: 'SALES_UNAVAILABLE' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('pre-abort performs no reads or model calls', async () => {
    const controller = new AbortController();
    controller.abort();
    const readSales = vi.fn(fixtureDataPorts.readSales);
    const provider = vi.fn<ActorAgentLlmProvider>();
    await expect(
      createAnalyst({
        provider,
        data: { ...fixtureDataPorts, readSales },
      }).analyze(task, { signal: controller.signal })
    ).rejects.toBeDefined();
    expect(readSales).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects promptly on cancellation and refuses a late read result', async () => {
    const controller = new AbortController();
    let settle: (value: { ok: true; value: typeof sales }) => void = () => {};
    let observedSignal: AbortSignal | undefined;
    const pending = new Promise<{ ok: true; value: typeof sales }>((resolve) => {
      settle = resolve;
    });
    let notifyEntered = () => {};
    const entered = new Promise<void>((resolve) => {
      notifyEntered = resolve;
    });
    const readWeather = vi.fn(fixtureDataPorts.readWeather);
    const provider = vi.fn<ActorAgentLlmProvider>();
    const run = createAnalyst({
      provider,
      data: {
        readSales: async (_id, signal) => {
          observedSignal = signal;
          notifyEntered();
          return pending;
        },
        readWeather,
      },
    }).startAnalysis(task, { signal: controller.signal });
    await entered;
    const rejected = expect(run.result).rejects.toMatchObject({ code: 'RUN_ABORTED' });
    controller.abort();
    await rejected;
    expect(observedSignal?.aborted).toBe(true);
    settle({ ok: true, value: sales });
    await Promise.resolve();
    expect(readWeather).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it('bounds stalled reads even if the data adapter ignores cancellation', async () => {
    vi.useFakeTimers();
    const provider = vi.fn<ActorAgentLlmProvider>();
    const run = createAnalyst({
      provider,
      data: { ...fixtureDataPorts, readSales: () => new Promise(() => {}) },
    }).startAnalysis(task);
    const rejected = expect(run.result).rejects.toMatchObject({ code: 'DATA_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(provider).not.toHaveBeenCalled();
  });

  it('does not start the model when cancellation occurs as weather returns', async () => {
    const controller = new AbortController();
    const provider = vi.fn<ActorAgentLlmProvider>();
    const run = createAnalyst({
      provider,
      data: {
        ...fixtureDataPorts,
        readWeather: async () => {
          controller.abort();
          return { ok: true, value: weather[2] };
        },
      },
    }).startAnalysis(task, { signal: controller.signal });
    await expect(run.result).rejects.toMatchObject({ code: 'RUN_ABORTED' });
    expect(provider).not.toHaveBeenCalled();
    expect(run.readTrace()).toBeUndefined();
    expect(run.readObservations().map((o) => o.name)).toEqual([
      'get_sales_data',
      'find_largest_sales_increase',
    ]);
  });

  it('rejects a model answer returned after assignment cancellation', async () => {
    const controller = new AbortController();
    const provider = vi.fn<ActorAgentLlmProvider>((request, context) => {
      controller.abort();
      return scriptedProvider(request, context);
    });
    const run = createAnalyst({ provider }).startAnalysis(task, { signal: controller.signal });
    await expect(run.result).rejects.toMatchObject({ code: 'RUN_ABORTED' });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed weather before the model starts', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>();
    await expect(
      createAnalyst({
        provider,
        data: {
          ...fixtureDataPorts,
          readWeather: async () => ({ ok: true, value: { date: '2024-01-12' } }),
        },
      }).analyze(task)
    ).rejects.toMatchObject({ code: 'INVALID_WEATHER_DATA' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('gives the model no tool authority', async () => {
    const provider: ActorAgentLlmProvider = () => ({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'bad', name: 'get_sales_data', input: {} }],
        },
      },
    });
    await expect(createAnalyst({ provider }).analyze(task)).rejects.toMatchObject({
      code: 'TOOL_DENIED',
    });
  });

  it('preserves provider failure without retry or acceptance', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>(() => ({
      ok: false,
      error: { code: 'LLM_PROVIDER_UNAVAILABLE', message: 'Offline.' },
    }));
    await expect(createAnalyst({ provider }).analyze(task)).rejects.toMatchObject({
      code: 'LLM_PROVIDER_UNAVAILABLE',
    });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('isolates repeated and concurrent assignments', async () => {
    const analyst = createAnalyst({ provider: scriptedProvider });
    const results = await Promise.all([analyst.analyze(task), analyst.analyze(task)]);
    const third = await analyst.analyze(task);
    expect(results[0].analysis).toEqual(third.analysis);
    expect(results[0].observations).not.toBe(results[1].observations);
    expect(new Set([...results, third].map((r) => r.trace[0].runId)).size).toBe(3);
  });

  it('keeps business results independent of diagnostic profiles and sink failures', async () => {
    const results = [];
    for (const traceProfile of ['evaluation', 'metadata', 'off'] as const) {
      const run = createAnalyst({
        provider: scriptedProvider,
        traceProfile,
        onTrace: () => {
          throw new Error('Diagnostic sink unavailable.');
        },
      }).startAnalysis(task);
      const result = await run.result;
      results.push(result.analysis);
      if (traceProfile === 'off') expect(run.readTrace()).toBeUndefined();
      else expect(result.traceDeliveryFailures).toBeGreaterThan(0);
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });
});
