import type {
  AgentTraceCapture,
  AgentTraceCompleteness,
  AgentTraceEvent,
  AgentTraceEventMap,
  AgentTraceMessage,
  AgentTraceModelRequest,
  AgentTracePayload,
} from '@actor-web/agent';
import type { ActorEventEnvelope, JsonValue } from '@actor-web/runtime';

// Compile-time contract tests, included by the public ESM consumption fixture.
const input = { status: 'captured', value: { before: 114, after: 342 } } as const;
const output = { status: 'captured', value: { percentage: 200 } } as const;
const modelCall = { turn: 1, modelCallId: 'model-1', attempt: 1 } as const;
const toolCall = { ...modelCall, toolCallId: 'tool-1', name: 'percentage_increase' };
const request: AgentTraceModelRequest = {
  system: 'Find the largest sales spike.',
  messages: [{ role: 'user', content: '{"productId":"P005"}' }],
  tools: ['percentage_increase'],
  toolDefinitions: [
    {
      name: 'percentage_increase',
      description: 'Calculate the change.',
      inputSchema: { type: 'object' },
    },
  ],
};

// Every event has a representative fixture; newly added event types require one.
const facts = {
  'run.started': {
    purpose: 'retail-analysis',
    methodRevision: 'v3',
    case: { datasetId: 'retail', datasetRevision: '1', caseId: 'P005' },
    task: { status: 'captured', value: { productId: 'P005' } },
    configuration: { status: 'captured', value: { toolExampleMode: 'description' } },
  },
  'model.requested': {
    ...modelCall,
    model: {
      provider: 'fixture',
      model: 'scripted',
      settings: { status: 'omitted', reason: 'unavailable' },
    },
    request: { status: 'captured', value: request },
  },
  'model.returned': {
    ...modelCall,
    message: {
      status: 'captured',
      value: {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tool-1', name: toolCall.name, input: input.value }],
        reasoningSummaries: [],
      },
    },
    usage: { inputTokens: 100, outputTokens: 20 },
    durationMs: 100,
  },
  'model.failed': { ...modelCall, failure: { code: 'PROVIDER_FAILED' }, durationMs: 10 },
  'tool.requested': { ...toolCall, input },
  'tool.rejected': { ...toolCall, failure: { code: 'INVALID_INPUT' } },
  'tool.observed': { ...toolCall, input, output, durationMs: 1 },
  'tool.failed': { ...toolCall, failure: { code: 'TOOL_FAILED' }, durationMs: 1 },
  'output.validated': {
    modelCallId: modelCall.modelCallId,
    validator: { id: 'retail-result', revision: '1' },
    outcome: 'passed',
    output,
  },
  'run.completed': { output },
  'run.failed': { failure: { code: 'RUN_FAILED' } },
  'run.cancelled': { code: 'CALLER_ABORTED' },
} satisfies AgentTraceEventMap;
void facts;

const payload: AgentTracePayload = { type: 'tool.observed', ...facts['tool.observed'] };
const event: AgentTraceEvent = {
  id: 'event-1',
  schemaVersion: 1,
  kind: 'fact',
  occurredAt: '2026-11-24T23:00:00.000Z',
  sourceActor: 'actor://local/analyst',
  runId: 'run-1',
  sequence: 1,
  type: 'tool.observed',
  payload: facts['tool.observed'],
};
const runtimeEnvelope: ActorEventEnvelope = event;
void [payload, runtimeEnvelope];

function narrow(event: AgentTraceEvent, payload: AgentTracePayload): void {
  // The entire envelope union must remain compatible, not just tool.observed.
  const envelope: ActorEventEnvelope = event;
  if (event.type === 'tool.observed') {
    const input: AgentTraceCapture<JsonValue> = event.payload.input;
    void input;
    // @ts-expect-error Tool observations do not contain a model response message.
    void event.payload.message;
  }
  if (payload.type === 'model.returned' && payload.message.status === 'captured') {
    const role: 'assistant' = payload.message.value.role;
    void role;
  }
  void envelope;
}
void narrow;

const redacted: AgentTraceCapture<string> = {
  status: 'redacted',
  value: '[redacted]',
  policyId: 'customer-data-v1',
};
const capturedNull: AgentTraceCapture<JsonValue> = { status: 'captured', value: null };
const missing: AgentTraceCapture<JsonValue> = { status: 'omitted', reason: 'size-limit' };
const incomplete: AgentTraceCompleteness = {
  status: 'incomplete',
  reasons: ['byte-limit', 'delivery-failed'],
};
const failedValidation: AgentTracePayload = {
  type: 'output.validated',
  modelCallId: 'model-1',
  validator: { id: 'retail-result', revision: '1' },
  outcome: 'failed',
  failure: { code: 'NUMERIC_MISMATCH' },
};
void [redacted, capturedNull, missing, incomplete, failedValidation];

// @ts-expect-error Omitted content cannot masquerade as a captured null.
const missingWithValue: AgentTraceCapture<JsonValue> = { ...missing, value: null };
// @ts-expect-error Redaction must name its policy.
const unnamedRedaction: AgentTraceCapture<string> = { status: 'redacted', value: '' };
// @ts-expect-error Missing usage is explicit, not silently treated as zero.
const missingUsage: AgentTracePayload = {
  type: 'model.returned',
  ...modelCall,
  message: { status: 'omitted', reason: 'disabled' },
  durationMs: 1,
};
// @ts-expect-error Event type and nested payload must agree.
const wrongEnvelope: AgentTraceEvent = { ...event, type: 'model.returned' };
// @ts-expect-error Incomplete traces require at least one reason.
const unexplainedLoss: AgentTraceCompleteness = { status: 'incomplete', reasons: [] };
const unsafeMessage: AgentTraceMessage = {
  role: 'assistant',
  content: '',
  // @ts-expect-error Opaque provider continuation data is excluded from eval traces.
  providerState: { format: 'openai-responses', reasoningItems: [] },
};
const unsafeOutput: AgentTraceCapture<JsonValue> = {
  status: 'captured',
  // @ts-expect-error Captured data must be JSON, not an executable value.
  value: () => 'output',
};
void [
  missingWithValue,
  unnamedRedaction,
  missingUsage,
  wrongEnvelope,
  unexplainedLoss,
  unsafeMessage,
  unsafeOutput,
];
