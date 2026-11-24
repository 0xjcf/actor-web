import {
  type AgentExecutionEventReceipt,
  type AgentExecutionTrace,
  createAgentExecutionTrace,
  toAgentExecutionReceiptFromEventEnvelope,
} from '@actor-web/runtime/browser';

const maxEvidenceReceipts = 256;
let sessionSerial = 0;

type PortOutcome = 'returned' | 'failed' | 'interrupted';
type EvidenceEvent =
  | 'LOCAL_MODEL_DISPATCHED'
  | 'LOCAL_MODEL_OUTCOME'
  | 'LOCAL_TOOL_DISPATCHED'
  | 'LOCAL_TOOL_OUTCOME'
  | 'LOCAL_OUTPUT_VALIDATION'
  | 'LOCAL_CLEANUP_STARTED'
  | 'LOCAL_CLEANUP_OUTCOME';

function sessionNonce(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}:${++sessionSerial}:${Math.random().toString(36).slice(2)}`
  );
}

function usageCount(usage: unknown, key: string): number | 'unknown' {
  if (typeof usage !== 'object' || usage === null) return 'unknown';
  try {
    const field = Object.getOwnPropertyDescriptor(usage, key);
    const count: unknown = field && Object.hasOwn(field, 'value') ? field.value : undefined;
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
      ? count === 0
        ? 0
        : count
      : 'unknown';
  } catch {
    // Optional provider usage must not replace the model result.
    return 'unknown';
  }
}

export function createExecutionEvidence(assignmentId: string, revision: number) {
  let identity:
    | Pick<
        AgentExecutionTrace,
        'traceId' | 'sessionId' | 'commandId' | 'actorId' | 'revision' | 'correlationId'
      >
    | undefined;
  const receipts: AgentExecutionEventReceipt[] = [];
  let truncated = false;
  let modelAttempts = 0;
  let toolAttempts = 0;

  function append(type: EvidenceEvent, payload: Record<string, unknown>, attempt?: number) {
    if (!identity || truncated) return;
    if (receipts.length === maxEvidenceReceipts) {
      truncated = true;
      return;
    }
    const sequence = receipts.length + 1;
    try {
      receipts.push(
        toAgentExecutionReceiptFromEventEnvelope(
          {
            id: `${identity.traceId}:record:${sequence}`,
            kind: 'fact',
            type,
            schemaVersion: 1,
            occurredAt: new Date().toISOString(),
            sourceActor: identity.actorId,
            correlationId: assignmentId,
            payload,
          },
          { ...identity, sequence, ...(attempt === undefined ? {} : { attempt }) }
        )
      );
    } catch {
      // Keep the truthful prefix, without making evidence production block dispatch.
      truncated = true;
    }
  }

  return {
    beginSession(actorId: string) {
      try {
        const nonce = sessionNonce();
        identity = {
          traceId: `local-trace:${nonce}`,
          sessionId: `local-session:${nonce}`,
          commandId: `local-run:${nonce}`,
          actorId,
          revision,
          correlationId: assignmentId,
        };
      } catch {
        // Evidence identity is optional; it must not refuse the underlying execution.
        truncated = true;
      }
    },
    modelDispatch(): number {
      const attempt = ++modelAttempts;
      append('LOCAL_MODEL_DISPATCHED', {}, attempt);
      return attempt;
    },
    modelOutcome(attempt: number, outcome: PortOutcome, usage?: unknown) {
      if (!identity || truncated) return;
      append(
        'LOCAL_MODEL_OUTCOME',
        {
          outcome,
          // This contains reported token counts, never provider-supplied usage objects.
          usage: {
            input: usageCount(usage, 'inputTokens'),
            output: usageCount(usage, 'outputTokens'),
            total: usageCount(usage, 'totalTokens'),
          },
        },
        attempt
      );
    },
    toolDispatch(toolOrdinal: number): number {
      const attempt = ++toolAttempts;
      append('LOCAL_TOOL_DISPATCHED', { toolOrdinal }, attempt);
      return attempt;
    },
    toolOutcome(attempt: number, toolOrdinal: number, outcome: PortOutcome) {
      append('LOCAL_TOOL_OUTCOME', { toolOrdinal, outcome }, attempt);
    },
    validation(outcome: 'passed' | 'failed' | 'interrupted') {
      append('LOCAL_OUTPUT_VALIDATION', { outcome });
    },
    cleanupStarted() {
      append('LOCAL_CLEANUP_STARTED', {});
    },
    cleanupOutcome(reason?: 'runtime-start-failed' | 'runtime-stop-failed') {
      append(
        'LOCAL_CLEANUP_OUTCOME',
        reason ? { outcome: 'unresolved', reason } : { outcome: 'settled' }
      );
    },
    read() {
      if (!identity) return undefined;
      const trace = createAgentExecutionTrace({ ...identity, receipts });
      return Object.freeze({ trace, truncated });
    },
  };
}
