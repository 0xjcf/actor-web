import { startRuntime } from '@actor-web/runtime/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActorRuntimeError,
  type ActorRuntimeOptions,
  type ActorRuntimeTool,
  createActorRuntime,
} from '../src/actor-runtime.js';
import type {
  ActorAgentLlmProvider,
  ActorAgentLlmResult,
  ActorAgentToolCall,
} from '../src/index.js';
import type { AgentTurn } from '../src/portable.js';

vi.mock('@actor-web/runtime/browser', async (importOriginal) => {
  const runtime = await importOriginal<typeof import('@actor-web/runtime/browser')>();
  return { ...runtime, startRuntime: vi.fn(runtime.startRuntime) };
});

function deferred<T = void>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const requested = (name: string) => ({
  name,
  description: `Read ${name}.`,
  parameters: { type: 'object' },
});
const definition = {
  purpose: 'review' as const,
  systemPrompt: 'Review the assigned text.',
  tools: ['read', 'ungranted', 'unimplemented'].map(requested),
  output: { instructions: 'Return text.' },
};
type Task = { readonly name: string; readonly text: string };
type Options = ActorRuntimeOptions<Task, 'review'>;
const limits = {
  runTimeoutMs: 5_000,
  askTimeoutMs: 1_000,
  providerTimeoutMs: 500,
  toolTimeoutMs: 500,
  maxToolCallsPerBatch: 2,
};
const call = (id = 'call-1', name = 'read', input: unknown = { path: 'public' }) => ({
  id,
  name,
  input,
});
const assistant = (content: string, toolCalls?: readonly ActorAgentToolCall[]) =>
  ({ ok: true, value: { message: { role: 'assistant', content, toolCalls } } }) as const;
const turn = (text = 'one', signal = new AbortController().signal): AgentTurn<Task, 'review'> => ({
  ...definition,
  systemPrompt: `${definition.systemPrompt}\n${definition.output.instructions}`,
  task: { name: 'public', text },
  signal,
});

function fixture(provider: ActorAgentLlmProvider, overrides: Partial<Options> = {}) {
  const execute = vi.fn<ActorRuntimeTool<Task>['execute']>((_input, task) => task.text);
  const unauthorized = vi.fn();
  const options: Options = {
    definition,
    provider,
    limits,
    grants: ['read', 'unimplemented', 'unrequested'],
    tools: [
      {
        name: 'read',
        validateInput(input, task) {
          if (
            typeof input !== 'object' ||
            input === null ||
            !('path' in input) ||
            typeof input.path !== 'string'
          ) {
            throw new Error('Expected a path.');
          }
          if (input.path !== task.name) throw new ActorRuntimeError('PATH_DENIED', 'Not assigned.');
          return { value: input.path };
        },
        execute,
      },
      ...['ungranted', 'unrequested'].map((name) => ({
        name,
        validateInput: () => ({ value: undefined }),
        execute: unauthorized,
      })),
    ],
    encodeTask: (task) => task.name,
    ...overrides,
  };
  return {
    options,
    execute,
    unauthorized,
    make: () => createActorRuntime(options),
  };
}

