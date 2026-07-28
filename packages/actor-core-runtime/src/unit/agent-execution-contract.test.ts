import { describe, expect, it } from 'vitest';
import {
  type AgentExecutionCommandAdmissionReceipt,
  type AgentExecutionEffectAttemptReceipt,
  type AgentExecutionEffectIntentReceipt,
  type AgentExecutionReceipt,
  admitAgentExecutionCommand,
  createAgentExecutionTrace,
  createAgentExecutionTraceIdempotencyKey,
  createExecutionAuthorizedReceipt,
  createExecutionCancellationReceipt,
  createExecutionCommandAdmissionReceipt,
  createExecutionEffectIntentReceipt,
  createExecutionReconciliationReceipt,
  createExecutionRejectedReceipt,
  createExecutionRetryReceipt,
  createExecutionStaleProjectionReceipt,
  createExecutionSuccessReceipt,
  createExecutionTimeoutReceipt,
  isAgentExecutionTrace,
  parseAgentExecutionTrace,
  redactAgentExecutionValue,
  sortAgentExecutionReceipts,
  toAgentExecutionReceiptFromEffectRecord,
  toAgentExecutionReceiptFromEventEnvelope,
  validateAgentExecutionTrace,
} from '../agent-execution-contract.js';
import * as browserEntry from '../browser.js';
import * as rootEntry from '../index.js';
import * as nodeEntry from '../node.js';
import {
  type BrandedStringParseResult,
  createChildProcessHandle,
  createProviderLifecycleAcquisitionKey,
  createProviderLifecycleActivationKey,
  createProviderLifecycleProcessFact,
} from '../node-provider-lifecycle-contract.js';
import {
  createInMemoryNodeProviderLifecycleEffectJournal,
  createNodeProviderLifecycleEffectIdempotencyKey,
  createNodeProviderLifecycleEffectRecord,
  type NodeProviderLifecycleEffectIdempotencyKey,
} from '../node-provider-lifecycle-effect-journal.js';
import { type ActorEventEnvelope, actorMessageToEventEnvelope } from '../runtime-projection.js';
import { Address } from '../utils/factories.js';

function expectValid<TValue extends string>(result: BrandedStringParseResult<TValue>): TValue {
  expect(result.outcome).toBe('valid');
  if (result.outcome !== 'valid') {
    throw new Error(`Expected valid branded string, received ${result.reason}`);
  }
  return result.value;
}

function createLifecycleEffectKey(): NodeProviderLifecycleEffectIdempotencyKey {
  return expectValid(
    createNodeProviderLifecycleEffectIdempotencyKey({
      kind: 'spawn',
      provider: 'mlx_lm.server',
      operationKey: 'boot-001',
      activationKey: expectValid(
        createProviderLifecycleActivationKey('activation:provider-host:001')
      ),
      acquisitionKey: expectValid(
        createProviderLifecycleAcquisitionKey('acquisition:provider-host:001')
      ),
    })
  );
}

function createBaseEnvelope(): ActorEventEnvelope {
  return actorMessageToEventEnvelope(
    {
      type: 'RUN_AGENT_COMMAND',
      model: 'provider-x',
      _timestamp: 101,
      _version: '1',
      _correlationId: 'corr-1',
      _sender: Address.from({ id: 'runtime://agent/session-1' }),
    },
    {
      id: 'record-command-1',
      kind: 'command',
      occurredAt: '2026-07-28T12:00:00.000Z',
      sourceActor: 'runtime://agent/session-1',
      targetActor: 'runtime://provider/provider-x',
      causationId: 'cause-1',
    }
  );
}

function createEffectAttemptReceipt(
  overrides: Partial<AgentExecutionEffectAttemptReceipt> = {}
): AgentExecutionEffectAttemptReceipt {
  return {
    version: 1,
    receiptId: 'receipt-effect-1',
    traceId: 'trace-1',
    recordId: 'record-effect-1',
    actorId: 'runtime://agent/session-1',
    sessionId: 'session-1',
    commandId: 'command-1',
    intentId: 'intent-1',
    principalId: 'user-1',
    effectId: 'effect-1',
    effectAttemptId: 'effect-attempt-1',
    sequence: 40,
    attempt: 1,
    receiptKind: 'effect_attempt',
    status: 'succeeded',
    provider: 'provider-x',
    occurredAt: '2026-07-28T12:00:04.000Z',
    idempotencyKey: 'agent-execution:key:command=command-1:effect=effect-1:attempt=1',
    outcome: {
      code: 'success',
      detail: 'Provider returned a response.',
    },
    ...overrides,
  };
}

