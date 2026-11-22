import type { JsonValue } from '@actor-web/runtime';
import {
  type ActorToolExecutionContext,
  type ActorToolExecutor,
  createActorToolbox,
  startRuntime,
} from '@actor-web/runtime/browser';
import { actor, defineActorWebTopology, node, tool } from '@actor-web/runtime/topology';
import {
  ACTOR_WEB_LLM_TOOL_NAME,
  type ActorAgentLlmProvider,
  type ActorAgentLlmResult,
  type ActorAgentLoopMessage,
  type ActorAgentLoopReply,
  type ActorAgentToolDefinition,
  createActorAgentToolRegistry,
  createAgentLoopBehavior,
} from './index.js';
import type { AgentRuntime, AgentTurn } from './portable.js';

export interface ActorRuntimeTool<Task> {
  readonly name: string;
  /** Synchronously validate and scope the input without effects. Return plain JSON data or throw. */
  readonly validateInput: (input: unknown, task: Task) => { readonly value: unknown };
  /** Only called with a detached copy of the validated payload. */
  readonly execute: (input: unknown, task: Task, context: ActorToolExecutionContext) => unknown;
}

export interface ActorRuntimeLimits {
  readonly runTimeoutMs: number;
  /** Positive integer up to 214748364 ms, allowing for the local ask's 10× fallback timer. */
  readonly askTimeoutMs: number;
  readonly providerTimeoutMs: number;
  readonly toolTimeoutMs: number;
  readonly maxToolCallsPerBatch: number;
}

export interface ActorRuntimeOptions<Task, Purpose extends string> {
  /** The trusted portable definition, including any output instructions appended by createAgent. */
  readonly definition: Pick<AgentTurn<Task, Purpose>, 'purpose' | 'systemPrompt' | 'tools'> & {
    readonly output?: { readonly instructions?: string };
  };
  readonly provider: ActorAgentLlmProvider;
  readonly grants: readonly string[];
  readonly tools: readonly ActorRuntimeTool<Task>[];
  readonly encodeTask: (task: Task) => string;
  readonly limits: ActorRuntimeLimits;
}

export class ActorRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = 'ActorRuntimeError';
  }
}

const localNode = 'portable-agent';
const maxTimerMs = 2_147_483_647;
// The local actor ask schedules a correlation fallback at ten times the requested delay.
const maxAskTimeoutMs = Math.floor(maxTimerMs / 10);

function invalidConfig(message: string): never {
  throw new ActorRuntimeError('INVALID_RUNTIME_CONFIG', message);
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\s\p{Cc}]/u.test(value);
}

function checkToolName(name: unknown): asserts name is string {
  if (!isToken(name) || name === ACTOR_WEB_LLM_TOOL_NAME || Object.hasOwn(Object.prototype, name)) {
    invalidConfig('Invalid or reserved application tool name.');
  }
}

// Take a plain, immutable JSON snapshot and canonicalize object key order for turn comparison.
function copyJson(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object' && value !== null && !ancestors.has(value)) {
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        const items = Array.from(value, (item: unknown) => copyJson(item, ancestors));
        Object.freeze(items);
        return items;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype === Object.prototype || prototype === null) {
        const entries = Reflect.ownKeys(value).map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) {
            return invalidConfig('Tool parameters must be plain JSON data.');
          }
          return [key, copyJson(descriptor.value, ancestors)] as const;
        });
        entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
        return Object.freeze(Object.fromEntries(entries));
      }
    } finally {
      ancestors.delete(value);
    }
  }
  return invalidConfig('Tool parameters must be plain JSON data.');
}

function invalidToolPayload(): Error {
  return new Error('Validated tool payloads must be plain JSON data.');
}

function ownJsonField(value: object, key: PropertyKey): unknown {
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (typeof key !== 'string' || !field?.enumerable || !('value' in field)) {
    throw invalidToolPayload();
  }
  return field.value;
}

