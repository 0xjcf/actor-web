import {
  createAgentExecutionTrace,
  createExecutionCommandAdmissionReceipt,
  createExecutionAuthorizedReceipt,
  createExecutionCancellationReceipt,
  createExecutionEffectIntentReceipt,
  createExecutionReconciliationReceipt,
  createExecutionRejectedReceipt,
  createExecutionRetryReceipt,
  createExecutionStaleProjectionReceipt,
  createExecutionSuccessReceipt,
  createExecutionTimeoutReceipt,
  isAgentExecutionTrace,
  type AgentExecutionAdmissionStage,
  type AgentExecutionTrace,
  type AgentExecutionTraceValidationResult,
  validateAgentExecutionTrace,
} from '@actor-web/runtime';

export const AGENT_EXECUTION_CONFORMANCE_SUPPORTED_VERSIONS = [1] as const;

export type AgentExecutionConformanceFixtureName =
  | 'success'
  | 'schema-rejection'
  | 'domain-rejection'
  | 'authorization-rejection'
  | 'timeout-retry-success'
  | 'duplicate-suppression'
  | 'interrupted'
  | 'stale-projection';

export interface AgentExecutionConformanceFixture {
  readonly name: AgentExecutionConformanceFixtureName;
  readonly packageName: '@actor-web/testing';
  readonly packageVersion: '0.2.0';
  readonly contractVersion: 1;
  readonly maturity: 'candidate';
  readonly supportedVersions: readonly 1[];
  readonly sourceOfTruthOwner: 'Actor-Web';
  readonly joinKeys: readonly [
    'intentId',
    'principalId',
    'traceId',
    'receiptId',
    'recordId',
    'actorId',
    'sessionId',
    'commandId',
    'effectId',
    'effectAttemptId',
    'attempt',
    'sequence',
    'revision',
    'checkpointId',
    'correlationId',
    'causationId',
  ];
  readonly redactionRules: Readonly<{
    readonly secretKeys: readonly string[];
    readonly promptKeys: readonly string[];
  }>;
  readonly unsupportedBehavior: Readonly<{
    readonly unsupportedVersion: 'unsupported_version';
    readonly malformedTrace: 'invalid_receipts';
    readonly invalidTerminalLineage: 'invalid_terminal_lineage';
  }>;
  readonly trace: AgentExecutionTrace;
  readonly expectedStatus: AgentExecutionTrace['status'];
}

const BASE_OCCURRED_AT = '2026-07-28T12:00:00.000Z';
const BASE_ACTOR_ID = 'runtime://agent/session-fixture';
const BASE_SESSION_ID = 'session-fixture';
const BASE_COMMAND_ID = 'command-fixture';
const BASE_CORRELATION_ID = 'corr-fixture';
const BASE_CAUSATION_ID = 'cause-fixture';
const BASE_EFFECT_ID = 'effect-fixture';

const JOIN_KEYS = [
  'intentId',
  'principalId',
  'traceId',
  'receiptId',
  'recordId',
  'actorId',
  'sessionId',
  'commandId',
  'effectId',
  'effectAttemptId',
  'attempt',
  'sequence',
  'revision',
  'checkpointId',
  'correlationId',
  'causationId',
] as const;

const REDACTION_RULES = Object.freeze({
  secretKeys: ['token', 'authorization', 'apiKey', 'api_key', 'secret', 'password', 'credential'],
  promptKeys: ['prompt'],
});

const UNSUPPORTED_BEHAVIOR = Object.freeze({
  unsupportedVersion: 'unsupported_version',
  malformedTrace: 'invalid_receipts',
  invalidTerminalLineage: 'invalid_terminal_lineage',
} as const);

function occurredAt(offsetSeconds: number): string {
  return new Date(Date.parse(BASE_OCCURRED_AT) + offsetSeconds * 1000).toISOString();
}

function createBaseTraceInput(name: AgentExecutionConformanceFixtureName) {
  return {
    version: 1 as const,
    traceId: `fixture:${name}:trace`,
    actorId: BASE_ACTOR_ID,
    sessionId: BASE_SESSION_ID,
    commandId: BASE_COMMAND_ID,
    intentId: `intent:${name}`,
    principalId: 'principal:operator',
    correlationId: BASE_CORRELATION_ID,
    causationId: BASE_CAUSATION_ID,
  };
}

