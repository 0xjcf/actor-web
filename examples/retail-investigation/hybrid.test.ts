import { describe, expect, it, vi } from 'vitest';
import { evaluateResult } from './evaluation.js';
import { type CaseId, caseIds, createDataset, createMockPort, scope } from './fixtures.js';
import { createInvestigator } from './investigation.js';
import { reconcile } from './reconciliation.js';
import { scriptedProvider } from './scripted-provider.js';

const setup = (id: CaseId) => {
  const data = vi.fn(createMockPort(createDataset(id)));
  const provider = vi.fn(scriptedProvider);
  return { data, provider, agent: createInvestigator({ data, provider }) };
};

describe('hybrid investigation', () => {
  it.each(caseIds)('preserves checkable findings with bounded real reads: %s', async (id) => {
    const { data, provider, agent } = setup(id);
    const run = agent.start(scope, { strategy: 'hybrid' });
    const result = await run.result;
    expect(evaluateResult(id, result)).toMatchObject({
      numericCorrect: true,
      statusMatchesFixture: true,
      extraKinds: [],
      missedKinds: [],
    });
    const names = data.mock.calls.map(([name]) => name);
    expect(names.slice(0, 2)).toEqual(['read_sales', 'read_orders']);
    expect(new Set(names).size).toBe(names.length);
    expect(run.readHostReadCount()).toBe(2);
    expect(result.metrics?.toolCalls).toBe(names.length - 2);
    expect(result.attemptedReads).toBeLessThanOrEqual(6);
    expect(provider.mock.calls[0][0].tools).not.toContain('read_orders');
    expect(provider.mock.calls[0][0].toolDefinitions?.map((t) => t.name)).not.toContain(
      'read_sales'
    );
    expect(provider.mock.calls[0][0].messages[0].content).not.toContain('order-row-');
    if (id === 'bulk-order' || id === 'data-defect') {
      expect(result.attemptedReads).toBe(2);
      expect(result.modelCalls).toBe(1);
      expect(run.readObservations()[1].records.length).toBeGreaterThan(20);
    }
    if (id === 'partial-availability') expect(names).toContain('read_weather');
  });

  it('counts pre-reads against a two-read budget and grants no further tools', async () => {
    const { agent, provider } = setup('mixed-order-promotion');
    const result = await agent.start(scope, { strategy: 'hybrid', maxReads: 2 }).result;
    expect(result.attemptedReads).toBe(2);
    expect(provider.mock.calls[0][0].tools).toHaveLength(0);
    expect(evaluateResult('mixed-order-promotion', result).missedKinds).toEqual(['promotion']);
  });

  it('keeps unavailable, empty, mismatched and repeated order data distinct', () => {
    const bulk = createDataset('bulk-order');
    const summarize = () => reconcile([bulk.read_sales, bulk.read_orders]).orders;
    expect(summarize()).toMatchObject({
      salesTotalsMatch: true,
      residualDeltaExcludingLargestRow: 0,
    });
    const defect = createDataset('data-defect');
    expect(reconcile([defect.read_sales, defect.read_orders]).orders).toMatchObject({
      current: { rows: 30, distinctOrderIds: 10, repeatedIdRows: 20 },
      residualDeltaExcludingLargestRow: null,
    });
    // Cancel the large order: do not count it or pretend the resulting totals reconcile.
    const last = bulk.read_orders.records.at(-1);
    if (last?.kind !== 'read_orders') throw new Error('Expected an order fixture.');
    last.cancelled = true;
    expect(summarize()).toMatchObject({
      salesTotalsMatch: false,
      current: { units: 100 },
      residualDeltaExcludingLargestRow: null,
    });
    bulk.read_orders.records = [];
    expect(summarize()).toMatchObject({
      availability: 'available',
      current: { rows: 0 },
      salesTotalsMatch: false,
    });
    bulk.read_orders.availability = 'unavailable';
    bulk.read_orders.reason = 'Unavailable';
    expect(summarize()).toEqual({ availability: 'unavailable', reason: 'Unavailable' });
  });
});
