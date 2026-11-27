import type { ActorAgentLlmProvider } from '@actor-web/agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateResult } from './evaluation.js';
import {
  type Assessment,
  calculateSpike,
  checkAssessment,
  type Observation,
  recordsOf,
  sources,
  validatePacket,
} from './evidence.js';
import {
  type CaseId,
  caseIds,
  controlCaseIds,
  createDataset,
  createMockPort,
  scope,
} from './fixtures.js';
import { controlStrategies, createInvestigator } from './investigation.js';
import { assessEvidence } from './policy.js';
import { scriptedProvider } from './scripted-provider.js';

const setup = (id: CaseId, provider: ActorAgentLlmProvider = scriptedProvider) =>
  createInvestigator({ data: createMockPort(createDataset(id)), provider });
const tool =
  (name: string, input: unknown = { reason: 'Inspect these records.' }): ActorAgentLlmProvider =>
  (request) => ({
    ok: true,
    value: {
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: `request-${request.messages.length}`,
            name,
            input,
          },
        ],
      },
    },
  });
const answer =
  (assessment: Assessment): ActorAgentLlmProvider =>
  () => ({
    ok: true,
    value: { message: { role: 'assistant', content: JSON.stringify(assessment) } },
  });
afterEach(() => vi.useRealTimers());

describe('availability-recovery evidence', () => {
  it('rejects recovery when the 200-unit order reconciles the rise but inventory never stocked out', async () => {
    const data = createDataset('bulk-order');
    const observed = [data.read_sales, data.read_orders, data.read_inventory];
    const sales = recordsOf(observed, 'read_sales');
    const delta = sales[2].units - sales[1].units;
    const orders = recordsOf(observed, 'read_orders').filter(
      (o) => o.date === sales[2].date && !o.cancelled
    );
    expect(delta).toBe(200);
    expect(orders.filter((o) => o.units === delta)).toHaveLength(1);
    expect(orders.filter((o) => o.units !== delta).reduce((sum, o) => sum + o.units, 0)).toBe(
      sales[1].units
    );
    const inventory = recordsOf(observed, 'read_inventory');
    expect(inventory.map((r) => r.receivedUnits)).toEqual([100, 100, 300]);
    expect(inventory.every((r) => r.stockoutHours === 0)).toBe(true);

    const assessment = assessEvidence(observed);
    expect(assessment.findings.map((f) => f.kind)).toEqual(['order-concentration']);
    expect(checkAssessment(assessment, observed)).toBeUndefined();
    assessment.findings.push({
      kind: 'availability-recovery',
      explanation: 'A larger delivery enabled the spike.',
      evidence: ['read_inventory'],
    });
    // The captured adaptive path actually read inventory; this is not a missing-citation test.
    const path = ['read_sales', 'read_promotions', 'read_inventory', 'read_orders', 'read_weather'];
    const run = setup('bulk-order', (request, context) => {
      const next = path[request.messages.filter((m) => m.role === 'tool').length];
      return (next ? tool(next) : answer(assessment))(request, context);
    }).start(scope);
    await expect(run.result).rejects.toMatchObject({ code: 'taskMismatch' });
    expect(run.readObservations().map((o) => o.source)).toEqual(path);
    expect(run.readTrace()?.events.at(-1)).toMatchObject({
      type: 'output.validated',
      payload: { outcome: 'failed' },
    });
  });
  it('accepts recovery supported by cited inventory, but not a sales-only citation', () => {
    const data = createDataset('restocking');
    const observed = [data.read_sales, data.read_inventory];
    const assessment = assessEvidence(observed);
    expect(assessment.findings.map((f) => f.kind)).toEqual(['availability-recovery']);
    expect(checkAssessment(assessment, observed)).toBeUndefined();
    assessment.findings[0].evidence = ['read_sales'];
    expect(checkAssessment(assessment, observed)).toBeDefined();
  });
});

