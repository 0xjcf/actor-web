import { createInMemoryAgentSessionCheckpointStore } from '@actor-web/runtime';
import { startRuntime } from '@actor-web/runtime/browser';
import { actor, defineTopology, node, tool } from '@actor-web/runtime/topology';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  type ActorAgentLlmProvider,
  type ActorAgentLoopContext,
  type ActorAgentLoopMessage,
  type ActorAgentLoopOptions,
  type ActorAgentLoopReply,
  createActorAgentTools,
  createAgentLoopBehavior,
} from '../src/index.js';

function scriptedProvider(...ids: string[]) {
  return vi
    .fn<ActorAgentLlmProvider>()
    .mockReturnValueOnce({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: ids.map((id) => ({ id, name: 'read', input: {} })),
        },
      },
    })
    .mockReturnValue({ ok: true, value: { message: { role: 'assistant', content: 'done' } } });
}

async function host(llm: ActorAgentLlmProvider, options: ActorAgentLoopOptions = {}) {
  const topology = defineTopology({
    nodes: { local: node('local') },
    tools: [tool('llm'), tool('read')],
    actors: {
      agent: actor({
        id: 'agent',
        node: 'local',
        tools: ['llm', 'read'],
        behavior: createAgentLoopBehavior({ system: 'Inspect.', ...options }),
      }),
    },
  });
  const runtime = await startRuntime(topology, {
    tools: { ...createActorAgentTools({ llm }), read: () => 'fact' },
  });
  let stopped: Promise<void> | undefined;
  const stop = () => {
    stopped ??= runtime.stop();
    return stopped;
  };
  onTestFinished(stop);
  const ref = runtime.requireActor('agent');
  return {
    ask: (message: ActorAgentLoopMessage) => ref.ask<ActorAgentLoopReply>(message),
    context: () => ref.ask<ActorAgentLoopContext>({ type: 'GET_AGENT_CONTEXT' }),
    stop,
  };
}

const start = { type: 'START_AGENT', prompt: 'Inspect the source.' } as const;
const resume = { type: 'CONTINUE_AGENT' } as const;
const observe = (id: string, deferContinuation = false) => ({
  type: 'OBSERVE_TOOL_RESULT' as const,
  toolCallId: id,
  name: 'read',
  ok: true,
  output: 'fact',
  deferContinuation,
});

