import { describe, expect, it, vi } from 'vitest';
import { createLlmProvider } from '../src/llm-provider.js';

const context = { actorId: 'test', nodeAddress: 'local', signal: new AbortController().signal };
describe('Responses reasoning summaries and continuation', () => {
  it('requests summaries, separates them from content, and replays opaque reasoning before tool results', async () => {
    const reasoning = {
      type: 'reasoning',
      id: 'rs-1',
      summary: [
        { type: 'summary_text', text: 'I need the assigned records.' },
        { type: 'not_summary_text', text: 'Do not treat this as a summary.' },
      ],
      encrypted_content: 'opaque-test-value',
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [
              reasoning,
              { type: 'function_call', call_id: 'call-1', name: 'read', arguments: '{}' },
            ],
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'done' }],
              },
            ],
          })
        )
      );
    const provider = createLlmProvider({
      endpoint: 'https://example.invalid/v1/responses',
      model: 'test',
      reasoningSummary: 'auto',
      fetch,
    });
    const request = {
      messages: [{ role: 'user' as const, content: 'Read.' }],
      tools: ['read'],
      toolDefinitions: [{ name: 'read', inputSchema: { type: 'object' } }],
    };
    const first = await provider(request, context);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('Expected provider success.');
    expect(first.value.message.content).toBe('');
    expect(first.value.message.reasoningSummaries).toEqual(['I need the assigned records.']);
    expect(first.value.message.providerState?.reasoningItems).toEqual([reasoning]);
    await provider(
      {
        ...request,
        messages: [
          ...request.messages,
          first.value.message,
          { role: 'tool', toolCallId: 'call-1', content: '{"ok":true,"output":[]}' },
        ],
      },
      context
    );
    const firstWire = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    const secondWire = JSON.parse(String(fetch.mock.calls[1][1]?.body));
    expect(firstWire.reasoning).toEqual({ summary: 'auto' });
    expect(secondWire.input[1]).toEqual(reasoning);
    expect(secondWire.input[2]).toMatchObject({ type: 'function_call', call_id: 'call-1' });
    expect(secondWire.input[3]).toMatchObject({ type: 'function_call_output', call_id: 'call-1' });
  });
  it('does not invent summaries when the provider returns none', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }],
        })
      )
    );
    const provider = createLlmProvider({
      endpoint: 'https://example.invalid/v1/responses',
      model: 'test',
      fetch,
    });
    const result = await provider({ messages: [], tools: [] }, context);
    expect(result).toMatchObject({ ok: true, value: { message: { content: 'done' } } });
    if (result.ok) expect(result.value.message).not.toHaveProperty('reasoningSummaries');
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).not.toHaveProperty('reasoning');
  });
  it('refuses summary configuration on a Chat Completions endpoint', () => {
    expect(() =>
      createLlmProvider({
        endpoint: 'https://example.invalid/v1/chat/completions',
        model: 'test',
        reasoningSummary: 'auto',
      })
    ).toThrow('Responses endpoint');
  });
});
