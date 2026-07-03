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

type AgentModule = {
  readonly ACTOR_WEB_LLM_TOOL_NAME: 'llm';
  createActorAgentToolRegistry(input: {
    readonly llm: ActorAgentLlmProvider;
  }): Record<string, (...args: readonly unknown[]) => unknown>;
  createAgentLoopBehavior(options?: { readonly system?: string }): {
    readonly context: unknown;
    readonly onMessage?: (params: unknown) => Promise<unknown> | unknown;
  };
};

const actorToolContext = {
  actorId: 'actor://local/researcher',
  nodeAddress: 'local',
};

function createAgentParams(input: {
  readonly behavior: AgentModule extends {
    createAgentLoopBehavior: (...args: readonly unknown[]) => infer TBehavior;
  }
    ? TBehavior
    : never;
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
});
