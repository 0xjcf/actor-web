import type {
  ActorBehavior,
  AgentSessionCheckpointEnvelope,
  AgentSessionCheckpointReadResult,
  AgentSessionCheckpointStore,
  AgentSessionCheckpointWriteResult,
  JsonValue,
} from '@actor-web/runtime';
import {
  createAgentSessionCheckpointEnvelope,
  deriveAgentSessionCheckpointRehydration,
} from '@actor-web/runtime';
import type {
  ActorToolExecutionContext,
  ActorToolExecutor,
  ActorToolRegistry,
} from '@actor-web/runtime/browser';
import { defineBehavior } from '@actor-web/runtime/browser';
export type { OpenAiCompatibleLlmProviderOptions } from './openai-compatible-llm-provider.js';
export { createOpenAiCompatibleLlmProvider } from './openai-compatible-llm-provider.js';

export const ACTOR_WEB_LLM_TOOL_NAME = 'llm' as const;

export type ActorAgentMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ActorAgentToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface ActorAgentToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: JsonValue;
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
  readonly toolDefinitions?: readonly ActorAgentToolDefinition[];
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
  | {
      readonly type: 'RECONCILE_AGENT_SESSION';
      readonly receipt: ActorAgentReconciliationReceipt;
      readonly checkpointState?: ActorAgentLoopCheckpointState;
    }
  | { readonly type: 'GET_AGENT_CONTEXT' };

export interface ActorAgentReconciliationReceipt {
  readonly receiptId: string;
  readonly outcome: 'effect_applied' | 'effect_not_applied';
}

export interface ActorAgentLoopContext {
  readonly system?: string;
  readonly history: readonly ActorAgentLlmMessage[];
  readonly steps: number;
  readonly pendingToolCalls: readonly ActorAgentToolCall[];
  readonly lastError: ActorAgentError | null;
}