function createCommandAdmissionReceipt(name: AgentExecutionConformanceFixtureName, sequence: number) {
  const trace = createBaseTraceInput(name);
  return createExecutionCommandAdmissionReceipt({
    receiptId: `fixture:${name}:admission:${sequence}`,
    traceId: trace.traceId,
    recordId: `record:${name}:admission:${sequence}`,
    actorId: trace.actorId,
    sessionId: trace.sessionId,
    commandId: trace.commandId,
    intentId: trace.intentId,
    principalId: trace.principalId,
    sequence,
    occurredAt: occurredAt(sequence),
    admissionStage: 'execution-authorized',
    admission: {
      discovery: 'descriptive_only',
      outcome: 'admitted',
      rechecked: ['command', 'payload', 'principal', 'approval', 'revision', 'idempotency', 'policy'],
    },
  });
}

function createAuthorizedReceipt(
  name: AgentExecutionConformanceFixtureName,
  sequence: number,
  effectAttemptId?: string
) {
  const trace = createBaseTraceInput(name);
  return createExecutionAuthorizedReceipt({
    receiptId: `fixture:${name}:authorized:${sequence}`,
    traceId: trace.traceId,
    recordId: `record:${name}:authorized:${sequence}`,
    actorId: trace.actorId,
    sessionId: trace.sessionId,
    commandId: trace.commandId,
    intentId: trace.intentId,
    principalId: trace.principalId,
    sequence,
    occurredAt: occurredAt(sequence),
    ...(effectAttemptId ? { effectId: BASE_EFFECT_ID, effectAttemptId } : {}),
    principal: {
      id: trace.principalId,
      role: 'operator',
    },
    authorization: {
      policy: 'manual-review-required',
      decision: 'approved',
    },
  });
}

function createRejectedFixture(
  name: Extract<
    AgentExecutionConformanceFixtureName,
    'schema-rejection' | 'domain-rejection' | 'authorization-rejection'
  >,
  admissionStage: AgentExecutionAdmissionStage,
  detail: string
): AgentExecutionConformanceFixture {
  const trace = createBaseTraceInput(name);
  const rejectedTrace = createAgentExecutionTrace({
    ...trace,
    receipts: [
      createExecutionRejectedReceipt({
        receiptId: `fixture:${name}:rejected`,
        traceId: trace.traceId,
        recordId: `record:${name}:rejected`,
        actorId: trace.actorId,
        sessionId: trace.sessionId,
        commandId: trace.commandId,
        intentId: trace.intentId,
        principalId: trace.principalId,
        sequence: 10,
        occurredAt: occurredAt(10),
        admissionStage,
        reason: {
          code: admissionStage === 'execution-authorized' ? 'authorization_denied' : 'rejected',
          detail,
        },
      }),
    ],
  });

  return createFixture(name, rejectedTrace);
}

function createFixture(
  name: AgentExecutionConformanceFixtureName,
  trace: AgentExecutionTrace
): AgentExecutionConformanceFixture {
  return Object.freeze({
    name,
    packageName: '@actor-web/testing',
    packageVersion: '0.2.0',
    contractVersion: 1,
    maturity: 'candidate',
    supportedVersions: AGENT_EXECUTION_CONFORMANCE_SUPPORTED_VERSIONS,
    sourceOfTruthOwner: 'Actor-Web',
    joinKeys: JOIN_KEYS,
    redactionRules: REDACTION_RULES,
    unsupportedBehavior: UNSUPPORTED_BEHAVIOR,
    trace,
    expectedStatus: trace.status,
  });
}

function createSuccessFixture(): AgentExecutionConformanceFixture {
  const trace = createBaseTraceInput('success');
  return createFixture(
    'success',
    createAgentExecutionTrace({
      ...trace,
      receipts: [
        createCommandAdmissionReceipt('success', 5),
        createAuthorizedReceipt('success', 10, 'effect-attempt-success-1'),
        createExecutionEffectIntentReceipt({
          receiptId: 'fixture:success:effect-intent',
          traceId: trace.traceId,
          recordId: 'record:success:effect-intent',
          actorId: trace.actorId,
          sessionId: trace.sessionId,
          commandId: trace.commandId,
          intentId: trace.intentId,
          principalId: trace.principalId,
          effectId: BASE_EFFECT_ID,
          attempt: 1,
          sequence: 15,
          occurredAt: occurredAt(15),
          idempotencyKey:
            'agent-execution:key:trace=fixture:success:trace:command=command-fixture:effect=effect-fixture:attempt=effect-attempt-success-1',
          effect: {
            effectType: 'provider_call',
            irreversible: true,
            idempotencyScope: 'command-effect-attempt',
          },
        }),
        createExecutionSuccessReceipt({
          receiptId: 'fixture:success:result',
          traceId: trace.traceId,
          recordId: 'record:success:result',
          actorId: trace.actorId,
          sessionId: trace.sessionId,
          commandId: trace.commandId,
          intentId: trace.intentId,
          principalId: trace.principalId,
          effectId: BASE_EFFECT_ID,
          effectAttemptId: 'effect-attempt-success-1',
          attempt: 1,
          sequence: 20,
          occurredAt: occurredAt(20),
          provider: 'provider-neutral-fixture',
          idempotencyKey:
            'agent-execution:key:trace=fixture:success:trace:command=command-fixture:effect=effect-fixture:attempt=effect-attempt-success-1',
          result: {
            output: {
              text: 'ok',
            },
          },
        }),
      ],
    })
  );
}

