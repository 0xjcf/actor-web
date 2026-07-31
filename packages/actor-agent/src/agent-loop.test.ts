import {
  createActorToolbox,
  createAgentSessionCheckpointEnvelope,
  createInMemoryAgentSessionCheckpointStore,
} from '@actor-web/runtime';
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
  createAgentLoopBehavior(options?: {
    readonly system?: string;
    readonly initialCheckpointState?: {
      readonly system?: string;
      readonly history: readonly { readonly role: string; readonly content: string }[];
      readonly steps: number;
      readonly pendingToolCalls: readonly {
        readonly id: string;
        readonly name: string;
        readonly input: unknown;
      }[];
      readonly lastError: null | { readonly code: string; readonly message: string };
    };
    readonly checkpoint?: {
      readonly store: {
        read(input: { readonly sessionId: string }): Promise<unknown>;
        write(envelope: unknown): Promise<unknown>;
      };
      readonly sessionId: string;
      readonly actorId?: string;
      readonly now?: () => Date;
    };
  }): AgentLoopBehaviorHarness;
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

  it('rehydrates loop state from the checkpoint seam before the next turn resumes', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }

    const behavior = agent.createAgentLoopBehavior({
      initialCheckpointState: {
        history: [
          { role: 'user', content: 'Plan the rollout.' },
          {
            role: 'assistant',
            content: 'Need the repo diff before I can continue.',
            toolCalls: [
              {
                id: 'call-1',
                name: 'repo.diff',
                input: { taskId: 'task-1' },
              },
            ],
          },
        ],
        steps: 1,
        pendingToolCalls: [
          {
            id: 'call-1',
            name: 'repo.diff',
            input: { taskId: 'task-1' },
          },
        ],
        lastError: null,
      },
    });

    expect(behavior.context).toMatchObject({
      history: [
        { role: 'user', content: 'Plan the rollout.' },
        {
          role: 'assistant',
          content: 'Need the repo diff before I can continue.',
          toolCalls: [
            {
              id: 'call-1',
              name: 'repo.diff',
              input: { taskId: 'task-1' },
            },
          ],
        },
      ],
      steps: 1,
      pendingToolCalls: [
        {
          id: 'call-1',
          name: 'repo.diff',
          input: { taskId: 'task-1' },
        },
      ],
      lastError: null,
    });
  });

  it('keeps logical turn continuity across a clean checkpoint restart without replaying the prior llm step', async () => {
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
            content: 'Need the repo diff before I can continue.',
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
      .mockReturnValueOnce({
        ok: true,
        value: {
          message: {
            role: 'assistant',
            content: 'Diff observed, continue the same turn.',
          },
        },
      });
    const firstBehavior = agent.createAgentLoopBehavior({ system: 'Default planner policy.' });
    const tools = createActorToolbox(
      {
        ...agent.createActorAgentToolRegistry({ llm: provider }),
        'repo.diff': () => ({ ok: true, diff: 'changed files' }),
      },
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME, 'repo.diff']
    );

    const started = await firstBehavior.onMessage?.(
      createAgentParams({
        behavior: firstBehavior,
        tools,
        message: {
          type: 'START_AGENT',
          prompt: 'plan task-1',
          system: 'Use the task-specific restart policy.',
        },
      })
    );
    const startedContext = readAgentLoopContext(started);

    const resumedBehavior = agent.createAgentLoopBehavior({
      initialCheckpointState: startedContext as {
        readonly system?: string;
        readonly history: readonly { readonly role: string; readonly content: string }[];
        readonly steps: number;
        readonly pendingToolCalls: readonly {
          readonly id: string;
          readonly name: string;
          readonly input: unknown;
        }[];
        readonly lastError: null | { readonly code: string; readonly message: string };
      },
    });
    const resumed = await resumedBehavior.onMessage?.({
      message: {
        type: 'OBSERVE_TOOL_RESULT',
        toolCallId: 'call-1',
        name: 'repo.diff',
        ok: true,
        output: { diff: 'changed files' },
      },
      context: resumedBehavior.context,
      actor: {
        getSnapshot: () => ({ context: resumedBehavior.context }),
      },
      tools,
    });

    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[1]?.[0]).toMatchObject({
      system: 'Use the task-specific restart policy.',
      messages: [
        { role: 'user', content: 'plan task-1' },
        {
          role: 'assistant',
          content: 'Need the repo diff before I can continue.',
        },
        {
          role: 'tool',
          toolCallId: 'call-1',
          toolName: 'repo.diff',
        },
      ],
    });
    expect(resumed).toMatchObject({
      context: {
        steps: 2,
        pendingToolCalls: [],
      },
      reply: {
        ok: true,
        status: 'responded',
        message: {
          role: 'assistant',
          content: 'Diff observed, continue the same turn.',
        },
      },
    });
  });

  it('loads checkpoint-store state before the next turn and defers pre-receipt restart reconciliation', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }

    const resumedStore = createInMemoryAgentSessionCheckpointStore();
    await resumedStore.write(
      createAgentSessionCheckpointEnvelope({
        sessionId: 'session:agent:resume',
        checkpointId: 'checkpoint:agent:resume',
        actor: {
          actorId: 'actor://local/researcher',
          sessionId: 'session:agent:resume',
          turnId: 'turn:1',
          traceId: 'trace:1',
          commandId: 'cmd:1',
          correlationId: 'corr:1',
          causationId: 'cause:1',
        },
        deterministic: {
          system: 'Resume from store.',
          history: [
            { role: 'user', content: 'Plan task-1' },
            {
              role: 'assistant',
              content: 'Need the repo diff before I can continue.',
              toolCalls: [{ id: 'call-1', name: 'repo.diff', input: { taskId: 'task-1' } }],
            },
          ],
          steps: 1,
          pendingToolCalls: [{ id: 'call-1', name: 'repo.diff', input: { taskId: 'task-1' } }],
          lastError: null,
        },
        effect: {
          effectId: 'effect:resume',
          effectAttemptId: 'effect-attempt:resume',
          phase: 'receipt_recorded',
          irreversible: true,
          intent: { tool: 'llm' },
          receipt: { ok: true },
        },
        continuation: null,
        reconciliation: { status: 'clear' },
        recordedAt: '2026-04-25T18:00:00.000Z',
      })
    );

    const provider = vi.fn<ActorAgentLlmProvider>().mockReturnValue({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: 'Diff observed, continue the same turn.',
        },
      },
    });
    const resumedBehavior = agent.createAgentLoopBehavior({
      checkpoint: {
        store: resumedStore,
        sessionId: 'session:agent:resume',
        actorId: 'actor://local/researcher',
        now: () => new Date('2026-04-25T18:00:01.000Z'),
      },
    });
    const resumedTools = createActorToolbox(
      {
        ...agent.createActorAgentToolRegistry({ llm: provider }),
        'repo.diff': () => ({ ok: true, diff: 'changed files' }),
      },
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME, 'repo.diff']
    );

    const resumed = await resumedBehavior.onMessage?.({
      message: {
        type: 'OBSERVE_TOOL_RESULT',
        toolCallId: 'call-1',
        name: 'repo.diff',
        ok: true,
        output: { diff: 'changed files' },
      },
      context: resumedBehavior.context,
      actor: {
        getSnapshot: () => ({ context: resumedBehavior.context }),
      },
      tools: resumedTools,
    });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0]?.[0]).toMatchObject({
      system: 'Resume from store.',
      messages: [
        { role: 'user', content: 'Plan task-1' },
        {
          role: 'assistant',
          content: 'Need the repo diff before I can continue.',
        },
        {
          role: 'tool',
          toolCallId: 'call-1',
          toolName: 'repo.diff',
        },
      ],
    });
    expect(resumed).toMatchObject({
      reply: {
        ok: true,
        status: 'responded',
      },
    });

    const reconciliationStore = createInMemoryAgentSessionCheckpointStore();
    await reconciliationStore.write(
      createAgentSessionCheckpointEnvelope({
        sessionId: 'session:agent:reconcile',
        checkpointId: 'checkpoint:agent:reconcile',
        actor: {
          actorId: 'actor://local/researcher',
          sessionId: 'session:agent:reconcile',
          turnId: 'turn:1',
          traceId: 'trace:reconcile:1',
          commandId: 'cmd:reconcile:1',
          correlationId: 'corr:reconcile:1',
          causationId: 'cause:reconcile:1',
        },
        deterministic: {
          system: 'Resume from store.',
          history: [{ role: 'user', content: 'Plan task-2' }],
          steps: 0,
          pendingToolCalls: [],
          lastError: null,
        },
        effect: {
          effectId: 'effect:reconcile',
          effectAttemptId: 'effect-attempt:reconcile',
          phase: 'intent_recorded',
          irreversible: true,
          intent: { tool: 'llm' },
        },
        continuation: null,
        reconciliation: { status: 'clear' },
        recordedAt: '2026-04-25T18:00:00.000Z',
      })
    );

    const blockedProvider = vi.fn<ActorAgentLlmProvider>().mockReturnValue({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: 'should not run',
        },
      },
    });
    const blockedBehavior = agent.createAgentLoopBehavior({
      checkpoint: {
        store: reconciliationStore,
        sessionId: 'session:agent:reconcile',
        actorId: 'actor://local/researcher',
        now: () => new Date('2026-04-25T18:00:01.000Z'),
      },
    });
    const blockedTools = createActorToolbox(
      agent.createActorAgentToolRegistry({ llm: blockedProvider }),
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME]
    );

    const blocked = await blockedBehavior.onMessage?.(
      createAgentParams({
        behavior: blockedBehavior,
        tools: blockedTools,
        message: { type: 'START_AGENT', prompt: 'plan task-2' },
      })
    );

    expect(blockedProvider).not.toHaveBeenCalled();
    expect(blocked).toMatchObject({
      reply: {
        ok: false,
        error: {
          code: 'CHECKPOINT_RECONCILIATION_REQUIRED',
        },
      },
      emit: [
        {
          type: 'AGENT_STEP_FAILED',
          error: {
            code: 'CHECKPOINT_RECONCILIATION_REQUIRED',
          },
        },
      ],
    });
  });

  it('fails closed before dispatch when the checkpoint intent write is rejected', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }

    const provider = vi.fn<ActorAgentLlmProvider>().mockReturnValue({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: 'should not run',
        },
      },
    });
    const behavior = agent.createAgentLoopBehavior({
      system: 'Checkpoint-gated planner.',
      checkpoint: {
        store: {
          read: async () => ({ outcome: 'missing', sessionId: 'session:agent:write-failure' }),
          write: async (envelope) => ({
            outcome: 'rejected' as const,
            envelope: envelope as never,
            reason: 'checkpoint write rejected',
          }),
        },
        sessionId: 'session:agent:write-failure',
      },
    });
    const tools = createActorToolbox(
      agent.createActorAgentToolRegistry({ llm: provider }),
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME]
    );

    const result = await behavior.onMessage?.(
      createAgentParams({
        behavior,
        tools,
        message: { type: 'START_AGENT', prompt: 'blocked by checkpoint write' },
      })
    );

    expect(provider).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      reply: {
        ok: false,
        error: {
          code: 'CHECKPOINT_WRITE_FAILED',
        },
      },
    });
  });

  it('does not silently resume from checkpoint envelopes with invalid deterministic state', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }

    const resumedStore = createInMemoryAgentSessionCheckpointStore();
    await resumedStore.write(
      createAgentSessionCheckpointEnvelope({
        sessionId: 'session:agent:invalid-state',
        checkpointId: 'checkpoint:agent:invalid-state',
        actor: {
          actorId: 'actor://local/researcher',
          sessionId: 'session:agent:invalid-state',
          turnId: 'turn:1',
          traceId: 'trace:invalid-state:1',
          commandId: 'cmd:invalid-state:1',
          correlationId: 'corr:invalid-state:1',
          causationId: 'cause:invalid-state:1',
        },
        deterministic: {
          system: 'Resume from store.',
          history: 'not-an-array',
          steps: 1,
          pendingToolCalls: [],
          lastError: null,
        } as never,
        effect: {
          effectId: 'effect:invalid-state',
          effectAttemptId: 'effect-attempt:invalid-state',
          phase: 'receipt_recorded',
          irreversible: true,
          intent: { tool: 'llm' },
          receipt: { ok: true },
        },
        continuation: null,
        reconciliation: { status: 'clear' },
        recordedAt: '2026-04-25T18:00:00.000Z',
      })
    );

    const provider = vi.fn<ActorAgentLlmProvider>().mockReturnValue({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: 'should not run',
        },
      },
    });
    const behavior = agent.createAgentLoopBehavior({
      checkpoint: {
        store: resumedStore,
        sessionId: 'session:agent:invalid-state',
        actorId: 'actor://local/researcher',
      },
    });
    const tools = createActorToolbox(
      agent.createActorAgentToolRegistry({ llm: provider }),
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME]
    );

    const result = await behavior.onMessage?.(
      createAgentParams({
        behavior,
        tools,
        message: { type: 'START_AGENT', prompt: 'resume invalid state' },
      })
    );

    expect(provider).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      reply: {
        ok: false,
        error: {
          code: 'CHECKPOINT_INVALID_STATE',
        },
      },
    });
  });

  it('fails closed when the checkpoint receipt write fails after the llm returns', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }

    const provider = vi.fn<ActorAgentLlmProvider>().mockReturnValue({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: 'checkpoint receipt should gate success',
        },
      },
    });
    const writes: unknown[] = [];
    const behavior = agent.createAgentLoopBehavior({
      system: 'Checkpoint-gated planner.',
      checkpoint: {
        store: {
          read: async () => ({ outcome: 'missing', sessionId: 'session:agent:receipt-failure' }),
          write: async (envelope) => {
            writes.push(envelope);
            return writes.length === 1
              ? ({ outcome: 'stored', envelope } as const)
              : ({
                  outcome: 'rejected',
                  envelope,
                  reason: 'checkpoint receipt rejected',
                } as const);
          },
        },
        sessionId: 'session:agent:receipt-failure',
      },
    });
    const tools = createActorToolbox(
      agent.createActorAgentToolRegistry({ llm: provider }),
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME]
    );

    const result = await behavior.onMessage?.(
      createAgentParams({
        behavior,
        tools,
        message: { type: 'START_AGENT', prompt: 'receipt write must gate success' },
      })
    );

    expect(provider).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      reply: {
        ok: false,
        error: {
          code: 'CHECKPOINT_WRITE_FAILED',
        },
      },
    });
  });

  it('preserves the original thrown error as cause when checkpoint writes throw', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }

    const checkpointError = new Error('checkpoint store unavailable');
    const provider = vi.fn<ActorAgentLlmProvider>().mockReturnValue({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: 'should not matter',
        },
      },
    });
    const behavior = agent.createAgentLoopBehavior({
      system: 'Checkpoint-gated planner.',
      checkpoint: {
        store: {
          read: async () => ({ outcome: 'missing', sessionId: 'session:agent:checkpoint-cause' }),
          write: async () => {
            throw checkpointError;
          },
        },
        sessionId: 'session:agent:checkpoint-cause',
      },
    });
    const tools = createActorToolbox(
      agent.createActorAgentToolRegistry({ llm: provider }),
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME]
    );

    const result = await behavior.onMessage?.(
      createAgentParams({
        behavior,
        tools,
        message: { type: 'START_AGENT', prompt: 'preserve cause' },
      })
    );

    expect(provider).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      reply: {
        ok: false,
        error: {
          code: 'AGENT_LOOP_FAILED',
        },
      },
    });
    expect(result).toMatchObject({
      reply: {
        error: {
          cause: {
            original: checkpointError,
            durability: {
              code: 'AGENT_LOOP_FAILED',
              cause: checkpointError,
            },
          },
        },
      },
    });
  });

  it('redacts raw provider message content from checkpoint receipts', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }

    const writes: unknown[] = [];
    const behavior = agent.createAgentLoopBehavior({
      system: 'Checkpoint-gated planner.',
      checkpoint: {
        store: {
          read: async () => ({ outcome: 'missing', sessionId: 'session:agent:redacted-receipt' }),
          write: async (envelope) => {
            writes.push(envelope);
            return { outcome: 'stored' as const, envelope };
          },
        },
        sessionId: 'session:agent:redacted-receipt',
      },
    });
    const tools = createActorToolbox(
      agent.createActorAgentToolRegistry({
        llm: () => ({
          ok: true,
          value: {
            message: {
              role: 'assistant',
              content: 'raw provider content should not be checkpointed',
            },
          },
        }),
      }),
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME]
    );

    await behavior.onMessage?.(
      createAgentParams({
        behavior,
        tools,
        message: { type: 'START_AGENT', prompt: 'redact raw receipt' },
      })
    );

    expect(writes).toHaveLength(2);
    const receiptEnvelope = writes[1] as {
      effect?: {
        receipt?: {
          ok: true;
          value?: {
            message?: Record<string, unknown>;
          };
        };
      };
    };
    expect(receiptEnvelope.effect?.receipt).toMatchObject({
      ok: true,
      value: {
        message: {
          role: 'assistant',
        },
      },
    });
    expect(receiptEnvelope.effect?.receipt?.value?.message).not.toHaveProperty('content');
  });

  it('retries checkpoint bootstrap after a blocked read instead of caching the blocked result', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }

    const resumedStore = createInMemoryAgentSessionCheckpointStore();
    await resumedStore.write(
      createAgentSessionCheckpointEnvelope({
        sessionId: 'session:agent:bootstrap-retry',
        checkpointId: 'checkpoint:agent:bootstrap-retry',
        actor: {
          actorId: 'actor://local/researcher',
          sessionId: 'session:agent:bootstrap-retry',
          turnId: 'turn:1',
          traceId: 'trace:bootstrap-retry:1',
          commandId: 'cmd:bootstrap-retry:1',
          correlationId: 'corr:bootstrap-retry:1',
          causationId: 'cause:bootstrap-retry:1',
        },
        deterministic: {
          system: 'Resume from store.',
          history: [{ role: 'user', content: 'Plan task-3' }],
          steps: 0,
          pendingToolCalls: [],
          lastError: null,
        },
        effect: {
          effectId: 'effect:bootstrap-retry',
          effectAttemptId: 'effect-attempt:bootstrap-retry',
          phase: 'intent_recorded',
          irreversible: true,
          intent: { tool: 'llm' },
        },
        continuation: null,
        reconciliation: { status: 'clear' },
        recordedAt: '2026-04-25T18:00:00.000Z',
      })
    );

    const provider = vi.fn<ActorAgentLlmProvider>().mockReturnValue({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: 'bootstrap resumed after retry',
        },
      },
    });
    const behavior = agent.createAgentLoopBehavior({
      checkpoint: {
        store: resumedStore,
        sessionId: 'session:agent:bootstrap-retry',
        actorId: 'actor://local/researcher',
      },
    });
    const tools = createActorToolbox(
      agent.createActorAgentToolRegistry({ llm: provider }),
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME]
    );

    const blocked = await behavior.onMessage?.(
      createAgentParams({
        behavior,
        tools,
        message: { type: 'START_AGENT', prompt: 'should block first' },
      })
    );
    expect(blocked).toMatchObject({
      reply: {
        ok: false,
        error: {
          code: 'CHECKPOINT_RECONCILIATION_REQUIRED',
        },
      },
    });

    await resumedStore.write(
      createAgentSessionCheckpointEnvelope({
        sessionId: 'session:agent:bootstrap-retry',
        checkpointId: 'checkpoint:agent:bootstrap-retry-ready',
        actor: {
          actorId: 'actor://local/researcher',
          sessionId: 'session:agent:bootstrap-retry',
          turnId: 'turn:2',
          traceId: 'trace:bootstrap-retry:2',
          commandId: 'cmd:bootstrap-retry:2',
          correlationId: 'corr:bootstrap-retry:2',
          causationId: 'cause:bootstrap-retry:2',
        },
        deterministic: {
          system: 'Resume from store.',
          history: [{ role: 'user', content: 'Plan task-3' }],
          steps: 0,
          pendingToolCalls: [],
          lastError: null,
        },
        effect: {
          effectId: 'effect:bootstrap-retry-ready',
          effectAttemptId: 'effect-attempt:bootstrap-retry-ready',
          phase: 'receipt_recorded',
          irreversible: true,
          intent: { tool: 'llm' },
          receipt: { ok: true },
        },
        continuation: null,
        reconciliation: { status: 'clear' },
        recordedAt: '2026-04-25T18:00:01.000Z',
      })
    );

    const resumed = await behavior.onMessage?.(
      createAgentParams({
        behavior,
        tools,
        message: { type: 'START_AGENT', prompt: 'should retry bootstrap' },
      })
    );

    expect(provider).toHaveBeenCalledTimes(1);
    expect(resumed).toMatchObject({
      reply: {
        ok: true,
      },
    });
  });

  it('retries checkpoint bootstrap after manual recovery is blocked instead of silently proceeding', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }

    const resumedStore = createInMemoryAgentSessionCheckpointStore();
    await resumedStore.write(
      createAgentSessionCheckpointEnvelope({
        sessionId: 'session:agent:manual-retry',
        checkpointId: 'checkpoint:agent:manual-retry-blocked',
        actor: {
          actorId: 'actor://local/researcher',
          sessionId: 'session:agent:manual-retry',
          turnId: 'turn:1',
          traceId: 'trace:manual-retry:1',
          commandId: 'cmd:manual-retry:1',
          correlationId: 'corr:manual-retry:1',
          causationId: 'cause:manual-retry:1',
        },
        deterministic: {
          system: 'Resume from store.',
          history: [{ role: 'user', content: 'Plan task-4' }],
          steps: 0,
          pendingToolCalls: [],
          lastError: null,
        },
        effect: {
          effectId: 'effect:manual-retry',
          effectAttemptId: 'effect-attempt:manual-retry',
          phase: 'intent_recorded',
          irreversible: true,
          intent: { tool: 'llm' },
        },
        continuation: null,
        reconciliation: { status: 'clear' },
        recordedAt: '2026-04-25T18:00:00.000Z',
        staleAt: '2026-04-25T18:00:00.000Z',
      })
    );

    let reads = 0;
    const provider = vi.fn<ActorAgentLlmProvider>().mockReturnValue({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: 'manual recovery resolved on retry',
        },
      },
    });
    const behavior = agent.createAgentLoopBehavior({
      checkpoint: {
        store: {
          read: async () => {
            reads += 1;
            return reads === 1
              ? resumedStore.read({ sessionId: 'session:agent:manual-retry' })
              : ({ outcome: 'missing', sessionId: 'session:agent:manual-retry' } as const);
          },
          write: async (envelope) => ({ outcome: 'stored' as const, envelope }),
        },
        sessionId: 'session:agent:manual-retry',
      },
    });
    const tools = createActorToolbox(
      agent.createActorAgentToolRegistry({ llm: provider }),
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME]
    );

    const blocked = await behavior.onMessage?.(
      createAgentParams({
        behavior,
        tools,
        message: { type: 'START_AGENT', prompt: 'should block first' },
      })
    );
    expect(blocked).toMatchObject({
      reply: {
        ok: false,
        error: {
          code: 'CHECKPOINT_RECOVERY_REQUIRED',
        },
      },
    });
    expect(provider).not.toHaveBeenCalled();

    const resumed = await behavior.onMessage?.(
      createAgentParams({
        behavior,
        tools,
        message: { type: 'START_AGENT', prompt: 'should retry after manual recovery' },
      })
    );
    expect(reads).toBe(2);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(resumed).toMatchObject({
      reply: {
        ok: true,
      },
    });
  });

  it('retries checkpoint bootstrap after a read failure instead of silently proceeding', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }

    let reads = 0;
    const provider = vi.fn<ActorAgentLlmProvider>().mockReturnValue({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: 'read failure resolved on retry',
        },
      },
    });
    const behavior = agent.createAgentLoopBehavior({
      checkpoint: {
        store: {
          read: async () => {
            reads += 1;
            if (reads === 1) {
              throw new Error('checkpoint read unavailable');
            }
            return { outcome: 'missing', sessionId: 'session:agent:read-retry' } as const;
          },
          write: async (envelope) => ({ outcome: 'stored' as const, envelope }),
        },
        sessionId: 'session:agent:read-retry',
      },
    });
    const tools = createActorToolbox(
      agent.createActorAgentToolRegistry({ llm: provider }),
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME]
    );

    const blocked = await behavior.onMessage?.(
      createAgentParams({
        behavior,
        tools,
        message: { type: 'START_AGENT', prompt: 'should block on read failure' },
      })
    );
    expect(blocked).toMatchObject({
      reply: {
        ok: false,
        error: {
          code: 'CHECKPOINT_READ_FAILED',
        },
      },
    });
    expect(provider).not.toHaveBeenCalled();

    const resumed = await behavior.onMessage?.(
      createAgentParams({
        behavior,
        tools,
        message: { type: 'START_AGENT', prompt: 'should retry after read failure' },
      })
    );
    expect(reads).toBe(2);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(resumed).toMatchObject({
      reply: {
        ok: true,
      },
    });
  });

  it('preserves the original llm failure when the receipt checkpoint write fails', async () => {
    const agent = await loadAgentModule();
    expect(agent).not.toBeNull();
    if (!agent) {
      return;
    }

    const llmFailure = {
      code: 'LLM_TOOL_UNAVAILABLE',
      message: 'provider offline',
      cause: 'vendor:test-provider',
    } as const;
    const writes: unknown[] = [];
    const behavior = agent.createAgentLoopBehavior({
      checkpoint: {
        store: {
          read: async () => ({
            outcome: 'missing',
            sessionId: 'session:agent:llm-failure-receipt',
          }),
          write: async (envelope) => {
            writes.push(envelope);
            return writes.length === 1
              ? ({ outcome: 'stored', envelope } as const)
              : ({
                  outcome: 'rejected',
                  envelope,
                  reason: 'checkpoint receipt rejected',
                } as const);
          },
        },
        sessionId: 'session:agent:llm-failure-receipt',
      },
    });
    const tools = createActorToolbox(
      agent.createActorAgentToolRegistry({
        llm: () => ({
          ok: false,
          error: llmFailure,
        }),
      }),
      actorToolContext,
      [agent.ACTOR_WEB_LLM_TOOL_NAME]
    );

    const result = await behavior.onMessage?.(
      createAgentParams({
        behavior,
        tools,
        message: { type: 'START_AGENT', prompt: 'preserve original llm failure' },
      })
    );

    expect(result).toMatchObject({
      reply: {
        ok: false,
        error: {
          code: llmFailure.code,
          message: llmFailure.message,
          cause: {
            original: llmFailure.cause,
            durability: {
              code: 'CHECKPOINT_WRITE_FAILED',
              message: 'Checkpoint write failed: rejected (checkpoint receipt rejected).',
            },
          },
        },
      },
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
