import type { ActorEventEnvelope, JsonValue } from '@actor-web/runtime';
import type {
  ActorAgentLlmMessage,
  ActorAgentTokenUsage,
  ActorAgentToolCall,
  ModelToolDefinition,
} from './index.js';

/** Version of the canonical agent trace event and JSONL summary records. */
export const AGENT_TRACE_SCHEMA_VERSION = 1;

/**
 * Content availability is independent of execution success. A captured null is
 * data, not missing content. Redacted values are not exact replay inputs.
 * Producers must apply capture policy before constructing these records.
 */
export type AgentTraceCapture<T> =
  | { readonly status: 'captured'; readonly value: T }
  | { readonly status: 'redacted'; readonly value: T; readonly policyId: string }
  | {
      readonly status: 'omitted';
      readonly reason: 'disabled' | 'size-limit' | 'unavailable' | 'invalid-json';
      readonly value?: never;
    };

export type AgentTraceContentField =
  | 'task'
  | 'configuration'
  | 'model.settings'
  | 'model.request'
  | 'model.message'
  | 'tool.input'
  | 'tool.output'
  | 'output';

export interface AgentTraceOptions {
  readonly methodRevision: string;
  readonly model: AgentTraceModel;
  readonly codeRevision?: string;
  readonly case?: AgentTraceRunInput['case'];
  /** Default metadata-only. Eval content may contain sensitive application data. */
  readonly capture?: 'metadata' | 'content';
  readonly maxEvents?: number;
  readonly maxBytes?: number;
  readonly maxContentBytes?: number;
  /** Called once per invocation. Return a unique, non-sensitive ID. */
  readonly createRunId?: () => string;
  /** Never awaited. Receives a detached event; rejected promises are observed. */
  readonly onEvent?: (event: AgentTraceEvent) => void | Promise<void>;
  readonly redaction?: {
    readonly policyId: string;
    /** Synchronous, shape-preserving projection of detached content. */
    readonly redact: <T>(value: T, field: AgentTraceContentField) => T;
  };
}

/** Capture presets only. They do not select a renderer or destination. */
export type AgentTraceProfile = 'off' | 'metadata' | 'evaluation';

/** Named profiles and low-level capture options are mutually exclusive. */
export type AgentTraceConfiguration =
  | (AgentTraceOptions & { readonly profile?: never })
  | { readonly profile: 'off'; readonly capture?: never }
  | (Omit<AgentTraceOptions, 'capture'> & {
      readonly profile: Exclude<AgentTraceProfile, 'off'>;
      readonly capture?: never;
    });

export interface AgentRunTraceSnapshot {
  readonly runId: string;
  readonly events: readonly AgentTraceEvent[];
  readonly completeness: AgentTraceCompleteness;
  readonly deliveryFailures: number;
  /** Counts are independent of retained events. Tool calls count actual dispatches. */
  readonly metrics: {
    readonly modelCalls: number;
    readonly toolCalls: number;
    readonly usage: { readonly inputTokens: number; readonly outputTokens: number } | null;
  };
}

/** Plain JSON arguments only; never SDK objects or opaque continuation state. */
export type AgentTraceToolCall = Omit<ActorAgentToolCall, 'input'> & {
  readonly input: JsonValue;
};

/**
 * Explicit allowlist of normalized model-visible fields. This is not the raw
 * provider response and does not expose hidden reasoning or continuation data.
 */
export type AgentTraceMessage = Pick<
  ActorAgentLlmMessage,
  'role' | 'content' | 'toolCallId' | 'toolName' | 'reasoningSummaries'
> & {
  readonly toolCalls?: readonly AgentTraceToolCall[];
  readonly providerState?: never;
};

/** Snapshot after prompt composition, grant filtering, and example injection. */
export interface AgentTraceModelRequest {
  readonly system?: string;
  readonly messages: readonly AgentTraceMessage[];
  readonly tools: readonly string[];
  readonly toolDefinitions: readonly ModelToolDefinition[];
}

/** Safe, allowlisted provider configuration; never headers or credentials. */
export interface AgentTraceModel {
  readonly provider: string;
  readonly model: string;
  /** Record known effective settings; do not invent unknown provider defaults. */
  readonly settings: AgentTraceCapture<{ [key: string]: JsonValue }>;
}

export type AgentTraceRunInput = {
  readonly purpose: string;
  /** Revision of the prompt/tool/output-contract combination under evaluation. */
  readonly methodRevision: string;
  readonly codeRevision?: string;
  readonly case?: {
    readonly datasetId: string;
    readonly datasetRevision: string;
    readonly caseId: string;
  };
  readonly task: AgentTraceCapture<JsonValue>;
  /** Safe experiment parameters, e.g. toolExampleMode and execution limits. */
  readonly configuration: AgentTraceCapture<{ [key: string]: JsonValue }>;
};

/** A turn is one-based. Each actual provider attempt has a unique modelCallId. */
export type AgentTraceModelCall = {
  readonly turn: number;
  readonly modelCallId: string;
  readonly attempt: number;
};

/** Join by IDs, never tool name; names can repeat within a model response. */
export type AgentTraceToolReference = {
  readonly turn: number;
  readonly modelCallId: string;
  readonly toolCallId: string;
  readonly name: string;
};

/** Stable, sanitized failure codes, not raw errors, stacks, or SDK responses. */
export interface AgentTraceFailure {
  readonly code: string;
}