const runtimeStart = vi.mocked(startRuntime);
beforeEach(() => {
  runtimeStart.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('local actor runtime executor', () => {
  it('seals the definition, exposes the intersection, and closes distinct fresh sessions', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>((request) => {
      expect(request.system).toBe(turn().systemPrompt);
      expect(request.tools).toEqual(['read']);
      expect(request.toolDefinitions).toEqual([
        { name: 'read', description: 'Read read.', inputSchema: { type: 'object' } },
      ]);
      if (request.messages.length === 1) {
        expect(request.messages).toEqual([{ role: 'user', content: 'public' }]);
        return assistant('not final', [call(), call('call-2')]);
      }
      expect(request.messages.map(({ role }) => role)).toEqual([
        'user',
        'assistant',
        'tool',
        'tool',
      ]);
      const last = request.messages.slice(-2);
      expect(last.map(({ toolCallId, toolName }) => [toolCallId, toolName])).toEqual([
        ['call-1', 'read'],
        ['call-2', 'read'],
      ]);
      const outputs = last.map(({ content }) => JSON.parse(content));
      expect(outputs[0]).toEqual(outputs[1]);
      return assistant(outputs[0].output);
    });
    const { make, execute, unauthorized } = fixture(provider);
    const runtime = make();
    await expect(runtime.run(turn())).resolves.toBe('one');
    await expect(runtime.run(turn('two'))).resolves.toBe('two');
    expect(provider).toHaveBeenCalledTimes(4);
    expect(execute.mock.calls.map(([input]) => input)).toEqual(Array(4).fill('public'));
    expect(unauthorized).not.toHaveBeenCalled();
    const [first, second] = await Promise.all(runtimeStart.mock.results.map(({ value }) => value));
    expect(first).toBeDefined();
    expect(second).not.toBe(first);
    expect(first.getActor('specialist')).toBeUndefined();
    expect(second.getActor('specialist')).toBeUndefined();
  });

  it.each([
    ['ask before provider', { askTimeoutMs: 25, providerTimeoutMs: 35 }, 0, 'ACTOR_ASK_FAILED'],
    ['run before provider', { runTimeoutMs: 25, providerTimeoutMs: 35 }, 0, 'RUN_TIMEOUT'],
    ['ask before run', { askTimeoutMs: 25, runTimeoutMs: 35 }, 0, 'ACTOR_ASK_FAILED'],
    ['provider before ask', { providerTimeoutMs: 25, askTimeoutMs: 35 }, 0, 'PROVIDER_TIMEOUT'],
    ['run and ask tie', { runTimeoutMs: 25, askTimeoutMs: 25 }, 0, 'RUN_TIMEOUT'],
    [
      'run expires first despite a longer configured duration',
      { runTimeoutMs: 30, askTimeoutMs: 15 },
      20,
      'RUN_TIMEOUT',
    ],
  ] as const)(
    'chooses the earliest active deadline with starved timers: %s',
    async (_name, configured, encodeTime, code) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
      try {
        const provider = vi.fn<ActorAgentLlmProvider>((_request, { signal }) => {
          clock.mockReturnValue(50);
          expect(signal.aborted).toBe(false);
          return assistant('not final', [call()]);
        });
        const { make, execute } = fixture(provider, {
          limits: { ...limits, ...configured },
          encodeTask(task) {
            clock.mockReturnValue(encodeTime);
            return task.name;
          },
        });
        await expect(make().run(turn())).rejects.toMatchObject({ code });
        expect(provider).toHaveBeenCalledTimes(1);
        expect(provider.mock.calls[0]?.[1].signal.reason).toMatchObject({ code });
        expect(execute).not.toHaveBeenCalled();
      } finally {
        clock.mockRestore();
      }
    }
  );

  it.each([
    [25, 35, 'RUN_TIMEOUT'],
    [35, 25, 'TOOL_TIMEOUT'],
  ] as const)(
    'orders starved run (%i ms) and tool (%i ms) deadlines',
    async (runTimeoutMs, toolTimeoutMs, code) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
      try {
        const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('', [call()]));
        const { make, execute } = fixture(provider, {
          limits: { ...limits, runTimeoutMs, toolTimeoutMs, askTimeoutMs: 5 },
        });
        execute.mockImplementationOnce((_input, _task, { signal }) => {
          clock.mockReturnValue(50);
          expect(signal.aborted).toBe(false);
          throw new ActorRuntimeError('READ_FAILED', 'The read failed after the deadline.');
        });
        await expect(make().run(turn())).rejects.toMatchObject({ code });
        expect(provider).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0]?.[2].signal.reason).toMatchObject({ code });
      } finally {
        clock.mockRestore();
      }
    }
  );

  it('checks the host binding, definition and pre-abort before any dispatch', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>();
    const encodeTask = vi.fn(() => 'prompt');
    const { make, options, execute } = fixture(provider, { encodeTask });
    for (const changes of [
      { provider: undefined },
      { grants: undefined },
      { grants: ['llm'] },
      { tools: [{ name: 'read', execute }] },
      { encodeTask: undefined },
      { definition: { ...definition, purpose: '' } },
      { limits: { ...limits, askTimeoutMs: Number.POSITIVE_INFINITY } },
      { limits: { ...limits, runTimeoutMs: 2_147_483_648 } },
    ]) {
      expect(() => createActorRuntime({ ...options, ...changes } as Options)).toThrow(
        expect.objectContaining({ code: 'INVALID_RUNTIME_CONFIG' })
      );
    }
    const runtime = make();
    for (const changed of [
      { systemPrompt: 'Override the system prompt.' },
      { tools: [requested('other')] },
      {
        tools: [
          { ...requested('read'), parameters: { type: 'number' } },
          ...definition.tools.slice(1),
        ],
      },
    ]) {
      await expect(runtime.run({ ...turn(), ...changed })).rejects.toMatchObject({
        code: 'DEFINITION_MISMATCH',
      });
    }
    const stopped = new AbortController();
    stopped.abort('superseded');
    await expect(runtime.run(turn('one', stopped.signal))).rejects.toMatchObject({
      code: 'RUN_ABORTED',
      cause: 'superseded',
    });
    expect(runtimeStart).not.toHaveBeenCalled();
    expect(encodeTask).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('admits the largest safe ask delay and rejects the next integer before dispatch', async () => {
    vi.useFakeTimers();
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    try {
      const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('on time'));
      const maxAsk = 214_748_364;
      const overflow = fixture(provider, { limits: { ...limits, askTimeoutMs: maxAsk + 1 } });
      expect(overflow.make).toThrow(expect.objectContaining({ code: 'INVALID_RUNTIME_CONFIG' }));
      expect(runtimeStart).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
      expect(schedule).not.toHaveBeenCalled();

      const boundary = fixture(provider, { limits: { ...limits, askTimeoutMs: maxAsk } });
      await expect(boundary.make().run(turn())).resolves.toBe('on time');
      const delays = schedule.mock.calls.map(([, delay]) => delay);
      expect(delays).toEqual(expect.arrayContaining([maxAsk, 2_147_483_640]));
      expect(delays.some((delay) => delay !== undefined && delay > 2_147_483_647)).toBe(false);
    } finally {
      schedule.mockRestore();
    }
  });

  it('checks every ask against its own deadline even before the timers run', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const cancelled = new AbortController();
    try {
      const provider = vi
        .fn<ActorAgentLlmProvider>()
        .mockImplementationOnce(() => {
          clock.mockReturnValue(24);
          return assistant('', [call()]);
        })
        .mockImplementationOnce(() => {
          clock.mockReturnValue(48);
          return assistant('on time');
        })
        .mockImplementationOnce(() => {
          clock.mockReturnValue(73);
          return assistant('not final', [call()]);
        })
        .mockImplementationOnce(() => {
          cancelled.abort('superseded');
          clock.mockReturnValue(98);
          return assistant('not final', [call()]);
        })
        .mockReturnValue(assistant('fresh'));
      const { make, execute } = fixture(provider, { limits: { ...limits, askTimeoutMs: 25 } });
      const runtime = make();

      // Both asks are under 25 ms each; the whole run takes longer.
      await expect(runtime.run(turn())).resolves.toBe('on time');
      // The monotonic clock reaches the next ask's deadline without delivering any timers.
      await expect(runtime.run(turn('late'))).rejects.toMatchObject({ code: 'ACTOR_ASK_FAILED' });
      expect(provider.mock.calls[2]?.[1].signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      await expect(runtime.run(turn('cancelled', cancelled.signal))).rejects.toMatchObject({
        code: 'RUN_ABORTED',
        cause: 'superseded',
      });
      expect(execute).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(0);
      await expect(runtime.run(turn('replacement'))).resolves.toBe('fresh');
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    ['ungranted', call('call-2', 'ungranted'), 'TOOL_DENIED'],
    ['unimplemented', call('call-2', 'unimplemented'), 'TOOL_DENIED'],
    ['unrequested', call('call-2', 'unrequested'), 'TOOL_DENIED'],
    ['reserved', call('call-2', 'llm'), 'TOOL_DENIED'],
    ['malformed ID', call('  '), 'INVALID_TOOL_CALL_ID'],
    ['duplicate ID', call(), 'DUPLICATE_TOOL_CALL_ID'],
    ['malformed input', call('call-2', 'read', {}), 'INVALID_TOOL_INPUT'],
    ['denied scope', call('call-2', 'read', { path: 'private' }), 'PATH_DENIED'],
  ])(
    'rejects a batch with a valid first call and a %s second call',
    async (_case, second, code) => {
      const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('not final', [call(), second]));
      const { make, execute, unauthorized } = fixture(provider);
      await expect(make().run(turn())).rejects.toMatchObject({ code });
      expect(execute).not.toHaveBeenCalled();
      expect(unauthorized).not.toHaveBeenCalled();
      expect(provider).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['provider', 'validator'] as const)(
    'isolates nested inputs shared by the %s across the batch and two runs',
    async (source) => {
      const scope = { path: 'public', offset: -0 };
      const shared = { targets: [scope], scope };
      const trace: string[] = [];
      const provider = vi.fn<ActorAgentLlmProvider>(({ messages }) =>
        messages.length === 1
          ? assistant('', [
              call('first', 'read', source === 'provider' ? shared : 'first'),
              call('second', 'read', source === 'provider' ? shared : 'second'),
            ])
          : assistant('complete')
      );
      const execute = vi.fn<ActorRuntimeTool<Task>['execute']>((input) => {
        const payload = input as typeof shared;
        trace.push(`execute:${payload.scope.path}`);
        expect(payload).not.toBe(shared);
        expect(payload.targets[0]).not.toBe(scope);
        expect(payload.targets[0]).toBe(payload.scope);
        expect(payload.scope.offset).toBe(-0);
        payload.scope.path = 'denied';
        return 'effect';
      });
      const runtime = fixture(provider, {
        tools: [
          {
            name: 'read',
            validateInput(input) {
              const payload = source === 'provider' ? (input as typeof shared) : shared;
              trace.push(`validate:${payload.scope.path}`);
              if (payload.scope.path !== 'public') throw new Error('Denied.');
              return { value: payload };
            },
            execute,
          },
        ],
      }).make();

      await expect(runtime.run(turn())).resolves.toBe('complete');
      await expect(runtime.run(turn('two'))).resolves.toBe('complete');
      const batch = ['validate:public', 'validate:public', 'execute:public', 'execute:public'];
      expect(trace).toEqual([...batch, ...batch]);
      expect(scope.path).toBe('public');
    }
  );

  const nonDataGetter = vi.fn(() => 'not plain data');
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  it.each([
    ['cycle', cyclic],
    ['accessor', Object.defineProperty({}, 'path', { enumerable: true, get: nonDataGetter })],
    ['hidden property', Object.defineProperty({}, 'path', { value: 'public' })],
    ['symbol key', { [Symbol('path')]: 'public' }],
    ['class instance', new Date(0)],
    ['sparse array', new Array(1)],
    ['array property', Object.assign(['public'], { extra: true })],
    ['nested undefined', { path: undefined }],
    ['nonfinite number', Number.NaN],
  ] as const)('rejects an unsupported normalized %s before any handler', async (_name, value) => {
    const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('', [call(), call('second')]));
    const execute = vi.fn();
    const validateInput = vi
      .fn()
      .mockReturnValueOnce({ value: 'public' })
      .mockReturnValue({ value });
    const runtime = fixture(provider, {
      tools: [{ name: 'read', validateInput, execute }],
    }).make();
    await expect(runtime.run(turn())).rejects.toMatchObject({ code: 'INVALID_TOOL_INPUT' });
    expect(validateInput).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
    expect(nonDataGetter).not.toHaveBeenCalled();
  });

  it('refuses a stale ID on a later provider turn without replaying its effect', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('', [call()]));
    const { make, execute } = fixture(provider);
    await expect(make().run(turn())).rejects.toMatchObject({ code: 'DUPLICATE_TOOL_CALL_ID' });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    const host = await runtimeStart.mock.results[0]?.value;
    expect(host.getActor('specialist')).toBeUndefined();
  });

  it.each([
    ['an oversized batch', assistant('', [call(), call('2'), call('3')]), 'TOOL_BATCH_LIMIT'],
    [
      'a non-assistant reply',
      { ok: true, value: { message: { role: 'tool', content: 'x' } } },
      'INVALID_ASSISTANT_REPLY',
    ],
    ['blank final text', assistant('  '), 'INVALID_ASSISTANT_REPLY'],
    [
      'a provider failure',
      { ok: false, error: { code: 'LLM_PROVIDER_UNAVAILABLE', message: 'Offline.' } },
      'LLM_PROVIDER_UNAVAILABLE',
    ],
  ] as const)('preserves the rejection for %s without replay', async (_case, reply, code) => {
    const provider = vi.fn<ActorAgentLlmProvider>(() => reply);
    const { make, execute } = fixture(provider);
    await expect(make().run(turn())).rejects.toMatchObject({ code });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('preserves a tool failure and does not run the rest of an admitted batch', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('', [call(), call('2')]));
    const { make, execute } = fixture(provider);
    execute.mockRejectedValueOnce(new ActorRuntimeError('READ_FAILED', 'The read failed.'));
    await expect(make().run(turn())).rejects.toMatchObject({ code: 'READ_FAILED' });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('refuses overlap while the admitted provider is running', async () => {
    const started = deferred();
    const raw = deferred<ActorAgentLlmResult>();
    const provider = vi.fn<ActorAgentLlmProvider>(() => {
      started.resolve();
      return raw.promise;
    });
    const runtime = fixture(provider).make();
    const first = runtime.run(turn());
    await started.promise;
    await expect(runtime.run(turn('two'))).rejects.toMatchObject({ code: 'RUNTIME_BUSY' });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(runtimeStart).toHaveBeenCalledTimes(1);
    raw.resolve(assistant('first'));
    await expect(first).resolves.toBe('first');
  });

  it.each([
    ['caller abort', 'RUN_ABORTED', 'provider', 'reject'],
    ['provider timeout', 'PROVIDER_TIMEOUT', 'provider', 'resolve'],
    ['actor ask timeout', 'ACTOR_ASK_FAILED', 'provider', 'resolve'],
    ['assignment timeout', 'RUN_TIMEOUT', 'tool', 'resolve'],
    ['tool timeout', 'TOOL_TIMEOUT', 'tool', 'reject'],
  ] as const)('fences unresolved raw work after %s', async (kind, code, port, settle) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const started = deferred<AbortSignal>();
    const raw = deferred<ActorAgentLlmResult>();
    const provider = vi.fn<ActorAgentLlmProvider>();
    if (port === 'provider') {
      provider.mockImplementationOnce((_request, { signal }) => {
        started.resolve(signal);
        return raw.promise;
      });
    } else {
      provider.mockReturnValueOnce(assistant('', [call()]));
    }
    provider.mockReturnValue(assistant('fresh'));
    const { make, execute } = fixture(provider, {
      limits: {
        ...limits,
        ...(kind === 'provider timeout'
          ? { providerTimeoutMs: 10, askTimeoutMs: 20, runTimeoutMs: 30 }
          : {}),
        ...(kind === 'assignment timeout' ? { runTimeoutMs: 10 } : {}),
        ...(kind === 'actor ask timeout' ? { askTimeoutMs: 10 } : {}),
        ...(kind === 'tool timeout' ? { toolTimeoutMs: 10 } : {}),
      },
    });
    execute.mockImplementationOnce((_input, _task, { signal }) => {
      started.resolve(signal);
      return raw.promise;
    });
    const control = new AbortController();
    const runtime = make();
    const rejected = expect(runtime.run(turn('first', control.signal))).rejects.toMatchObject({
      code,
    });
    const admittedSignal = await started.promise;
    if (kind === 'caller abort') control.abort();
    else await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(admittedSignal.aborted).toBe(true);
    if (kind === 'provider timeout') control.abort('too late to replace the timeout');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(admittedSignal.reason).toMatchObject({ code });
    const host = await runtimeStart.mock.results[0]?.value;
    expect(host.getActor('specialist')).toBeUndefined();
    // Teardown returned; this still must not admit while the actual port promise is pending.
    await expect(runtime.run(turn('busy'))).rejects.toMatchObject({ code: 'RUNTIME_BUSY' });
    expect(provider).toHaveBeenCalledTimes(1);
    if (settle === 'resolve') raw.resolve(assistant('late must not be accepted', [call()]));
    else raw.reject(new Error('late rejection'));
    await vi.advanceTimersByTimeAsync(0);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(port === 'tool' ? 1 : 0);
    await expect(runtime.run(turn('replacement'))).resolves.toBe('fresh');
  });

  it('keeps admission closed while the owned stop promise is pending', async () => {
    const original = (
      await vi.importActual<typeof import('@actor-web/runtime/browser')>(
        '@actor-web/runtime/browser'
      )
    ).startRuntime;
    const stopRequested = deferred();
    const stopGate = deferred();
    const stopped = deferred();
    runtimeStart.mockImplementationOnce(async (topology, options) => {
      const host = await original(topology, options);
      return {
        ...host,
        async stop() {
          stopRequested.resolve();
          await stopGate.promise;
          await host.stop();
          stopped.resolve();
        },
      };
    });
    const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('reply'));
    const control = new AbortController();
    const runtime = fixture(provider).make();
    const rejected = expect(runtime.run(turn('first', control.signal))).rejects.toMatchObject({
      code: 'RUN_ABORTED',
    });
    await stopRequested.promise;
    control.abort();
    await rejected;
    await expect(runtime.run(turn('busy'))).rejects.toMatchObject({ code: 'RUNTIME_BUSY' });
    stopGate.resolve();
    await stopped.promise;
    // Let the owned run observe resolution of stop and release admission.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(runtime.run(turn('replacement'))).resolves.toBe('reply');
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('closes a late-started runtime without dispatching', async () => {
    const { startRuntime: original } = await vi.importActual<
      typeof import('@actor-web/runtime/browser')
    >('@actor-web/runtime/browser');
    const startup = deferred();
    const stopped = deferred();
    runtimeStart.mockImplementationOnce(async (topology, options) => {
      await startup.promise;
      const host = await original(topology, options);
      return {
        ...host,
        async stop() {
          await host.stop();
          stopped.resolve();
        },
      };
    });
    const control = new AbortController();
    const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('fresh'));
    const runtime = fixture(provider).make();
    const rejected = expect(runtime.run(turn('first', control.signal))).rejects.toMatchObject({
      code: 'RUN_ABORTED',
    });
    expect(runtimeStart).toHaveBeenCalledTimes(1);
    control.abort();
    await rejected;
    await expect(runtime.run(turn('busy'))).rejects.toMatchObject({ code: 'RUNTIME_BUSY' });
    startup.resolve();
    await stopped.promise;
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects success and remains fenced when owned stop fails', async () => {
    const { startRuntime: original } = await vi.importActual<
      typeof import('@actor-web/runtime/browser')
    >('@actor-web/runtime/browser');
    runtimeStart.mockImplementationOnce(async (topology, options) => {
      const host = await original(topology, options);
      return {
        ...host,
        async stop() {
          await host.stop();
          throw new Error('Stop result could not be verified.');
        },
      };
    });
    const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('not accepted'));
    const runtime = fixture(provider).make();
    await expect(runtime.run(turn())).rejects.toMatchObject({ code: 'RUNTIME_STOP_FAILED' });
    await expect(runtime.run(turn())).rejects.toMatchObject({ code: 'RUNTIME_BUSY' });
    expect(runtimeStart).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
