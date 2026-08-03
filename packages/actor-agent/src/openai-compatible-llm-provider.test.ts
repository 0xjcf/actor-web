import { ActorToolTimeoutError } from '@actor-web/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ActorAgentToolDefinition = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
};

type ActorAgentLlmMessage = {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolCalls?: readonly {
    readonly id: string;
    readonly name: string;
    readonly input: unknown;
  }[];
};

type ActorAgentLlmResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly message: ActorAgentLlmMessage;
        readonly usage?: {
          readonly inputTokens?: number;
          readonly outputTokens?: number;
          readonly totalTokens?: number;
        };
      };
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };

type OpenAiCompatibleProvider = (
  request: {
    readonly system?: string;
    readonly messages: readonly ActorAgentLlmMessage[];
    readonly tools: readonly string[];
    readonly toolDefinitions?: readonly ActorAgentToolDefinition[];
  },
  context: { readonly actorId: string; readonly nodeAddress: string; readonly signal: AbortSignal }
) => Promise<ActorAgentLlmResult>;

type AgentModule = {
  createOpenAiCompatibleLlmProvider(input: {
    readonly endpoint: string;
    readonly model: string;
    readonly timeoutMs?: number;
    readonly headers?: Record<string, string>;
    readonly credentials?: RequestCredentials;
    readonly fetch?: typeof fetch;
  }): OpenAiCompatibleProvider;
};

async function loadAgentModule(): Promise<AgentModule | null> {
  try {
    return (await import('./index.js')) as AgentModule;
  } catch {
    return null;
  }
}

function createContext(signal = new AbortController().signal) {
  return {
    actorId: 'actor://local/planner',
    nodeAddress: 'local',
    signal,
  } as const;
}

const declaredTools: readonly ActorAgentToolDefinition[] = [
  {
    name: 'repo.diff',
    description: 'Read the current diff for a task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'repo.files',
    description: 'List files in the repository.',
    inputSchema: {
      type: 'object',
      properties: {
        glob: { type: 'string' },
      },
    },
  },
];

describe('createOpenAiCompatibleLlmProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps a no-tool assistant completion into the actor-agent result contract', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Plan accepted.',
              },
            },
          ],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 7,
            total_tokens: 18,
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    );

    const provider = agent.createOpenAiCompatibleLlmProvider({
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'qwen2.5',
      fetch: fetchMock as typeof fetch,
    });

    const result = await provider(
      {
        system: 'You are a planner.',
        messages: [{ role: 'user', content: 'Plan task-1.' }],
        tools: [],
      },
      createContext()
    );

    expect(result).toEqual({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: 'Plan accepted.',
        },
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          totalTokens: 18,
        },
      },
    });
  });

  it('sends provider-neutral tool definitions and maps tool-result messages onto the wire format', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'repo.diff',
                      arguments: '{"taskId":"task-1"}',
                    },
                  },
                  {
                    id: 'call-2',
                    type: 'function',
                    function: {
                      name: 'repo.files',
                      arguments: '{"glob":"packages/**"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    );

    const provider = agent.createOpenAiCompatibleLlmProvider({
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'qwen2.5',
      headers: {
        authorization: 'Bearer test-token',
      },
      credentials: 'omit',
      fetch: fetchMock as typeof fetch,
    });

    const result = await provider(
      {
        system: 'You are a planner.',
        messages: [
          { role: 'user', content: 'Plan task-1.' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'historic-call-1',
                name: 'repo.diff',
                input: undefined,
              },
            ],
          },
          {
            role: 'tool',
            toolCallId: 'call-0',
            toolName: 'repo.status',
            content: '{"ok":true}',
          },
        ],
        tools: ['repo.diff', 'repo.files'],
        toolDefinitions: declaredTools,
      },
      createContext()
    );

    expect(result).toEqual({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              name: 'repo.diff',
              input: { taskId: 'task-1' },
            },
            {
              id: 'call-2',
              name: 'repo.files',
              input: { glob: 'packages/**' },
            },
          ],
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      headers: expect.objectContaining({
        'content-type': 'application/json',
        authorization: 'Bearer test-token',
      }),
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'qwen2.5',
      messages: [
        { role: 'system', content: 'You are a planner.' },
        { role: 'user', content: 'Plan task-1.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'historic-call-1',
              type: 'function',
              function: {
                name: 'repo.diff',
                arguments: 'null',
              },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call-0', content: '{"ok":true}' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'repo.diff',
            description: 'Read the current diff for a task.',
            parameters: declaredTools[0]?.inputSchema,
          },
        },
        {
          type: 'function',
          function: {
            name: 'repo.files',
            description: 'List files in the repository.',
            parameters: declaredTools[1]?.inputSchema,
          },
        },
      ],
      tool_choice: 'auto',
    });
  });

  it('returns data for malformed tool arguments', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    const provider = agent.createOpenAiCompatibleLlmProvider({
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'qwen2.5',
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: 'call-1',
                      type: 'function',
                      function: {
                        name: 'repo.diff',
                        arguments: '{"taskId":',
                      },
                    },
                  ],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      ) as typeof fetch,
    });

    const result = await provider(
      {
        messages: [{ role: 'user', content: 'Plan task-1.' }],
        tools: ['repo.diff'],
        toolDefinitions: declaredTools,
      },
      createContext()
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'LLM_TOOL_ARGUMENTS_INVALID',
      },
    });
  });

  it('returns data for undeclared or unsupported tool calls', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    const provider = agent.createOpenAiCompatibleLlmProvider({
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'qwen2.5',
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: 'call-1',
                      type: 'custom',
                      function: {
                        name: 'repo.secret',
                        arguments: '{}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      ) as typeof fetch,
    });

    const result = await provider(
      {
        messages: [{ role: 'user', content: 'Plan task-1.' }],
        tools: ['repo.diff'],
        toolDefinitions: declaredTools,
      },
      createContext()
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'LLM_TOOL_UNSUPPORTED',
      },
    });
  });

  it('returns provider-unavailable data for non-2xx responses and network failures', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    const nonOkProvider = agent.createOpenAiCompatibleLlmProvider({
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'qwen2.5',
      fetch: vi.fn(async () => new Response('upstream unavailable', { status: 503 })) as typeof fetch,
    });
    const networkProvider = agent.createOpenAiCompatibleLlmProvider({
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'qwen2.5',
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });

    await expect(
      nonOkProvider(
        {
          messages: [{ role: 'user', content: 'Plan task-1.' }],
          tools: [],
        },
        createContext()
      )
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'LLM_PROVIDER_UNAVAILABLE',
        message: 'OpenAI-compatible provider is unavailable.',
      },
    });

    await expect(
      networkProvider(
        {
          messages: [{ role: 'user', content: 'Plan task-1.' }],
          tools: [],
        },
        createContext()
      )
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'LLM_PROVIDER_UNAVAILABLE',
        message: 'OpenAI-compatible provider is unavailable.',
      },
    });
  });

  it('cleans up timeout and parent abort listener when fetch rejects before headers arrive', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    vi.useFakeTimers();
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, 'addEventListener');
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed immediately');
    });
    const provider = agent.createOpenAiCompatibleLlmProvider({
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'qwen2.5',
      timeoutMs: 25,
      fetch: fetchMock as typeof fetch,
    });

    const result = await provider(
      {
        messages: [{ role: 'user', content: 'Plan task-1.' }],
        tools: [],
      },
      createContext(controller.signal)
    );

    await vi.advanceTimersByTimeAsync(25);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'LLM_PROVIDER_UNAVAILABLE',
        message: 'OpenAI-compatible provider is unavailable.',
      },
    });
    expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(clearTimeoutSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('returns timeout and cancellation data instead of throwing', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    vi.useFakeTimers();
    const createAbortAwareFetch = () =>
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      });

    const timeoutFetch = createAbortAwareFetch();
    const timeoutProvider = agent.createOpenAiCompatibleLlmProvider({
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'qwen2.5',
      timeoutMs: 25,
      fetch: timeoutFetch as typeof fetch,
    });

    const cancelledFetch = createAbortAwareFetch();
    const cancelledProvider = agent.createOpenAiCompatibleLlmProvider({
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'qwen2.5',
      fetch: cancelledFetch as typeof fetch,
    });
    const cancelledController = new AbortController();
    cancelledController.abort(new DOMException('Cancelled by caller', 'AbortError'));

    const timeoutPromise = timeoutProvider(
      {
        messages: [{ role: 'user', content: 'Plan task-1.' }],
        tools: [],
      },
      createContext()
    );

    await vi.advanceTimersByTimeAsync(25);

    await expect(timeoutPromise).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'LLM_PROVIDER_TIMEOUT',
        message: 'OpenAI-compatible provider timed out after 25ms.',
      },
    });

    await expect(
      cancelledProvider(
        {
          messages: [{ role: 'user', content: 'Plan task-1.' }],
          tools: [],
        },
        createContext(cancelledController.signal)
      )
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'LLM_PROVIDER_CANCELLED',
      },
    });

    vi.useRealTimers();
  });

  it('keeps provider timeout active while the response body is still stalled', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    const stalledBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"choices":['));
      },
    });
    const fetchMock = vi.fn(async () =>
      new Response(stalledBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const provider = agent.createOpenAiCompatibleLlmProvider({
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'qwen2.5',
      timeoutMs: 25,
      fetch: fetchMock as typeof fetch,
    });

    const pending = provider(
      {
        messages: [{ role: 'user', content: 'Plan task-1.' }],
        tools: [],
      },
      createContext()
    );

    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'LLM_PROVIDER_TIMEOUT',
        message: 'OpenAI-compatible provider timed out after 25ms.',
      },
    });
    vi.useRealTimers();
  });

  it('keeps caller cancellation active while the response body is still stalled', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    const encoder = new TextEncoder();
    const stalledBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"choices":['));
      },
    });
    const fetchMock = vi.fn(async () =>
      new Response(stalledBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const provider = agent.createOpenAiCompatibleLlmProvider({
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'qwen2.5',
      fetch: fetchMock as typeof fetch,
    });
    const controller = new AbortController();

    const pending = provider(
      {
        messages: [{ role: 'user', content: 'Plan task-1.' }],
        tools: [],
      },
      createContext(controller.signal)
    );

    controller.abort(new DOMException('Cancelled by caller', 'AbortError'));

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'LLM_PROVIDER_CANCELLED',
      },
    });
  });

  it('returns invalid-response data when the assistant message has neither content nor tool calls', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    const provider = agent.createOpenAiCompatibleLlmProvider({
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'qwen2.5',
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      ) as typeof fetch,
    });

    const result = await provider(
      {
        messages: [{ role: 'user', content: 'Plan task-1.' }],
        tools: [],
      },
      createContext()
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'LLM_PROVIDER_INVALID_RESPONSE',
      },
    });
  });

  it('filters direct-caller tool definitions and response tool calls against authoritative request.tools', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'repo.secret',
                      arguments: '{}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    );
    const provider = agent.createOpenAiCompatibleLlmProvider({
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'qwen2.5',
      fetch: fetchMock as typeof fetch,
    });

    const result = await provider(
      {
        messages: [{ role: 'user', content: 'Plan task-1.' }],
        tools: ['repo.diff'],
        toolDefinitions: [
          ...declaredTools,
          {
            name: 'repo.secret',
            description: 'Should be ignored because request.tools did not authorize it.',
            inputSchema: { type: 'object' },
          },
        ],
      },
      createContext()
    );

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      tools: [
        {
          type: 'function',
          function: {
            name: 'repo.diff',
          },
        },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'LLM_TOOL_UNSUPPORTED',
      },
    });
  });
});
