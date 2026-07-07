import type { ActorBehavior } from '@actor-web/runtime';
import type {
  ActorToolExecutionContext,
  ActorToolExecutor,
  ActorToolRegistry,
} from '@actor-web/runtime/browser';
import { defineBehavior } from '@actor-web/runtime/browser';

export const ACTOR_WEB_LLM_TOOL_NAME = 'llm' as const;

export type ActorAgentMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ActorAgentToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface ActorAgentLlmMessage {
  readonly role: ActorAgentMessageRole;
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolCalls?: readonly ActorAgentToolCall[];
}

export interface ActorAgentLlmRequest {
  readonly system?: string;
  readonly messages: readonly ActorAgentLlmMessage[];
  readonly tools: readonly string[];
}

export interface ActorAgentTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface ActorAgentError {
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}

export interface ActorAgentLlmSuccess {
  readonly ok: true;
  readonly value: {
    readonly message: ActorAgentLlmMessage;
    readonly usage?: ActorAgentTokenUsage;
  };
}

export interface ActorAgentLlmFailure {
  readonly ok: false;
  readonly error: ActorAgentError;
}

export type ActorAgentLlmResult = ActorAgentLlmSuccess | ActorAgentLlmFailure;

export type ActorAgentLlmProvider = (
  request: ActorAgentLlmRequest,
  context: ActorToolExecutionContext
) => ActorAgentLlmResult | Promise<ActorAgentLlmResult>;

export type ActorAgentToolRegistry = {
  readonly [ACTOR_WEB_LLM_TOOL_NAME]: ActorToolExecutor<ActorAgentLlmRequest, ActorAgentLlmResult>;
};

export type ActorAgentLoopMessage =
  | { readonly type: 'START_AGENT'; readonly prompt: string; readonly system?: string }
  | {
      readonly type: 'OBSERVE_TOOL_RESULT';
      readonly toolCallId: string;
      readonly name: string;
      readonly ok: boolean;
      readonly output: unknown;
    }
  | { readonly type: 'GET_AGENT_CONTEXT' };

export interface ActorAgentLoopContext {
  readonly history: readonly ActorAgentLlmMessage[];
  readonly steps: number;
  readonly pendingToolCalls: readonly ActorAgentToolCall[];
  readonly lastError: ActorAgentError | null;
}

export type ActorAgentLoopStatus = 'responded' | 'waiting-for-tool';

export type ActorAgentLoopReply =
  | {
      readonly ok: true;
      readonly status: ActorAgentLoopStatus;
      readonly message: ActorAgentLlmMessage;
      readonly toolCalls: readonly ActorAgentToolCall[];
      readonly usage?: ActorAgentTokenUsage;
    }
  | { readonly ok: false; readonly error: ActorAgentError };

export type ActorAgentLoopEvent =
  | {
      readonly type: 'AGENT_STEP_COMPLETED';
      readonly step: number;
      readonly message: ActorAgentLlmMessage;
    }
  | {
      readonly type: 'AGENT_TOOL_CALL_REQUESTED';
      readonly step: number;
      readonly toolCall: ActorAgentToolCall;
    }
  | {
      readonly type: 'AGENT_TOOL_RESULT_OBSERVED';
      readonly toolCallId: string;
      readonly name: string;
      readonly ok: boolean;
    }
  | {
      readonly type: 'AGENT_STEP_FAILED';
      readonly step: number;
      readonly error: ActorAgentError;
    };

export interface ActorAgentLoopOptions {
  readonly system?: string;
  readonly initialHistory?: readonly ActorAgentLlmMessage[];
  readonly llmTimeoutMs?: number;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeThrownError(error: unknown): ActorAgentError {
  const message = toErrorMessage(error);
  return {
    code: message.includes(`Actor tool "${ACTOR_WEB_LLM_TOOL_NAME}" is not registered.`)
      ? 'LLM_TOOL_UNAVAILABLE'
      : 'AGENT_LOOP_FAILED',
    message,
  };
}

function createInitialContext(options: ActorAgentLoopOptions): ActorAgentLoopContext {
  return {
    history: [...(options.initialHistory ?? [])],
    steps: 0,
    pendingToolCalls: [],
    lastError: null,
  };
}

function serializeToolOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function toolNamesForModel(tools: { list(): string[] }): readonly string[] {
  return tools.list().filter((name) => name !== ACTOR_WEB_LLM_TOOL_NAME);
}

function createFailureResult(input: {
  readonly context: ActorAgentLoopContext;
  readonly error: ActorAgentError;
  readonly emitPrefix?: readonly ActorAgentLoopEvent[];
}): {
  readonly context: ActorAgentLoopContext;
  readonly reply: ActorAgentLoopReply;
  readonly emit: ActorAgentLoopEvent[];
} {
  const nextContext = {
    ...input.context,
    lastError: input.error,
  };

  return {
    context: nextContext,
    reply: {
      ok: false,
      error: input.error,
    },
    emit: [
      ...(input.emitPrefix ?? []),
      {
        type: 'AGENT_STEP_FAILED',
        step: input.context.steps,
        error: input.error,
      },
    ],
  };
}

function createObservedToolMessage(
  message: Extract<ActorAgentLoopMessage, { type: 'OBSERVE_TOOL_RESULT' }>
): ActorAgentLlmMessage {
  return {
    role: 'tool',
    content: serializeToolOutput({
      ok: message.ok,
      output: message.output,
    }),
    toolCallId: message.toolCallId,
    toolName: message.name,
  };
}

export function createActorAgentToolRegistry(input: {
  readonly llm: ActorAgentLlmProvider;
}): ActorAgentToolRegistry {
  return {
    [ACTOR_WEB_LLM_TOOL_NAME]: async (request, context) => {
      try {
        return await input.llm(request, {
          actorId: context.actorId,
          nodeAddress: context.nodeAddress,
          signal: context.signal,
        });
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'LLM_PROVIDER_FAILED',
            message: toErrorMessage(error),
            cause: error,
          },
        };
      }
    },
  };
}