// Copy each call independently. Keep aliases within a copy, but reject cycles.
function snapshotToolPayload(
  value: unknown,
  copies = new Map<object, JsonValue | undefined>()
): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value === null) throw invalidToolPayload();
  const existing = copies.get(value);
  if (existing !== undefined) return existing;
  if (copies.has(value)) throw invalidToolPayload();
  copies.set(value, undefined);

  const prototype = Object.getPrototypeOf(value);
  let copy: JsonValue;
  if (Array.isArray(value)) {
    const length = value.length;
    if (prototype !== Array.prototype || Reflect.ownKeys(value).length !== length + 1) {
      throw invalidToolPayload();
    }
    const items: JsonValue[] = [];
    for (let index = 0; index < length; index++) {
      items.push(snapshotToolPayload(ownJsonField(value, String(index)), copies));
    }
    copy = items;
  } else {
    if (prototype !== Object.prototype && prototype !== null) throw invalidToolPayload();
    const record = Object.fromEntries(
      Reflect.ownKeys(value).map((key) => [
        key,
        snapshotToolPayload(ownJsonField(value, key), copies),
      ])
    );
    copy = prototype === null ? Object.setPrototypeOf(record, null) : record;
  }
  copies.set(value, copy);
  return copy;
}

function snapshotRequested(tools: unknown): ActorAgentToolDefinition[] {
  if (!Array.isArray(tools)) invalidConfig('An explicit requested tool list is required.');
  const seen = new Set<string>();
  return Array.from(tools, (entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || !('name' in entry)) {
      return invalidConfig('Invalid requested tool definition.');
    }
    const { name } = entry;
    checkToolName(name);
    if (
      seen.has(name) ||
      !('description' in entry) ||
      typeof entry.description !== 'string' ||
      !entry.description.trim() ||
      !('parameters' in entry) ||
      typeof entry.parameters !== 'object' ||
      entry.parameters === null ||
      Array.isArray(entry.parameters)
    ) {
      return invalidConfig('Invalid or duplicate requested tool definition.');
    }
    seen.add(name);
    return Object.freeze({
      name,
      description: entry.description,
      inputSchema: copyJson(entry.parameters),
    });
  });
}

function bindConfig<Task, Purpose extends string>(options: ActorRuntimeOptions<Task, Purpose>) {
  if (!options) invalidConfig('Actor runtime options are required.');
  const { definition, grants, tools, provider, encodeTask } = options;
  if (
    !definition ||
    typeof definition.purpose !== 'string' ||
    !definition.purpose.trim() ||
    typeof definition.systemPrompt !== 'string' ||
    !definition.systemPrompt.trim() ||
    (definition.output !== undefined &&
      (!definition.output || typeof definition.output !== 'object')) ||
    (definition.output?.instructions !== undefined &&
      typeof definition.output.instructions !== 'string') ||
    typeof provider !== 'function' ||
    typeof encodeTask !== 'function' ||
    !Array.isArray(grants) ||
    !Array.isArray(tools)
  ) {
    invalidConfig('A trusted definition, provider, task encoder, grants and tools are required.');
  }
  const limits = {
    runTimeoutMs: options.limits?.runTimeoutMs,
    askTimeoutMs: options.limits?.askTimeoutMs,
    providerTimeoutMs: options.limits?.providerTimeoutMs,
    toolTimeoutMs: options.limits?.toolTimeoutMs,
    maxToolCallsPerBatch: options.limits?.maxToolCallsPerBatch,
  };
  for (const [name, limit] of Object.entries(limits)) {
    // Browser and Node timers cannot represent delays above the signed 32-bit maximum.
    const max = name === 'askTimeoutMs' ? maxAskTimeoutMs : maxTimerMs;
    if (!Number.isInteger(limit) || limit < 1 || limit > max) {
      invalidConfig(`${name} must be a positive integer no greater than ${max}.`);
    }
  }
  const requested = snapshotRequested(definition.tools);
  const granted = new Set<string>();
  for (const name of grants) {
    checkToolName(name);
    if (granted.has(name)) invalidConfig('Duplicate tool grant.');
    granted.add(name);
  }
  const implementations = new Map<string, ActorRuntimeTool<Task>>();
  for (const implementation of tools as readonly ActorRuntimeTool<Task>[]) {
    if (!implementation) invalidConfig('Invalid tool implementation.');
    const { name, validateInput, execute } = implementation;
    checkToolName(name);
    if (
      implementations.has(name) ||
      typeof validateInput !== 'function' ||
      typeof execute !== 'function'
    ) {
      invalidConfig('Each registered tool must have a unique name, validator and handler.');
    }
    implementations.set(name, { name, validateInput, execute });
  }
  const effective = requested.flatMap((definition) => {
    const implementation = implementations.get(definition.name);
    return granted.has(definition.name) && implementation ? [{ definition, implementation }] : [];
  });
  return {
    purpose: definition.purpose,
    systemPrompt: definition.output?.instructions
      ? `${definition.systemPrompt}\n${definition.output.instructions}`
      : definition.systemPrompt,
    requested: JSON.stringify(requested),
    effective,
    limits,
    encodeTask,
    provider: createActorAgentToolRegistry({ llm: provider })[ACTOR_WEB_LLM_TOOL_NAME],
  };
}

