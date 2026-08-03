import { ActorToolTimeoutError } from '@actor-web/runtime';
import type {
  ActorAgentError,
  ActorAgentLlmMessage,
  ActorAgentLlmProvider,
  ActorAgentLlmRequest,
  ActorAgentLlmResult,
  ActorAgentTokenUsage,
  ActorAgentToolCall,
  ActorAgentToolDefinition,
} from './index.js';

export interface OpenAiCompatibleLlmProviderOptions {
  readonly endpoint: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly headers?: Record<string, string>;
  readonly credentials?: RequestCredentials;
  readonly fetch?: typeof globalThis.fetch;
}

type OpenAiCompatibleToolCallWire = {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly function?: {
    readonly name?: unknown;
    readonly arguments?: unknown;
  } | null;
};

type OpenAiCompatibleResponse = {
  readonly choices?: readonly {
    readonly message?: {
      readonly role?: unknown;
      readonly content?: unknown;
      readonly tool_calls?: readonly OpenAiCompatibleToolCallWire[];
    } | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: unknown;
    readonly completion_tokens?: unknown;
    readonly total_tokens?: unknown;
  } | null;
};

type OpenAiCompatibleRequestMessage = {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly tool_call_id?: string;
  readonly name?: string;
  readonly tool_calls?: readonly {
    readonly id: string;
    readonly type: 'function';
    readonly function: {
      readonly name: string;
      readonly arguments: string;
    };
  }[];
};

function createError(code: string, message: string): ActorAgentError {
  return { code, message };
}

function createFailure(code: string, message: string): ActorAgentLlmResult {
  return {
    ok: false,
    error: createError(code, message),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toMessageText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveFetch(input: OpenAiCompatibleLlmProviderOptions): typeof globalThis.fetch | null {
  return input.fetch ?? globalThis.fetch ?? null;
}

function resolveProviderTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined) {
    return undefined;
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('OpenAI-compatible provider timeoutMs must be a positive finite number.');
  }
  return timeoutMs;
}

function mapUsage(usage: OpenAiCompatibleResponse['usage']): ActorAgentTokenUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const inputTokens = isFiniteNumber(usage.prompt_tokens) ? usage.prompt_tokens : undefined;
  const outputTokens = isFiniteNumber(usage.completion_tokens)
    ? usage.completion_tokens
    : undefined;
  const totalTokens = isFiniteNumber(usage.total_tokens) ? usage.total_tokens : undefined;
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

function serializeToolCallInput(input: unknown): string {
  try {
    const serialized = JSON.stringify(input);
    return typeof serialized === 'string' ? serialized : 'null';
  } catch {
    return 'null';
  }
}

function toWireMessages(request: ActorAgentLlmRequest): readonly OpenAiCompatibleRequestMessage[] {
  const wireMessages: OpenAiCompatibleRequestMessage[] = [];
  if (request.system) {
    wireMessages.push({
      role: 'system',
      content: request.system,
    });
  }
  for (const message of request.messages) {
    if (message.role === 'tool') {
      wireMessages.push({
        role: 'tool',
        content: message.content,
        ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
        ...(message.toolName === undefined ? {} : { name: message.toolName }),
      });
      continue;
    }
    wireMessages.push({
      role: message.role,
      content: message.content,
      ...(message.toolCalls === undefined
        ? {}
        : {
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: 'function' as const,
              function: {
                name: toolCall.name,
                arguments: serializeToolCallInput(toolCall.input),
              },
            })),
          }),
    });
  }
  return wireMessages;
}

function toWireTools(toolDefinitions: readonly ActorAgentToolDefinition[] | undefined):
  | readonly {
      readonly type: 'function';
      readonly function: {
        readonly name: string;
        readonly description?: string;
        readonly parameters?: unknown;
      };
    }[]
  | undefined {
  if (!toolDefinitions || toolDefinitions.length === 0) {
    return undefined;
  }
  return toolDefinitions.map((definition) => ({
    type: 'function' as const,
    function: {
      name: definition.name,
      ...(definition.description === undefined ? {} : { description: definition.description }),
      ...(definition.inputSchema === undefined ? {} : { parameters: definition.inputSchema }),
    },
  }));
}