export function createAgentLoopBehavior(
  options: ActorAgentLoopOptions = {}
): ActorBehavior<ActorAgentLoopMessage, ActorAgentLoopEvent, ActorAgentToolRegistry> {
  return defineBehavior<ActorAgentLoopMessage, ActorAgentLoopEvent>()
    .withTools<ActorAgentToolRegistry>()
    .withContext(createInitialContext(options))
    .onMessage(async ({ message, context, tools }) => {
      if (message.type === 'GET_AGENT_CONTEXT') {
        return { reply: context };
      }

      const nextMessages =
        message.type === 'START_AGENT'
          ? [{ role: 'user' as const, content: message.prompt }]
          : [createObservedToolMessage(message)];
      const pendingToolCalls =
        message.type === 'OBSERVE_TOOL_RESULT'
          ? context.pendingToolCalls.filter((toolCall) => toolCall.id !== message.toolCallId)
          : context.pendingToolCalls;
      const messages = [...context.history, ...nextMessages];
      const observedToolEvents: ActorAgentLoopEvent[] =
        message.type === 'OBSERVE_TOOL_RESULT'
          ? [
              {
                type: 'AGENT_TOOL_RESULT_OBSERVED',
                toolCallId: message.toolCallId,
                name: message.name,
                ok: message.ok,
              },
            ]
          : [];

      if (message.type === 'OBSERVE_TOOL_RESULT' && pendingToolCalls.length > 0) {
        return {
          context: {
            history: messages,
            steps: context.steps,
            pendingToolCalls,
            lastError: null,
          },
          reply: {
            ok: true,
            status: 'waiting-for-tool',
            message: nextMessages[0],
            toolCalls: [],
          },
          emit: observedToolEvents,
        };
      }

      const step = context.steps + 1;

      try {
        const result = await tools.execute<ActorAgentLlmResult, ActorAgentLlmRequest>(
          ACTOR_WEB_LLM_TOOL_NAME,
          {
            system:
              message.type === 'START_AGENT' ? (message.system ?? options.system) : options.system,
            messages,
            tools: toolNamesForModel(tools),
          },
          options.llmTimeoutMs ? { timeoutMs: options.llmTimeoutMs } : undefined
        );

        if (!result.ok) {
          return createFailureResult({
            context: {
              ...context,
              history: messages,
              pendingToolCalls,
            },
            error: result.error,
            emitPrefix: observedToolEvents,
          });
        }

        const assistantMessage = result.value.message;
        const toolCalls = assistantMessage.toolCalls ?? [];
        const nextContext: ActorAgentLoopContext = {
          history: [...messages, assistantMessage],
          steps: step,
          pendingToolCalls: [...pendingToolCalls, ...toolCalls],
          lastError: null,
        };
        const reply: ActorAgentLoopReply = {
          ok: true,
          status: toolCalls.length > 0 ? 'waiting-for-tool' : 'responded',
          message: assistantMessage,
          toolCalls,
          ...(result.value.usage ? { usage: result.value.usage } : {}),
        };
        const emit: ActorAgentLoopEvent[] =
          toolCalls.length > 0
            ? toolCalls.map((toolCall: ActorAgentToolCall) => ({
                type: 'AGENT_TOOL_CALL_REQUESTED' as const,
                step,
                toolCall,
              }))
            : [
                {
                  type: 'AGENT_STEP_COMPLETED',
                  step,
                  message: assistantMessage,
                },
              ];

        return {
          context: nextContext,
          reply,
          emit: [...observedToolEvents, ...emit],
        };
      } catch (error) {
        return createFailureResult({
          context: {
            ...context,
            history: messages,
            pendingToolCalls,
          },
          error: normalizeThrownError(error),
          emitPrefix: observedToolEvents,
        });
      }
    })
    .build();
}

export function createActorAgentTools(input: {
  readonly llm: ActorAgentLlmProvider;
}): ActorToolRegistry {
  return createActorAgentToolRegistry(input) as unknown as ActorToolRegistry;
}
