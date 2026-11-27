import { expect, it, vi } from 'vitest';
import { evaluateResult, selectionChecks } from './evaluation.js';
import { calculateSpike, checkAssessment } from './evidence.js';
import { createDataset, createMockPort, scope, selectionCaseIds } from './fixtures.js';
import { createInvestigator, readInstructions } from './investigation.js';
import { assessEvidence } from './policy.js';
import { scriptedProvider } from './scripted-provider.js';

it('holds messages, tools and the rest of the system prompt fixed on identical receipts', async () => {
  const run = async (readPrompt: 'standard' | 'budget-plan') => {
    const provider = vi.fn(scriptedProvider);
    const agent = createInvestigator({
      provider,
      data: createMockPort(createDataset('alert-wet')),
    });
    await agent.start(scope, { strategy: 'adaptive', maxReads: 3, readPrompt }).result;
    return provider.mock.calls.map(([{ system, messages, tools, toolDefinitions }]) => {
      expect(system).toContain(readInstructions[readPrompt]);
      return {
        system: system?.replace(readInstructions[readPrompt], '<contrast>'),
        messages,
        tools,
        toolDefinitions,
      };
    });
  };
  const baseline = await run('standard');
  expect(baseline).toHaveLength(4);
  expect(await run('budget-plan')).toEqual(baseline);
  expect(JSON.stringify(baseline)).not.toContain('alert-wet');
});

it('hides the branch until the campaign receipt, and the alert outcome until the weather receipt', () => {
  const [wet, volume, normal] = selectionCaseIds.map(createDataset);
  expect(wet.read_sales).toEqual(volume.read_sales);
  expect(normal.read_sales).toEqual(wet.read_sales);
  expect(wet.read_promotions).toEqual(normal.read_promotions);
  expect(wet.read_promotions).not.toEqual(volume.read_promotions);
  expect(wet.read_weather).not.toEqual(normal.read_weather);
});

it.each(selectionCaseIds)('has an attainable diagnostic route and exact assessment: %s', (id) => {
  const data = createDataset(id);
  const probe = id === 'volume-offer' ? 'read_orders' : 'read_weather';
  const observations = [data.read_sales, data.read_promotions, data[probe]];
  expect(
    selectionChecks(
      id,
      observations.map((o) => o.source)
    )
  ).toEqual({
    probe,
    covered: true,
    cueThenProbe: true,
  });
  expect(selectionChecks(id, ['read_sales', 'read_promotions', 'read_inventory'])?.covered).toBe(
    false
  );
  const assessment = assessEvidence(observations);
  expect(checkAssessment(assessment, observations)).toBeUndefined();
  const spike = calculateSpike(observations);
  if (spike.status !== 'found') throw new Error('Expected a spike');
  expect(evaluateResult(id, { facts: { spike: spike.increase }, assessment })).toMatchObject({
    numericCorrect: true,
    statusMatchesFixture: true,
    findingKindsMatchFixture: true,
  });
});