function verifyTurn<Task, Purpose extends string>(
  config: ReturnType<typeof bindConfig<Task, Purpose>>,
  turn: AgentTurn<Task, Purpose>
): void {
  let requested: string;
  try {
    requested = JSON.stringify(snapshotRequested(turn.tools));
  } catch (cause) {
    throw new ActorRuntimeError('DEFINITION_MISMATCH', 'Invalid turn tool definitions.', cause);
  }
  if (
    turn.purpose !== config.purpose ||
    turn.systemPrompt !== config.systemPrompt ||
    requested !== config.requested
  ) {
    throw new ActorRuntimeError(
      'DEFINITION_MISMATCH',
      'Turn does not match the trusted definition.'
    );
  }
}

function executionFailure(code: string, message: string, cause: unknown): ActorRuntimeError {
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string' &&
    'message' in cause &&
    typeof cause.message === 'string'
  ) {
    return new ActorRuntimeError(cause.code, cause.message, cause);
  }
  return new ActorRuntimeError(code, message, cause);
}

type DispatchDeadlineCode = 'ACTOR_ASK_FAILED' | 'PROVIDER_TIMEOUT' | 'TOOL_TIMEOUT';
type Deadline = { readonly at: number; readonly failure: ActorRuntimeError };

function createRunScope(callerSignal: AbortSignal, runTimeoutMs: number) {
  const controller = new AbortController();
  const { signal } = controller;
  const rawWork = new Set<Promise<unknown>>();
  const deadlines = new Set<Deadline>();
  let rejectInterrupted: (reason: unknown) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectInterrupted = reject;
  });
  const interrupt = (reason: ActorRuntimeError) => {
    if (signal.aborted) return;
    // Reject the caller independently of any cooperative abort handlers.
    rejectInterrupted(reason);
    controller.abort(reason);
  };
  const abort = () =>
    interrupt(
      new ActorRuntimeError('RUN_ABORTED', 'The assignment was aborted.', callerSignal.reason)
    );
  const observeDeadlines = () => {
    if (signal.aborted) return;
    if (callerSignal.aborted) {
      abort();
      return;
    }
    const now = performance.now();
    let earliest: Deadline | undefined;
    // Equal absolute deadlines keep registration order (outer operation first).
    for (const deadline of deadlines) {
      if (deadline.at <= now && (!earliest || deadline.at < earliest.at)) earliest = deadline;
    }
    if (earliest) interrupt(earliest.failure);
  };
  const startDeadline = (failure: ActorRuntimeError, timeoutMs: number) => {
    const deadline = { at: performance.now() + timeoutMs, failure };
    deadlines.add(deadline);
    const onTimer = () => {
      observeDeadlines();
      if (!signal.aborted) {
        // Timer delivery can round down. Recheck the clock instead of committing early.
        timer = setTimeout(onTimer, Math.max(1, Math.ceil(deadline.at - performance.now())));
      }
    };
    let timer = setTimeout(onTimer, timeoutMs);
    return () => {
      deadlines.delete(deadline);
      clearTimeout(timer);
    };
  };
  const finishRunDeadline = startDeadline(
    new ActorRuntimeError('RUN_TIMEOUT', 'The assignment deadline expired.'),
    runTimeoutMs
  );
  callerSignal.addEventListener('abort', abort, { once: true });
  const check = () => {
    observeDeadlines();
    signal.throwIfAborted();
  };
  const wait = <T>(work: Promise<T>): Promise<T> => Promise.race([work, interrupted]);
  const track = <T>(operation: () => T | Promise<T>): Promise<T> => {
    const raw = Promise.resolve().then(() => {
      check();
      return operation();
    });
    rawWork.add(raw);
    const remove = () => rawWork.delete(raw);
    void raw.then(remove, remove);
    return raw;
  };
  return {
    check,
    signal,
    wait,
    async dispatch<T>(
      code: DispatchDeadlineCode,
      timeoutMs: number,
      operation: () => T | Promise<T>
    ): Promise<T> {
      check();
      const finish = startDeadline(
        new ActorRuntimeError(
          code,
          code === 'ACTOR_ASK_FAILED'
            ? 'The actor reply deadline expired.'
            : 'The dispatch deadline expired.'
        ),
        timeoutMs
      );
      try {
        const raw = track(operation);
        try {
          return await wait(raw);
        } finally {
          // Keep this deadline active for both successful and failed completions.
          check();
        }
      } catch (cause) {
        if (code !== 'ACTOR_ASK_FAILED' || signal.aborted) throw cause;
        const failure = executionFailure(code, 'The actor did not answer.', cause);
        interrupt(failure);
        throw failure;
      } finally {
        finish();
      }
    },
    async drain(): Promise<void> {
      await Promise.allSettled(rawWork);
    },
    dispose(): void {
      callerSignal.removeEventListener('abort', abort);
      finishRunDeadline();
    },
  };
}