function createTimeoutRetrySuccessFixture(): AgentExecutionConformanceFixture {
  const trace = createBaseTraceInput('timeout-retry-success');
  return createFixture(
    'timeout-retry-success',
    createAgentExecutionTrace({
      ...trace,
      receipts: [
        createCommandAdmissionReceipt('timeout-retry-success', 5),
        createAuthorizedReceipt('timeout-retry-success', 10, 'effect-attempt-timeout-1'),
        createExecutionEffectIntentReceipt({
          receiptId: 'fixture:timeout-retry-success:effect-intent',
          traceId: trace.traceId,
          recordId: 'record:timeout-retry-success:effect-intent',
          actorId: trace.actorId,
          sessionId: trace.sessionId,
          commandId: trace.commandId,
          intentId: trace.intentId,
          principalId: trace.principalId,
          effectId: BASE_EFFECT_ID,
          attempt: 1,
          sequence: 15,
          occurredAt: occurredAt(15),
          idempotencyKey:
            'agent-execution:key:trace=fixture:timeout-retry-success:trace:command=command-fixture:effect=effect-fixture:attempt=effect-attempt-timeout-1',
          effect: {
            effectType: 'provider_call',
            irreversible: true,
            idempotencyScope: 'command-effect-attempt',
          },
        }),
        createExecutionTimeoutReceipt({
          receiptId: 'fixture:timeout-retry-success:timeout',
          traceId: trace.traceId,
          recordId: 'record:timeout-retry-success:timeout',
          actorId: trace.actorId,
          sessionId: trace.sessionId,
          commandId: trace.commandId,
          intentId: trace.intentId,
          principalId: trace.principalId,
          effectId: BASE_EFFECT_ID,
          effectAttemptId: 'effect-attempt-timeout-1',
          attempt: 1,
          sequence: 20,
          occurredAt: occurredAt(20),
          provider: 'provider-neutral-fixture',
          timeoutMs: 15_000,
        }),
        createExecutionRetryReceipt({
          receiptId: 'fixture:timeout-retry-success:retry',
          traceId: trace.traceId,
          recordId: 'record:timeout-retry-success:retry',
          actorId: trace.actorId,
          sessionId: trace.sessionId,
          commandId: trace.commandId,
          intentId: trace.intentId,
          principalId: trace.principalId,
          effectId: BASE_EFFECT_ID,
          effectAttemptId: 'effect-attempt-timeout-2',
          attempt: 2,
          sequence: 30,
          occurredAt: occurredAt(30),
          provider: 'provider-neutral-fixture',
          retry: {
            attempt: 2,
            reason: 'timeout',
            policy: 'bounded-exponential-backoff',
          },
        }),
        createExecutionSuccessReceipt({
          receiptId: 'fixture:timeout-retry-success:result',
          traceId: trace.traceId,
          recordId: 'record:timeout-retry-success:result',
          actorId: trace.actorId,
          sessionId: trace.sessionId,
          commandId: trace.commandId,
          intentId: trace.intentId,
          principalId: trace.principalId,
          effectId: BASE_EFFECT_ID,
          effectAttemptId: 'effect-attempt-timeout-2',
          attempt: 2,
          sequence: 40,
          occurredAt: occurredAt(40),
          provider: 'provider-neutral-fixture',
          idempotencyKey:
            'agent-execution:key:trace=fixture:timeout-retry-success:trace:command=command-fixture:effect=effect-fixture:attempt=effect-attempt-timeout-2',
          result: {
            output: {
              text: 'recovered',
            },
          },
        }),
      ],
    })
  );
}