function createCommandAdmissionReceipt(
  overrides: Partial<AgentExecutionCommandAdmissionReceipt> = {}
): AgentExecutionCommandAdmissionReceipt {
  return createExecutionCommandAdmissionReceipt({
    receiptId: 'receipt-admission-1',
    traceId: 'trace-1',
    recordId: 'record-admission-1',
    actorId: 'runtime://agent/session-1',
    sessionId: 'session-1',
    commandId: 'command-1',
    intentId: 'intent-1',
    principalId: 'user-1',
    sequence: 15,
    occurredAt: '2026-07-28T12:00:01.500Z',
    admissionStage: 'execution-authorized',
    admission: {
      discovery: 'descriptive_only',
      outcome: 'admitted',
      rechecked: [
        'command',
        'payload',
        'principal',
        'approval',
        'revision',
        'idempotency',
        'policy',
      ],
    },
    ...overrides,
  });
}

function createEffectIntentReceipt(
  overrides: Partial<AgentExecutionEffectIntentReceipt> = {}
): AgentExecutionEffectIntentReceipt {
  return createExecutionEffectIntentReceipt({
    receiptId: 'receipt-effect-intent-1',
    traceId: 'trace-1',
    recordId: 'record-effect-intent-1',
    actorId: 'runtime://agent/session-1',
    sessionId: 'session-1',
    commandId: 'command-1',
    intentId: 'intent-1',
    principalId: 'user-1',
    effectId: 'effect-1',
    sequence: 35,
    attempt: 1,
    occurredAt: '2026-07-28T12:00:03.500Z',
    idempotencyKey:
      'agent-execution:key:trace=trace-1:command=command-1:effect=effect-1:attempt=effect-attempt-1',
    effect: {
      effectType: 'provider_call',
      irreversible: true,
      idempotencyScope: 'command-effect-attempt',
    },
    ...overrides,
  });
}

