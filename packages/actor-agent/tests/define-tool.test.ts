import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineTool } from '../src/zod.js';

const context = { actorId: 'test', nodeAddress: 'local', signal: new AbortController().signal };
describe('defineTool', () => {
  it('produces a plain JSON declaration and validates input before assignment scope', () => {
    const check = vi.fn();
    const execute = vi.fn(({ count }: { count: number }) => ({ doubled: count * 2 }));
    const tool = defineTool({
      name: 'double',
      description: 'Double an assigned count.',
      input: z.strictObject({ count: z.number() }),
      output: z.strictObject({ doubled: z.number() }),
      check,
      execute,
    });
    expect(Reflect.ownKeys(tool.declaration.parameters)).not.toContain('~standard');
    expect(tool.declaration.parameters).toEqual(
      JSON.parse(JSON.stringify(tool.declaration.parameters))
    );
    expect(() => tool.handler.validateInput({ count: '2' }, {})).toThrow();
    expect(check).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(tool.handler.validateInput({ count: 2 }, {})).toEqual({ value: { count: 2 } });
    expect(check).toHaveBeenCalledWith({ count: 2 }, {});
  });

  it('preserves transformed validated types without applying the input transform twice', async () => {
    const tool = defineTool({
      name: 'parse_count',
      description: 'Parse then double a count.',
      input: z.strictObject({ count: z.string().transform(Number) }),
      output: z.strictObject({ doubled: z.number() }),
      execute: ({ count }) => ({ doubled: count * 2 }),
    });
    const { value } = tool.handler.validateInput({ count: '3' }, {});
    await expect(tool.handler.execute(value, {}, context)).resolves.toEqual({ doubled: 6 });
  });

  it('checks asynchronous handler output against its schema', async () => {
    const tool = defineTool({
      name: 'count',
      description: 'Return a count.',
      input: z.strictObject({}),
      output: z.strictObject({ count: z.number().positive() }),
      execute: async () => ({ count: -1 }),
    });
    await expect(tool.handler.execute({}, {}, context)).rejects.toThrow();
  });
});

describe('defineTool examples', () => {
  it('validates examples without executing handlers or assignment-specific checks', () => {
    const execute = vi.fn(({ count }: { count: number }) => ({ doubled: count * 2 }));
    const check = vi.fn();
    const tool = defineTool({
      name: 'double',
      description: 'Double a count.',
      input: z.strictObject({ count: z.number() }),
      output: z.strictObject({ doubled: z.number() }),
      examples: [{ input: { count: 2 }, result: { doubled: 4 } }],
      check,
      execute,
    });
    expect(tool.declaration.examples).toEqual([{ input: { count: 2 }, result: { doubled: 4 } }]);
    expect(execute).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });
  it('rejects invalid example results before a provider can see them', () => {
    expect(() =>
      defineTool({
        name: 'double',
        description: 'Double a count.',
        input: z.strictObject({ count: z.number() }),
        output: z.strictObject({ doubled: z.number().positive() }),
        examples: [{ input: { count: 2 }, result: { doubled: -4 } }],
        execute: ({ count }) => ({ doubled: count * 2 }),
      })
    ).toThrow();
  });
});
