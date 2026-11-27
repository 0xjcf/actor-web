import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type AgentRunRequest, createAgent } from '../src/portable.js';
import { AgentOutputError, structured } from '../src/zod.js';

const expertise = {
  id: 'ignite-element',
  revision: 1,
  rules: ['Sending intent does not confirm the operation succeeded.'],
} as const;
type Task = { expertise: typeof expertise; files: readonly { path: string; source: string }[] };
const task: Task = { expertise, files: [{ path: 'card.tsx', source: 'ship: () => actor.send()' }] };
const signal = new AbortController().signal;
const finding = z.strictObject({ path: z.string(), excerpt: z.string().min(1) });
const check = (content: z.output<typeof finding>, assignment: Task) =>
  assignment.files.some(
    (file) => file.path === content.path && file.source.includes(content.excerpt)
  )
    ? undefined
    : 'Citation is not present in the assignment';

describe('portable agent specs', () => {
  it('uses the same expertise as data for distinct phase methods, tools and runners', async () => {
    const writeTool = { name: 'write', description: 'Write a granted file', parameters: {} };
    const buildRun = vi.fn(async (_turn: AgentRunRequest<Task, 'build'>) => 'readyForVerification');
    const reviewRun = vi.fn(async (_turn: AgentRunRequest<Task, 'review'>) =>
      JSON.stringify({ path: 'card.tsx', excerpt: 'actor.send()' })
    );
    const build = createAgent(
      { run: buildRun },
      {
        purpose: 'build',
        systemPrompt: 'Implement the task.',
        tools: [writeTool],
        parse: (text) => text,
      }
    );
    const output = structured(finding, { check });
    const review = createAgent(
      { run: reviewRun },
      {
        purpose: 'review',
        systemPrompt: 'Inspect the supplied sources.',
        tools: [],
        output,
      }
    );
    const assignment = { ...task, signal };
    expect(await build.run(assignment)).toBe('readyForVerification');
    const detachedRun = review.run;
    expect(await detachedRun(assignment)).toEqual({ path: 'card.tsx', excerpt: 'actor.send()' });
    expect(buildRun.mock.calls).toEqual([
      [
        {
          purpose: 'build',
          tools: [writeTool],
          systemPrompt: 'Implement the task.',
          task,
          signal,
        },
      ],
    ]);
    expect(reviewRun.mock.calls).toEqual([
      [
        {
          purpose: 'review',
          tools: [],
          systemPrompt: `Inspect the supplied sources.\n${output.instructions}`,
          task,
          signal,
        },
      ],
    ]);
    expect(reviewRun.mock.calls[0]?.[0].signal).toBe(signal);
    expect(review.systemPrompt).toBe(reviewRun.mock.calls[0]?.[0].systemPrompt);
    expect(review.systemPrompt).not.toContain(expertise.rules[0]);
  });

  it('propagates host cancellation without retrying or parsing', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const parse = vi.fn((raw: string) => raw);
    const run = vi.fn(async (turn: AgentRunRequest<Task, 'build'>) => {
      turn.signal.throwIfAborted();
      return 'unused';
    });
    const agent = createAgent(
      { run },
      { purpose: 'build', tools: [], systemPrompt: 'Build.', parse }
    );
    await expect(agent.run({ ...task, signal: controller.signal })).rejects.toBe(
      controller.signal.reason
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(parse).not.toHaveBeenCalled();
  });

  it('uses the original decoder as the receiver when parsing a runtime result', async () => {
    const raw = 'Ready';
    const run = vi.fn(async (_turn: AgentRunRequest<Task, 'review'>) => raw);
    const output = {
      prefix: 'Review result',
      parse(text: string, assignment: Task) {
        expect(this).toBe(output);
        return `${this.prefix}: ${text} (${assignment.expertise.id})`;
      },
    };
    const agent = createAgent(
      { run },
      { purpose: 'review', tools: [], systemPrompt: 'Review.', output }
    );
    const direct = output.parse(raw, task);
    await expect(agent.run({ ...task, signal })).resolves.toBe(direct);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('preserves custom text protocols and parser errors', async () => {
    const reason = new Error('missing board observation');
    const run = vi.fn(async (_turn: AgentRunRequest<Task, 'review'>) => 'Fail plan');
    const review = createAgent(
      { run },
      {
        purpose: 'review',
        tools: [],
        systemPrompt: 'Review.',
        output: {
          parse(raw) {
            if (raw === 'Fail plan') throw reason;
            return raw;
          },
        },
      }
    );
    await expect(review.run({ ...task, signal })).rejects.toBe(reason);
    expect(review.systemPrompt).toBe('Review.');
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('structured output', () => {
  it.each([
    ['not JSON', 'invalidJson', 0],
    ['{"path":7,"excerpt":"x"}', 'schemaMismatch', 0],
    ['{"path":"other.tsx","excerpt":"actor.send()"}', 'taskMismatch', 1],
  ] as const)('rejects %s at the correct validation boundary', (raw, code, checks) => {
    const checked = vi.fn(check);
    const output = structured(finding, { check: checked });
    expect(() => output.parse(raw, task)).toThrowError(expect.objectContaining({ code }));
    expect(checked).toHaveBeenCalledTimes(checks);
  });

  it('decodes already-produced text without a runtime and exposes stable error codes', () => {
    const output = structured(z.enum(['blocked', 'ready']));
    expect(output.instructions).toContain('"enum":["blocked","ready"]');
    expect(output.parse('"blocked"', task)).toBe('blocked');
    expect(() => output.parse('"unknown"', task)).toThrow(AgentOutputError);
  });
});
