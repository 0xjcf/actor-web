import { expect, it, vi } from 'vitest';
import { type CaseId, createDataset, createMockPort, scope } from './fixtures.js';
import { callCap, gateArms, gateScenarios } from './gate-experiment.js';
import { createInvestigator, type ReadPrompt } from './investigation.js';
import { reconcile, synthesisReason } from './reconciliation.js';
import { scriptedProvider } from './scripted-provider.js';

async function request(id: CaseId, gated: boolean, readPrompt: ReadPrompt) {
  const provider = vi.fn(scriptedProvider);
  const run = createInvestigator({ provider, data: createMockPort(createDataset(id)) }).start(
    scope,
    { strategy: 'hybrid', gated, readPrompt }
  );
  const result = await run.result;
  return { result, first: provider.mock.calls[0][0], reason: run.readSynthesisOnlyReason() };
}

it.each(['bulk-order', 'data-defect'] as const)(
  'isolates the prompt and host-grant contrasts: %s',
  async (id) => {
    const open = await request(id, false, 'standard');
    const closed = await request(id, true, 'standard');
    const alternate = await request(id, true, 'discriminate');
    expect(open.first.tools.length).toBe(4);
    expect(closed.first.tools).toEqual([]);
    expect(closed.first.system).toBe(open.first.system);
    expect(closed.first.messages).toEqual(open.first.messages);
    expect(alternate.first.system).not.toBe(closed.first.system);
    expect(alternate.first.messages).toEqual(closed.first.messages);
    expect(alternate.first.tools).toEqual(closed.first.tools);
    for (const run of [closed, alternate]) {
      expect(run.reason).toBeDefined();
      expect(run.result.attemptedReads).toBe(2);
      expect(run.result.modelCalls).toBe(1);
    }
  }
);

it.each(['mixed-order-promotion', 'partial-availability', 'restocking'] as const)(
  'keeps follow-ups available for %s',
  async (id) => {
    const r = await request(id, true, 'standard');
    expect(r.reason).toBeUndefined();
    expect(r.first.tools).toHaveLength(4);
  }
);

it('does not close when order totals conflict or the prior period already has duplicate IDs', () => {
  const data = createDataset('bulk-order');
  const summary = reconcile([data.read_sales, data.read_orders]);
  if (summary.orders.availability !== 'available') throw new Error('Expected available orders');
  expect(
    synthesisReason({ ...summary, orders: { ...summary.orders, salesTotalsMatch: false } })
  ).toBeUndefined();
  expect(
    synthesisReason({
      ...summary,
      orders: { ...summary.orders, previous: { ...summary.orders.previous, repeatedIdRows: 1 } },
    })
  ).toBeUndefined();
});

it('does not dispatch a requested read in synthesis-only mode', async () => {
  const data = vi.fn(createMockPort(createDataset('bulk-order')));
  const run = createInvestigator({
    data,
    provider: () => ({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'unexpected', name: 'read_promotions', input: { reason: 'inspect' } }],
        },
      },
    }),
  }).start(scope, { strategy: 'hybrid', gated: true });
  await expect(run.result).rejects.toBeDefined();
  expect(data.mock.calls.map(([name]) => name)).toEqual(['read_sales', 'read_orders']);
});

it('bounds the paired design and gives every arm the same budget for each case', () => {
  expect(new Set(gateArms.map((a) => a.id)).size).toBe(7);
  expect(gateScenarios.find((s) => s.caseId === 'confounded')?.maxReads).toBe(3);
  expect(
    gateScenarios.reduce(
      (n, s) => n + gateArms.reduce((v, a) => v + callCap(a.strategy, s.maxReads), 0),
      0
    )
  ).toBe(159);
});