function createDuplicateSuppressionFixture(): AgentExecutionConformanceFixture {
  const trace = createBaseTraceInput('duplicate-suppression');
  return createFixture(
    'duplicate-suppression',
    createAgentExecutionTrace({
      ...trace,
      receipts: [
        createCommandAdmissionReceipt('duplicate-suppression', 5),
        createAuthorizedReceipt('duplicate-suppression', 10, 'effect-attempt-duplicate-1'),
        createExecutionEffectIntentReceipt({
          receiptId: 'fixture:duplicate-suppression:effect-intent',
          traceId: trace.traceId,
          recordId: 'record:duplicate-suppression:effect-intent',
          actorId: trace.actorId,
          sessionId: trace.sessionId,
          commandId: trace.commandId,
          intentId: trace.intentId,
          principalId: trace.principalId,
          effectId: BASE_EFFECT_ID,
          attempt: 1,
          sequence: 15,
          occurredAt: occurredAt(15),
          idempotencyKey:
            'agent-execution:key:trace=fixture:duplicate-suppression:trace:command=command-fixture:effect=effect-fixture:attempt=effect-attempt-duplicate-1',
          effect: {
            effectType: 'provider_call',
            irreversible: true,
            idempotencyScope: 'command-effect-attempt',
          },
        }),
        createExecutionSuccessReceipt({
          receiptId: 'fixture:duplicate-suppression:result',
          traceId: trace.traceId,
          recordId: 'record:duplicate-suppression:result',
          actorId: trace.actorId,
          sessionId: trace.sessionId,
          commandId: trace.commandId,
          intentId: trace.intentId,
          principalId: trace.principalId,
          effectId: BASE_EFFECT_ID,
          effectAttemptId: 'effect-attempt-duplicate-1',
          attempt: 1,
          sequence: 20,
          occurredAt: occurredAt(20),
          provider: 'provider-neutral-fixture',
          idempotencyKey:
            'agent-execution:key:trace=fixture:duplicate-suppression:trace:command=command-fixture:effect=effect-fixture:attempt=effect-attempt-duplicate-1',
          result: {
            output: {
              text: 'first-write-won',
            },
          },
        }),
        createExecutionReconciliationReceipt({
          receiptId: 'fixture:duplicate-suppression:reconciliation',
          traceId: trace.traceId,
          recordId: 'record:duplicate-suppression:reconciliation',
          actorId: trace.actorId,
          sessionId: trace.sessionId,
          commandId: trace.commandId,
          intentId: trace.intentId,
          principalId: trace.principalId,
          effectId: BASE_EFFECT_ID,
          effectAttemptId: 'effect-attempt-duplicate-2',
          attempt: 2,
          sequence: 30,
          occurredAt: occurredAt(30),
          provider: 'provider-neutral-fixture',
          reconciliation: {
            outcome: 'observed_duplicate_outcome',
            source: 'durable_replay',
          },
        }),
      ],
    })
  );
}

function createInterruptedFixture(): AgentExecutionConformanceFixture {
  const trace = createBaseTraceInput('interrupted');
  return createFixture(
    'interrupted',
    createAgentExecutionTrace({
      ...trace,
      receipts: [
        createCommandAdmissionReceipt('interrupted', 5),
        createAuthorizedReceipt('interrupted', 10, 'effect-attempt-cancel-1'),
        createExecutionCancellationReceipt({
          receiptId: 'fixture:interrupted:cancellation',
          traceId: trace.traceId,
          recordId: 'record:interrupted:cancellation',
          actorId: trace.actorId,
          sessionId: trace.sessionId,
          commandId: trace.commandId,
          intentId: trace.intentId,
          principalId: trace.principalId,
          effectId: BASE_EFFECT_ID,
          effectAttemptId: 'effect-attempt-cancel-1',
          attempt: 1,
          sequence: 20,
          occurredAt: occurredAt(20),
          provider: 'provider-neutral-fixture',
          cancellation: {
            reason: 'operator_interrupt',
            requestedBy: 'operator',
          },
        }),
      ],
    })
  );
}

