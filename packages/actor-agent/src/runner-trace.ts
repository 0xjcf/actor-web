import type { JsonValue } from '@actor-web/runtime';
import type { ActorAgentLlmMessage, ActorAgentLlmRequest, ActorAgentTokenUsage } from './index.js';
import { JsonPayloadTooLarge, snapshotJson } from './runner-json.js';
import type {
  AgentRunTraceSnapshot,
  AgentTraceCapture,
  AgentTraceCompleteness,
  AgentTraceContentField,
  AgentTraceEvent,
  AgentTraceMessage,
  AgentTraceModelRequest,
  AgentTraceOptions,
  AgentTracePayload,
} from './trace.js';

type Loss = Extract<AgentTraceCompleteness, { status: 'incomplete' }>['reasons'][number];
let serial = 0;

export function bindTraceOptions(options: AgentTraceOptions) {
  const limits = {
    maxEvents: options.maxEvents ?? 256,
    maxBytes: options.maxBytes ?? 1024 * 1024,
    maxContentBytes: options.maxContentBytes ?? 64 * 1024,
  };
  if (
    Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1) ||
    !options.methodRevision?.trim() ||
    !options.model?.provider?.trim() ||
    !options.model.model?.trim() ||
    (options.capture !== undefined && !['metadata', 'content'].includes(options.capture)) ||
    (options.createRunId !== undefined && typeof options.createRunId !== 'function') ||
    (options.onEvent !== undefined && typeof options.onEvent !== 'function') ||
    (options.redaction !== undefined &&
      (!options.redaction.policyId?.trim() || typeof options.redaction.redact !== 'function'))
  ) {
    throw new Error('Invalid trace configuration.');
  }
  const metadata = snapshotJson(
    {
      methodRevision: options.methodRevision,
      model: {
        provider: options.model.provider,
        model: options.model.model,
        settings: options.model.settings,
      },
      ...(options.case === undefined ? {} : { case: options.case }),
      ...(options.codeRevision === undefined ? {} : { codeRevision: options.codeRevision }),
    },
    64 * 1024
  ).value;
  return {
    ...metadata,
    ...limits,
    capture: options.capture ?? 'metadata',
    createRunId: options.createRunId,
    onEvent: options.onEvent,
    redaction: options.redaction
      ? { policyId: options.redaction.policyId, redact: options.redaction.redact }
      : undefined,
  };
}

/** Read only data properties; diagnostic capture must never invoke input accessors. */
function data(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

export function traceFailureCode(cause: unknown, fallback: string): string {
  try {
    const code = data(cause, 'code');
    return typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(code)
      ? code
      : fallback;
  } catch {
    return fallback;
  }
}

export function traceUsage(value: unknown): ActorAgentTokenUsage | null {
  try {
    const usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
      const count = data(value, key);
      if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
        usage[key] = count;
      }
    }
    return Object.keys(usage).length ? usage : null;
  } catch {
    return null;
  }
}

// Only called with already-normalized runner messages; opaque state is never copied.
export function traceMessage(message: ActorAgentLlmMessage): AgentTraceMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId }),
    ...(message.toolName === undefined ? {} : { toolName: message.toolName }),
    ...(message.reasoningSummaries === undefined
      ? {}
      : { reasoningSummaries: message.reasoningSummaries }),
    ...(message.toolCalls === undefined
      ? {}
      : {
          toolCalls: message.toolCalls.map(({ id, name, input }) => ({
            id,
            name,
            input: input as JsonValue,
          })),
        }),
  };
}

export function traceRequest(request: ActorAgentLlmRequest): AgentTraceModelRequest {
  return {
    ...(request.system === undefined ? {} : { system: request.system }),
    messages: request.messages.map(traceMessage),
    tools: request.tools,
    toolDefinitions: request.toolDefinitions ?? [],
  };
}