describe('synthetic evidence', () => {
  it.each(caseIds)('has scoped, consistent records without case labels: %s', (id) => {
    const data = createDataset(id);
    const observations = sources.map((source) => validatePacket(data[source], source, scope));
    const sales = recordsOf(observations, 'read_sales');
    expect(calculateSpike(observations).status).toBe('found');
    for (const sale of sales) {
      expect(sale.revenue).toBe(sale.units * sale.unitPrice);
      const orders = recordsOf(observations, 'read_orders').filter(
        (o) => o.date === sale.date && !o.cancelled
      );
      if (data.read_orders.availability === 'available') {
        expect(orders.reduce((total, o) => total + o.units, 0)).toBe(sale.units);
      }
    }
    for (const packet of observations) {
      expect(packet).not.toHaveProperty('caseId');
      expect(packet).not.toHaveProperty('cause');
      if (packet.availability === 'unavailable') expect(packet.records).toEqual([]);
    }
  });

  it('distinguishes missing evidence from an observed empty source', () => {
    expect(createDataset('bulk-order').read_promotions).toMatchObject({
      availability: 'available',
      records: [],
    });
    expect(createDataset('insufficient').read_promotions).toMatchObject({
      availability: 'unavailable',
      records: [],
    });
  });

  it('does not use a hidden fixture label to choose findings', () => {
    const data = createDataset('bulk-order');
    const observed = [data.read_sales, data.read_orders];
    expect(assessEvidence(observed).findings[0].kind).toBe('order-concentration');
    data.read_orders.records = [];
    expect(assessEvidence(observed).status).toBe('insufficient-evidence');
  });
});

describe.each(controlStrategies)('%s investigation', (strategy) => {
  it.each(controlCaseIds)(
    'accepts the expected facts and evidence-limited findings for %s',
    async (id) => {
      const result = await setup(id).start(scope, { strategy }).result;
      expect(evaluateResult(id, result)).toEqual({
        numericCorrect: true,
        statusMatchesFixture: true,
        findingKindsMatchFixture: true,
        extraKinds: [],
        missedKinds: [],
        semanticQuality: 'requires-review',
      });
      const reads = result.observations.map((o) => o.source);
      expect(reads[0]).toBe('read_sales');
      expect(new Set(reads).size).toBe(reads.length);
      const expectedReads =
        strategy === 'fixed'
          ? 6
          : {
              promotion: 6,
              restocking: 3,
              'bulk-order': 2,
              'data-defect': 2,
              confounded: 6,
              insufficient: 6,
            }[id];
      expect(reads).toHaveLength(expectedReads);
      expect(result.attemptedReads).toBe(expectedReads);
      expect(result.modelCalls).toBe(strategy === 'adaptive' ? expectedReads + 1 : 1);
      expect(result.metrics?.toolCalls).toBe(strategy === 'adaptive' ? expectedReads : 0);
    }
  );
  it('stops at a smaller shared budget rather than reading the entire dataset', async () => {
    const result = await setup('confounded').start(scope, { strategy, maxReads: 2 }).result;
    expect(result.completedReads).toBe(2);
    expect(result.assessment.status).not.toBe('confounded');
  });
});

