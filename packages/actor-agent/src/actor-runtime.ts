import {
  type ActorToolExecutionContext,
  type ActorToolExecutor,
  createActorToolbox,
  startRuntime,
} from '@actor-web/runtime/browser';
import { actor, defineActorWebTopology, node, tool } from '@actor-web/runtime/topology';
import {
  equalJson,
  InvalidJsonPayload,
  JsonPayloadTooLarge,
  measureJson,
  ownData,
  snapshotJson,
} from './actor-runtime-json.js';
import {
  ACTOR_WEB_LLM_TOOL_NAME,
  type ActorAgentLlmProvider,
  type ActorAgentLlmRequest,
  type ActorAgentLlmResult,
  type ActorAgentLoopMessage,
  type ActorAgentLoopReply,
  type ActorAgentTokenUsage,
  type ActorAgentToolCall,
  type ActorAgentToolDefinition,
  createAgentLoopBehavior,
} from './index.js';
import type { AgentRuntime, AgentTurn } from './portable.js';

export interface ActorRuntimeTool<Task> {
  readonly name: string;
  /** Synchronously validate and scope the input without effects. Return plain JSON data or throw. */
  readonly validateInput: (input: unknown, task: Task) => { readonly value: unknown };
  /** Receives a detached validated payload and returns plain JSON or a promise for it. */
  readonly execute: (input: unknown, task: Task, context: ActorToolExecutionContext) => unknown;
}

type BudgetCode = 'MODEL_TURN_LIMIT' | 'TOOL_ATTEMPT_LIMIT' | 'PAYLOAD_BYTE_LIMIT';
const budgetMessages: Record<BudgetCode, string> = {
  MODEL_TURN_LIMIT: 'The assignment has no remaining model turn.',
  TOOL_ATTEMPT_LIMIT: 'The application tool attempts would exceed the assignment limit.',
  PAYLOAD_BYTE_LIMIT: 'The payload would exceed the assignment byte limit.',
};

function budgetFailure(code: BudgetCode): never {
  throw new ActorRuntimeError(code, budgetMessages[code]);
}

function createBudget(limits: ActorRuntimeLimits) {
  let modelTurns = limits.maxModelTurns;
  let toolAttempts = limits.maxToolAttempts;
  let payloadBytes = limits.maxPayloadBytes;
  const requireModelTurn = () => {
    if (modelTurns === 0) budgetFailure('MODEL_TURN_LIMIT');
  };
  const requireToolAttempts = (attempts: number) => {
    if (attempts > toolAttempts) budgetFailure('TOOL_ATTEMPT_LIMIT');
  };
  const chargePayload = (bytes: number) => {
    if (bytes > payloadBytes) budgetFailure('PAYLOAD_BYTE_LIMIT');
    payloadBytes -= bytes;
  };
  return {
    requireModelTurn,
    requireToolAttempts,
    chargePayload,
    get payloadBytes() {
      return payloadBytes;
    },
    dispatchModel(bytes: number) {
      requireModelTurn();
      chargePayload(bytes);
      modelTurns--;
    },
    dispatchTool(bytes: number) {
      requireToolAttempts(1);
      chargePayload(bytes);
      toolAttempts--;
    },
  };
}

function checkPayload<T>(code: string, read: () => T): T {
  try {
    return read();
  } catch (cause) {
    if (cause instanceof JsonPayloadTooLarge) budgetFailure('PAYLOAD_BYTE_LIMIT');
    if (cause instanceof ActorRuntimeError) throw cause;
    throw new ActorRuntimeError(code, 'Expected a plain JSON payload.');
  }
}