export function createRunTrace(options: ReturnType<typeof bindTraceOptions>) {
  const losses = new Set<Loss>();
  const events: AgentTraceEvent[] = [];
  let bytes = 0;
  let stopped = false;
  let deliveryFailures = 0;
  let sequence = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  let usageKnown = true;
  let inputTokens = 0;
  let outputTokens = 0;
  let sourceActor = 'actor://portable-agent/specialist';
  let evidence: AgentTraceEvent['evidence'];
  let runId = `agent-run:${Date.now()}:${++serial}:${Math.random().toString(36).slice(2)}`;
  try {
    const supplied = options.createRunId?.() ?? globalThis.crypto?.randomUUID?.();
    if (supplied !== undefined) {
      if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(supplied)) throw new Error('Invalid run ID.');
      runId = supplied;
    }
  } catch {
    losses.add('capture-failed');
  }
  const failure = () => {
    deliveryFailures++;
    losses.add('delivery-failed');
  };
  function capture<T>(field: AgentTraceContentField, value: T): AgentTraceCapture<T> {
    if (options.capture !== 'content') return { status: 'omitted', reason: 'disabled' };
    try {
      const detached = snapshotJson(value, options.maxContentBytes).value;
      if (!options.redaction) return { status: 'captured', value: detached };
      const projected = options.redaction.redact(detached, field);
      // Observe an accidentally async redactor's rejection without awaiting it.
      if (projected instanceof Promise) {
        void projected.catch(() => {});
        throw new Error('Redaction must be synchronous.');
      }
      return {
        status: 'redacted',
        value: snapshotJson(projected, options.maxContentBytes).value,
        policyId: options.redaction.policyId,
      };
    } catch (cause) {
      if (cause instanceof JsonPayloadTooLarge) return { status: 'omitted', reason: 'size-limit' };
      losses.add('capture-failed');
      return { status: 'omitted', reason: 'invalid-json' };
    }
  }
  function emit(fact: AgentTracePayload): void {
    if (stopped) return;
    if (events.length >= options.maxEvents) {
      stopped = true;
      losses.add('event-limit');
      return;
    }
    try {
      const { type, ...payload } = fact;
      // The mapped event union preserves the type/payload relationship supplied by fact.
      const event = {
        id: `${runId}:event:${++sequence}`,
        kind: 'fact',
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        sourceActor,
        correlationId: runId,
        runId,
        sequence,
        type,
        payload,
        ...(evidence ? { evidence } : {}),
      } as AgentTraceEvent;
      const stored = snapshotJson(event, options.maxBytes - bytes);
      bytes += stored.bytes;
      events.push(stored.value);
      if (options.onEvent) {
        try {
          const returned = options.onEvent(snapshotJson(stored.value, stored.bytes).value);
          if (returned !== undefined) void Promise.resolve(returned).catch(failure);
        } catch {
          failure();
        }
      }
    } catch (cause) {
      stopped = true;
      losses.add(cause instanceof JsonPayloadTooLarge ? 'byte-limit' : 'capture-failed');
    }
  }
  return {
    runId,
    capture,
    emit,
    captureFailed() {
      losses.add('capture-failed');
    },
    get modelCall() {
      return { turn: modelCalls, modelCallId: `${runId}:model:${modelCalls}`, attempt: 1 };
    },
    bindActor(actorId: string, identity?: AgentTraceEvent['evidence']) {
      sourceActor = actorId;
      evidence = identity;
    },
    modelDispatch(request: ActorAgentLlmRequest) {
      modelCalls++;
      const settings = options.model.settings;
      const capturedSettings =
        settings.status === 'omitted' ? settings : capture('model.settings', settings.value);
      emit({
        type: 'model.requested',
        ...this.modelCall,
        model: {
          provider: options.model.provider,
          model: options.model.model,
          settings:
            settings.status === 'redacted' && capturedSettings.status === 'captured'
              ? { ...capturedSettings, status: 'redacted', policyId: settings.policyId }
              : capturedSettings,
        },
        request: capture('model.request', traceRequest(request)),
      });
    },
    modelUsage(usage: ActorAgentTokenUsage | null) {
      if (usage?.inputTokens === undefined || usage.outputTokens === undefined) usageKnown = false;
      else {
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
        if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)) {
          usageKnown = false;
        }
      }
    },
    toolDispatch() {
      toolCalls++;
    },
    get toolAttempts() {
      return toolCalls;
    },
    read(): AgentRunTraceSnapshot {
      const reasons = [...losses];
      const [first, ...rest] = reasons;
      return {
        runId,
        events: snapshotJson(events, options.maxBytes + options.maxEvents + 2).value,
        completeness: first
          ? { status: 'incomplete', reasons: [first, ...rest] }
          : { status: 'complete' },
        deliveryFailures,
        metrics: {
          modelCalls,
          toolCalls,
          usage: usageKnown ? { inputTokens, outputTokens } : null,
        },
      };
    },
  };
}