describe('host authority', () => {
  it.each(['off', 'metadata'] as const)(
    'delivers only enabled runner events (%s)',
    async (traceProfile) => {
      const onTrace = vi.fn();
      const run = createInvestigator({
        data: createMockPort(createDataset('bulk-order')),
        provider: scriptedProvider,
        traceProfile,
        onTrace,
      }).start(scope, { strategy: 'rules' });
      await run.result;
      const delivered = onTrace.mock.calls.map(([event]) => event.type);
      expect(delivered).toEqual(
        traceProfile === 'off'
          ? []
          : [
              'run.started',
              'model.requested',
              'model.returned',
              'run.completed',
              'output.validated',
            ]
      );
    }
  );
  it('advertises only a reason and dispatches every read with the original host scope', async () => {
    const data = vi.fn(createMockPort(createDataset('confounded')));
    const provider = vi.fn(scriptedProvider);
    const assignment = { ...scope };
    const run = createInvestigator({ provider, data }).start(assignment);
    assignment.productId = 'P006';
    assignment.startDate = assignment.endDate;
    await run.result;
    const definitions = provider.mock.calls[0][0].toolDefinitions ?? [];
    expect(definitions.map((d) => d.name).sort()).toEqual([...sources].sort());
    for (const { inputSchema } of definitions) {
      expect(inputSchema).toEqual(
        expect.objectContaining({
          properties: { reason: expect.objectContaining({ type: 'string' }) },
          required: ['reason'],
          additionalProperties: false,
        })
      );
    }
    expect(data.mock.calls.map(([source]) => source).sort()).toEqual([...sources].sort());
    for (const [, actualScope] of data.mock.calls) expect(actualScope).toEqual(scope);
  });

  it.each([
    ['read_orders', { scope: { ...scope, startDate: scope.endDate } }],
    ['read_comparison_sales', { scope: { ...scope, productId: 'P006' } }],
    ['read_inventory', { scope: { ...scope, storeId: 'S002' } }],
    ['read_sales', { scope: { ...scope, startDate: '2025-01-01' } }],
    ['read_orders', { startDate: scope.endDate, endDate: scope.endDate }],
    ['read_comparison_sales', { productId: 'P006' }],
  ] as const)('rejects scope overrides on %s before dispatch', async (source, override) => {
    const data = vi.fn(createMockPort(createDataset('promotion')));
    const provider: ActorAgentLlmProvider = (request, context) =>
      (request.messages.some((m) => m.role === 'tool')
        ? tool(source, { reason: 'Inspect these records.', ...override })
        : tool('read_sales'))(request, context);
    const run = createInvestigator({ provider, data }).start(scope);
    await expect(run.result).rejects.toMatchObject({ code: 'INVALID_TOOL_INPUT' });
    expect(data.mock.calls.map(([name]) => name)).toEqual(['read_sales']);
    expect(run.readCounters()).toEqual({ attemptedReads: 1, modelCalls: 2 });
  });

  it('permits a provider-selected investigation that differs from the rule tree', async () => {
    const reads = ['read_sales', 'read_weather', 'read_promotions'];
    const provider: ActorAgentLlmProvider = (request, context) => {
      const receipts = request.messages.filter((m) => m.role === 'tool');
      const source = reads[receipts.length];
      if (source) return tool(source)(request, context);
      const evidence = receipts.map((m) => JSON.parse(m.content).output.evidence);
      return answer(assessEvidence(evidence))(request, context);
    };
    const result = await setup('confounded', provider).start(scope, { maxReads: 3 }).result;
    expect(result.observations.map((o) => o.source)).toEqual(reads);
    expect(result.assessment.status).toBe('confounded');
  });
  it.each([
    ['ungranted name', tool('adjust_inventory'), 'TOOL_DENIED'],
    ['missing reason', tool('read_sales', {}), 'INVALID_TOOL_INPUT'],
    ['blank reason', tool('read_sales', { reason: '  ' }), 'INVALID_TOOL_INPUT'],
    ['oversized reason', tool('read_sales', { reason: 'x'.repeat(241) }), 'INVALID_TOOL_INPUT'],
    ['weather before sales', tool('read_weather'), 'SALES_REQUIRED'],
  ] as const)('refuses %s before a port read', async (_name, provider, code) => {
    const run = setup('promotion', provider).start(scope);
    await expect(run.result).rejects.toMatchObject({ code });
    expect(run.readCounters()).toEqual({ attemptedReads: 0, modelCalls: 1 });
  });
  it('refuses repeated reads before a second port call', async () => {
    const run = setup('promotion', tool('read_sales')).start(scope);
    await expect(run.result).rejects.toMatchObject({ code: 'REPEATED_READ' });
    expect(run.readCounters().attemptedReads).toBe(1);
  });
  it('rejects an adaptive request after the budget is used', async () => {
    const requests = ['read_sales', 'read_orders', 'read_weather'];
    let index = 0;
    const run = setup('promotion', (request, context) =>
      tool(requests[index++])(request, context)
    ).start(scope, { maxReads: 2 });
    await expect(run.result).rejects.toBeDefined();
    expect(run.readCounters()).toEqual({ attemptedReads: 2, modelCalls: 3 });
  });
  it('rejects malformed or out-of-scope port output before giving it to the model', async () => {
    const dataset = createDataset('promotion');
    dataset.read_sales.records[0].productId = 'P006';
    const run = createInvestigator({
      provider: scriptedProvider,
      data: createMockPort(dataset),
    }).start(scope, { strategy: 'fixed' });
    await expect(run.result).rejects.toMatchObject({ code: 'INVALID_EVIDENCE' });
    expect(run.readCounters()).toEqual({ attemptedReads: 1, modelCalls: 0 });
    expect(run.readObservations()).toEqual([]);
  });
  it('checks references on actual final output, not just on a prompt', async () => {
    const data = createDataset('bulk-order');
    const assessment = assessEvidence([data.read_sales, data.read_orders]);
    assessment.findings[0].evidence = ['read_weather'];
    const run = setup('bulk-order', answer(assessment)).start(scope, { strategy: 'rules' });
    await expect(run.result).rejects.toMatchObject({ code: 'taskMismatch' });
    expect(run.readTrace()?.events.at(-1)).toMatchObject({
      type: 'output.validated',
      payload: { outcome: 'failed' },
    });
  });
  it('rejects unavailable citations even if the source was requested', () => {
    const data = createDataset('insufficient');
    const observed: Observation[] = [data.read_sales, data.read_orders];
    const unsupported = assessEvidence(observed);
    unsupported.findings.push({
      kind: 'order-concentration',
      explanation: 'Bulk.',
      evidence: ['read_orders'],
    });
    expect(checkAssessment(unsupported, observed)).toBeDefined();
  });
  it('does not mistake schema acceptance for semantic truth', () => {
    const data = createDataset('bulk-order');
    const observed = [data.read_sales, data.read_orders];
    const wrong = assessEvidence(observed);
    wrong.findings[0].explanation = 'Customers bought umbrellas because of a storm.';
    expect(checkAssessment(wrong, observed)).toBeUndefined();
  });
  it('rejects a conclusion before evidence retrieval', async () => {
    const run = setup('promotion', answer(assessEvidence([]))).start(scope);
    await expect(run.result).rejects.toMatchObject({ code: 'taskMismatch' });
    expect(run.readCounters().attemptedReads).toBe(0);
  });
  it('preserves provider errors without retry', async () => {
    const run = setup('promotion', () => ({
      ok: false,
      error: { code: 'LLM_PROVIDER_UNAVAILABLE', message: 'Offline.' },
    })).start(scope);
    await expect(run.result).rejects.toMatchObject({ code: 'LLM_PROVIDER_UNAVAILABLE' });
    expect(run.readCounters().modelCalls).toBe(1);
  });
  it('does nothing on a pre-aborted assignment', async () => {
    const controller = new AbortController();
    controller.abort();
    const run = setup('promotion').start(scope, { signal: controller.signal });
    await expect(run.result).rejects.toMatchObject({ code: 'RUN_ABORTED' });
    expect(run.readCounters()).toEqual({ attemptedReads: 0, modelCalls: 0 });
  });
  it('ignores late reads on cancellation', async () => {
    let resolve: (value: unknown) => void = () => {};
    const controller = new AbortController();
    const run = createInvestigator({
      data: () =>
        new Promise((r) => {
          resolve = r;
        }),
      provider: scriptedProvider,
    }).start(scope, { strategy: 'rules', signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(run.result).rejects.toMatchObject({ code: 'RUN_ABORTED' });
    resolve(createDataset('promotion').read_sales);
    await Promise.resolve();
    expect(run.readObservations()).toEqual([]);
    expect(run.readCounters().modelCalls).toBe(0);
  });
  it('bounds a stalled host read even if the adapter ignores cancellation', async () => {
    vi.useFakeTimers();
    const run = createInvestigator({
      data: () => new Promise(() => {}),
      provider: scriptedProvider,
    }).start(scope, { strategy: 'fixed' });
    const rejected = expect(run.result).rejects.toMatchObject({ code: 'DATA_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(run.readCounters().modelCalls).toBe(0);
  });
  it('isolates concurrent assignment ledgers', async () => {
    const investigator = setup('bulk-order');
    const a = investigator.start(scope);
    const b = investigator.start(scope);
    const [first, second] = await Promise.all([a.result, b.result]);
    expect(first.assessment).toEqual(second.assessment);
    expect(a.readTrace()?.events[0].runId).not.toBe(b.readTrace()?.events[0].runId);
    first.observations.length = 0;
    expect(second.observations).toHaveLength(2);
    expect(a.readObservations()).toHaveLength(2);
  });
});