function validateProviderStep(result: ActorAgentLlmResult, maxCalls: number): ActorAgentLlmResult {
  if (
    result?.ok === false &&
    typeof result.error?.code === 'string' &&
    typeof result.error.message === 'string'
  ) {
    return result;
  }
  if (result?.ok !== true) {
    return {
      ok: false,
      error: { code: 'INVALID_PROVIDER_REPLY', message: 'Expected a provider result.' },
    };
  }
  const message = result.value?.message;
  if (
    !message ||
    message.role !== 'assistant' ||
    typeof message.content !== 'string' ||
    (message.toolCalls !== undefined && !Array.isArray(message.toolCalls))
  ) {
    return {
      ok: false,
      error: { code: 'INVALID_ASSISTANT_REPLY', message: 'Expected an assistant message.' },
    };
  }
  if ((message.toolCalls?.length ?? 0) > maxCalls) {
    return {
      ok: false,
      error: { code: 'TOOL_BATCH_LIMIT', message: 'The tool batch exceeds the configured limit.' },
    };
  }
  const toolCalls = [];
  for (const call of message.toolCalls ?? []) {
    if (!call || !isToken(call.id)) {
      return {
        ok: false,
        error: { code: 'INVALID_TOOL_CALL_ID', message: 'Expected a nonempty tool call ID.' },
      };
    }
    if (!isToken(call.name) || !Object.hasOwn(call, 'input')) {
      return {
        ok: false,
        error: { code: 'INVALID_TOOL_CALL', message: 'Expected a tool name and input.' },
      };
    }
    toolCalls.push({ id: call.id, name: call.name, input: call.input });
  }
  return { ok: true, value: { ...result.value, message: { ...message, toolCalls } } };
}