export interface ActorAgentLoopCheckpointState {
  readonly system?: string;
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
  | {
      readonly ok: true;
      readonly status: 'reconciled';
      readonly receiptId: string;
      readonly outcome: ActorAgentReconciliationReceipt['outcome'];
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
    }
  | {
      readonly type: 'AGENT_SESSION_RECONCILED';
      readonly receiptId: string;
      readonly outcome: ActorAgentReconciliationReceipt['outcome'];
    };

export interface ActorAgentLoopOptions {
  readonly system?: string;
  readonly toolDefinitions?: readonly ActorAgentToolDefinition[];
  readonly initialHistory?: readonly ActorAgentLlmMessage[];
  readonly initialCheckpointState?: ActorAgentLoopCheckpointState;
  readonly llmTimeoutMs?: number;
  readonly checkpoint?: {
    readonly store: AgentSessionCheckpointStore;
    readonly sessionId: string;
    readonly actorId?: string;
    readonly now?: () => Date;
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeThrownError(error: unknown): ActorAgentError {
  if (isActorAgentError(error)) {
    return error;
  }
  const message = toErrorMessage(error);
  return {
    code: message.includes(`Actor tool "${ACTOR_WEB_LLM_TOOL_NAME}" is not registered.`)
      ? 'LLM_TOOL_UNAVAILABLE'
      : 'AGENT_LOOP_FAILED',
    message,
    cause: error,
  };
}

function createInitialContext(options: ActorAgentLoopOptions): ActorAgentLoopContext {
  if (options.initialCheckpointState) {
    const context = rehydrateActorAgentLoopContext(options.initialCheckpointState);
    return {
      ...context,
      system: context.system ?? options.system,
    };
  }
  return {
    system: options.system,
    history: [...(options.initialHistory ?? [])],
    steps: 0,
    pendingToolCalls: [],
    lastError: null,
  };
}

export function createActorAgentLoopCheckpointState(
  context: ActorAgentLoopContext
): ActorAgentLoopCheckpointState {
  return {
    ...(context.system === undefined ? {} : { system: context.system }),
    history: [...context.history],
    steps: context.steps,
    pendingToolCalls: [...context.pendingToolCalls],
    lastError: context.lastError
      ? {
          code: context.lastError.code,
          message: context.lastError.message,
        }
      : null,
  };
}

export function rehydrateActorAgentLoopContext(
  state: ActorAgentLoopCheckpointState
): ActorAgentLoopContext {
  return {
    system: state.system,
    history: [...state.history],
    steps: state.steps,
    pendingToolCalls: [...state.pendingToolCalls],
    lastError: state.lastError ? { ...state.lastError } : null,
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

function toolDefinitionsForModel(
  requested: readonly ActorAgentToolDefinition[] | undefined,
  allowedTools: readonly string[]
): readonly ActorAgentToolDefinition[] | undefined {
  if (!requested || requested.length === 0) {
    return undefined;
  }
  const allowedToolNames = new Set(allowedTools);
  const authorizedDefinitions = requested.filter((definition) => allowedToolNames.has(definition.name));
  return authorizedDefinitions.length > 0 ? authorizedDefinitions : undefined;
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

function composeFailureWithDurability(
  error: ActorAgentError,
  durabilityError: unknown
): ActorAgentError {
  return {
    code: error.code,
    message: error.message,
    cause: {
      original: error.cause,
      durability: normalizeThrownError(durabilityError),
    },
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

function isCheckpointStateCandidate(value: unknown): value is ActorAgentLoopCheckpointState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const history = candidate.history;
  const pendingToolCalls = candidate.pendingToolCalls;
  const lastError = candidate.lastError;
  return (
    (candidate.system === undefined || typeof candidate.system === 'string') &&
    Array.isArray(history) &&
    history.every(isActorAgentLlmMessage) &&
    typeof candidate.steps === 'number' &&
    Number.isInteger(candidate.steps) &&
    candidate.steps >= 0 &&
    Array.isArray(pendingToolCalls) &&
    pendingToolCalls.every(isActorAgentToolCall) &&
    (lastError === null || isActorAgentError(lastError))
  );
}

function createCheckpointError(code: string, message: string, cause?: unknown): ActorAgentError {
  return {
    code,
    message,
    ...(cause === undefined ? {} : { cause }),
  };
}

function createCheckpointIdentity(
  checkpoint: NonNullable<ActorAgentLoopOptions['checkpoint']>,
  step: number
) {
  const actorId = checkpoint.actorId ?? 'actor://local/agent';
  return {
    actorId,
    sessionId: checkpoint.sessionId,
    turnId: `turn:${step}`,
    traceId: `trace:${checkpoint.sessionId}:${step}`,
    commandId: `cmd:${checkpoint.sessionId}:${step}`,
    correlationId: `corr:${checkpoint.sessionId}:${step}`,
    causationId: `cause:${checkpoint.sessionId}:${step}`,
  } as const;
}

function isActorAgentToolCall(value: unknown): value is ActorAgentToolCall {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' && typeof candidate.name === 'string' && 'input' in candidate
  );
}

function isActorAgentLlmMessage(value: unknown): value is ActorAgentLlmMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.role === 'system' ||
      candidate.role === 'user' ||
      candidate.role === 'assistant' ||
      candidate.role === 'tool') &&
    typeof candidate.content === 'string' &&
    (candidate.toolCallId === undefined || typeof candidate.toolCallId === 'string') &&
    (candidate.toolName === undefined || typeof candidate.toolName === 'string') &&
    (candidate.toolCalls === undefined ||
      (Array.isArray(candidate.toolCalls) && candidate.toolCalls.every(isActorAgentToolCall)))
  );
}

function isActorAgentError(value: unknown): value is ActorAgentError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}

function sanitizeCheckpointReceipt(receipt: unknown): JsonValue {
  if (
    typeof receipt === 'object' &&
    receipt !== null &&
    'ok' in receipt &&
    (receipt as { ok: unknown }).ok === true &&
    'value' in receipt
  ) {
    const value = (receipt as { value: { message?: ActorAgentLlmMessage; usage?: JsonValue } })
      .value;
    return {
      ok: true,
      value: {
        ...(value.usage === undefined ? {} : { usage: value.usage }),
        ...(value.message
          ? {
              message: {
                role: value.message.role,
                ...(value.message.toolCallId === undefined
                  ? {}
                  : { toolCallId: value.message.toolCallId }),
                ...(value.message.toolName === undefined
                  ? {}
                  : { toolName: value.message.toolName }),
                ...(value.message.toolCalls === undefined
                  ? {}
                  : {
                      toolCalls: value.message.toolCalls.map((toolCall) => ({
                        id: toolCall.id,
                        name: toolCall.name,
                        input: toolCall.input as JsonValue,
                      })),
                    }),
              },
            }
          : {}),
      },
    };
  }
  if (
    typeof receipt === 'object' &&
    receipt !== null &&
    'ok' in receipt &&
    (receipt as { ok: unknown }).ok === false &&
    'error' in receipt
  ) {
    const error = (receipt as { error?: ActorAgentError }).error;
    return {
      ok: false,
      ...(error
        ? {
            error: {
              code: error.code,
              message: error.message,
            },
          }
        : {}),
    };
  }
  return {
    recorded: true,
  };
}

function createCheckpointWriteFailure(
  writeResult: AgentSessionCheckpointWriteResult
): ActorAgentError {
  return createCheckpointError(
    'CHECKPOINT_WRITE_FAILED',
    `Checkpoint write failed: ${writeResult.outcome}${
      'reason' in writeResult && typeof writeResult.reason === 'string'
        ? ` (${writeResult.reason})`
        : ''
    }.`,
    writeResult
  );
}

async function requireCheckpointWriteStored(
  checkpoint: NonNullable<ActorAgentLoopOptions['checkpoint']>,
  context: ActorAgentLoopContext,
  input: {
    readonly step: number;
    readonly phase: 'intent_recorded' | 'receipt_recorded' | 'reconciliation_required';
    readonly irreversible: boolean;
    readonly intent?: unknown;
    readonly receipt?: unknown;
    readonly reconciliationReason?: string;
    readonly checkpointKey?: string;
    readonly effectKey?: string;
  }
): Promise<void> {
  const writeResult = await writeCheckpointEnvelope(checkpoint, context, input);
  if (
    writeResult.outcome !== 'stored' &&
    writeResult.outcome !== 'replaced' &&
    writeResult.outcome !== 'duplicate'
  ) {
    throw createCheckpointWriteFailure(writeResult);
  }
}

async function writeCheckpointEnvelope(
  checkpoint: NonNullable<ActorAgentLoopOptions['checkpoint']>,
  context: ActorAgentLoopContext,
  input: {
    readonly step: number;
    readonly phase: 'intent_recorded' | 'receipt_recorded' | 'reconciliation_required';
    readonly irreversible: boolean;
    readonly intent?: unknown;
    readonly receipt?: unknown;
    readonly reconciliationReason?: string;
    readonly checkpointKey?: string;
    readonly effectKey?: string;
  }
): Promise<AgentSessionCheckpointWriteResult> {
  const recordedAt = (checkpoint.now ?? (() => new Date()))().toISOString();
  const checkpointKey = input.checkpointKey ?? input.phase;
  const effectKey = input.effectKey ?? String(input.step);
  return checkpoint.store.write(
    createAgentSessionCheckpointEnvelope({
      sessionId: checkpoint.sessionId,
      checkpointId: `checkpoint:${checkpoint.sessionId}:${input.step}:${checkpointKey}`,
      actor: createCheckpointIdentity(checkpoint, input.step),
      deterministic: createActorAgentLoopCheckpointState(context) as unknown as JsonValue,
      effect: {
        effectId: `effect:${checkpoint.sessionId}:${effectKey}`,
        effectAttemptId: `effect-attempt:${checkpoint.sessionId}:${effectKey}`,
        phase: input.phase,
        irreversible: input.irreversible,
        ...(input.intent === undefined ? {} : { intent: input.intent as JsonValue }),
        ...(input.receipt === undefined
          ? {}
          : { receipt: sanitizeCheckpointReceipt(input.receipt) }),
      },
      continuation: null,
      reconciliation:
        input.phase === 'reconciliation_required'
          ? {
              status: 'required',
              reason:
                input.reconciliationReason ?? 'Checkpoint requires reconciliation before resume.',
            }
          : { status: 'clear' },
      recordedAt,
    })
  );
}

function isCheckpointWriteDurable(writeResult: AgentSessionCheckpointWriteResult): boolean {
  return (
    writeResult.outcome === 'stored' ||
    writeResult.outcome === 'replaced' ||
    writeResult.outcome === 'duplicate'
  );
}

async function reconcileAgentSessionCheckpoint(input: {
  readonly checkpoint: NonNullable<ActorAgentLoopOptions['checkpoint']>;
  readonly receipt: ActorAgentReconciliationReceipt;
  readonly checkpointState?: ActorAgentLoopCheckpointState;
}): Promise<
  | { readonly ok: true; readonly context: ActorAgentLoopContext }
  | { readonly ok: false; readonly error: ActorAgentError }
> {
  if (input.receipt.receiptId.trim().length === 0) {
    return {
      ok: false,
      error: createCheckpointError(
        'CHECKPOINT_RECONCILIATION_INVALID',
        'Reconciliation requires a non-empty receiptId.'
      ),
    };
  }

  let readResult: AgentSessionCheckpointReadResult;
  try {
    readResult = await input.checkpoint.store.read({
      sessionId: input.checkpoint.sessionId,
      now: input.checkpoint.now,
    });
  } catch (error) {
    return {
      ok: false,
      error: createCheckpointError(
        'CHECKPOINT_READ_FAILED',
        `Checkpoint read failed: ${toErrorMessage(error)}`,
        error
      ),
    };
  }

  const rehydration = deriveAgentSessionCheckpointRehydration(readResult);
  if (rehydration.outcome !== 'deferred_for_reconciliation') {
    return {
      ok: false,
      error: createCheckpointError(
        'CHECKPOINT_RECONCILIATION_NOT_REQUIRED',
        'The current checkpoint is not awaiting reconciliation.'
      ),
    };
  }

  const envelope = rehydration.envelope;
  if (!isCheckpointStateCandidate(envelope.deterministic)) {
    return {
      ok: false,
      error: createCheckpointError(
        'CHECKPOINT_INVALID_STATE',
        'Checkpoint deterministic state is invalid.'
      ),
    };
  }
  if (
    input.receipt.outcome === 'effect_applied' &&
    !isCheckpointStateCandidate(input.checkpointState)
  ) {
    return {
      ok: false,
      error: createCheckpointError(
        'CHECKPOINT_RECONCILIATION_INVALID',
        'Applied-effect reconciliation requires the resulting deterministic checkpoint state.'
      ),
    };
  }

  const nextState =
    input.receipt.outcome === 'effect_applied'
      ? (input.checkpointState as ActorAgentLoopCheckpointState)
      : envelope.deterministic;
  const nextContext = rehydrateActorAgentLoopContext(nextState);
  const effect = envelope.effect;
  try {
    const reconciledEnvelope: AgentSessionCheckpointEnvelope = createAgentSessionCheckpointEnvelope(
      {
        sessionId: envelope.sessionId,
        checkpointId: `${envelope.checkpointId}:reconciled:${input.receipt.receiptId}`,
        actor: envelope.actor,
        deterministic: createActorAgentLoopCheckpointState(nextContext) as unknown as JsonValue,
        effect: effect
          ? {
              ...effect,
              phase: 'receipt_recorded',
              receipt: {
                receiptId: input.receipt.receiptId,
                receiptKind: 'reconciliation',
                status: 'reconciled',
                outcome: input.receipt.outcome,
              },
            }
          : null,
        continuation: envelope.continuation,
        reconciliation: { status: 'clear' },
        recordedAt: (input.checkpoint.now ?? (() => new Date()))().toISOString(),
        expiresAt: envelope.expiresAt,
        staleAt: null,
        redactedFields: envelope.redactedFields,
        ...(envelope.metadata === undefined ? {} : { metadata: envelope.metadata }),
      }
    );
    const writeResult = await input.checkpoint.store.write(reconciledEnvelope);
    if (!isCheckpointWriteDurable(writeResult)) {
      return {
        ok: false,
        error: createCheckpointWriteFailure(writeResult),
      };
    }
  } catch (error) {
    return {
      ok: false,
      error: createCheckpointError(
        'CHECKPOINT_WRITE_FAILED',
        `Checkpoint write failed: ${toErrorMessage(error)}`,
        error
      ),
    };
  }

  return { ok: true, context: nextContext };
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
  const bootstrapCheckpoint = async (
    context: ActorAgentLoopContext
  ): Promise<
    | { readonly kind: 'noop' }
    | { readonly kind: 'ready'; readonly context: ActorAgentLoopContext }
    | { readonly kind: 'blocked'; readonly error: ActorAgentError }
  > => {
    const checkpoint = options.checkpoint;
    if (!checkpoint) {
      return { kind: 'noop' };
    }
    try {
      const readResult = await checkpoint.store.read({
        sessionId: checkpoint.sessionId,
        now: checkpoint.now,
      });
      const rehydration = deriveAgentSessionCheckpointRehydration(readResult);
      switch (rehydration.outcome) {
        case 'resumed':
          if (isCheckpointStateCandidate(rehydration.envelope.deterministic)) {
            return {
              kind: 'ready',
              context: rehydrateActorAgentLoopContext(
                rehydration.envelope.deterministic as ActorAgentLoopCheckpointState
              ),
            } as const;
          }
          return {
            kind: 'blocked',
            error: createCheckpointError(
              'CHECKPOINT_INVALID_STATE',
              'Checkpoint deterministic state is invalid.'
            ),
          } as const;
        case 'deferred_for_reconciliation':
          return {
            kind: 'blocked',
            error: createCheckpointError('CHECKPOINT_RECONCILIATION_REQUIRED', rehydration.reason),
          } as const;
        case 'manual_recovery_required':
          if (rehydration.reason === 'missing') {
            return { kind: 'ready', context } as const;
          }
          return {
            kind: 'blocked',
            error: createCheckpointError(
              'CHECKPOINT_RECOVERY_REQUIRED',
              rehydration.detail ?? `Checkpoint recovery required: ${rehydration.reason}.`
            ),
          } as const;
      }
    } catch (error) {
      return {
        kind: 'blocked',
        error: createCheckpointError(
          'CHECKPOINT_READ_FAILED',
          `Checkpoint read failed: ${toErrorMessage(error)}`,
          error
        ),
      } as const;
    }
  };

  return defineBehavior<ActorAgentLoopMessage, ActorAgentLoopEvent>()
    .withTools<ActorAgentToolRegistry>()
    .withContext(createInitialContext(options))
    .onMessage(async ({ message, context, tools }) => {
      if (message.type === 'RECONCILE_AGENT_SESSION') {
        if (!options.checkpoint) {
          return createFailureResult({
            context,
            error: createCheckpointError(
              'CHECKPOINT_RECONCILIATION_UNAVAILABLE',
              'Agent-session reconciliation requires a configured checkpoint store.'
            ),
          });
        }
        const reconciliation = await reconcileAgentSessionCheckpoint({
          checkpoint: options.checkpoint,
          receipt: message.receipt,
          ...(message.checkpointState === undefined
            ? {}
            : { checkpointState: message.checkpointState }),
        });
        if (!reconciliation.ok) {
          return createFailureResult({
            context,
            error: reconciliation.error,
          });
        }
        return {
          context: reconciliation.context,
          reply: {
            ok: true,
            status: 'reconciled',
            receiptId: message.receipt.receiptId,
            outcome: message.receipt.outcome,
          },
          emit: [
            {
              type: 'AGENT_SESSION_RECONCILED',
              receiptId: message.receipt.receiptId,
              outcome: message.receipt.outcome,
            },
          ],
        };
      }

      const checkpointState = await bootstrapCheckpoint(context);
      if (checkpointState.kind === 'blocked') {
        return createFailureResult({
          context,
          error: checkpointState.error,
        });
      }
      const activeContext = checkpointState.kind === 'ready' ? checkpointState.context : context;

      if (message.type === 'GET_AGENT_CONTEXT') {
        return { reply: activeContext, context: activeContext };
      }

      const nextMessages =
        message.type === 'START_AGENT'
          ? [{ role: 'user' as const, content: message.prompt }]
          : [createObservedToolMessage(message)];
      const pendingToolCalls =
        message.type === 'OBSERVE_TOOL_RESULT'
          ? activeContext.pendingToolCalls.filter((toolCall) => toolCall.id !== message.toolCallId)
          : activeContext.pendingToolCalls;
      const system =
        message.type === 'START_AGENT'
          ? (message.system ?? activeContext.system ?? options.system)
          : (activeContext.system ?? options.system);
      const messages = [...activeContext.history, ...nextMessages];
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
        const waitingContext = {
          system,
          history: messages,
          steps: activeContext.steps,
          pendingToolCalls,
          lastError: null,
        } satisfies ActorAgentLoopContext;
        if (options.checkpoint) {
          try {
            await requireCheckpointWriteStored(options.checkpoint, waitingContext, {
              step: activeContext.steps,
              phase: 'receipt_recorded',
              irreversible: true,
              checkpointKey: `tool_result:${message.toolCallId}`,
              effectKey: `tool_result:${message.toolCallId}`,
              intent: {
                tool: message.name,
                toolCallId: message.toolCallId,
              },
              receipt: { recorded: true },
            });
          } catch (error) {
            return createFailureResult({
              context: activeContext,
              error: normalizeThrownError(error),
              emitPrefix: observedToolEvents,
            });
          }
        }
        return {
          context: waitingContext,
          reply: {
            ok: true,
            status: 'waiting-for-tool',
            message: nextMessages[0],
            toolCalls: [],
          },
          emit: observedToolEvents,
        };
      }

      const step = activeContext.steps + 1;
      const executionContext: ActorAgentLoopContext = {
        ...activeContext,
        system,
        history: messages,
        pendingToolCalls,
        lastError: null,
      };

      let dispatched = false;
      try {
        if (options.checkpoint) {
          await requireCheckpointWriteStored(options.checkpoint, executionContext, {
            step,
            phase: 'intent_recorded',
            irreversible: true,
            intent: {
              tool: ACTOR_WEB_LLM_TOOL_NAME,
              messageType: message.type,
            },
          });
        }
        dispatched = true;
        const result = await tools.execute<ActorAgentLlmResult, ActorAgentLlmRequest>(
          ACTOR_WEB_LLM_TOOL_NAME,
          {
            system,
            messages,
            tools: toolNamesForModel(tools),
            toolDefinitions: toolDefinitionsForModel(
              options.toolDefinitions,
              toolNamesForModel(tools)
            ),
          },
          options.llmTimeoutMs ? { timeoutMs: options.llmTimeoutMs } : undefined
        );

        if (!result.ok) {
          const failureError = result.error;
          const failure = createFailureResult({
            context: executionContext,
            error: failureError,
            emitPrefix: observedToolEvents,
          });
          if (options.checkpoint) {
            try {
              await requireCheckpointWriteStored(options.checkpoint, failure.context, {
                step,
                phase: 'receipt_recorded',
                irreversible: true,
                intent: {
                  tool: ACTOR_WEB_LLM_TOOL_NAME,
                  messageType: message.type,
                },
                receipt: result,
              });
            } catch (durabilityError) {
              return createFailureResult({
                context: executionContext,
                error: composeFailureWithDurability(failureError, durabilityError),
                emitPrefix: observedToolEvents,
              });
            }
          }
          return failure;
        }

        const assistantMessage = result.value.message;
        const toolCalls = assistantMessage.toolCalls ?? [];
        const nextContext: ActorAgentLoopContext = {
          system,
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

        if (options.checkpoint) {
          try {
            await requireCheckpointWriteStored(options.checkpoint, nextContext, {
              step,
              phase: 'receipt_recorded',
              irreversible: true,
              intent: {
                tool: ACTOR_WEB_LLM_TOOL_NAME,
                messageType: message.type,
              },
              receipt: result,
            });
          } catch (durabilityError) {
            return createFailureResult({
              context: nextContext,
              error: normalizeThrownError(durabilityError),
              emitPrefix: [...observedToolEvents, ...emit],
            });
          }
        }

        return {
          context: nextContext,
          reply,
          emit: [...observedToolEvents, ...emit],
        };
      } catch (error) {
        const failure = createFailureResult({
          context: executionContext,
          error: normalizeThrownError(error),
          emitPrefix: observedToolEvents,
        });
        const failureError = failure.reply.ok ? null : failure.reply.error;
        if (options.checkpoint && dispatched) {
          try {
            await requireCheckpointWriteStored(options.checkpoint, failure.context, {
              step,
              phase: 'reconciliation_required',
              irreversible: true,
              intent: {
                tool: ACTOR_WEB_LLM_TOOL_NAME,
                messageType: message.type,
              },
              reconciliationReason: failureError?.message,
            });
          } catch (durabilityError) {
            if (!failureError) {
              return failure;
            }
            return createFailureResult({
              context: executionContext,
              error: composeFailureWithDurability(failureError, durabilityError),
              emitPrefix: observedToolEvents,
            });
          }
        }
        return failure;
      }
    })
    .build();
}

export function createActorAgentTools(input: {
  readonly llm: ActorAgentLlmProvider;
}): ActorToolRegistry {
  return createActorAgentToolRegistry(input) as unknown as ActorToolRegistry;
}
