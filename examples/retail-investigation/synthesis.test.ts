import { expect, it, vi } from 'vitest';
import { evaluateResult } from './evaluation.js';
import { weatherEvidenceRequirement } from './evidence.js';
import { createDataset, createMockPort, scope } from './fixtures.js';
import { createInvestigator, strategies } from './investigation.js';
import { scriptedProvider } from './scripted-provider.js';
import { type SynthesisPrompt, synthesisSources, workedExample } from './synthesis.js';

it.each(strategies)(
  'keeps the trusted method separate from the %s assignment',
  async (strategy) => {
    const provider = vi.fn(scriptedProvider);
    const handle = createInvestigator({
      provider,
      data: createMockPort(createDataset('alert-wet')),
    }).start(scope, { strategy });
    await handle.result;
    const [request] = provider.mock.calls[0];
    const task = JSON.parse(request.messages[0].content);
    expect(request.messages[0].role).toBe('user');
    expect(task).toMatchObject({
      objective: expect.stringContaining('largest daily sales increase'),
      scope,
    });
    expect(request.system).toContain('retail analyst');
    expect(request.system).toContain(weatherEvidenceRequirement);
    expect(request.system).toContain('Return one JSON value matching this schema:');
    expect(request.system).not.toContain(workedExample);
    expect(request.system).not.toContain(scope.productId);
    expect(request.system).not.toContain(task.objective);
    expect(request.system).toContain(
      request.tools.length ? 'no read tools are granted' : 'No further reads are available'
    );
    expect(handle.readTrace()?.events.at(-1)).toMatchObject({
      type: 'output.validated',
      payload: { validator: { revision: '3' } },
    });
  }
);

it.each(['alert-normal', 'alert-wet'] as const)(
  'only the illustrative block changes at the provider boundary: %s',
  async (caseId) => {
    const run = async (synthesisPrompt: SynthesisPrompt) => {
      const provider = vi.fn(scriptedProvider);
      const data = vi.fn(createMockPort(createDataset(caseId)));
      const handle = createInvestigator({ provider, data }).start(scope, {
        strategy: 'fixed',
        maxReads: 3,
        synthesisPrompt,
      });
      const result = await handle.result;
      expect(data.mock.calls.map(([s]) => s)).toEqual(synthesisSources);
      expect(handle.readHostReadCount()).toBe(3);
      expect(provider).toHaveBeenCalledTimes(1);
      const [request] = provider.mock.calls[0];
      expect(request.tools).toEqual([]);
      expect(JSON.parse(request.messages[0].content)).toMatchObject({ remainingReads: 0 });
      expect(JSON.stringify(request)).not.toContain(caseId);
      expect(evaluateResult(caseId, result)).toMatchObject({
        numericCorrect: true,
        statusMatchesFixture: true,
        findingKindsMatchFixture: true,
      });
      return request;
    };
    const control = await run('rule-only');
    const oneShot = await run('one-shot');
    expect(control.system).not.toContain(workedExample);
    expect(oneShot.system).toContain(workedExample);
    expect({ ...oneShot, system: oneShot.system?.replace(`${workedExample}\n`, '') }).toEqual(
      control
    );
  }
);

it('rejects a synthesis comparison with model-selected reads before spending a call', async () => {
  const provider = vi.fn(scriptedProvider);
  const data = vi.fn(createMockPort(createDataset('alert-normal')));
  const handle = createInvestigator({ provider, data }).start(scope, {
    strategy: 'adaptive',
    maxReads: 3,
    synthesisPrompt: 'one-shot',
  });
  await expect(handle.result).rejects.toMatchObject({ code: 'INVALID_EXPERIMENT_OPTION' });
  expect(data).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
});
