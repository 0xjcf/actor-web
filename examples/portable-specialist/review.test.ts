// @vitest-environment node
import type { ActorAgentLlmProvider } from '@actor-web/agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSourceReview } from './review.js';

const path = 'src/totals.ts';
const source = 'export const total = 23;';
const assignment = {
  request: 'Cite how total is defined.',
  files: [{ path, source }],
};

function requestTool(name = 'read_source', input: unknown = { path }) {
  return {
    ok: true,
    value: {
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name, input }],
      },
    },
  } as const;
}

function reply(content: string) {
  return { ok: true, value: { message: { role: 'assistant', content } } } as const;
}

afterEach(() => vi.unstubAllGlobals());

describe('portable specialist example', () => {
  it('feeds a real tool result back to the actor and returns a typed citation', async () => {
    const fetch = vi.fn(() => {
      throw new Error('The example must not make network requests.');
    });
    vi.stubGlobal('fetch', fetch);
    const onTool = vi.fn();
    const provider = vi
      .fn<ActorAgentLlmProvider>()
      .mockReturnValueOnce(requestTool())
      .mockImplementationOnce((request) => {
        const result = request.messages.at(-1);
        expect(result).toMatchObject({
          role: 'tool',
          toolCallId: 'call-1',
          toolName: 'read_source',
        });
        const observed = JSON.parse(result?.content ?? '');
        expect(observed).toEqual({ ok: true, output: source });
        return reply(JSON.stringify({ path, excerpt: observed.output }));
      });

    await expect(runSourceReview(assignment, { provider, onTool })).resolves.toEqual({
      path,
      excerpt: source,
    });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[0]?.[0]).toMatchObject({
      system: expect.stringContaining('Return one JSON value'),
      messages: [
        { role: 'user', content: JSON.stringify({ request: assignment.request, paths: [path] }) },
      ],
      tools: ['read_source'],
      toolDefinitions: [{ name: 'read_source' }],
    });
    expect(onTool.mock.calls).toEqual([['read_source']]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['an invented citation', JSON.stringify({ path, excerpt: 'invented' }), 'taskMismatch'],
    ['malformed JSON', 'not JSON', 'invalidJson'],
  ])('rejects %s without repairing it', async (_label, text, code) => {
    const provider = vi
      .fn<ActorAgentLlmProvider>()
      .mockReturnValueOnce(requestTool())
      .mockReturnValueOnce(reply(text));

    await expect(runSourceReview(assignment, { provider })).rejects.toMatchObject({
      name: 'AgentOutputError',
      code,
    });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a registered but ungranted tool', requestTool('list_sources', {}), 'TOOL_DENIED'],
    ['an out-of-scope path', requestTool('read_source', { path: 'private.ts' }), 'PATH_DENIED'],
  ])('refuses %s before any application effect', async (_label, scriptedReply, code) => {
    const provider = vi.fn<ActorAgentLlmProvider>().mockReturnValue(scriptedReply);
    const onTool = vi.fn();

    await expect(runSourceReview(assignment, { provider, onTool })).rejects.toMatchObject({ code });
    expect(onTool).not.toHaveBeenCalled();
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('propagates the provider failure category without trying to parse it as output', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>().mockReturnValue({
      ok: false,
      error: { code: 'LLM_PROVIDER_UNAVAILABLE', message: 'Scripted provider unavailable.' },
    });

    await expect(runSourceReview(assignment, { provider })).rejects.toMatchObject({
      code: 'LLM_PROVIDER_UNAVAILABLE',
    });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('allows one read and refuses another batch after both attempt and turn exhaustion', async () => {
    const first = requestTool();
    const second = {
      ...first,
      value: {
        message: {
          ...first.value.message,
          toolCalls: [{ id: 'call-2', name: 'read_source', input: { path } }],
        },
      },
    };
    const provider = vi
      .fn<ActorAgentLlmProvider>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const onTool = vi.fn();
    await expect(runSourceReview(assignment, { provider, onTool })).rejects.toMatchObject({
      name: 'ActorRuntimeError',
      code: 'TOOL_ATTEMPT_LIMIT',
    });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(onTool.mock.calls).toEqual([['read_source']]);
  });

  it('rejects a large source result before sending it to the provider', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>().mockReturnValueOnce(requestTool());
    const onTool = vi.fn();
    const files = [{ path, source: 'é'.repeat(32 * 1024) }];
    await expect(
      runSourceReview({ ...assignment, files }, { provider, onTool })
    ).rejects.toMatchObject({
      name: 'ActorRuntimeError',
      code: 'PAYLOAD_BYTE_LIMIT',
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(onTool.mock.calls).toEqual([['read_source']]);
  });
});