async function driveLoop<Task>(
  ask: (message: ActorAgentLoopMessage) => Promise<ActorAgentLoopReply>,
  toolbox: ReturnType<typeof createActorToolbox>,
  implementations: ReadonlyMap<string, ActorRuntimeTool<Task>>,
  scope: ReturnType<typeof createRunScope>,
  task: Task,
  prompt: string,
  system: string
): Promise<string> {
  const seen = new Set<string>();
  let reply = await ask({ type: 'START_AGENT', prompt, system });
  for (;;) {
    scope.check();
    if (!reply.ok)
      throw new ActorRuntimeError(reply.error.code, reply.error.message, reply.error.cause);
    if (
      reply.status === 'responded' &&
      reply.message.role === 'assistant' &&
      !reply.toolCalls.length
    ) {
      if (reply.message.content.trim()) return reply.message.content;
      throw new ActorRuntimeError('INVALID_ASSISTANT_REPLY', 'Expected final assistant text.');
    }
    if (
      reply.status !== 'waiting-for-tool' ||
      reply.message.role !== 'assistant' ||
      reply.toolCalls.length === 0
    ) {
      throw new ActorRuntimeError(
        'UNEXPECTED_REPLY',
        'Expected an assistant tool batch or final reply.'
      );
    }

    // Validate and detach the whole batch before any handler runs. IDs stay reserved for the session.
    const batch = reply.toolCalls.map((call) => {
      scope.check();
      const { id, name } = call;
      if (seen.has(id)) {
        throw new ActorRuntimeError('DUPLICATE_TOOL_CALL_ID', 'A tool call ID cannot be reused.');
      }
      seen.add(id);
      const implementation = implementations.get(name);
      if (!implementation || !toolbox.has(name)) {
        throw new ActorRuntimeError('TOOL_DENIED', 'The tool is not granted for this assignment.');
      }
      let payload: unknown;
      try {
        const validated = implementation.validateInput(call.input, task);
        if (validated instanceof Promise) {
          void validated.catch(() => {});
          throw new Error('Tool validators must be synchronous.');
        }
        if (!validated || !Object.hasOwn(validated, 'value')) {
          throw new Error('Expected a synchronous validated tool payload.');
        }
        payload = validated.value;
      } catch (cause) {
        throw executionFailure('INVALID_TOOL_INPUT', 'The tool input was refused.', cause);
      }
      try {
        return { id, name, input: snapshotToolPayload(payload) };
      } catch (cause) {
        throw new ActorRuntimeError('INVALID_TOOL_INPUT', 'The tool input was refused.', cause);
      }
    });

    for (const [index, { id, name, input }] of batch.entries()) {
      scope.check();
      let output: unknown;
      try {
        output = await toolbox.execute(name, input);
      } catch (cause) {
        throw executionFailure('TOOL_FAILED', 'The application tool failed.', cause);
      }
      scope.check();
      reply = await ask({ type: 'OBSERVE_TOOL_RESULT', toolCallId: id, name, ok: true, output });
      if (!reply.ok)
        throw new ActorRuntimeError(reply.error.code, reply.error.message, reply.error.cause);
      if (
        index < batch.length - 1 &&
        (reply.status !== 'waiting-for-tool' ||
          reply.message.role !== 'tool' ||
          reply.message.toolCallId !== id ||
          reply.message.toolName !== name ||
          reply.toolCalls.length !== 0)
      ) {
        throw new ActorRuntimeError(
          'UNEXPECTED_REPLY',
          'Expected acknowledgement of the tool result.'
        );
      }
    }
  }
}