/**
 * Canonical agent diagnostic facts. Applications retain their own business
 * events and evaluator records; this map does not confer execution authority.
 */
export type AgentTraceEventMap = {
  'run.started': AgentTraceRunInput;
  'model.requested': AgentTraceModelCall & {
    readonly model: AgentTraceModel;
    readonly request: AgentTraceCapture<AgentTraceModelRequest>;
  };
  'model.returned': AgentTraceModelCall & {
    readonly message: AgentTraceCapture<AgentTraceMessage & { readonly role: 'assistant' }>;
    /** Null means no usage was reported; absent individual counts are unknown. */
    readonly usage: ActorAgentTokenUsage | null;
    /** Nonnegative monotonic elapsed milliseconds for this attempt. */
    readonly durationMs: number;
    readonly resolvedModel?: string;
  };
  'model.failed': AgentTraceModelCall & {
    readonly failure: AgentTraceFailure;
    readonly durationMs: number;
  };
  /** Proposed arguments, before application input validation or execution. */
  'tool.requested': AgentTraceToolReference & {
    readonly input: AgentTraceCapture<JsonValue>;
  };
  /** A request refused before handler dispatch; not a failed execution. */
  'tool.rejected': AgentTraceToolReference & {
    readonly failure: AgentTraceFailure;
  };
  /** Successful local handler return, not proof of a durable remote effect. */
  'tool.observed': AgentTraceToolReference & {
    readonly attempt: number;
    /** Validated input actually passed to the handler, which may be transformed. */
    readonly input: AgentTraceCapture<JsonValue>;
    readonly output: AgentTraceCapture<JsonValue>;
    readonly durationMs: number;
  };
  'tool.failed': AgentTraceToolReference & {
    readonly attempt: number;
    readonly failure: AgentTraceFailure;
    readonly durationMs: number;
  };
  /** Local output validation, not workflow acceptance or an eval quality score. */
  'output.validated': {
    readonly modelCallId: string;
    readonly validator: { readonly id: string; readonly revision: string };
  } & (
    | { readonly outcome: 'passed'; readonly output: AgentTraceCapture<JsonValue> }
    | { readonly outcome: 'failed'; readonly failure: AgentTraceFailure }
  );
  /** Raw runner output; completion precedes host validation and does not imply evaluation success. */
  'run.completed': {
    readonly output: AgentTraceCapture<JsonValue>;
  };
  'run.failed': {
    readonly failure: AgentTraceFailure;
  };
  'run.cancelled': {
    readonly code: string;
  };
};

export type AgentTraceEventType = keyof AgentTraceEventMap;

/** Flat discriminated form for producers; envelope payloads omit this type field. */
export type AgentTracePayload = {
  [T in AgentTraceEventType]: { readonly type: T } & AgentTraceEventMap[T];
}[AgentTraceEventType];

/**
 * Persisted schema version 1, using runtime event identity/time/causality.
 * Sequence is one-based and monotonic within one run, not across actors.
 * IDs are host-owned; evidence links reference existing identities, never
 * fabricated receipts. A model/tool fact still has envelope kind "fact".
 */
export type AgentTraceEvent = {
  [T in AgentTraceEventType]: Readonly<
    Omit<ActorEventEnvelope, 'type' | 'payload' | 'kind' | 'schemaVersion'>
  > & {
    readonly kind: 'fact';
    readonly schemaVersion: typeof AGENT_TRACE_SCHEMA_VERSION;
    readonly type: T;
    readonly runId: string;
    readonly sequence: number;
    readonly payload: AgentTraceEventMap[T];
    readonly evidence?: {
      readonly traceId: string;
      readonly sessionId: string;
      readonly commandId: string;
      readonly receiptId?: string;
    };
  };
}[AgentTraceEventType];

/**
 * Missing events are separate from omitted content. Collectors must retain this
 * summary even when their event buffer is full. An incomplete trace is not a
 * successful or failed evaluation by itself.
 */
export type AgentTraceCompleteness =
  | { readonly status: 'complete' }
  | {
      readonly status: 'incomplete';
      readonly reasons: readonly [
        'event-limit' | 'byte-limit' | 'capture-failed' | 'delivery-failed',
        ...('event-limit' | 'byte-limit' | 'capture-failed' | 'delivery-failed')[],
      ];
    };

/** Point-in-time snapshot metadata, not an agent event or a delivery receipt. */
export type AgentTraceRunSummary = Omit<AgentRunTraceSnapshot, 'events'> & {
  readonly type: 'agent.trace.summary';
  readonly schemaVersion: typeof AGENT_TRACE_SCHEMA_VERSION;
};

export type AgentTraceRecord = AgentTraceEvent | AgentTraceRunSummary;

/**
 * Serialize a trusted runner snapshot as JSONL with one trailing summary line.
 * No content is added or removed. The caller owns storage and access control.
 */
export function serializeAgentTraceJsonl(snapshot: AgentRunTraceSnapshot): string {
  const { runId, completeness, deliveryFailures, metrics } = snapshot;
  const summary: AgentTraceRunSummary = {
    type: 'agent.trace.summary',
    schemaVersion: AGENT_TRACE_SCHEMA_VERSION,
    runId,
    completeness,
    deliveryFailures,
    metrics,
  };
  const lines = snapshot.events.map((event) => JSON.stringify(event));
  lines.push(JSON.stringify(summary));
  return `${lines.join('\n')}\n`;
}