function filterAuthorizedToolDefinitions(
  toolDefinitions: readonly ActorAgentToolDefinition[] | undefined,
  allowedTools: ReadonlySet<string>
): readonly ActorAgentToolDefinition[] | undefined {
  if (!toolDefinitions || toolDefinitions.length === 0) {
    return undefined;
  }
  const authorizedDefinitions = toolDefinitions.filter((definition) =>
    allowedTools.has(definition.name)
  );
  return authorizedDefinitions.length > 0 ? authorizedDefinitions : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function classifyAbort(signal: AbortSignal): ActorAgentLlmResult {
  const reason = signal.reason;
  if (
    reason instanceof ActorToolTimeoutError ||
    (isRecord(reason) && reason.code === 'ACTOR_TOOL_TIMEOUT')
  ) {
    const timeoutMs =
      reason instanceof ActorToolTimeoutError
        ? reason.timeoutMs
        : isFiniteNumber(reason.timeoutMs)
          ? reason.timeoutMs
          : undefined;
    return createFailure(
      'LLM_PROVIDER_TIMEOUT',
      timeoutMs === undefined
        ? 'OpenAI-compatible provider timed out.'
        : `OpenAI-compatible provider timed out after ${timeoutMs}ms.`
    );
  }
  return createFailure('LLM_PROVIDER_CANCELLED', 'OpenAI-compatible provider was cancelled.');
}

function mapThrownError(error: unknown, signal: AbortSignal): ActorAgentLlmResult {
  if (signal.aborted || isAbortError(error)) {
    return classifyAbort(signal);
  }
  return createFailure('LLM_PROVIDER_UNAVAILABLE', 'OpenAI-compatible provider is unavailable.');
}

async function readJsonResponse(
  response: Response,
  signal: AbortSignal
): Promise<OpenAiCompatibleResponse> {
  if (signal.aborted) {
    throw signal.reason;
  }
  const body = response.body;
  if (!body) {
    return (await response.json()) as OpenAiCompatibleResponse;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let released = false;
  let settled = false;
  const releaseReader = (): void => {
    if (released) {
      return;
    }
    released = true;
    try {
      reader.releaseLock();
    } catch {
      // Ignore release errors after cancellation/stream termination.
    }
  };

  return await new Promise<OpenAiCompatibleResponse>((resolve, reject) => {
    const settleResolve = (value: OpenAiCompatibleResponse): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    const settleReject = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    const abortListener = () => {
      void reader
        .cancel(signal.reason)
        .catch(() => undefined)
        .then(() => {
          settleReject(signal.reason);
        });
    };

    const pump = async (): Promise<void> => {
      try {
        let text = '';
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) {
            text += decoder.decode();
            settleResolve(JSON.parse(text) as OpenAiCompatibleResponse);
            return;
          }
          text += decoder.decode(chunk.value, { stream: true });
          if (signal.aborted) {
            throw signal.reason;
          }
        }
      } catch (error) {
        settleReject(error);
      }
    };

    signal.addEventListener('abort', abortListener, { once: true });
    void pump().finally(() => {
      signal.removeEventListener('abort', abortListener);
      releaseReader();
    });
  });
}

function parseToolCall(
  value: OpenAiCompatibleToolCallWire,
  declaredTools: ReadonlySet<string>
):
  | { readonly ok: true; readonly value: ActorAgentToolCall }
  | { readonly ok: false; readonly error: ActorAgentError } {
  if (value.type !== 'function') {
    return {
      ok: false,
      error: createError(
        'LLM_TOOL_UNSUPPORTED',
        'OpenAI-compatible provider returned a non-function tool call.'
      ),
    };
  }
  const id = value.id;
  const fn = value.function;
  if (typeof id !== 'string' || !isRecord(fn) || typeof fn.name !== 'string') {
    return {
      ok: false,
      error: createError(
        'LLM_PROVIDER_INVALID_RESPONSE',
        'OpenAI-compatible provider returned an invalid tool call shape.'
      ),
    };
  }
  if (!declaredTools.has(fn.name)) {
    return {
      ok: false,
      error: createError(
        'LLM_TOOL_UNSUPPORTED',
        `OpenAI-compatible provider requested undeclared tool "${fn.name}".`
      ),
    };
  }
  if (typeof fn.arguments !== 'string') {
    return {
      ok: false,
      error: createError(
        'LLM_TOOL_ARGUMENTS_INVALID',
        `OpenAI-compatible provider returned non-string arguments for tool "${fn.name}".`
      ),
    };
  }
  try {
    return {
      ok: true,
      value: {
        id,
        name: fn.name,
        input: JSON.parse(fn.arguments),
      },
    };
  } catch {
    return {
      ok: false,
      error: createError(
        'LLM_TOOL_ARGUMENTS_INVALID',
        `OpenAI-compatible provider returned malformed JSON arguments for tool "${fn.name}".`
      ),
    };
  }
}