function createStaleProjectionFixture(): AgentExecutionConformanceFixture {
  const trace = createBaseTraceInput('stale-projection');
  return createFixture(
    'stale-projection',
    createAgentExecutionTrace({
      ...trace,
      receipts: [
        createCommandAdmissionReceipt('stale-projection', 5),
        createAuthorizedReceipt('stale-projection', 10, 'effect-attempt-projection-1'),
        createExecutionEffectIntentReceipt({
          receiptId: 'fixture:stale-projection:effect-intent',
          traceId: trace.traceId,
          recordId: 'record:stale-projection:effect-intent',
          actorId: trace.actorId,
          sessionId: trace.sessionId,
          commandId: trace.commandId,
          intentId: trace.intentId,
          principalId: trace.principalId,
          effectId: BASE_EFFECT_ID,
          attempt: 1,
          sequence: 15,
          occurredAt: occurredAt(15),
          idempotencyKey:
            'agent-execution:key:trace=fixture:stale-projection:trace:command=command-fixture:effect=effect-fixture:attempt=effect-attempt-projection-1',
          effect: {
            effectType: 'provider_call',
            irreversible: true,
            idempotencyScope: 'command-effect-attempt',
          },
        }),
        createExecutionSuccessReceipt({
          receiptId: 'fixture:stale-projection:result',
          traceId: trace.traceId,
          recordId: 'record:stale-projection:result',
          actorId: trace.actorId,
          sessionId: trace.sessionId,
          commandId: trace.commandId,
          intentId: trace.intentId,
          principalId: trace.principalId,
          effectId: BASE_EFFECT_ID,
          effectAttemptId: 'effect-attempt-projection-1',
          attempt: 1,
          sequence: 20,
          occurredAt: occurredAt(20),
          provider: 'provider-neutral-fixture',
          result: {
            output: {
              text: 'persisted',
            },
          },
        }),
        createExecutionStaleProjectionReceipt({
          receiptId: 'fixture:stale-projection:projection',
          traceId: trace.traceId,
          recordId: 'record:stale-projection:projection',
          actorId: trace.actorId,
          sessionId: trace.sessionId,
          commandId: trace.commandId,
          intentId: trace.intentId,
          principalId: trace.principalId,
          sequence: 30,
          occurredAt: occurredAt(30),
          checkpointId: 'checkpoint-stale-1',
          revision: 4,
          projection: {
            checkpointId: 'checkpoint-stale-1',
            revision: 4,
            expectedRevision: 5,
          },
        }),
      ],
    })
  );
}

const FIXTURE_MAP: Readonly<Record<AgentExecutionConformanceFixtureName, AgentExecutionConformanceFixture>> =
  Object.freeze({
    success: createSuccessFixture(),
    'schema-rejection': createRejectedFixture(
      'schema-rejection',
      'schema-admitted',
      'Schema validation failed before domain acceptance.'
    ),
    'domain-rejection': createRejectedFixture(
      'domain-rejection',
      'domain-accepted',
      'Behavior and FSM constraints rejected the admitted command.'
    ),
    'authorization-rejection': createRejectedFixture(
      'authorization-rejection',
      'execution-authorized',
      'Execution-time authorization denied the command.'
    ),
    'timeout-retry-success': createTimeoutRetrySuccessFixture(),
    'duplicate-suppression': createDuplicateSuppressionFixture(),
    interrupted: createInterruptedFixture(),
    'stale-projection': createStaleProjectionFixture(),
  });

export function getAgentExecutionConformanceFixture(
  name: AgentExecutionConformanceFixtureName
): AgentExecutionConformanceFixture {
  return FIXTURE_MAP[name];
}

export function listAgentExecutionConformanceFixtures(): readonly AgentExecutionConformanceFixture[] {
  return Object.freeze(Object.values(FIXTURE_MAP));
}

export function assertAgentExecutionConformanceFixture(
  fixture: AgentExecutionConformanceFixture
): AgentExecutionTraceValidationResult {
  if (!isAgentExecutionTrace(fixture.trace)) {
    throw new Error(`Fixture ${fixture.name} does not parse as a valid agent execution trace.`);
  }

  const validation = validateAgentExecutionTrace(fixture.trace);
  if (!validation.ok) {
    throw new Error(
      `Fixture ${fixture.name} failed validation with ${validation.reason} at ${validation.receiptId}.`
    );
  }

  if (fixture.trace.status !== fixture.expectedStatus) {
    throw new Error(
      `Fixture ${fixture.name} expected status ${fixture.expectedStatus} but found ${fixture.trace.status}.`
    );
  }

  if (fixture.trace.traceId.length === 0 || fixture.trace.commandId.length === 0) {
    throw new Error(`Fixture ${fixture.name} is missing stable join keys.`);
  }

  for (const receipt of fixture.trace.receipts) {
    if (receipt.traceId !== fixture.trace.traceId) {
      throw new Error(`Fixture ${fixture.name} has receipt ${receipt.receiptId} on the wrong trace.`);
    }
  }

  const jsonSafeRoundTrip = JSON.parse(JSON.stringify(fixture.trace)) as AgentExecutionTrace;
  if (!isAgentExecutionTrace(jsonSafeRoundTrip)) {
    throw new Error(`Fixture ${fixture.name} is not JSON-safe after round-trip serialization.`);
  }

  return validation;
}