describe('tool-result continuation', () => {
  it('waits for the whole batch, then continues exactly once from the recorded history', async () => {
    const provider = scriptedProvider('a', 'b');
    const agent = await host(provider);
    const refused = { ok: false, error: { code: 'AGENT_NOT_PAUSED' } };
    expect(await agent.ask(resume)).toMatchObject(refused);
    await agent.ask(start);
    expect(await agent.ask(observe('b'))).toMatchObject({ status: 'waiting-for-tool' });
    expect(await agent.ask(resume)).toMatchObject(refused);
    expect(await agent.ask({ ...observe('a', true), ok: false })).toMatchObject({
      ok: true,
      status: 'paused',
      toolCalls: [],
      message: { role: 'tool', toolCallId: 'a' },
    });
    const paused = await agent.context();
    expect(paused).toMatchObject({ paused: true, steps: 1, pendingToolCalls: [] });
    expect(paused.history).toHaveLength(4);
    expect(paused.history.at(-1)?.content).toBe(JSON.stringify({ ok: false, output: 'fact' }));
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await agent.ask(resume)).toMatchObject({ ok: true, status: 'responded' });
    expect(provider.mock.calls[1]?.[0]).toMatchObject({
      system: 'Inspect.',
      messages: paused.history,
    });
    expect(await agent.ask(resume)).toMatchObject(refused);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('does not let an unknown, misnamed or repeated receipt advance the loop', async () => {
    const provider = scriptedProvider('a', 'b');
    const agent = await host(provider);
    await agent.ask(start);
    expect(await agent.ask(observe('a', true))).toMatchObject({ status: 'waiting-for-tool' });
    const before = await agent.context();
    for (const invalid of [observe('missing'), { ...observe('b'), name: 'wrong' }, observe('a')]) {
      expect(await agent.ask(invalid)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_TOOL_RESULT' },
      });
    }
    expect(await agent.context()).toMatchObject({
      history: before.history,
      pendingToolCalls: before.pendingToolCalls,
      steps: before.steps,
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await agent.ask(observe('b'))).toMatchObject({ status: 'responded' });
    expect(await agent.ask(observe('b', true))).toMatchObject({ ok: false });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('restores a deferred receipt without replaying it or dispatching until continued', async () => {
    const checkpoint = {
      store: createInMemoryAgentSessionCheckpointStore(),
      sessionId: 'paused-session',
    };
    const provider = scriptedProvider('a');
    const agent = await host(provider, { checkpoint });
    await agent.ask(start);
    expect(await agent.ask(observe('a', true))).toMatchObject({ status: 'paused' });
    const paused = await agent.context();
    await agent.stop();
    const replacement = await host(provider, { checkpoint });
    expect(await replacement.context()).toEqual(paused);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await replacement.ask(resume)).toMatchObject({ status: 'responded' });
    expect(provider.mock.calls[1]?.[0].messages).toEqual(paused.history);
    expect(await replacement.ask(resume)).toMatchObject({ ok: false });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('does not acknowledge a pause or dispatch a continuation before its checkpoint is stored', async () => {
    const store = createInMemoryAgentSessionCheckpointStore();
    const provider = scriptedProvider('a');
    const agent = await host(provider, { checkpoint: { store, sessionId: 'refused-write' } });
    const write = vi.spyOn(store, 'write');
    const refuseNextWrite = () =>
      write.mockImplementationOnce(async (envelope) => ({
        outcome: 'rejected',
        envelope,
        reason: 'store full',
      }));
    const failedWrite = { ok: false, error: { code: 'CHECKPOINT_WRITE_FAILED' } };
    await agent.ask(start);
    refuseNextWrite();
    expect(await agent.ask(observe('a', true))).toMatchObject(failedWrite);
    expect(await agent.ask(resume)).toMatchObject({
      ok: false,
      error: { code: 'AGENT_NOT_PAUSED' },
    });
    expect(await agent.ask(observe('a', true))).toMatchObject({ status: 'paused' });
    refuseNextWrite();
    expect(await agent.ask(resume)).toMatchObject(failedWrite);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await agent.ask(resume)).toMatchObject({ status: 'responded' });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('consumes the pause even when the dispatched provider returns a failure', async () => {
    const provider = scriptedProvider('a').mockReturnValueOnce({
      ok: false,
      error: { code: 'MODEL_FAILED', message: 'Provider refused the request.' },
    });
    const agent = await host(provider);
    await agent.ask(start);
    await agent.ask(observe('a', true));
    expect(await agent.ask(resume)).toMatchObject({ ok: false, error: { code: 'MODEL_FAILED' } });
    expect(await agent.ask(resume)).toMatchObject({
      ok: false,
      error: { code: 'AGENT_NOT_PAUSED' },
    });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    'takes a new instruction instead of continuing (reset: %s)',
    async (reset) => {
      const provider = scriptedProvider('a');
      const agent = await host(provider);
      await agent.ask(start);
      await agent.ask(observe('a', true));
      const paused = await agent.context();
      expect(
        await agent.ask({ type: 'START_AGENT', prompt: 'New instruction.', reset })
      ).toMatchObject({ status: 'responded' });
      expect(provider.mock.calls[1]?.[0].messages).toEqual([
        ...(reset ? [] : paused.history),
        { role: 'user', content: 'New instruction.' },
      ]);
      expect(await agent.ask(resume)).toMatchObject({ ok: false });
      expect(provider).toHaveBeenCalledTimes(2);
    }
  );
});