/** One fresh, owned local actor session per admitted portable invocation. */
export function createActorRuntime<Task, Purpose extends string>(
  options: ActorRuntimeOptions<Task, Purpose>
): AgentRuntime<Task, Purpose> {
  const config = bindConfig(options);
  const implementations = new Map(
    config.effective.map(({ implementation }) => [implementation.name, implementation])
  );
  const names = [ACTOR_WEB_LLM_TOOL_NAME, ...implementations.keys()];
  let active = false;

  return {
    async run(turn): Promise<string> {
      if (active) throw new ActorRuntimeError('RUNTIME_BUSY', 'The runtime is active or fenced.');
      if (!(turn?.signal instanceof AbortSignal)) {
        throw new ActorRuntimeError('INVALID_TURN', 'An explicit AbortSignal is required.');
      }
      if (turn.signal.aborted) {
        throw new ActorRuntimeError(
          'RUN_ABORTED',
          'The assignment was aborted.',
          turn.signal.reason
        );
      }

      active = true;
      const scope = createRunScope(turn.signal, config.limits.runTimeoutMs);
      let canRelease = true;
      const runOwned = async () => {
        verifyTurn(config, turn);
        scope.check();
        const task = turn.task;
        let prompt: string;
        try {
          prompt = config.encodeTask(task);
        } catch (cause) {
          throw executionFailure('INVALID_TASK', 'The task could not be encoded.', cause);
        }
        if (typeof prompt !== 'string' || !prompt.trim()) {
          throw new ActorRuntimeError(
            'INVALID_TASK',
            'The task encoder must return a nonempty string.'
          );
        }
        scope.check();

        const topology = defineActorWebTopology({
          nodes: { local: node(localNode) },
          tools: names.map((name) => tool(name)),
          actors: {
            specialist: actor({
              id: 'specialist',
              node: 'local',
              tools: names,
              supervision: { strategy: 'stop' },
              behavior: createAgentLoopBehavior({
                toolDefinitions: config.effective.map(({ definition }) => definition),
              }),
            }),
          },
        });
        const applicationTools = Object.fromEntries(
          Array.from(implementations, ([name, { execute }]): [string, ActorToolExecutor] => [
            name,
            (input, context) =>
              scope.dispatch('TOOL_TIMEOUT', config.limits.toolTimeoutMs, () =>
                execute(input, task, { ...context, signal: scope.signal })
              ),
          ])
        );
        const llm: typeof config.provider = (request, context) =>
          scope
            .dispatch('PROVIDER_TIMEOUT', config.limits.providerTimeoutMs, () =>
              config.provider(request, { ...context, signal: scope.signal })
            )
            .then((result) => validateProviderStep(result, config.limits.maxToolCallsPerBatch));
        scope.check();
        const host = await startRuntime(topology, { tools: { ...applicationTools, llm } }).catch(
          (cause: unknown) => {
            // A failed start does not give us a runtime handle to verify closure.
            canRelease = false;
            throw new ActorRuntimeError(
              'RUNTIME_START_FAILED',
              'Could not start the local runtime.',
              cause
            );
          }
        );
        let outcome: { ok: true; text: string } | { ok: false; error: unknown };
        try {
          scope.check();
          const specialist = host.requireActor('specialist');
          const toolbox = createActorToolbox(
            applicationTools,
            { actorId: topology.actors.specialist.address, nodeAddress: localNode },
            [...implementations.keys()]
          );
          const ask = (message: ActorAgentLoopMessage) =>
            scope.dispatch('ACTOR_ASK_FAILED', config.limits.askTimeoutMs, () =>
              specialist.ask<ActorAgentLoopReply>(message, config.limits.askTimeoutMs)
            );
          const text = await scope.wait(
            driveLoop(ask, toolbox, implementations, scope, task, prompt, config.systemPrompt)
          );
          outcome = { ok: true, text };
        } catch (error) {
          outcome = { ok: false, error };
        }
        try {
          await host.stop();
        } catch (cause) {
          canRelease = false;
          // Retain a primary rejection, but do not admit another run.
          if (outcome.ok) {
            outcome = {
              ok: false,
              error: new ActorRuntimeError(
                'RUNTIME_STOP_FAILED',
                'Could not close the local runtime.',
                cause
              ),
            };
          }
        } finally {
          await scope.drain();
        }
        if (!outcome.ok) throw outcome.error;
        return outcome.text;
      };
      const managed = runOwned().finally(() => {
        if (canRelease) active = false;
      });
      try {
        return await scope.wait(managed);
      } finally {
        try {
          scope.check();
        } finally {
          scope.dispose();
        }
      }
    },
  };
}
