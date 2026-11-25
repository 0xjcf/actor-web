import { runInNewContext } from 'node:vm';
import {
  type AgentExecutionEventReceipt,
  parseAgentExecutionTrace,
  startRuntime,
} from '@actor-web/runtime/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ActorAgentLlmMessage,
  ActorAgentLlmProvider,
  ActorAgentLlmRequest,
  ActorAgentLlmResult,
  ActorAgentToolCall,
} from '../src/index.js';
import type { AgentRunRequest, AgentToolExample } from '../src/portable.js';
import {
  AgentRunnerError,
  type AgentRunnerOptions,
  type AgentToolHandler,
  createAgentRunner,
  type ObservedAgentRunHandle,
} from '../src/runner.js';
import { createExecutionEvidence } from '../src/runner-evidence.js';

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

function promiseWrapper<T>(
  promise: Promise<T>,
  onSubscribe: () => void,
  inherited = false,
  nullRoot = false
): Promise<T> {
  const wrapper: Promise<T> = {
    [Symbol.toStringTag]: 'Promise',
    // biome-ignore lint/suspicious/noThenProperty: Intentionally implements the public Promise type.
    then(onFulfilled, onRejected) {
      onSubscribe();
      expect(this).toBe(wrapper);
      return promise.then(onFulfilled, onRejected);
    },
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  if (inherited) {
    // biome-ignore lint/suspicious/noThenProperty: The same Promise method is tested on the prototype.
    const prototype = { then: wrapper.then };
    if (nullRoot) Object.setPrototypeOf(prototype, null);
    Object.setPrototypeOf(wrapper, prototype);
    Reflect.deleteProperty(wrapper, 'then');
  }
  return wrapper;
}

function accessorPromise<T>(
  owned: Promise<T>,
  onRead: () => void,
  onSubscribe: () => void,
  ownAccessor: boolean,
  nullRoot: boolean
): Promise<T> {
  class AccessorPromise implements Promise<T> {
    readonly [Symbol.toStringTag] = 'Promise';

    // biome-ignore lint/suspicious/noThenProperty: Intentionally implements an accessor-backed Promise.
    get then(): Promise<T>['then'] {
      expect(this).toBe(wrapper);
      onRead();
      return function (this: AccessorPromise, onFulfilled, onRejected) {
        expect(this).toBe(wrapper);
        onSubscribe();
        return owned.then(onFulfilled, onRejected);
      };
    }

    get catch(): Promise<T>['catch'] {
      return owned.catch.bind(owned);
    }
    get finally(): Promise<T>['finally'] {
      return owned.finally.bind(owned);
    }
  }

  if (nullRoot) Object.setPrototypeOf(AccessorPromise.prototype, null);
  const wrapper = new AccessorPromise();
  if (ownAccessor) {
    const property = Object.getOwnPropertyDescriptor(AccessorPromise.prototype, 'then');
    if (!property) throw new Error('Expected an accessor on the fixture prototype.');
    Object.defineProperty(wrapper, 'then', property);
  }
  return wrapper;
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
type Options = AgentRunnerOptions<Task, 'review'>;
const limits = {
  runTimeoutMs: 5_000,
  askTimeoutMs: 1_000,
  providerTimeoutMs: 500,
  toolTimeoutMs: 500,
  maxToolCallsPerBatch: 2,
  maxModelTurns: 10,
  maxToolAttempts: 10,
  maxPayloadBytes: 64 * 1024,
};
const call = (id = 'call-1', name = 'read', input: unknown = { path: 'public' }) => ({
  id,
  name,
  input,
});
const assistant = (content: string, toolCalls?: readonly ActorAgentToolCall[]) =>
  ({
    ok: true,
    value: {
      message: {
        role: 'assistant',
        content,
        ...(toolCalls === undefined ? {} : { toolCalls }),
      },
    },
  }) as const;
const turn = (
  text = 'one',
  signal = new AbortController().signal
): AgentRunRequest<Task, 'review'> => ({
  ...definition,
  systemPrompt: `${definition.systemPrompt}\n${definition.output.instructions}`,
  task: { name: 'public', text },
  signal,
});

const jsonBytes = (...values: unknown[]) =>
  values.reduce<number>(
    (total, value) => total + new TextEncoder().encode(JSON.stringify(value)).length,
    0
  );

const initialMessage = { role: 'user', content: 'public' } as const;
function requestOf(
  messages: readonly ActorAgentLlmMessage[] = [initialMessage]
): ActorAgentLlmRequest {
  return {
    system: turn().systemPrompt,
    messages,
    tools: ['read'],
    toolDefinitions: [{ name: 'read', description: 'Read read.', inputSchema: { type: 'object' } }],
  };
}

function toolReceipt(id: string, output: unknown): ActorAgentLlmMessage {
  return {
    role: 'tool',
    content: JSON.stringify({ ok: true, output }),
    toolCallId: id,
    toolName: 'read',
  };
}

function fixture(provider: ActorAgentLlmProvider, overrides: Partial<Options> = {}) {
  const execute = vi.fn<AgentToolHandler<Task>['execute']>((_input, task) => task.text);
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
          if (input.path !== task.name) throw new AgentRunnerError('PATH_DENIED', 'Not assigned.');
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
    make: () => createAgentRunner(options),
  };
}

const runtimeStart = vi.mocked(startRuntime);
beforeEach(() => {
  runtimeStart.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

const evidenceBinding = { assignmentId: 'assignment.local', revision: 1 } as const;

describe('portable tool examples', () => {
  const example = { input: { path: 'example.txt' }, result: { lines: [] } };
  const tools = definition.tools.map((tool) => ({
    ...tool,
    examples: [example, { input: { path: 'other.txt' }, result: `sample-${tool.name}` }],
  }));

  it('renders only effective tools and keeps synthetic examples out of history', async () => {
    const first = assistant('', [call()]);
    const provider = vi
      .fn<ActorAgentLlmProvider>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(assistant('done'));
    const { make, execute, unauthorized } = fixture(provider, {
      definition: { ...definition, tools },
      toolExampleMode: 'description',
    });
    await expect(make().run({ ...turn('actual output'), tools })).resolves.toBe('done');
    const description = [
      'Read read.',
      'Illustrative calls and results; not observations from this task:',
      '{"input":{"path":"example.txt"},"result":{"lines":[]}}',
      '{"input":{"path":"other.txt"},"result":"sample-read"}',
    ].join('\n');
    for (const [i, [request]] of provider.mock.calls.entries()) {
      const messages = i
        ? [initialMessage, first.value.message, toolReceipt('call-1', 'actual output')]
        : [initialMessage];
      expect(request).toEqual({
        ...requestOf(messages),
        toolDefinitions: [{ name: 'read', description, inputSchema: { type: 'object' } }],
      });
    }
    expect(execute).toHaveBeenCalledTimes(1);
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it.each([undefined, 'off', 'description'] as const)(
    'keeps the original request when examples are disabled or empty (mode %s)',
    async (toolExampleMode) => {
      const declared =
        toolExampleMode === 'description' ? [{ ...requested('read'), examples: [] }] : tools;
      const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('ok'));
      const { make } = fixture(provider, {
        definition: { ...definition, tools: declared },
        toolExampleMode,
        limits: {
          ...limits,
          maxPayloadBytes: jsonBytes(requestOf(), assistant('ok').value.message),
        },
      });
      await expect(make().run({ ...turn(), tools: declared })).resolves.toBe('ok');
      expect(provider.mock.calls[0][0]).toEqual(requestOf());
    }
  );

  it('charges rendered descriptions against the provider request budget before dispatch', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>();
    const { make } = fixture(provider, {
      definition: { ...definition, tools },
      toolExampleMode: 'description',
      limits: { ...limits, maxPayloadBytes: jsonBytes(requestOf(), assistant('ok').value.message) },
    });
    await expect(make().run({ ...turn(), tools })).rejects.toMatchObject({
      code: 'PAYLOAD_BYTE_LIMIT',
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it('pins the example values independently of later changes to the declaration', async () => {
    const declared = [{ ...requested('read'), examples: [{ input: {}, result: 'original' }] }];
    const provider = vi.fn<ActorAgentLlmProvider>();
    const runtime = fixture(provider, { definition: { ...definition, tools: declared } }).make();
    declared[0].examples[0].result = 'changed';
    await expect(runtime.run({ ...turn(), tools: declared })).rejects.toMatchObject({
      code: 'DEFINITION_MISMATCH',
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'not an array', examples: {} },
    { label: 'missing result', examples: [{ input: {} }] },
    { label: 'non-object arguments', examples: [{ input: [], result: null }] },
    { label: 'non-JSON result', examples: [{ input: {}, result: undefined }] },
    { label: 'too many pairs', examples: Array(5).fill(example) },
    { label: 'over 4 KiB of JSON', examples: [{ input: {}, result: '界'.repeat(1400) }] },
  ])('rejects $label at registration even when injection is disabled', ({ examples }) => {
    const declared = [{ ...requested('read'), examples: examples as AgentToolExample[] }];
    expect(fixture(vi.fn(), { definition: { ...definition, tools: declared } }).make).toThrow(
      expect.objectContaining({ code: 'INVALID_RUNTIME_CONFIG' })
    );
  });
});

function facts(run: ObservedAgentRunHandle, prefix = 'LOCAL_') {
  return run
    .readEvidence()
    ?.trace.receipts.filter(
      (receipt): receipt is AgentExecutionEventReceipt =>
        receipt.receiptKind === 'event' && receipt.event.type.startsWith(prefix)
    )
    .map(({ event, attempt }) => [event.type, attempt, event.payload]);
}

describe('local execution evidence', () => {
  it('joins model attempts by session and ordinal with allowlisted usage only', async () => {
    const usageGetter = vi.fn(() => 99);
    const provider = vi.fn<ActorAgentLlmProvider>(({ messages }) => {
      if (messages.length > 1) return assistant('private final response');
      const batch = assistant('private assistant prose', [
        call('private-provider-call-id', 'read', { path: 'public', content: 'private argument' }),
      ]);
      return {
        ...batch,
        value: {
          ...batch.value,
          usage: {
            inputTokens: 0,
            outputTokens: -1,
            get totalTokens() {
              return usageGetter();
            },
            credential: 'private credential',
          },
        },
      };
    });
    const { make, execute } = fixture(provider);
    execute.mockReturnValue('private tool result');
    const runtime = make();
    const binding = { assignmentId: 'assignment.1', revision: 7 };
    const first = runtime.start(turn('private task 1'), binding);
    await expect(first.result).resolves.toBe('private final response');
    const beforeValidation = first.readEvidence();
    const second = runtime.start(turn('private task 2'), binding);
    binding.revision = 8;
    await expect(first.validateOutput((raw) => `${raw} private parsed`)).resolves.toBe(
      'private final response private parsed'
    );
    await expect(second.result).resolves.toBe('private final response');

    const earlier = first.readEvidence();
    const later = second.readEvidence();
    if (!earlier || !later) throw new Error('Expected evidence for both sessions.');
    expect(beforeValidation?.trace.receipts).toHaveLength(8);
    expect(facts(first, 'LOCAL_OUTPUT_')).toEqual([
      ['LOCAL_OUTPUT_VALIDATION', undefined, { outcome: 'passed' }],
    ]);
    expect(facts(second, 'LOCAL_OUTPUT_')).toEqual([]);
    expect(later.trace.sessionId).not.toBe(earlier.trace.sessionId);
    expect(later.trace.commandId).not.toBe(earlier.trace.commandId);
    expect(later.trace.traceId).not.toBe(earlier.trace.traceId);
    for (const { trace, truncated } of [earlier, later]) {
      expect(truncated).toBe(false);
      expect(parseAgentExecutionTrace(JSON.parse(JSON.stringify(trace))).ok).toBe(true);
      expect(trace).toMatchObject({ correlationId: 'assignment.1', revision: 7 });
      expect(trace.receipts.map(({ sequence }) => sequence)).toEqual(
        trace.receipts.map((_, index) => index + 1)
      );
      expect(
        trace.receipts.slice(0, 8).map((receipt) => {
          if (receipt.receiptKind !== 'event') throw new Error('Expected an event receipt.');
          return [receipt.event.type, receipt.attempt];
        })
      ).toEqual([
        ['LOCAL_MODEL_DISPATCHED', 1],
        ['LOCAL_MODEL_OUTCOME', 1],
        ['LOCAL_TOOL_DISPATCHED', 1],
        ['LOCAL_TOOL_OUTCOME', 1],
        ['LOCAL_MODEL_DISPATCHED', 2],
        ['LOCAL_MODEL_OUTCOME', 2],
        ['LOCAL_CLEANUP_STARTED', undefined],
        ['LOCAL_CLEANUP_OUTCOME', undefined],
      ]);
      for (const receipt of trace.receipts) {
        expect(receipt).toMatchObject({
          status: 'observed',
          receiptKind: 'event',
          sessionId: trace.sessionId,
          traceId: trace.traceId,
          commandId: trace.commandId,
          revision: trace.revision,
          correlationId: trace.correlationId,
        });
        expect(Object.isFrozen(receipt)).toBe(true);
      }
      expect(trace.receipts[1]).toMatchObject({
        event: {
          type: 'LOCAL_MODEL_OUTCOME',
          payload: {
            outcome: 'returned',
            usage: { input: 0, output: 'unknown', total: 'unknown' },
          },
        },
      });
      expect(trace.receipts[5]).toMatchObject({
        event: { payload: { usage: { input: 'unknown', output: 'unknown', total: 'unknown' } } },
      });
      expect(JSON.stringify(trace)).not.toMatch(/private[ -]|Review the assigned/);
    }
    expect(usageGetter).not.toHaveBeenCalled();
  });

  it('does not record pre-aborted or over-budget model dispatch', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>();
    const { make } = fixture(provider, { limits: { ...limits, maxPayloadBytes: 1 } });
    const runtime = make();
    const binding = { assignmentId: 'assignment.1', revision: 0 };
    expect(() => runtime.start(turn(), { ...binding, assignmentId: 'not an opaque ID' })).toThrow(
      expect.objectContaining({ code: 'INVALID_EVIDENCE_BINDING' })
    );
    const control = new AbortController();
    control.abort();
    const refused = runtime.start(turn('stopped', control.signal), binding);
    await expect(refused.result).rejects.toMatchObject({ code: 'RUN_ABORTED' });
    expect(refused.readEvidence()).toBeUndefined();
    expect(runtimeStart).not.toHaveBeenCalled();
    const limited = runtime.start(turn(), binding);
    await expect(limited.result).rejects.toMatchObject({ code: 'PAYLOAD_BYTE_LIMIT' });
    expect(facts(limited, 'LOCAL_MODEL_')).toEqual([]);
    expect(facts(limited, 'LOCAL_CLEANUP_')).toEqual([
      ['LOCAL_CLEANUP_STARTED', undefined, {}],
      ['LOCAL_CLEANUP_OUTCOME', undefined, { outcome: 'settled' }],
    ]);
    expect(provider).not.toHaveBeenCalled();
  });

  it('keeps diagnostic details out of failed model receipts', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>(() => {
      throw new Error('private provider error');
    });
    const run = fixture(provider).make().start(turn(), { assignmentId: 'failure', revision: 0 });
    await expect(run.result).rejects.toMatchObject({
      code: 'LLM_PROVIDER_FAILED',
      message: 'private provider error',
    });
    const receipts = facts(run, 'LOCAL_MODEL_');
    expect(receipts).toHaveLength(2);
    expect(receipts?.[1]).toMatchObject(['LOCAL_MODEL_OUTCOME', 1, { outcome: 'failed' }]);
    expect(JSON.stringify(receipts)).not.toContain('private provider error');
  });

  it('does not append a returned result when an aborted provider finishes late', async () => {
    const started = deferred();
    const raw = deferred<ActorAgentLlmResult>();
    const control = new AbortController();
    const provider = vi.fn<ActorAgentLlmProvider>(() => {
      started.resolve();
      return raw.promise;
    });
    const run = fixture(provider)
      .make()
      .start(turn('first', control.signal), { assignmentId: 'stopped', revision: 1 });
    await started.promise;
    expect(run.readEvidence()?.trace.receipts).toHaveLength(1);
    control.abort('private abort reason');
    await expect(run.result).rejects.toMatchObject({ code: 'RUN_ABORTED' });
    const late = assistant('private late content');
    raw.resolve({ ...late, value: { ...late.value, usage: { totalTokens: 42 } } });
    await expect(run.waitForSettlement(500)).resolves.toEqual({ status: 'settled' });
    const receipts = facts(run, 'LOCAL_MODEL_');
    expect(receipts).toHaveLength(2);
    expect(receipts?.[1]).toMatchObject([
      'LOCAL_MODEL_OUTCOME',
      1,
      { outcome: 'interrupted', usage: { total: 'unknown' } },
    ]);
    expect(JSON.stringify(receipts)).not.toContain('private');
  });

  it('bounds retained receipts and identifies an incomplete prefix', () => {
    const evidence = createExecutionEvidence('assignment.1', 1);
    evidence.beginSession('actor://fixture/specialist');
    for (let i = 0; i < 128; i++) evidence.modelOutcome(evidence.modelDispatch(), 'returned');
    const complete = evidence.read();
    expect(complete?.truncated).toBe(false);
    evidence.cleanupStarted();
    const truncated = evidence.read();
    expect(truncated?.truncated).toBe(true);
    expect(truncated?.trace.receipts).toEqual(complete?.trace.receipts);
    expect(truncated?.trace.receipts).toHaveLength(256);
  });

  it('pairs each actual application attempt with its effective tool ordinal', async () => {
    const secondTool = 'private_tool_name';
    const tools = [...definition.tools, requested(secondTool)];
    const provider = vi
      .fn<ActorAgentLlmProvider>()
      .mockReturnValueOnce(assistant('', [call('private-a', secondTool), call('private-b')]))
      .mockReturnValueOnce(assistant('private response'));
    const probe = fixture(provider);
    const run = fixture(provider, {
      definition: { ...definition, tools },
      grants: [...probe.options.grants, secondTool],
      // Implementation order differs from the effective definition order.
      tools: [
        { name: secondTool, validateInput: () => ({ value: 'private input' }), execute: String },
        ...probe.options.tools,
      ],
    })
      .make()
      .start({ ...turn(), tools }, evidenceBinding);
    await expect(run.result).resolves.toBe('private response');
    expect(facts(run, 'LOCAL_TOOL_')).toEqual([
      ['LOCAL_TOOL_DISPATCHED', 1, { toolOrdinal: 2 }],
      ['LOCAL_TOOL_OUTCOME', 1, { toolOrdinal: 2, outcome: 'returned' }],
      ['LOCAL_TOOL_DISPATCHED', 2, { toolOrdinal: 1 }],
      ['LOCAL_TOOL_OUTCOME', 2, { toolOrdinal: 1, outcome: 'returned' }],
    ]);
    expect(JSON.stringify(run.readEvidence())).not.toContain('private');
  });

  it.each([
    ['denied tool', call('2', 'ungranted'), {}, 'TOOL_DENIED'],
    ['refused input', call('2', 'read', { path: 'private' }), {}, 'PATH_DENIED'],
    ['attempt limit', call('2'), { maxToolAttempts: 1 }, 'TOOL_ATTEMPT_LIMIT'],
    ['model limit', call('2'), { maxModelTurns: 1 }, 'MODEL_TURN_LIMIT'],
  ] as const)(
    'records no application attempts for %s in a refused batch',
    async (_, planned, bound, code) => {
      const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('', [call(), planned]));
      const { make, execute } = fixture(provider, { limits: { ...limits, ...bound } });
      const run = make().start(turn(), evidenceBinding);
      await expect(run.result).rejects.toMatchObject({ code });
      expect(facts(run, 'LOCAL_TOOL_')).toEqual([]);
      expect(execute).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      'throws',
      () => {
        throw new Error('private tool diagnostic');
      },
      'TOOL_FAILED',
    ],
    ['returns unusable data', () => ({ private: undefined }), 'INVALID_TOOL_OUTPUT'],
    [
      'returns over-budget data',
      () => 'private'.repeat(limits.maxPayloadBytes),
      'PAYLOAD_BYTE_LIMIT',
    ],
  ] as const)('records a failed dispatch when the handler %s', async (_, handler, code) => {
    const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('', [call(), call('2')]));
    const { make, execute } = fixture(provider);
    execute.mockImplementation(handler);
    const run = make().start(turn(), evidenceBinding);
    await expect(run.result).rejects.toMatchObject({ code });
    expect(facts(run, 'LOCAL_TOOL_')).toEqual([
      ['LOCAL_TOOL_DISPATCHED', 1, { toolOrdinal: 1 }],
      ['LOCAL_TOOL_OUTCOME', 1, { toolOrdinal: 1, outcome: 'failed' }],
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(run.readEvidence())).not.toContain('private');
  });

  it('preserves the actual parser rejection and rejects a concurrent validation request', async () => {
    const error = new Error('private parser diagnostic');
    const parser = vi.fn(async () => {
      throw error;
    });
    const duplicate = vi.fn();
    const run = fixture(() => assistant('private raw'))
      .make()
      .start(turn(), evidenceBinding);
    const validation = run.validateOutput(parser);
    const failed = expect(validation).rejects.toBe(error);
    await expect(run.validateOutput(duplicate)).rejects.toMatchObject({
      code: 'VALIDATION_ALREADY_REQUESTED',
    });
    await failed;
    await expect(run.result).resolves.toBe('private raw');
    expect(parser).toHaveBeenCalledTimes(1);
    expect(parser).toHaveBeenCalledWith('private raw');
    expect(duplicate).not.toHaveBeenCalled();
    expect(facts(run, 'LOCAL_OUTPUT_')).toEqual([
      ['LOCAL_OUTPUT_VALIDATION', undefined, { outcome: 'failed' }],
    ]);
    expect(JSON.stringify(run.readEvidence())).not.toContain('private');
  });

  it('skips the parser after a raw failure or a pre-parser abort', async () => {
    const parser = vi.fn();
    const runtime = fixture(() => assistant('text')).make();
    const failed = runtime.start({ ...turn(), systemPrompt: 'wrong' }, evidenceBinding);
    await expect(failed.validateOutput(parser)).rejects.toMatchObject({
      code: 'DEFINITION_MISMATCH',
    });
    expect(failed.readEvidence()).toBeUndefined();
    const control = new AbortController();
    const finished = runtime.start(turn('one', control.signal), evidenceBinding);
    await finished.result;
    const reason = new Error('private reason');
    control.abort(reason);
    await expect(finished.validateOutput(parser)).rejects.toBe(reason);
    expect(parser).not.toHaveBeenCalled();
    expect(facts(finished, 'LOCAL_OUTPUT_')).toEqual([]);
  });

  it('does not report a pass from an asynchronous parser that returns after abort', async () => {
    const control = new AbortController();
    const entered = deferred();
    const answer = deferred<string>();
    const run = fixture(() => assistant('text'))
      .make()
      .start(turn('one', control.signal), evidenceBinding);
    const validated = run.validateOutput(() => {
      entered.resolve();
      return answer.promise;
    });
    await entered.promise;
    expect(facts(run, 'LOCAL_OUTPUT_')).toEqual([]);
    await expect(run.waitForSettlement(0)).resolves.toEqual({ status: 'settled' });
    const reason = new Error('private reason');
    const rejected = expect(validated).rejects.toBe(reason);
    control.abort(reason);
    answer.resolve('private late parse');
    await rejected;
    expect(facts(run, 'LOCAL_OUTPUT_')).toEqual([
      ['LOCAL_OUTPUT_VALIDATION', undefined, { outcome: 'interrupted' }],
    ]);
    expect(JSON.stringify(run.readEvidence())).not.toContain('private');
  });
});

describe('assignment execution budgets', () => {
  it.each(['maxModelTurns', 'maxToolAttempts', 'maxPayloadBytes'] as const)(
    'requires a valid safe integer for %s before starting the host',
    (name) => {
      const values = [
        undefined,
        -1,
        1.1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ];
      if (name !== 'maxToolAttempts') values.push(0);
      const provider = vi.fn<ActorAgentLlmProvider>();
      for (const value of values) {
        const { make } = fixture(provider, {
          limits: { ...limits, [name]: value } as Options['limits'],
        });
        expect(make).toThrow(expect.objectContaining({ code: 'INVALID_RUNTIME_CONFIG' }));
      }
      expect(
        fixture(provider, { limits: { ...limits, [name]: Number.MAX_SAFE_INTEGER } }).make
      ).not.toThrow();
      expect(runtimeStart).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
    }
  );

  it.each([
    [{ maxModelTurns: 1, maxToolAttempts: 2 }, 'MODEL_TURN_LIMIT'],
    [{ maxModelTurns: 2, maxToolAttempts: 1 }, 'TOOL_ATTEMPT_LIMIT'],
    [{ maxModelTurns: 2, maxToolAttempts: 0 }, 'TOOL_ATTEMPT_LIMIT'],
  ] as const)('seals the limits and refuses the whole batch with %s', async (overrides, code) => {
    const mutableLimits = { ...limits, ...overrides };
    const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('', [call(), call('second')]));
    const { make, execute } = fixture(provider, { limits: mutableLimits });
    const runtime = make();
    Object.assign(mutableLimits, limits);
    await expect(runtime.run(turn())).rejects.toMatchObject({ name: 'AgentRunnerError', code });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    [2, 2, 'MODEL_TURN_LIMIT', 2, 1],
    [3, 1, 'TOOL_ATTEMPT_LIMIT', 2, 1],
    [3, 2, undefined, 3, 2],
  ] as const)(
    'applies cumulative turn/attempt budgets of %i/%i across batches',
    async (maxModelTurns, maxToolAttempts, code, modelCalls, toolCalls) => {
      const provider = vi.fn<ActorAgentLlmProvider>(({ messages }) => {
        if (messages.length === 1) return assistant('', [call()]);
        if (messages.length === 3) return assistant('', [call('second')]);
        return assistant('complete');
      });
      const { make, execute } = fixture(provider, {
        limits: { ...limits, maxModelTurns, maxToolAttempts },
      });
      const runtime = make();
      for (const text of ['first', 'second']) {
        const result = runtime.run(turn(text));
        if (code) await expect(result).rejects.toMatchObject({ code });
        else await expect(result).resolves.toBe('complete');
      }
      expect(provider).toHaveBeenCalledTimes(modelCalls * 2);
      expect(execute).toHaveBeenCalledTimes(toolCalls * 2);
    }
  );

  it('does not retry failed dispatches and admits a fresh ledger after each failure', async () => {
    const provider = vi
      .fn<ActorAgentLlmProvider>()
      .mockImplementationOnce(() => {
        throw new Error('offline');
      })
      .mockImplementation(({ messages }) =>
        messages.length === 1 ? assistant('', [call()]) : assistant('complete')
      );
    const { make, execute } = fixture(provider, {
      limits: { ...limits, maxModelTurns: 2, maxToolAttempts: 1 },
    });
    execute.mockImplementationOnce(() => {
      throw new AgentRunnerError('READ_REFUSED', 'Could not read.');
    });
    const runtime = make();
    await expect(runtime.run(turn())).rejects.toMatchObject({ code: 'LLM_PROVIDER_FAILED' });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    await expect(runtime.run(turn())).rejects.toMatchObject({ code: 'READ_REFUSED' });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(runtime.run(turn())).resolves.toBe('complete');
    expect(provider).toHaveBeenCalledTimes(4);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it.each([0, -1])(
    'checks model request ingress at the exact byte limit plus %i',
    async (delta) => {
      const prompt = 'é漢😀\u0000\u000b\r\n"\\\ud800 / \udfff';
      const request = { ...requestOf([{ role: 'user', content: prompt }]), tools: [] };
      const expected = { system: request.system, messages: request.messages, tools: [] };
      const provider = vi.fn<ActorAgentLlmProvider>(() => ({
        ok: false,
        error: { code: 'OFFLINE', message: 'diagnostic'.repeat(1000) },
      }));
      const mutableLimits = {
        ...limits,
        maxModelTurns: 1,
        maxToolAttempts: 0,
        maxPayloadBytes: jsonBytes(expected) + delta,
      };
      const { make, execute } = fixture(provider, {
        encodeTask: () => prompt,
        grants: [],
        limits: mutableLimits,
      });
      const runtime = make();
      mutableLimits.maxPayloadBytes = 1;
      await expect(runtime.run(turn())).rejects.toMatchObject({
        code: delta === 0 ? 'OFFLINE' : 'PAYLOAD_BYTE_LIMIT',
      });
      expect(provider).toHaveBeenCalledTimes(delta === 0 ? 1 : 0);
      if (delta === 0) expect(provider.mock.calls[0]?.[0]).toStrictEqual(expected);
      expect(execute).not.toHaveBeenCalled();
    }
  );

  it.each([0, -1])(
    'counts every JSON crossing in two batches, including re-sent history, at exact bytes plus %i',
    async (delta) => {
      const text = ' repeated 😀é漢 \\" \r\b\t\f\n\0\ud800\udfff\udfff / ';
      const shared = { [text]: [text, -0, 1e21, 1e-7, Number.MIN_VALUE, null, false] };
      const effects = [{ shared, again: shared }, { é: [true, -15.32, text] }];
      const batches = [
        assistant('read one', [call('one', 'read', { path: 'public', text: shared })]),
        assistant('read two', [call('two', 'read', { path: 'public', text })]),
      ] as const;
      const final = assistant('finished 😀');
      const firstHistory = [
        initialMessage,
        batches[0].value.message,
        toolReceipt('one', effects[0]),
      ];
      const secondHistory = [
        ...firstHistory,
        batches[1].value.message,
        toolReceipt('two', effects[1]),
      ];
      const requests = [requestOf(), requestOf(firstHistory), requestOf(secondHistory)];
      const allowance = jsonBytes(
        ...requests,
        ...batches.map(({ value }) => value.message),
        final.value.message,
        'public',
        'public',
        ...effects
      );
      const provider = vi
        .fn<ActorAgentLlmProvider>()
        .mockReturnValueOnce(batches[0])
        .mockReturnValueOnce(batches[1])
        .mockReturnValue({
          ...final,
          value: { ...final.value, usage: { inputTokens: 500, totalTokens: 901 } },
        });
      const { make, execute } = fixture(provider, {
        limits: {
          ...limits,
          maxModelTurns: 3,
          maxToolAttempts: 2,
          maxPayloadBytes: allowance + delta,
        },
      });
      execute.mockReturnValueOnce(effects[0]).mockReturnValueOnce(effects[1]);
      const result = make().run(turn());
      if (delta === 0) await expect(result).resolves.toBe('finished 😀');
      else await expect(result).rejects.toMatchObject({ code: 'PAYLOAD_BYTE_LIMIT' });
      expect(execute).toHaveBeenCalledTimes(2);
      expect(provider.mock.calls.map(([request]) => request)).toStrictEqual(requests);
    }
  );

  it('accepts a model-only answer at both exact caps and resets the byte budget', async () => {
    const final = assistant('online');
    const provider = vi.fn<ActorAgentLlmProvider>(() => final);
    const { make, execute } = fixture(provider, {
      limits: {
        ...limits,
        maxModelTurns: 1,
        maxToolAttempts: 0,
        maxPayloadBytes: jsonBytes(requestOf(), final.value.message),
      },
    });
    const runtime = make();
    await expect(runtime.run(turn())).resolves.toBe('online');
    await expect(runtime.run(turn())).resolves.toBe('online');
    expect(provider).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['assistant message', -1, []],
    ['known inputs in combination', 2 * jsonBytes('public') - 1, []],
    ['tool result', 2 * jsonBytes('public'), ['failed']],
    ['new allowance after result', jsonBytes('public', '012345678') + 1, ['returned']],
    [
      'resending the resulting history',
      2 * jsonBytes('public', '012345678'),
      ['returned', 'returned'],
    ],
  ] as const)('short-circuits byte exhaustion at %s', async (_boundary, extra, outcomes) => {
    const first = assistant('', [call(), call('second')]);
    const provider = vi.fn<ActorAgentLlmProvider>(() => first);
    const { make, execute } = fixture(provider, {
      limits: {
        ...limits,
        maxModelTurns: 2,
        maxToolAttempts: 2,
        maxPayloadBytes: jsonBytes(requestOf(), first.value.message) + extra,
      },
    });
    // Size 11. With 16 spare bytes, the first result itself is too big; with
    // 20 spare bytes, it fits but leaves only one byte for the second input.
    execute.mockReturnValue('012345678');
    const run = make().start(turn(), evidenceBinding);
    await expect(run.result).rejects.toMatchObject({ code: 'PAYLOAD_BYTE_LIMIT' });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(outcomes.length);
    expect(facts(run, 'LOCAL_TOOL_')).toEqual(
      outcomes.flatMap((outcome, index) => [
        ['LOCAL_TOOL_DISPATCHED', index + 1, { toolOrdinal: 1 }],
        ['LOCAL_TOOL_OUTCOME', index + 1, { toolOrdinal: 1, outcome }],
      ])
    );
  });

  it('rejects invalid proposed arguments and outputs without invoking getters or toJSON', async () => {
    const get = vi.fn(() => 'illicit');
    const toJSON = vi.fn(() => null);
    const badArgument = Object.defineProperty({}, 'hidden', { enumerable: true, get });
    const badProvider = vi.fn<ActorAgentLlmProvider>(() =>
      assistant('', [call('id', 'read', badArgument)])
    );
    const badRequest = fixture(badProvider);
    await expect(badRequest.make().run(turn())).rejects.toMatchObject({
      code: 'INVALID_TOOL_CALL',
    });
    expect(badRequest.execute).not.toHaveBeenCalled();
    const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('', [call(), call('second')]));
    for (const invalid of [
      Object.defineProperty({}, 'then', { enumerable: true, get }),
      { toJSON },
      undefined,
      { count: Number.POSITIVE_INFINITY },
    ]) {
      const { make, execute } = fixture(provider);
      execute.mockReturnValue(invalid);
      await expect(make().run(turn())).rejects.toMatchObject({ code: 'INVALID_TOOL_OUTPUT' });
      expect(execute).toHaveBeenCalledTimes(1);
    }
    expect(provider).toHaveBeenCalledTimes(4);
    expect(get).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  it('does not forward a tool result the shared loop cannot serialize as JSON', async () => {
    const output = Array.from({ length: 20_000 }).reduce<unknown>((child) => [child], null);
    let validReceipt: string | undefined;
    try {
      validReceipt = JSON.stringify({ ok: true, output });
    } catch (error) {
      // Engines may have different native serializer nesting limits.
      expect(error).toBeInstanceOf(RangeError);
    }
    const provider = vi
      .fn<ActorAgentLlmProvider>()
      .mockReturnValueOnce(assistant('', [call()]))
      .mockReturnValueOnce(assistant('complete'));
    const { make, execute } = fixture(provider, {
      limits: { ...limits, maxPayloadBytes: 128 * 1024 },
    });
    execute.mockReturnValue(output);
    const outcome = make().run(turn());
    if (validReceipt === undefined) {
      await expect(outcome).rejects.toMatchObject({ code: 'INVALID_TOOL_OUTPUT' });
      expect(provider).toHaveBeenCalledTimes(1);
    } else {
      await expect(outcome).resolves.toBe('complete');
      expect(provider.mock.calls[1]?.[0].messages.at(-1)?.content).toBe(validReceipt);
    }
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('trusted port compatibility', () => {
  it.each([
    ['provider', false, false, 'PROVIDER_TIMEOUT'],
    ['provider', true, false, 'RUN_ABORTED'],
    ['tool', false, false, 'RUN_ABORTED'],
    ['tool', true, false, 'TOOL_TIMEOUT'],
    ['provider', false, true, 'PROVIDER_TIMEOUT'],
    ['provider', true, true, 'RUN_ABORTED'],
    ['tool', false, true, 'RUN_ABORTED'],
    ['tool', true, true, 'TOOL_TIMEOUT'],
  ] as const)(
    'fences a %s Promise accessor (own: %s, null root: %s) through %s and until settled',
    async (port, ownAccessor, nullRoot, code) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      const subscribed = deferred();
      const raw = deferred<ActorAgentLlmResult>();
      const onRead = vi.fn();
      const pending = accessorPromise(
        raw.promise,
        onRead,
        subscribed.resolve,
        ownAccessor,
        nullRoot
      );
      const provider = vi
        .fn<ActorAgentLlmProvider>()
        .mockReturnValueOnce(port === 'provider' ? pending : assistant('', [call()]))
        .mockReturnValue(assistant('fresh'));
      const { make, execute } = fixture(provider, {
        limits: { ...limits, providerTimeoutMs: 10, toolTimeoutMs: 10 },
      });
      execute.mockReturnValueOnce(pending);
      const runtime = make();
      const control = new AbortController();
      const first = runtime.run(turn('first', control.signal));
      expect(
        await Promise.race([subscribed.promise.then(() => true), first.catch(() => false)])
      ).toBe(true);
      if (code === 'RUN_ABORTED') control.abort();
      else await vi.advanceTimersByTimeAsync(10);
      await expect(first).rejects.toMatchObject({ code });
      await expect(runtime.run(turn())).rejects.toMatchObject({ code: 'RUNTIME_BUSY' });
      expect(provider).toHaveBeenCalledTimes(1);
      expect(onRead).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(port === 'provider' ? 0 : 1);
      raw.resolve(assistant('late', [call()]));
      await vi.advanceTimersByTimeAsync(0);
      await expect(runtime.run(turn())).resolves.toBe('fresh');
      expect(provider).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenCalledTimes(port === 'provider' ? 0 : 1);
    }
  );

  it('keeps plain record, array and foreign-realm root accessors inert', async () => {
    const get = vi.fn(() => {
      throw new Error('A data accessor must not run.');
    });
    const local = [Object.create(null), [], {}].map((value) =>
      Object.defineProperty(value, 'then', { enumerable: true, get })
    );
    const ambiguousRoot: object = Object.create(null);
    Object.defineProperty(ambiguousRoot, 'constructor', { get });
    Object.defineProperty(ambiguousRoot, 'then', { get });
    const ambiguous: unknown = Object.create(ambiguousRoot);
    const fabricatedRoot: object = Object.create(null);
    const fake = { class() {} }.class;
    Object.defineProperty(fake, 'prototype', { value: fabricatedRoot });
    Object.defineProperty(fabricatedRoot, 'constructor', { value: fake });
    Object.defineProperty(fabricatedRoot, 'then', { get });
    const fabricated: unknown = Object.create(fabricatedRoot);
    const foreign: unknown[] = runInNewContext(
      `Object.defineProperty(Object.prototype, 'then', { get: hook });
       [Object.defineProperty({}, 'then', { get: hook }), {}, [], new class Fixture {}];`,
      { hook: get }
    );
    const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('', [call()]));
    const { make, execute } = fixture(provider);
    const runtime = make();
    for (const value of [...local, ...foreign, ambiguous, fabricated]) {
      execute.mockReturnValueOnce(value);
      await expect(runtime.run(turn())).rejects.toMatchObject({ code: 'INVALID_TOOL_OUTPUT' });
    }
    expect(get).not.toHaveBeenCalled();
    expect(provider).toHaveBeenCalledTimes(9);
    expect(execute).toHaveBeenCalledTimes(9);
  });

  it.each([
    ['provider', false, false, 'PROVIDER_TIMEOUT'],
    ['tool', true, false, 'TOOL_TIMEOUT'],
    ['provider', true, true, 'PROVIDER_TIMEOUT'],
    ['tool', true, true, 'TOOL_TIMEOUT'],
  ] as const)(
    'retains the returned %s Promise method (inherited: %s, null root: %s) until it settles',
    async (port, inherited, nullRoot, code) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      const started = deferred();
      const raw = deferred<ActorAgentLlmResult>();
      const pending = promiseWrapper(raw.promise, started.resolve, inherited, nullRoot);
      const provider = vi
        .fn<ActorAgentLlmProvider>()
        .mockReturnValueOnce(port === 'provider' ? pending : assistant('', [call()]))
        .mockReturnValue(assistant('fresh'));
      const { make, execute } = fixture(provider, {
        limits: { ...limits, providerTimeoutMs: 10, toolTimeoutMs: 10 },
      });
      execute.mockReturnValueOnce(pending);
      const runtime = make();
      const first = runtime.run(turn());
      expect(await Promise.race([started.promise.then(() => true), first.catch(() => false)])).toBe(
        true
      );
      await vi.advanceTimersByTimeAsync(10);
      await expect(first).rejects.toMatchObject({ code });
      await expect(runtime.run(turn())).rejects.toMatchObject({ code: 'RUNTIME_BUSY' });
      expect(provider).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(port === 'provider' ? 0 : 1);
      raw.resolve(assistant('late', [call()]));
      await vi.advanceTimersByTimeAsync(0);
      await expect(runtime.run(turn())).resolves.toBe('fresh');
      expect(provider).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenCalledTimes(port === 'provider' ? 0 : 1);
    }
  );

  it('tracks a nested wrapper when fulfillment wins over a later callback and throw', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const subscribed = deferred();
    const raw = deferred<string>();
    const inner = promiseWrapper(raw.promise, subscribed.resolve, true);
    const provider = vi
      .fn<ActorAgentLlmProvider>()
      .mockReturnValueOnce(assistant('', [call()]))
      .mockReturnValue(assistant('fresh'));
    const { make, execute } = fixture(provider);
    execute.mockReturnValueOnce({
      // biome-ignore lint/suspicious/noThenProperty: Exercises first-settlement rules for nested wrappers.
      then(fulfill: (value: Promise<string>) => void, reject: (reason: unknown) => void) {
        fulfill(inner);
        reject(new Error('too late'));
        throw new Error('also too late');
      },
    });
    const runtime = make();
    const control = new AbortController();
    const first = runtime.run(turn('first', control.signal));
    expect(
      await Promise.race([subscribed.promise.then(() => true), first.catch(() => false)])
    ).toBe(true);
    control.abort();
    await expect(first).rejects.toMatchObject({ code: 'RUN_ABORTED' });
    await expect(runtime.run(turn())).rejects.toMatchObject({ code: 'RUNTIME_BUSY' });
    raw.reject(new Error('settled after abort'));
    await vi.advanceTimersByTimeAsync(0);
    await expect(runtime.run(turn())).resolves.toBe('fresh');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('accepts successful provider and tool wrapper fulfillments as ordinary payloads', async () => {
    const onSubscribe = vi.fn();
    const provider = vi
      .fn<ActorAgentLlmProvider>()
      .mockReturnValueOnce(promiseWrapper(Promise.resolve(assistant('', [call()])), onSubscribe))
      .mockImplementationOnce((request) => {
        expect(request.messages.at(-1)?.content).toBe('{"ok":true,"output":{"value":"ready"}}');
        return promiseWrapper(Promise.resolve(assistant('complete')), onSubscribe);
      });
    const { make, execute } = fixture(provider);
    execute.mockReturnValueOnce(
      promiseWrapper(Promise.resolve({ value: 'ready' }), onSubscribe, true)
    );
    await expect(make().run(turn())).resolves.toBe('complete');
    expect(onSubscribe).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('reports a wrapper method throw as a tool fault and never assimilates data accessors', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>(() => assistant('', [call()]));
    const { make, execute } = fixture(provider);
    const get = vi.fn(() => {
      throw new Error('must not be read');
    });
    const data = Object.defineProperty({}, 'then', { enumerable: true, get });
    execute
      .mockReturnValueOnce({
        // biome-ignore lint/suspicious/noThenProperty: Intentionally throws during Promise subscription.
        then() {
          throw new AgentRunnerError('READ_FAILED', 'Could not read.');
        },
      })
      .mockReturnValueOnce({
        // biome-ignore lint/suspicious/noThenProperty: Intentionally fulfills with invalid JSON data.
        then(fulfill: (input: unknown) => void) {
          fulfill(data);
        },
      });
    const runtime = make();
    await expect(runtime.run(turn())).rejects.toMatchObject({ code: 'READ_FAILED' });
    await expect(runtime.run(turn())).rejects.toMatchObject({ code: 'INVALID_TOOL_OUTPUT' });
    expect(get).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('preserves inherited provider codes, required getter messages, and ordinary causes', async () => {
    class AuthFailure extends Error {
      get code() {
        return 'OFFLINE_AUTH';
      }
    }
    const ordinaryCause = new Error('test cause');
    const getCause = vi.fn(() => {
      throw new Error('lazy cause must not be read');
    });
    const lazyDiagnostic = {
      get code() {
        return 'OFFLINE_LAZY';
      },
      get message() {
        return 'Offline without inspecting the cause.';
      },
      get cause() {
        return getCause();
      },
    };
    const provider = vi
      .fn<ActorAgentLlmProvider>()
      .mockReturnValueOnce({
        ok: false,
        error: new AuthFailure('Offline.', { cause: ordinaryCause }),
      })
      .mockReturnValueOnce({ ok: false, error: lazyDiagnostic })
      .mockReturnValueOnce({
        ok: false,
        error: {
          get code(): string {
            throw new AgentRunnerError('NOT_THE_DIAGNOSTIC', 'Could not read the code.');
          },
          message: 'Malformed diagnostic.',
        },
      });
    const { make, execute } = fixture(provider);
    const runtime = make();
    await expect(runtime.run(turn())).rejects.toMatchObject({
      code: 'OFFLINE_AUTH',
      message: 'Offline.',
      cause: ordinaryCause,
    });
    await expect(runtime.run(turn())).rejects.toMatchObject({
      code: 'OFFLINE_LAZY',
      message: 'Offline without inspecting the cause.',
      cause: undefined,
    });
    await expect(runtime.run(turn())).rejects.toMatchObject({ code: 'INVALID_PROVIDER_REPLY' });
    expect(getCause).not.toHaveBeenCalled();
    expect(provider).toHaveBeenCalledTimes(3);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('local actor runtime runner', () => {
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
          throw new AgentRunnerError('READ_FAILED', 'The read failed after the deadline.');
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
      { encodeTask: null },
      { definition: { ...definition, purpose: '' } },
      { limits: { ...limits, askTimeoutMs: Number.POSITIVE_INFINITY } },
      { limits: { ...limits, runTimeoutMs: 2_147_483_648 } },
    ]) {
      expect(() => createAgentRunner({ ...options, ...changes } as Options)).toThrow(
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
      const execute = vi.fn<AgentToolHandler<Task>['execute']>((input) => {
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
    execute.mockRejectedValueOnce(new AgentRunnerError('READ_FAILED', 'The read failed.'));
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

  it('reports pre-abort and invalid bindings without starting a local session', async () => {
    const provider = vi.fn<ActorAgentLlmProvider>();
    const { make, execute } = fixture(provider);
    const runtime = make();
    const control = new AbortController();
    control.abort();
    const stopped = runtime.start(turn('first', control.signal));
    expect(Object.keys(stopped).sort()).toEqual(['readTrace', 'result', 'waitForSettlement']);
    expect(stopped.readTrace()).toBeUndefined();
    await expect(stopped.waitForSettlement(0)).resolves.toEqual({ status: 'not-admitted' });
    await expect(stopped.result).rejects.toMatchObject({ code: 'RUN_ABORTED' });
    const wrongDefinition = runtime.start({ ...turn(), systemPrompt: 'wrong definition' });
    await expect(wrongDefinition.result).rejects.toMatchObject({ code: 'DEFINITION_MISMATCH' });
    await expect(wrongDefinition.waitForSettlement(0)).resolves.toEqual({ status: 'not-admitted' });
    expect(runtimeStart).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not confuse an unconfirmed start with local settlement', async () => {
    runtimeStart.mockRejectedValueOnce(new Error('No runtime handle was returned.'));
    const provider = vi.fn<ActorAgentLlmProvider>();
    const runtime = fixture(provider).make();
    const first = runtime.start(turn(), evidenceBinding);
    await expect(first.result).rejects.toMatchObject({ code: 'RUNTIME_START_FAILED' });
    await expect(first.waitForSettlement(0)).resolves.toEqual({
      status: 'unresolved',
      reason: 'runtime-start-failed',
    });
    expect(facts(first)).toEqual([
      [
        'LOCAL_CLEANUP_OUTCOME',
        undefined,
        { outcome: 'unresolved', reason: 'runtime-start-failed' },
      ],
    ]);
    expect(JSON.stringify(first.readEvidence())).not.toContain('No runtime handle');
    await expect(runtime.run(turn())).rejects.toMatchObject({ code: 'RUNTIME_BUSY' });
    expect(provider).not.toHaveBeenCalled();
    expect(runtimeStart).toHaveBeenCalledTimes(1);
  });

  it('expires an observation without stopping healthy work', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const entered = deferred<AbortSignal>();
    const reply = deferred<ActorAgentLlmResult>();
    const provider = vi.fn<ActorAgentLlmProvider>((_request, { signal }) => {
      entered.resolve(signal);
      return reply.promise;
    });
    const runtime = fixture(provider).make();
    const first = runtime.start(turn());
    const signal = await entered.promise;
    const waiting = first.waitForSettlement(5);
    await vi.advanceTimersByTimeAsync(5);
    await expect(waiting).resolves.toEqual({ status: 'unresolved', reason: 'wait-timeout' });
    expect(signal.aborted).toBe(false);
    reply.resolve(assistant('on time'));
    await expect(first.result).resolves.toBe('on time');
    await expect(first.waitForSettlement(0)).resolves.toEqual({ status: 'settled' });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['caller abort', 'RUN_ABORTED', 'provider', 'reject'],
    ['caller abort', 'RUN_ABORTED', 'tool', 'resolve'],
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
    const first = runtime.start(turn('first', control.signal), evidenceBinding);
    const rejected = expect(first.result).rejects.toMatchObject({ code });
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
    const shortWait = first.waitForSettlement(10);
    const longWait = first.waitForSettlement(30);
    await expect(first.waitForSettlement(-1)).rejects.toMatchObject({
      code: 'INVALID_SETTLEMENT_WAIT',
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(shortWait).resolves.toEqual({ status: 'unresolved', reason: 'wait-timeout' });
    expect(facts(first, 'LOCAL_CLEANUP_')).toEqual([['LOCAL_CLEANUP_STARTED', undefined, {}]]);
    const toolFacts =
      port === 'tool'
        ? [
            ['LOCAL_TOOL_DISPATCHED', 1, { toolOrdinal: 1 }],
            ['LOCAL_TOOL_OUTCOME', 1, { toolOrdinal: 1, outcome: 'interrupted' }],
          ]
        : [];
    expect(facts(first, 'LOCAL_TOOL_')).toEqual(toolFacts);
    const overlap = runtime.start(turn('busy'), evidenceBinding);
    await expect(overlap.result).rejects.toMatchObject({ code: 'RUNTIME_BUSY' });
    await expect(overlap.waitForSettlement(0)).resolves.toEqual({ status: 'not-admitted' });
    expect(overlap.readEvidence()).toBeUndefined();
    expect(provider).toHaveBeenCalledTimes(1);
    if (settle === 'resolve') raw.resolve(assistant('late must not be accepted', [call()]));
    else raw.reject(new Error('late rejection'));
    await vi.advanceTimersByTimeAsync(0);
    await expect(longWait).resolves.toEqual({ status: 'settled' });
    expect(facts(first, 'LOCAL_CLEANUP_')).toEqual([
      ['LOCAL_CLEANUP_STARTED', undefined, {}],
      ['LOCAL_CLEANUP_OUTCOME', undefined, { outcome: 'settled' }],
    ]);
    expect(facts(first, 'LOCAL_TOOL_')).toEqual(toolFacts);
    expect(JSON.stringify(first.readEvidence())).not.toMatch(
      /wait-timeout|late must|late rejection/
    );
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
    const first = runtime.start(turn('first', control.signal), evidenceBinding);
    const rejected = expect(first.result).rejects.toMatchObject({ code: 'RUN_ABORTED' });
    await stopRequested.promise;
    control.abort();
    await rejected;
    await expect(first.waitForSettlement(0)).resolves.toEqual({
      status: 'unresolved',
      reason: 'wait-timeout',
    });
    expect(facts(first, 'LOCAL_CLEANUP_')).toEqual([['LOCAL_CLEANUP_STARTED', undefined, {}]]);
    await expect(runtime.run(turn('busy'))).rejects.toMatchObject({ code: 'RUNTIME_BUSY' });
    stopGate.resolve();
    await stopped.promise;
    await expect(first.waitForSettlement(500)).resolves.toEqual({ status: 'settled' });
    expect(facts(first, 'LOCAL_CLEANUP_')).toEqual([
      ['LOCAL_CLEANUP_STARTED', undefined, {}],
      ['LOCAL_CLEANUP_OUTCOME', undefined, { outcome: 'settled' }],
    ]);
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
    const first = runtime.start(turn('first', control.signal), evidenceBinding);
    const rejected = expect(first.result).rejects.toMatchObject({ code: 'RUN_ABORTED' });
    expect(runtimeStart).toHaveBeenCalledTimes(1);
    control.abort();
    await rejected;
    await expect(first.waitForSettlement(0)).resolves.toEqual({
      status: 'unresolved',
      reason: 'wait-timeout',
    });
    expect(facts(first)).toEqual([]);
    await expect(runtime.run(turn('busy'))).rejects.toMatchObject({ code: 'RUNTIME_BUSY' });
    startup.resolve();
    await stopped.promise;
    await expect(first.waitForSettlement(500)).resolves.toEqual({ status: 'settled' });
    expect(facts(first)).toEqual([
      ['LOCAL_CLEANUP_STARTED', undefined, {}],
      ['LOCAL_CLEANUP_OUTCOME', undefined, { outcome: 'settled' }],
    ]);
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
    const first = runtime.start(turn(), evidenceBinding);
    await expect(first.result).rejects.toMatchObject({ code: 'RUNTIME_STOP_FAILED' });
    const parser = vi.fn();
    await expect(first.validateOutput(parser)).rejects.toMatchObject({
      code: 'RUNTIME_STOP_FAILED',
    });
    expect(parser).not.toHaveBeenCalled();
    expect(facts(first, 'LOCAL_OUTPUT_')).toEqual([]);
    await expect(first.waitForSettlement(0)).resolves.toEqual({
      status: 'unresolved',
      reason: 'runtime-stop-failed',
    });
    expect(facts(first, 'LOCAL_CLEANUP_')).toEqual([
      ['LOCAL_CLEANUP_STARTED', undefined, {}],
      [
        'LOCAL_CLEANUP_OUTCOME',
        undefined,
        { outcome: 'unresolved', reason: 'runtime-stop-failed' },
      ],
    ]);
    expect(JSON.stringify(first.readEvidence())).not.toMatch(/Stop result|not accepted/);
    await expect(runtime.run(turn())).rejects.toMatchObject({ code: 'RUNTIME_BUSY' });
    expect(runtimeStart).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
