import { createActorToolbox } from '@actor-web/runtime';
import { describe, expect, it, vi } from 'vitest';

type ActorAgentLlmProvider = (
  request: {
    readonly system?: string;
    readonly messages: readonly { readonly role: string; readonly content: string }[];
    readonly tools: readonly string[];
  },
  context: { readonly actorId: string; readonly nodeAddress: string; readonly signal: AbortSignal }
) => unknown;

type AgentLoopBehaviorHarness = {
  readonly context: unknown;
  readonly onMessage?: (params: unknown) => Promise<unknown> | unknown;
};

type AgentModule = {
  readonly ACTOR_WEB_LLM_TOOL_NAME: 'llm';
  createActorAgentToolRegistry(input: {
    readonly llm: ActorAgentLlmProvider;
  }): Record<string, (...args: readonly unknown[]) => unknown>;
  createAgentLoopBehavior(options?: { readonly system?: string }): AgentLoopBehaviorHarness;
};

type AgentLoopResultWithContext = {
  readonly context: unknown;
};

const actorToolContext = {
  actorId: 'actor://local/researcher',
  nodeAddress: 'local',
};

function readAgentLoopContext(result: unknown): unknown {
  expect(result).toMatchObject({ context: expect.any(Object) });
  return (result as AgentLoopResultWithContext).context;
}

function createAgentParams(input: {
  readonly behavior: AgentLoopBehaviorHarness;
  readonly tools: ReturnType<typeof createActorToolbox>;
  readonly message:
    | { readonly type: 'START_AGENT'; readonly prompt: string; readonly system?: string }
    | {
        readonly type: 'OBSERVE_TOOL_RESULT';
        readonly toolCallId: string;
        readonly name: string;
        readonly ok: boolean;
        readonly output: unknown;
      };
}) {
  const context = input.behavior.context;
  return {
    message: input.message,
    context,
    actor: {
      getSnapshot: () => ({ context }),
    },
    tools: input.tools,
  };
}

async function loadAgentModule(): Promise<AgentModule | null> {
  try {
    return (await import('./index.js')) as AgentModule;
  } catch {
    return null;
  }
}

describe('@actor-web/agent llm tool', () => {
  it('adapts an injected provider into the runtime tool registry', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    const provider = vi.fn<ActorAgentLlmProvider>((request, context) => ({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: `planned:${request.messages.at(-1)?.content}`,
        },
        usage: {
          inputTokens: 4,
          outputTokens: 2,
        },
      },
      observedActorId: context.actorId,
    }));
    const tools = createActorToolbox(
      agent.createActorAgentToolRegistry({ llm: provider }),
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME]
    );

    const result = await tools.execute(agent.ACTOR_WEB_LLM_TOOL_NAME, {
      system: 'Plan safely.',
      messages: [{ role: 'user', content: 'ship v1' }],
      tools: [],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: 'planned:ship v1',
        },
        usage: {
          inputTokens: 4,
          outputTokens: 2,
        },
      },
      observedActorId: 'actor://local/researcher',
    });
    expect(provider).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'Plan safely.',
        messages: [{ role: 'user', content: 'ship v1' }],
      }),
      expect.objectContaining({
        actorId: 'actor://local/researcher',
        nodeAddress: 'local',
        signal: expect.any(AbortSignal),
      })
    );
  });
});