export interface ActorRuntimeLimits {
  readonly runTimeoutMs: number;
  /** Positive integer up to 214748364 ms, allowing for the local ask's 10× fallback timer. */
  readonly askTimeoutMs: number;
  readonly providerTimeoutMs: number;
  readonly toolTimeoutMs: number;
  readonly maxToolCallsPerBatch: number;
  /** Positive safe integer; counts actual provider calls, including failed calls. */
  readonly maxModelTurns: number;
  /** Nonnegative safe integer; zero permits no application-tool handler calls. */
  readonly maxToolAttempts: number;
  /** Positive safe integer; cumulative compact JSON UTF-8 bytes at the local port boundaries. */
  readonly maxPayloadBytes: number;
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

function snapshotRequested(tools: unknown): ActorAgentToolDefinition[] {
  if (!Array.isArray(tools)) invalidConfig('An explicit requested tool list is required.');
  const seen = new Set<string>();
  try {
    const requested: ActorAgentToolDefinition[] = [];
    for (let index = 0; index < tools.length; index++) {
      const entry = ownData(tools, String(index));
      if (typeof entry !== 'object' || entry === null) throw new InvalidJsonPayload();
      const name = ownData(entry, 'name');
      const description = ownData(entry, 'description');
      const parameters = ownData(entry, 'parameters');
      checkToolName(name);
      if (
        seen.has(name) ||
        typeof description !== 'string' ||
        !description.trim() ||
        typeof parameters !== 'object' ||
        parameters === null ||
        Array.isArray(parameters)
      ) {
        return invalidConfig('Invalid or duplicate requested tool definition.');
      }
      seen.add(name);
      requested.push(
        Object.freeze({
          name,
          description,
          inputSchema: snapshotJson(
            parameters as ActorAgentToolDefinition['inputSchema'],
            Number.MAX_SAFE_INTEGER,
            true
          ).value,
        })
      );
    }
    return requested;
  } catch (cause) {
    if (cause instanceof ActorRuntimeError) throw cause;
    return invalidConfig('Tool definitions must contain plain JSON parameters.');
  }
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
  const { limits: suppliedLimits } = options;
  const timedLimits = {
    runTimeoutMs: suppliedLimits?.runTimeoutMs,
    askTimeoutMs: suppliedLimits?.askTimeoutMs,
    providerTimeoutMs: suppliedLimits?.providerTimeoutMs,
    toolTimeoutMs: suppliedLimits?.toolTimeoutMs,
    maxToolCallsPerBatch: suppliedLimits?.maxToolCallsPerBatch,
  };
  for (const [name, limit] of Object.entries(timedLimits)) {
    // Browser and Node timers cannot represent delays above the signed 32-bit maximum.
    const max = name === 'askTimeoutMs' ? maxAskTimeoutMs : maxTimerMs;
    if (!Number.isInteger(limit) || limit < 1 || limit > max) {
      invalidConfig(`${name} must be a positive integer no greater than ${max}.`);
    }
  }
  const budgets = {
    maxModelTurns: suppliedLimits?.maxModelTurns,
    maxToolAttempts: suppliedLimits?.maxToolAttempts,
    maxPayloadBytes: suppliedLimits?.maxPayloadBytes,
  };
  for (const [name, limit] of Object.entries(budgets)) {
    const allowZero = name === 'maxToolAttempts';
    if (!Number.isSafeInteger(limit) || limit < (allowZero ? 0 : 1)) {
      invalidConfig(`${name} must be a ${allowZero ? 'nonnegative' : 'positive'} safe integer.`);
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
    requested,
    effective,
    limits: Object.freeze({ ...timedLimits, ...budgets }),
    encodeTask,
    provider,
  };
}

function verifyTurn<Task, Purpose extends string>(
  config: ReturnType<typeof bindConfig<Task, Purpose>>,
  turn: AgentTurn<Task, Purpose>
): void {
  let requested: ActorAgentToolDefinition[];
  try {
    requested = snapshotRequested(turn.tools);
  } catch (cause) {
    throw new ActorRuntimeError('DEFINITION_MISMATCH', 'Invalid turn tool definitions.', cause);
  }
  if (
    turn.purpose !== config.purpose ||
    turn.systemPrompt !== config.systemPrompt ||
    !equalJson(requested, config.requested)
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
    checked<T>(checkPayload: () => T): T {
      check();
      try {
        return checkPayload();
      } finally {
        check();
      }
    },
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

function dataField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (field && !('value' in field)) throw new InvalidJsonPayload();
  return field?.value;
}

function descriptorInChain(value: object, key: string): PropertyDescriptor | undefined {
  for (let current: object | null = value; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return descriptor;
  }
  return undefined;
}

type Held<T> = { value: T };

function holdValue<T>(value: T): Held<T> {
  // Do not inherit a `then` hook while the native Promise assimilates the box itself.
  const box = { __proto__: null, value };
  return box;
}

function isClassPrototype(prototype: object): boolean {
  const constructorField = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  if (!constructorField || !Object.hasOwn(constructorField, 'value')) return false;
  const cls: unknown = constructorField.value;
  if (typeof cls !== 'function') return false;
  const link = Object.getOwnPropertyDescriptor(cls, 'prototype');
  // A class's immutable prototype link must point back to this exact object. The
  // intrinsic source check distinguishes it from every realm's Object constructor.
  if (
    !link ||
    !Object.hasOwn(link, 'value') ||
    link.value !== prototype ||
    link.writable !== false
  ) {
    return false;
  }
  const source = Function.prototype.toString.call(cls);
  if (!/^class(?=\s|\/[*/]|\{)/.test(source)) return false;
  const afterKeyword = source
    .slice(5)
    .replace(/^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*)*/, '');
  return !afterKeyword.startsWith('(');
}

function portThen(value: object): unknown {
  const prototype: object | null = Object.getPrototypeOf(value);
  for (let owner: object | null = value; owner; ) {
    const parent: object | null = owner === value ? prototype : Object.getPrototypeOf(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, 'then');
    if (descriptor) {
      // Data methods do not require running a getter, regardless of their owner.
      if (Object.hasOwn(descriptor, 'value')) return descriptor.value;
      if (
        !descriptor.get ||
        Array.isArray(value) ||
        prototype === null ||
        (Object.getPrototypeOf(prototype) === null && !isClassPrototype(prototype)) ||
        (parent === null && owner !== prototype && !isClassPrototype(owner))
      ) {
        return undefined;
      }
      // An ambiguous root (including every realm's Object.prototype) never
      // contributes an accessor. For a wrapper, use the port result as the receiver.
      return Reflect.apply(descriptor.get, value, []);
    }
    owner = parent;
  }
  return undefined;
}

// Box synchronous data and wrapper fulfillments before resolving a native Promise.
// Plain records and arrays never run a `then` accessor during port adoption.
function holdPortResult<T>(value: T | Promise<T>, chain?: Set<object>): Held<T> | Promise<Held<T>> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return holdValue(value as T);
  }
  try {
    // Native promises (including from another realm) do not need property-based detection.
    return Promise.prototype.then.call(value, (result: T) => holdValue(result)) as Promise<Held<T>>;
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
  }

  if (chain?.has(value)) throw new TypeError('A returned Promise wrapper resolved cyclically.');
  const then = portThen(value);
  if (typeof then !== 'function') return holdValue(value as T);
  const pending = chain ?? new Set<object>();
  pending.add(value);

  return new Promise<Held<T>>((resolve, reject) => {
    // Like native thenable assimilation, invoke the method asynchronously and let only
    // its first settlement win, even if that fulfillment adopts another pending wrapper.
    queueMicrotask(() => {
      let settled = false;
      const refuse = (reason: unknown) => {
        if (settled) return;
        settled = true;
        reject(reason);
      };
      const fulfill = (result: T | Promise<T>) => {
        if (settled) return;
        settled = true;
        try {
          resolve(holdPortResult(result, pending));
        } catch (cause) {
          reject(cause);
        }
      };
      try {
        Reflect.apply(then, value, [fulfill, refuse]);
      } catch (cause) {
        refuse(cause);
      }
    });
  });
}

function normalizeRequest(request: ActorAgentLlmRequest): ActorAgentLlmRequest {
  return {
    ...(request.system === undefined ? {} : { system: request.system }),
    messages: request.messages,
    tools: request.tools,
    ...(request.toolDefinitions === undefined ? {} : { toolDefinitions: request.toolDefinitions }),
  };
}

function diagnosticCause(diagnostic: object): unknown {
  try {
    return descriptorInChain(diagnostic, 'cause')?.value;
  } catch {
    // Optional metadata must not replace the provider's valid code and message.
    return undefined;
  }
}

function normalizeProviderStep(
  result: unknown,
  maxCalls: number,
  budget: ReturnType<typeof createBudget>
): ActorAgentLlmResult {
  const ok = checkPayload('INVALID_PROVIDER_REPLY', () => dataField(result, 'ok'));
  if (ok === false) {
    try {
      const diagnostic = dataField(result, 'error');
      if (typeof diagnostic === 'object' && diagnostic !== null) {
        // Diagnostics aren't metered JSON. Read the required public fields, including on
        // Error subclasses, but do not force an optional lazy cause.
        const { code, message } = diagnostic as { code?: unknown; message?: unknown };
        if (typeof code === 'string' && typeof message === 'string') {
          const cause = diagnosticCause(diagnostic);
          return { ok: false, error: { code, message, ...(cause === undefined ? {} : { cause }) } };
        }
      }
    } catch {
      // A diagnostic whose required fields cannot be read is a malformed provider reply.
    }
    throw new ActorRuntimeError('INVALID_PROVIDER_REPLY', 'Expected a plain JSON payload.');
  }
  if (ok !== true) {
    throw new ActorRuntimeError('INVALID_PROVIDER_REPLY', 'Expected a provider result.');
  }
  return checkPayload('INVALID_ASSISTANT_REPLY', () => {
    const value = dataField(result, 'value');
    const message = dataField(value, 'message');
    const content = dataField(message, 'content');
    const calls = dataField(message, 'toolCalls');
    if (
      dataField(message, 'role') !== 'assistant' ||
      typeof content !== 'string' ||
      (calls !== undefined && !Array.isArray(calls))
    ) {
      throw new ActorRuntimeError('INVALID_ASSISTANT_REPLY', 'Expected an assistant message.');
    }
    const callCount =
      calls === undefined ? 0 : Object.getOwnPropertyDescriptor(calls, 'length')?.value;
    if (typeof callCount !== 'number') throw new InvalidJsonPayload();
    if (callCount > maxCalls) {
      throw new ActorRuntimeError(
        'TOOL_BATCH_LIMIT',
        'The tool batch exceeds the configured limit.'
      );
    }
    const toolCalls: ActorAgentToolCall[] = [];
    const normalized = {
      role: 'assistant' as const,
      content,
      ...(calls === undefined ? {} : { toolCalls }),
    };
    // Measure with the empty calls array first, then add each normalized element and comma.
    let bytes = measureJson(normalized, budget.payloadBytes);
    for (let index = 0; index < callCount; index++) {
      const separator = index === 0 ? 0 : 1;
      const remaining = budget.payloadBytes - bytes - separator;
      if (remaining < 0) budgetFailure('PAYLOAD_BYTE_LIMIT');
      const call = checkPayload('INVALID_TOOL_CALL', () => {
        if (!Array.isArray(calls)) throw new InvalidJsonPayload();
        const raw = ownData(calls, String(index));
        const id = dataField(raw, 'id');
        const name = dataField(raw, 'name');
        if (typeof id !== 'string' || !id) {
          throw new ActorRuntimeError('INVALID_TOOL_CALL_ID', 'Expected a nonempty tool call ID.');
        }
        if (typeof name !== 'string' || !name) {
          throw new ActorRuntimeError('INVALID_TOOL_CALL', 'Expected a tool name and input.');
        }
        const detached = snapshotJson({ id, name, input: dataField(raw, 'input') }, remaining);
        if (!isToken(id)) {
          throw new ActorRuntimeError('INVALID_TOOL_CALL_ID', 'Expected a nonempty tool call ID.');
        }
        if (!isToken(name)) {
          throw new ActorRuntimeError('INVALID_TOOL_CALL', 'Expected a tool name and input.');
        }
        return detached;
      });
      bytes += separator + call.bytes;
      toolCalls.push(call.value);
    }
    const usage = dataField(value, 'usage') as ActorAgentTokenUsage | undefined;
    budget.chargePayload(bytes);
    return {
      ok: true,
      value: { message: normalized, ...(usage === undefined ? {} : { usage }) },
    };
  });
}

async function driveLoop<Task>(
  ask: (message: ActorAgentLoopMessage) => Promise<ActorAgentLoopReply>,
  toolbox: ReturnType<typeof createActorToolbox>,
  implementations: ReadonlyMap<string, ActorRuntimeTool<Task>>,
  scope: ReturnType<typeof createRunScope>,
  budget: ReturnType<typeof createBudget>,
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
    let batchBytes = budget.payloadBytes;
    const batch = reply.toolCalls.map((call) =>
      scope.checked(() => {
        const { id, name } = call;
        if (seen.has(id)) {
          throw new ActorRuntimeError('DUPLICATE_TOOL_CALL_ID', 'A tool call ID cannot be reused.');
        }
        seen.add(id);
        const implementation = implementations.get(name);
        if (!implementation || !toolbox.has(name)) {
          throw new ActorRuntimeError(
            'TOOL_DENIED',
            'The tool is not granted for this assignment.'
          );
        }
        let payload: unknown;
        try {
          const validated = implementation.validateInput(call.input, task);
          if (validated instanceof Promise) {
            void validated.catch(() => {});
            throw new Error('Tool validators must be synchronous.');
          }
          payload = dataField(validated, 'value');
        } catch (cause) {
          throw executionFailure('INVALID_TOOL_INPUT', 'The tool input was refused.', cause);
        }
        const { value: input, bytes } = checkPayload('INVALID_TOOL_INPUT', () =>
          snapshotJson(payload, batchBytes)
        );
        batchBytes -= bytes;
        return { id, name, input };
      })
    );
    budget.requireToolAttempts(batch.length);
    // The loop always asks the model again immediately after the last tool receipt.
    budget.requireModelTurn();

    for (const [index, { id, name, input }] of batch.entries()) {
      scope.check();
      let output: unknown;
      try {
        output = await toolbox.execute(name, input);
      } catch (cause) {
        throw executionFailure('TOOL_FAILED', 'The application tool failed.', cause);
      }
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
      const budget = createBudget(config.limits);
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
            async (input, context) => {
              const portContext = { ...context, signal: scope.signal };
              const bytes = scope.checked(() =>
                checkPayload('INVALID_TOOL_INPUT', () => measureJson(input, budget.payloadBytes))
              );
              const { value } = await scope.dispatch(
                'TOOL_TIMEOUT',
                config.limits.toolTimeoutMs,
                () => {
                  budget.dispatchTool(bytes);
                  return holdPortResult(execute(input, task, portContext));
                }
              );
              return scope.checked(() =>
                checkPayload('INVALID_TOOL_OUTPUT', () => {
                  const output = snapshotJson(value, budget.payloadBytes);
                  // The shared loop serializes this envelope. Verify it can do so without
                  // falling back to lossy text (e.g. an engine's JSON nesting limit).
                  JSON.stringify({ ok: true, output: output.value });
                  budget.chargePayload(output.bytes);
                  return output.value;
                })
              );
            },
          ])
        );
        const llm: ActorAgentLlmProvider = async (request, context) => {
          const portContext = {
            actorId: context.actorId,
            nodeAddress: context.nodeAddress,
            signal: scope.signal,
          };
          const normalized = scope.checked(() => {
            budget.requireModelTurn();
            return checkPayload('INVALID_MODEL_REQUEST', () =>
              snapshotJson(normalizeRequest(request), budget.payloadBytes)
            );
          });
          const result = await scope.dispatch(
            'PROVIDER_TIMEOUT',
            config.limits.providerTimeoutMs,
            async () => {
              budget.dispatchModel(normalized.bytes);
              try {
                return await holdPortResult(config.provider(normalized.value, portContext));
              } catch (cause) {
                // Match the shared registry's thrown-provider error without wrapping budget errors.
                return holdValue({
                  ok: false,
                  error: {
                    code: 'LLM_PROVIDER_FAILED',
                    message: cause instanceof Error ? cause.message : String(cause),
                    cause,
                  },
                } satisfies ActorAgentLlmResult);
              }
            }
          );
          return scope.checked(() =>
            normalizeProviderStep(result.value, config.limits.maxToolCallsPerBatch, budget)
          );
        };
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
            driveLoop(
              ask,
              toolbox,
              implementations,
              scope,
              budget,
              task,
              prompt,
              config.systemPrompt
            )
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