function parseAssistantMessage(
  payload: OpenAiCompatibleResponse,
  declaredTools: ReadonlySet<string>
): ActorAgentLlmResult {
  const assistantMessage = payload.choices?.[0]?.message;
  if (!assistantMessage || assistantMessage.role !== 'assistant') {
    return createFailure(
      'LLM_PROVIDER_INVALID_RESPONSE',
      'OpenAI-compatible provider returned no assistant message.'
    );
  }

  const rawToolCalls = assistantMessage.tool_calls ?? [];
  const toolCalls: ActorAgentToolCall[] = [];
  for (const toolCall of rawToolCalls) {
    const parsed = parseToolCall(toolCall, declaredTools);
    if (!parsed.ok) {
      return {
        ok: false,
        error: parsed.error,
      };
    }
    toolCalls.push(parsed.value);
  }

  const content = typeof assistantMessage.content === 'string' ? assistantMessage.content : '';
  if (content.length === 0 && toolCalls.length === 0) {
    return createFailure(
      'LLM_PROVIDER_INVALID_RESPONSE',
      'OpenAI-compatible provider returned no assistant content or tool calls.'
    );
  }

  const message: ActorAgentLlmMessage = {
    role: 'assistant',
    content,
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
  };

  return {
    ok: true,
    value: {
      message,
      ...(mapUsage(payload.usage) === undefined ? {} : { usage: mapUsage(payload.usage) }),
    },
  };
}

export function createOpenAiCompatibleLlmProvider(
  input: OpenAiCompatibleLlmProviderOptions
): ActorAgentLlmProvider {
  const providerTimeoutMs = resolveProviderTimeoutMs(input.timeoutMs);
  return async (request, context) => {
    const fetchImpl = resolveFetch(input);
    if (!fetchImpl) {
      return createFailure(
        'LLM_PROVIDER_UNAVAILABLE',
        'OpenAI-compatible provider requires a fetch implementation.'
      );
    }
    if (context.signal.aborted) {
      return classifyAbort(context.signal);
    }

    const allowedToolNames = new Set(request.tools);
    const authorizedToolDefinitions = filterAuthorizedToolDefinitions(
      request.toolDefinitions,
      allowedToolNames
    );
    const body = {
      model: input.model,
      messages: toWireMessages(request),
      ...(authorizedToolDefinitions && authorizedToolDefinitions.length > 0
        ? {
            tools: toWireTools(authorizedToolDefinitions),
            tool_choice: 'auto' as const,
          }
        : {}),
    };

    const timeoutController = new AbortController();
    const abortFromParent = () => {
      timeoutController.abort(context.signal.reason);
    };
    context.signal.addEventListener('abort', abortFromParent, { once: true });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (providerTimeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        timeoutController.abort(
          new ActorToolTimeoutError({
            toolName: 'llm',
            timeoutMs: providerTimeoutMs,
            actorId: context.actorId,
            nodeAddress: context.nodeAddress,
          })
        );
      }, providerTimeoutMs);
    }

    try {
      const response = await fetchImpl(input.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(input.headers ?? {}),
        },
        ...(input.credentials === undefined ? {} : { credentials: input.credentials }),
        signal: timeoutController.signal,
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        return createFailure(
          'LLM_PROVIDER_UNAVAILABLE',
          'OpenAI-compatible provider is unavailable.'
        );
      }

      const payload = await readJsonResponse(response, timeoutController.signal);
      return parseAssistantMessage(payload, allowedToolNames);
    } catch (error) {
      if (timeoutController.signal.aborted || isAbortError(error)) {
        return classifyAbort(timeoutController.signal);
      }
      if (error instanceof SyntaxError) {
        return createFailure(
          'LLM_PROVIDER_INVALID_RESPONSE',
          `OpenAI-compatible provider returned invalid JSON: ${toMessageText(error)}`
        );
      }
      if (error instanceof Error || typeof error === 'string') {
        return mapThrownError(error, timeoutController.signal);
      }
      return createFailure(
        'LLM_PROVIDER_INVALID_RESPONSE',
        `OpenAI-compatible provider returned invalid JSON: ${toMessageText(error)}`
      );
    } finally {
      context.signal.removeEventListener('abort', abortFromParent);
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  };
}
