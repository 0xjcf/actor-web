import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { z } from 'zod';

const require = createRequire(import.meta.url);
for (const [portable, codec] of [
  [await import('@actor-web/agent/portable'), await import('@actor-web/agent/zod')],
  [require('@actor-web/agent/portable'), require('@actor-web/agent/zod')],
]) {
  const agent = portable.createAgent(
    { run: async ({ task }) => JSON.stringify({ id: task.id }) },
    {
      purpose: 'test',
      systemPrompt: 'Inspect one item.',
      tools: [],
      output: codec.structured(z.strictObject({ id: z.string() })),
    }
  );
  assert.deepEqual(await agent.run({ id: 'item', signal: new AbortController().signal }), {
    id: 'item',
  });
}
