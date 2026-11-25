import { describe, expect, it, vi } from 'vitest';
import { createLlmProvider } from '../src/llm-provider.js';

describe('provider parallel tool control', () => {
  for (const endpoint of [
    'https://example.invalid/v1/chat/completions',
    'https://example.invalid/v1/responses',
  ]) {
    for (const parallelToolCalls of [undefined, false, true]) {
      it(`${endpoint} preserves ${String(parallelToolCalls)}`, async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(
          async () =>
            new Response(
              JSON.stringify({
                choices: [{ message: { role: 'assistant', content: 'done' } }],
                output: [
                  {
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'done' }],
                  },
                ],
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            )
        );
        const provider = createLlmProvider({
          endpoint,
          model: 'test',
          fetch,
          ...(parallelToolCalls === undefined ? {} : { parallelToolCalls }),
        });
        const result = await provider(
          {
            messages: [{ role: 'user', content: 'Read.' }],
            tools: ['read'],
            toolDefinitions: [{ name: 'read', inputSchema: { type: 'object' } }],
          },
          { actorId: 'test', nodeAddress: 'local', signal: new AbortController().signal }
        );
        expect(result.ok).toBe(true);
        const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
        if (parallelToolCalls === undefined) expect(body).not.toHaveProperty('parallel_tool_calls');
        else expect(body.parallel_tool_calls).toBe(parallelToolCalls);
      });
    }
  }
});
