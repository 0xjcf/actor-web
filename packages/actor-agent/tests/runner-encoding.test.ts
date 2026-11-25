import { describe, expect, it, vi } from 'vitest';
import type { ActorAgentLlmProvider } from '../src/index.js';
import { createAgentRunner } from '../src/runner.js';

const definition = { purpose: 'encode' as const, systemPrompt: 'Return done.', tools: [] };
const limits = {
  runTimeoutMs: 3000,
  askTimeoutMs: 2000,
  providerTimeoutMs: 1000,
  toolTimeoutMs: 100,
  maxModelTurns: 1,
  maxToolAttempts: 0,
  maxToolCallsPerBatch: 1,
  maxPayloadBytes: 8192,
};
const task = { productId: 'P005', quantity: 342 };
const signal = new AbortController().signal;
function setup(encodeTask?: (assignment: typeof task) => string) {
  const provider = vi.fn<ActorAgentLlmProvider>(() => ({
    ok: true,
    value: {
      message: { role: 'assistant', content: 'done' },
    },
  }));
  const runner = createAgentRunner<typeof task, 'encode'>({
    definition,
    provider,
    grants: [],
    tools: [],
    limits,
    ...(encodeTask && { encodeTask }),
  });
  return { runner, provider };
}
describe('default task encoding', () => {
  it('encodes a plain assignment when encodeTask is omitted', async () => {
    const { runner, provider } = setup();
    await runner.run({ ...definition, task, signal });
    expect(provider.mock.calls[0][0].messages[0].content).toBe(JSON.stringify(task));
  });
  it('preserves an explicit model-context projection', async () => {
    const { runner, provider } = setup((t) => t.productId);
    await runner.run({ ...definition, task, signal });
    expect(provider.mock.calls[0][0].messages[0].content).toBe('P005');
  });
  it('refuses unsupported values instead of silently dropping them', async () => {
    const { runner, provider } = setup();
    await expect(
      runner.run({
        ...definition,
        task: { ...task, hidden: () => 'secret' } as typeof task,
        signal,
      })
    ).rejects.toMatchObject({ code: 'INVALID_TASK' });
    expect(provider).not.toHaveBeenCalled();
  });
});