describe('agent execution contract', () => {
  it('exports the contract helpers from browser, node, and root entrypoints', () => {
    expect(typeof rootEntry.createAgentExecutionTrace).toBe('function');
    expect(typeof browserEntry.createAgentExecutionTrace).toBe('function');
    expect(typeof nodeEntry.createAgentExecutionTrace).toBe('function');
    expect(typeof rootEntry.toAgentExecutionReceiptFromEffectRecord).toBe('function');
    expect(typeof browserEntry.toAgentExecutionReceiptFromEffectRecord).toBe('function');
    expect(typeof nodeEntry.toAgentExecutionReceiptFromEffectRecord).toBe('function');
  });

  it('creates a versioned trace with ordered provider-neutral receipts', () => {
    const trace = createAgentExecutionTrace({
      version: 1,
      traceId: 'trace-1',
      actorId: 'runtime://agent/session-1',
      sessionId: 'session-1',
      commandId: 'command-1',
      intentId: 'intent-1',
      principalId: 'user-1',
      correlationId: 'corr-1',
      causationId: 'cause-1',
      receipts: [
        createCommandAdmissionReceipt(),
        createExecutionAuthorizedReceipt({
          receiptId: 'receipt-authorized-1',
          traceId: 'trace-1',
          recordId: 'record-authorized-1',
          actorId: 'runtime://agent/session-1',
          sessionId: 'session-1',
          commandId: 'command-1',
          intentId: 'intent-1',
          sequence: 30,
          occurredAt: '2026-07-28T12:00:03.000Z',
          principal: { id: 'user-1', role: 'operator' },
          authorization: { policy: 'allow-listed', decision: 'approved' },
        }),
        createEffectIntentReceipt(),
        createExecutionSuccessReceipt({
          receiptId: 'receipt-success-1',
          traceId: 'trace-1',
          recordId: 'record-success-1',
          actorId: 'runtime://agent/session-1',
          sessionId: 'session-1',
          commandId: 'command-1',
          intentId: 'intent-1',
          principalId: 'user-1',
          effectId: 'effect-1',
          effectAttemptId: 'effect-attempt-1',
          attempt: 1,
          sequence: 50,
          occurredAt: '2026-07-28T12:00:05.000Z',
          result: { output: { text: 'approved' } },
        }),
      ],
    });

    expect(trace.receipts.map((receipt) => receipt.sequence)).toEqual([15, 30, 35, 50]);
    expect(trace.status).toBe('succeeded');
    expect(trace.lastReceipt?.receiptId).toBe('receipt-success-1');
    expect(trace.schemaVersion).toBe(1);
    expect(trace.intentId).toBe('intent-1');
    expect(trace.principalId).toBe('user-1');
    expect(isAgentExecutionTrace(trace)).toBe(true);
    expect(validateAgentExecutionTrace(trace)).toEqual({ ok: true });
  });

  it('rejects terminal lineage when any rejection stage is followed by a success receipt', () => {
    for (const [admissionStage, receiptId] of [
      ['schema-admitted', 'receipt-schema-success-1'],
      ['domain-accepted', 'receipt-domain-success-1'],
      ['execution-authorized', 'receipt-auth-success-1'],
    ] as const) {
      const trace = createAgentExecutionTrace({
        version: 1,
        traceId: `trace-${admissionStage}`,
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        receipts: [
          createExecutionRejectedReceipt({
            receiptId: `receipt-${admissionStage}-1`,
            traceId: `trace-${admissionStage}`,
            recordId: `record-${admissionStage}-1`,
            actorId: 'runtime://agent/session-1',
            sessionId: 'session-1',
            commandId: 'command-1',
            sequence: 10,
            occurredAt: '2026-07-28T12:00:01.000Z',
            admissionStage,
            reason: { code: 'rejected', detail: `Rejected at ${admissionStage}.` },
          }),
          createExecutionSuccessReceipt({
            receiptId,
            traceId: `trace-${admissionStage}`,
            recordId: `record-${admissionStage}-success-1`,
            actorId: 'runtime://agent/session-1',
            sessionId: 'session-1',
            commandId: 'command-1',
            sequence: 20,
            occurredAt: '2026-07-28T12:00:02.000Z',
            result: { output: { text: 'should not happen' } },
          }),
        ],
      });

      expect(validateAgentExecutionTrace(trace)).toEqual({
        ok: false,
        reason: 'invalid_terminal_lineage',
        receiptId,
      });
      expect(parseAgentExecutionTrace(trace)).toEqual({
        ok: false,
        reason: 'invalid_terminal_lineage',
        value: trace,
        receiptId,
      });
      expect(isAgentExecutionTrace(trace)).toBe(false);
    }
  });

  it('distinguishes schema, domain, and execution authorization rejection receipts', () => {
    const receipts: readonly AgentExecutionReceipt[] = [
      createExecutionRejectedReceipt({
        receiptId: 'receipt-schema-1',
        traceId: 'trace-1',
        recordId: 'record-schema-1',
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        sequence: 10,
        occurredAt: '2026-07-28T12:00:01.000Z',
        admissionStage: 'schema-admitted',
        reason: { code: 'schema_invalid', detail: 'payload.shape' },
      }),
      createExecutionRejectedReceipt({
        receiptId: 'receipt-domain-1',
        traceId: 'trace-1',
        recordId: 'record-domain-1',
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        sequence: 20,
        occurredAt: '2026-07-28T12:00:02.000Z',
        admissionStage: 'domain-accepted',
        reason: { code: 'domain_rejected', detail: 'state.transition.denied' },
      }),
      createExecutionRejectedReceipt({
        receiptId: 'receipt-auth-1',
        traceId: 'trace-1',
        recordId: 'record-auth-1',
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        sequence: 30,
        occurredAt: '2026-07-28T12:00:03.000Z',
        admissionStage: 'execution-authorized',
        reason: { code: 'authorization_denied', detail: 'approval missing' },
      }),
    ];

    expect(receipts.map((receipt) => receipt.admissionStage)).toEqual([
      'schema-admitted',
      'domain-accepted',
      'execution-authorized',
    ]);
  });

  it('captures timeout, retry, cancellation, and partial failure receipts as durable facts', () => {
    const timeoutReceipt = createExecutionTimeoutReceipt({
      receiptId: 'receipt-timeout-1',
      traceId: 'trace-1',
      recordId: 'record-timeout-1',
      actorId: 'runtime://agent/session-1',
      sessionId: 'session-1',
      commandId: 'command-1',
      effectId: 'effect-1',
      effectAttemptId: 'effect-attempt-1',
      sequence: 40,
      occurredAt: '2026-07-28T12:00:04.000Z',
      provider: 'provider-x',
      timeoutMs: 15_000,
    });
    const retryReceipt = createExecutionRetryReceipt({
      receiptId: 'receipt-retry-1',
      traceId: 'trace-1',
      recordId: 'record-retry-1',
      actorId: 'runtime://agent/session-1',
      sessionId: 'session-1',
      commandId: 'command-1',
      effectId: 'effect-1',
      effectAttemptId: 'effect-attempt-2',
      sequence: 50,
      occurredAt: '2026-07-28T12:00:05.000Z',
      provider: 'provider-x',
      retry: { attempt: 2, reason: 'timeout', policy: 'bounded-exponential-backoff' },
    });
    const cancellationReceipt = createExecutionCancellationReceipt({
      receiptId: 'receipt-cancel-1',
      traceId: 'trace-1',
      recordId: 'record-cancel-1',
      actorId: 'runtime://agent/session-1',
      sessionId: 'session-1',
      commandId: 'command-1',
      effectId: 'effect-1',
      effectAttemptId: 'effect-attempt-2',
      sequence: 60,
      occurredAt: '2026-07-28T12:00:06.000Z',
      provider: 'provider-x',
      cancellation: { reason: 'operator_interrupt', requestedBy: 'operator' },
    });
    const partialFailureReceipt = createEffectAttemptReceipt({
      receiptId: 'receipt-partial-1',
      status: 'partial_failure',
      outcome: {
        code: 'partial_failure',
        detail: 'Tool call succeeded but persistence write failed.',
      },
      provider: 'provider-x',
    });

    expect(timeoutReceipt.status).toBe('timeout');
    expect(retryReceipt.retry?.attempt).toBe(2);
    expect(cancellationReceipt.cancellation?.reason).toBe('operator_interrupt');
    expect(partialFailureReceipt.status).toBe('partial_failure');
  });

  it('uses canonical idempotency keys to suppress duplicate execution and enable replay', async () => {
    const journal = createInMemoryNodeProviderLifecycleEffectJournal();
    const lifecycleKey = createLifecycleEffectKey();
    const handle = expectValid(createChildProcessHandle('child:provider-host:001'));
    const activationKey = expectValid(
      createProviderLifecycleActivationKey('activation:provider-host:001')
    );
    const acquisitionKey = expectValid(
      createProviderLifecycleAcquisitionKey('acquisition:provider-host:001')
    );

    expect(
      createAgentExecutionTraceIdempotencyKey({
        traceId: 'trace-1',
        commandId: 'command-1',
        effectId: 'effect-1',
        effectAttemptId: 'effect-attempt-1',
      })
    ).toEqual({
      outcome: 'valid',
      value:
        'agent-execution:key:trace=trace-1:command=command-1:effect=effect-1:attempt=effect-attempt-1',
    });

    expect(journal.claim({ idempotencyKey: lifecycleKey, kind: 'spawn' })).toEqual({
      outcome: 'claimed',
      idempotencyKey: lifecycleKey,
      kind: 'spawn',
    });

    const record = createNodeProviderLifecycleEffectRecord({
      idempotencyKey: lifecycleKey,
      kind: 'spawn',
      recordedAt: '2026-07-28T12:00:04.000Z',
      result: {
        outcome: 'spawned',
        process: createProviderLifecycleProcessFact({
          handle,
          activationKey,
          acquisitionKey,
          provider: 'provider-x',
          pid: 4242,
          processGroup: 'isolated',
          startedAt: '2026-07-28T12:00:03.000Z',
        }),
      },
    });

    expect(journal.record(record)).toEqual({ outcome: 'recorded', record });
    const receipt = toAgentExecutionReceiptFromEffectRecord(record, {
      traceId: 'trace-1',
      actorId: 'runtime://agent/session-1',
      sessionId: 'session-1',
      commandId: 'command-1',
      effectId: 'effect-1',
      effectAttemptId: 'effect-attempt-1',
      sequence: 70,
      receiptId: 'receipt-effect-1',
      recordId: 'record-effect-1',
    });

    expect(receipt.receiptKind).toBe('effect_attempt');
    expect(receipt.status).toBe('succeeded');
    expect(journal.replay({ idempotencyKey: lifecycleKey, kind: 'spawn' })).toEqual({
      outcome: 'recorded',
      record,
    });
  });

  it('records reconciliation and stale projection receipts without claiming exactly-once execution', () => {
    const reconciliationReceipt = createExecutionReconciliationReceipt({
      receiptId: 'receipt-reconcile-1',
      traceId: 'trace-1',
      recordId: 'record-reconcile-1',
      actorId: 'runtime://agent/session-1',
      sessionId: 'session-1',
      commandId: 'command-1',
      effectId: 'effect-1',
      effectAttemptId: 'effect-attempt-1',
      sequence: 80,
      occurredAt: '2026-07-28T12:00:08.000Z',
      provider: 'provider-x',
      reconciliation: { outcome: 'observed_duplicate_outcome', source: 'durable_replay' },
    });
    const staleProjectionReceipt = createExecutionStaleProjectionReceipt({
      receiptId: 'receipt-stale-1',
      traceId: 'trace-1',
      recordId: 'record-stale-1',
      actorId: 'runtime://agent/session-1',
      sessionId: 'session-1',
      commandId: 'command-1',
      sequence: 90,
      occurredAt: '2026-07-28T12:00:09.000Z',
      projection: { checkpointId: 'checkpoint-1', revision: 3, expectedRevision: 4 },
    });

    const trace = createAgentExecutionTrace({
      version: 1,
      traceId: 'trace-reconciled-1',
      actorId: 'runtime://agent/session-1',
      sessionId: 'session-1',
      commandId: 'command-1',
      receipts: [
        createExecutionSuccessReceipt({
          receiptId: 'receipt-success-1',
          traceId: 'trace-reconciled-1',
          recordId: 'record-success-1',
          actorId: 'runtime://agent/session-1',
          sessionId: 'session-1',
          commandId: 'command-1',
          sequence: 70,
          occurredAt: '2026-07-28T12:00:07.000Z',
          result: { output: { text: 'done' } },
        }),
        reconciliationReceipt,
      ],
    });

    expect(reconciliationReceipt.reconciliation?.outcome).toBe('observed_duplicate_outcome');
    expect(trace.status).toBe('reconciled');
    expect(staleProjectionReceipt.status).toBe('stale_projection');
  });

  it('rejects malformed traces and unsupported versions', () => {
    expect(
      parseAgentExecutionTrace({
        schemaVersion: 2,
        traceId: 'trace-1',
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        receipts: [],
      })
    ).toEqual({
      ok: false,
      reason: 'unsupported_version',
      value: 2,
    });

    expect(
      parseAgentExecutionTrace({
        schemaVersion: 1,
        traceId: '',
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        receipts: [],
      })
    ).toEqual({
      ok: false,
      reason: 'invalid_trace_id',
      value: '',
    });

    const malformedInputs = [
      {
        schemaVersion: 1,
        traceId: 'trace-1',
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        receipts: [{}],
      },
      {
        schemaVersion: 1,
        traceId: 'trace-1',
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        receipts: [
          {
            receiptId: 'receipt-1',
            recordId: 'record-1',
            traceId: 'trace-1',
            actorId: 'runtime://agent/session-1',
            sessionId: 'session-1',
            commandId: 'command-1',
            receiptKind: 'unknown',
            status: 'observed',
            sequence: 1,
            occurredAt: '2026-07-28T12:00:01.000Z',
          },
        ],
      },
      {
        schemaVersion: 1,
        traceId: 'trace-1',
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        receipts: [
          {
            receiptId: 'receipt-1',
            recordId: 'record-1',
            traceId: 'trace-1',
            actorId: 'runtime://agent/session-1',
            sessionId: 'session-1',
            commandId: 'command-1',
            receiptKind: 'event',
            status: 'authorized',
            sequence: 1,
            occurredAt: '2026-07-28T12:00:01.000Z',
            event: { kind: 'command', type: 'RUN', payload: {} },
          },
        ],
      },
      {
        schemaVersion: 1,
        traceId: 'trace-1',
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        receipts: [
          {
            receiptId: '',
            recordId: 'record-1',
            traceId: 'trace-1',
            actorId: 'runtime://agent/session-1',
            sessionId: 'session-1',
            commandId: 'command-1',
            receiptKind: 'event',
            status: 'observed',
            sequence: 1,
            occurredAt: '2026-07-28T12:00:01.000Z',
            event: { kind: 'command', type: 'RUN', payload: {} },
          },
        ],
      },
      {
        schemaVersion: 1,
        traceId: 'trace-1',
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        receipts: [
          {
            receiptId: 'receipt-1',
            recordId: 'record-1',
            traceId: 'trace-2',
            actorId: 'runtime://agent/session-1',
            sessionId: 'session-1',
            commandId: 'command-1',
            receiptKind: 'event',
            status: 'observed',
            sequence: 1,
            occurredAt: '2026-07-28T12:00:01.000Z',
            event: { kind: 'command', type: 'RUN', payload: {} },
          },
        ],
      },
      {
        schemaVersion: 1,
        traceId: 'trace-1',
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        receipts: [
          {
            receiptId: 'receipt-1',
            recordId: 'record-1',
            traceId: 'trace-1',
            actorId: 'runtime://agent/session-1',
            sessionId: 'session-1',
            commandId: 'command-1',
            receiptKind: 'event',
            status: 'observed',
            sequence: Number.NaN,
            occurredAt: 'invalid-date',
            event: { kind: 'command', type: 'RUN', payload: {} },
          },
        ],
      },
      {
        schemaVersion: 1,
        traceId: 'trace-1',
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        receipts: [
          {
            receiptId: 'receipt-1',
            recordId: 'record-1',
            traceId: 'trace-1',
            actorId: 'runtime://agent/session-1',
            sessionId: 'session-1',
            commandId: 'command-1',
            receiptKind: 'event',
            status: 'observed',
            sequence: 1,
            occurredAt: '2026-07-28T12:00:01.000Z',
            event: { kind: 'command', type: 'RUN', payload: { when: new Date() } },
          },
        ],
      },
    ];

    for (const malformed of malformedInputs) {
      expect(() => parseAgentExecutionTrace(malformed)).not.toThrow();
      expect(parseAgentExecutionTrace(malformed)).toMatchObject({
        ok: false,
        reason: 'invalid_receipts',
      });
    }
  });

  it('redacts sensitive principal and tool payload fields while preserving join keys', () => {
    const redacted = redactAgentExecutionValue({
      principal: {
        id: 'user-1',
        role: 'operator',
        token: 'secret-token',
        authorization: 'Bearer secret-value',
      },
      tool: {
        id: 'tool-1',
        prompt: 'summarize private notes',
        args: {
          apiKey: 'top-secret',
          correlationId: 'corr-1',
        },
      },
    });

    expect(redacted).toEqual({
      principal: {
        id: 'user-1',
        role: 'operator',
        token: '[redacted:secret]',
        authorization: '[redacted:secret]',
      },
      tool: {
        id: 'tool-1',
        prompt: '[redacted:prompt]',
        args: {
          apiKey: '[redacted:secret]',
          correlationId: 'corr-1',
        },
      },
    });
  });

  it('derives a provider-neutral receipt from actor envelopes', () => {
    const receipt = toAgentExecutionReceiptFromEventEnvelope(createBaseEnvelope(), {
      traceId: 'trace-1',
      actorId: 'runtime://agent/session-1',
      sessionId: 'session-1',
      commandId: 'command-1',
      sequence: 5,
    });

    expect(receipt).toMatchObject({
      version: 1,
      receiptKind: 'event',
      traceId: 'trace-1',
      recordId: 'record-command-1',
      correlationId: 'corr-1',
      causationId: 'cause-1',
      sequence: 5,
      event: {
        kind: 'command',
        type: 'RUN_AGENT_COMMAND',
      },
    });
  });

  it('orders receipts deterministically by sequence and timestamp', () => {
    const receipts = sortAgentExecutionReceipts([
      createExecutionSuccessReceipt({
        receiptId: 'receipt-b',
        traceId: 'trace-1',
        recordId: 'record-b',
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        sequence: 20,
        occurredAt: '2026-07-28T12:00:03.000Z',
        result: { output: { text: 'later' } },
      }),
      createExecutionSuccessReceipt({
        receiptId: 'receipt-a',
        traceId: 'trace-1',
        recordId: 'record-a',
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        sequence: 20,
        occurredAt: '2026-07-28T12:00:02.000Z',
        result: { output: { text: 'earlier' } },
      }),
      createExecutionSuccessReceipt({
        receiptId: 'receipt-c',
        traceId: 'trace-1',
        recordId: 'record-c',
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        commandId: 'command-1',
        sequence: 10,
        occurredAt: '2026-07-28T12:00:01.000Z',
        result: { output: { text: 'first' } },
      }),
    ]);

    expect(receipts.map((receipt) => receipt.receiptId)).toEqual([
      'receipt-c',
      'receipt-a',
      'receipt-b',
    ]);
  });

  it('rejects malformed public admission inputs without throwing', async () => {
    await expect(
      admitAgentExecutionCommand({
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        kind: 'send',
        message: { type: 'RUN' },
        principal: 'not-a-principal' as unknown as never,
        metadata: null as unknown as never,
        now: () => new Date('2026-07-28T12:00:00.000Z'),
      })
    ).resolves.toMatchObject({
      ok: false,
      rejectionReceipt: {
        reason: {
          code: 'invalid_command_metadata',
          detail: 'metadata must be a JSON object when provided.',
        },
      },
    });

    await expect(
      admitAgentExecutionCommand({
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        kind: 'send',
        message: {
          type: 'RUN',
          fn: (() => 'unsafe') as unknown as never,
        },
        principal: {
          id: 'principal-1',
          kind: 'authenticated',
        },
        now: () => new Date('2026-07-28T12:00:00.000Z'),
      })
    ).resolves.toMatchObject({
      ok: false,
      rejectionReceipt: {
        reason: {
          code: 'invalid_command_metadata',
          detail: 'message must be JSON-safe.',
        },
      },
    });
  });

  it('rejects present-but-empty idempotency metadata and does not call the claim port after policy denial', async () => {
    const claimPort = vi.fn(async () => ({ outcome: 'available' as const }));

    const invalid = await admitAgentExecutionCommand({
      actorId: 'runtime://agent/session-1',
      sessionId: 'session-1',
      kind: 'send',
      message: { type: 'RUN' },
      principal: {
        id: 'principal-1',
        kind: 'authenticated',
      },
      metadata: {
        commandId: 'cmd-empty-idempotency',
        idempotencyKey: '',
      },
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });

    expect(invalid).toMatchObject({
      ok: false,
      rejectionReceipt: {
        reason: {
          code: 'invalid_command_metadata',
          detail: 'idempotencyKey must be a non-empty string when provided.',
        },
      },
    });

    const denied = await admitAgentExecutionCommand({
      actorId: 'runtime://agent/session-1',
      sessionId: 'session-1',
      kind: 'send',
      message: { type: 'RUN' },
      principal: {
        id: 'principal-1',
        kind: 'authenticated',
      },
      metadata: {
        commandId: 'cmd-policy-denied',
        idempotencyKey: 'idem-1',
      },
      policy: async () => ({
        outcome: 'rejected',
        policy: 'explicit-human-review',
        code: 'policy_denied',
      }),
      requireExplicitPolicy: true,
      idempotency: claimPort,
      now: () => new Date('2026-07-28T12:00:01.000Z'),
    });

    expect(denied).toMatchObject({
      ok: false,
      rejectionReceipt: {
        reason: {
          code: 'policy_denied',
        },
      },
    });
    expect(claimPort).not.toHaveBeenCalled();
  });

  it('fails closed when idempotency metadata is supplied without an idempotency adapter', async () => {
    const decision = await admitAgentExecutionCommand({
      actorId: 'runtime://agent/session-1',
      sessionId: 'session-1',
      kind: 'send',
      message: { type: 'RUN' },
      principal: {
        id: 'principal-1',
        kind: 'authenticated',
      },
      metadata: {
        commandId: 'cmd-missing-idem-adapter',
        idempotencyKey: 'idem-1',
      },
      policy: async () => ({
        outcome: 'authorized',
        policy: 'explicit-human-review',
      }),
      requireExplicitPolicy: true,
      now: () => new Date('2026-07-28T12:00:02.000Z'),
    });

    expect(decision).toMatchObject({
      ok: false,
      rejectionReceipt: {
        reason: {
          code: 'missing_idempotency_adapter',
          detail:
            'commandAdmission metadata.idempotencyKey requires an explicit idempotency adapter.',
        },
      },
    });
  });

  it('rejects raw invalid metadata fields without throwing', async () => {
    await expect(
      admitAgentExecutionCommand({
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        kind: 'send',
        message: { type: 'RUN' },
        principal: {
          id: 'principal-1',
          kind: 'authenticated',
        },
        metadata: {
          commandId: 42 as unknown as never,
        },
        now: () => new Date('2026-07-28T12:00:03.000Z'),
      })
    ).resolves.toMatchObject({
      ok: false,
      rejectionReceipt: {
        reason: {
          code: 'invalid_command_metadata',
          detail: 'commandId must be a non-empty string when provided.',
        },
      },
    });

    await expect(
      admitAgentExecutionCommand({
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        kind: 'send',
        message: { type: 'RUN' },
        principal: {
          id: 'principal-1',
          kind: 'authenticated',
        },
        metadata: {
          commandId: 'cmd-bad-idem',
          idempotencyKey: 42 as unknown as never,
        },
        now: () => new Date('2026-07-28T12:00:04.000Z'),
      })
    ).resolves.toMatchObject({
      ok: false,
      rejectionReceipt: {
        reason: {
          code: 'invalid_command_metadata',
          detail: 'idempotencyKey must be a non-empty string when provided.',
        },
      },
    });

    await expect(
      admitAgentExecutionCommand({
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        kind: 'send',
        message: { type: 'RUN' },
        principal: {
          id: 'principal-1',
          kind: 'authenticated',
        },
        metadata: {
          commandId: 'cmd-bad-approval-array',
          approval: ['nope'] as unknown as never,
        },
        now: () => new Date('2026-07-28T12:00:05.000Z'),
      })
    ).resolves.toMatchObject({
      ok: false,
      rejectionReceipt: {
        reason: {
          code: 'invalid_command_metadata',
          detail: 'approval must be a JSON-safe object when provided.',
        },
      },
    });

    await expect(
      admitAgentExecutionCommand({
        actorId: 'runtime://agent/session-1',
        sessionId: 'session-1',
        kind: 'send',
        message: { type: 'RUN' },
        principal: {
          id: 'principal-1',
          kind: 'authenticated',
        },
        metadata: {
          commandId: 'cmd-bad-approval-function',
          approval: {
            state: 'granted',
            verifier: (() => 'unsafe') as unknown as never,
          },
        },
        now: () => new Date('2026-07-28T12:00:06.000Z'),
      })
    ).resolves.toMatchObject({
      ok: false,
      rejectionReceipt: {
        reason: {
          code: 'invalid_command_metadata',
          detail: 'approval must be a JSON-safe object when provided.',
        },
      },
    });
  });

  it('rejects credential-bearing principals without leaking secrets into the decision surface', async () => {
    const tokenDecision = await admitAgentExecutionCommand({
      actorId: 'runtime://agent/session-1',
      sessionId: 'session-1',
      kind: 'send',
      message: { type: 'RUN' },
      principal: {
        id: 'principal-1',
        kind: 'authenticated',
        token: 'secret-token',
      } as AgentExecutionCommandPrincipal,
      now: () => new Date('2026-07-28T12:00:07.000Z'),
    });

    expect(tokenDecision).toMatchObject({
      ok: false,
      rejectionReceipt: {
        reason: {
          code: 'credential_bearing_principal',
          detail: 'principal.token is secret-bearing. Supply a credential-free principal.',
        },
      },
    });
    expect(JSON.stringify(tokenDecision)).not.toContain('secret-token');

    const authorizationDecision = await admitAgentExecutionCommand({
      actorId: 'runtime://agent/session-1',
      sessionId: 'session-1',
      kind: 'send',
      message: { type: 'RUN' },
      principal: {
        id: 'principal-2',
        kind: 'authenticated',
        Authorization: 'Bearer secret-value',
      } as AgentExecutionCommandPrincipal,
      now: () => new Date('2026-07-28T12:00:08.000Z'),
    });

    expect(authorizationDecision).toMatchObject({
      ok: false,
      rejectionReceipt: {
        reason: {
          code: 'credential_bearing_principal',
          detail: 'principal.Authorization is secret-bearing. Supply a credential-free principal.',
        },
      },
    });
    expect(JSON.stringify(authorizationDecision)).not.toContain('secret-value');

    const apiKeyDecision = await admitAgentExecutionCommand({
      actorId: 'runtime://agent/session-1',
      sessionId: 'session-1',
      kind: 'send',
      message: { type: 'RUN' },
      principal: {
        id: 'principal-3',
        kind: 'authenticated',
        claims: {
          ApiKey: 'key-123',
        },
      } as AgentExecutionCommandPrincipal,
      now: () => new Date('2026-07-28T12:00:09.000Z'),
    });

    expect(apiKeyDecision).toMatchObject({
      ok: false,
      rejectionReceipt: {
        reason: {
          code: 'credential_bearing_principal',
          detail: 'principal.claims.ApiKey is secret-bearing. Supply a credential-free principal.',
        },
      },
    });
    expect(JSON.stringify(apiKeyDecision)).not.toContain('key-123');
  });
});