describe('@actor-web/agent loop behavior', () => {
  it('calls the gated llm tool, records context, and emits requested tool calls', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    const provider = vi.fn<ActorAgentLlmProvider>(() => ({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: 'I need the diff before the next step.',
          toolCalls: [
            {
              id: 'call-1',
              name: 'repo.diff',
              input: { taskId: 'task-1' },
            },
          ],
        },
      },
    }));
    const behavior = agent.createAgentLoopBehavior({ system: 'You are a FAS planner.' });
    const tools = createActorToolbox(
      {
        ...agent.createActorAgentToolRegistry({ llm: provider }),
        'repo.diff': () => ({ ok: true, diff: 'changed files' }),
      },
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME, 'repo.diff']
    );

    const result = await behavior.onMessage?.(
      createAgentParams({
        behavior,
        tools,
        message: { type: 'START_AGENT', prompt: 'plan task-1' },
      })
    );

    expect(provider).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are a FAS planner.',
        messages: [{ role: 'user', content: 'plan task-1' }],
        tools: ['repo.diff'],
      }),
      expect.anything()
    );
    expect(result).toMatchObject({
      context: {
        steps: 1,
        history: [
          { role: 'user', content: 'plan task-1' },
          {
            role: 'assistant',
            content: 'I need the diff before the next step.',
            toolCalls: [
              {
                id: 'call-1',
                name: 'repo.diff',
                input: { taskId: 'task-1' },
              },
            ],
          },
        ],
        pendingToolCalls: [
          {
            id: 'call-1',
            name: 'repo.diff',
            input: { taskId: 'task-1' },
          },
        ],
      },
      reply: {
        ok: true,
        status: 'waiting-for-tool',
      },
      emit: [
        {
          type: 'AGENT_TOOL_CALL_REQUESTED',
          toolCall: {
            id: 'call-1',
            name: 'repo.diff',
            input: { taskId: 'task-1' },
          },
        },
      ],
    });
  });

  it('returns errors as facts when toolAccess does not allow llm', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    const provider = vi.fn<ActorAgentLlmProvider>(() => ({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: 'should not run',
        },
      },
    }));
    const behavior = agent.createAgentLoopBehavior();
    const tools = createActorToolbox(
      agent.createActorAgentToolRegistry({ llm: provider }),
      actorToolContext,
      []
    );

    const result = await behavior.onMessage?.(
      createAgentParams({
        behavior,
        tools,
        message: { type: 'START_AGENT', prompt: 'blocked' },
      })
    );

    expect(provider).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      reply: {
        ok: false,
        error: {
          code: 'LLM_TOOL_UNAVAILABLE',
          message: 'Actor tool "llm" is not registered.',
        },
      },
      emit: [
        {
          type: 'AGENT_STEP_FAILED',
          error: {
            code: 'LLM_TOOL_UNAVAILABLE',
          },
        },
      ],
    });
  });

  it('does not re-enter the llm until all pending tool calls are resolved', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    const provider = vi
      .fn<ActorAgentLlmProvider>()
      .mockReturnValueOnce({
        ok: true,
        value: {
          message: {
            role: 'assistant',
            content: 'Need both tool results.',
            toolCalls: [
              {
                id: 'call-1',
                name: 'repo.diff',
                input: { taskId: 'task-1' },
              },
              {
                id: 'call-2',
                name: 'repo.status',
                input: { taskId: 'task-1' },
              },
            ],
          },
        },
      })
      .mockReturnValueOnce({
        ok: true,
        value: {
          message: {
            role: 'assistant',
            content: 'All tool results observed.',
          },
        },
      });
    const behavior = agent.createAgentLoopBehavior({ system: 'You are a FAS planner.' });
    const tools = createActorToolbox(
      {
        ...agent.createActorAgentToolRegistry({ llm: provider }),
        'repo.diff': () => ({ ok: true, diff: 'changed files' }),
        'repo.status': () => ({ ok: true, clean: false }),
      },
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME, 'repo.diff', 'repo.status']
    );

    const started = await behavior.onMessage?.({
      message: { type: 'START_AGENT', prompt: 'plan task-1' },
      context: behavior.context,
      actor: {
        getSnapshot: () => ({ context: behavior.context }),
      },
      tools,
    });

    expect(started).toMatchObject({
      context: {
        steps: 1,
        pendingToolCalls: [
          { id: 'call-1', name: 'repo.diff', input: { taskId: 'task-1' } },
          { id: 'call-2', name: 'repo.status', input: { taskId: 'task-1' } },
        ],
      },
    });
    const startedContext = readAgentLoopContext(started);

    const observed = await behavior.onMessage?.({
      message: {
        type: 'OBSERVE_TOOL_RESULT',
        toolCallId: 'call-1',
        name: 'repo.diff',
        ok: true,
        output: { diff: 'changed files' },
      },
      context: startedContext,
      actor: {
        getSnapshot: () => ({ context: startedContext }),
      },
      tools,
    });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(observed).toMatchObject({
      context: {
        steps: 1,
        history: [
          { role: 'user', content: 'plan task-1' },
          {
            role: 'assistant',
            content: 'Need both tool results.',
          },
          {
            role: 'tool',
            toolCallId: 'call-1',
            toolName: 'repo.diff',
            content: JSON.stringify({
              ok: true,
              output: { diff: 'changed files' },
            }),
          },
        ],
        pendingToolCalls: [{ id: 'call-2', name: 'repo.status', input: { taskId: 'task-1' } }],
      },
      reply: {
        ok: true,
        status: 'waiting-for-tool',
        message: {
          role: 'tool',
          toolCallId: 'call-1',
          toolName: 'repo.diff',
          content: JSON.stringify({
            ok: true,
            output: { diff: 'changed files' },
          }),
        },
        toolCalls: [],
      },
      emit: [
        {
          type: 'AGENT_TOOL_RESULT_OBSERVED',
          toolCallId: 'call-1',
          name: 'repo.diff',
          ok: true,
        },
      ],
    });
  });

  it('preserves ok:false tool results when re-entering the llm after the final tool reply', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }
    const provider = vi
      .fn<ActorAgentLlmProvider>()
      .mockReturnValueOnce({
        ok: true,
        value: {
          message: {
            role: 'assistant',
            content: 'Run the diff tool.',
            toolCalls: [
              {
                id: 'call-1',
                name: 'repo.diff',
                input: { taskId: 'task-1' },
              },
            ],
          },
        },
      })
      .mockImplementationOnce((request) => ({
        ok: true,
        value: {
          message: {
            role: 'assistant',
            content: request.messages.at(-1)?.content ?? 'missing tool message',
          },
        },
      }));
    const behavior = agent.createAgentLoopBehavior({ system: 'You are a FAS planner.' });
    const tools = createActorToolbox(
      {
        ...agent.createActorAgentToolRegistry({ llm: provider }),
        'repo.diff': () => ({ ok: false, error: 'tool execution failed' }),
      },
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME, 'repo.diff']
    );

    const started = await behavior.onMessage?.({
      message: { type: 'START_AGENT', prompt: 'plan task-1' },
      context: behavior.context,
      actor: {
        getSnapshot: () => ({ context: behavior.context }),
      },
      tools,
    });
    const startedContext = readAgentLoopContext(started);

    const observed = await behavior.onMessage?.({
      message: {
        type: 'OBSERVE_TOOL_RESULT',
        toolCallId: 'call-1',
        name: 'repo.diff',
        ok: false,
        output: { error: 'tool execution failed' },
      },
      context: startedContext,
      actor: {
        getSnapshot: () => ({ context: startedContext }),
      },
      tools,
    });

    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[1]?.[0]).toMatchObject({
      messages: [
        { role: 'user', content: 'plan task-1' },
        {
          role: 'assistant',
          content: 'Run the diff tool.',
        },
        {
          role: 'tool',
          content: JSON.stringify({
            ok: false,
            output: { error: 'tool execution failed' },
          }),
        },
      ],
    });
    expect(observed).toMatchObject({
      context: {
        steps: 2,
        pendingToolCalls: [],
      },
      reply: {
        ok: true,
        status: 'responded',
        message: {
          role: 'assistant',
          content: JSON.stringify({
            ok: false,
            output: { error: 'tool execution failed' },
          }),
        },
      },
      emit: [
        {
          type: 'AGENT_TOOL_RESULT_OBSERVED',
          toolCallId: 'call-1',
          name: 'repo.diff',
          ok: false,
        },
        {
          type: 'AGENT_STEP_COMPLETED',
          step: 2,
          message: {
            role: 'assistant',
            content: JSON.stringify({
              ok: false,
              output: { error: 'tool execution failed' },
            }),
          },
        },
      ],
    });
  });
});
