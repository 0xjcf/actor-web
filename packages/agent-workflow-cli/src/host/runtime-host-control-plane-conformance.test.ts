import {
  actor,
  createInMemoryAgentSessionCheckpointStore,
  defineActorWebTopology,
  defineBehavior,
  node,
} from '@actor-web/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ExecutableControlPlaneConformanceDriver,
  type ExecutableControlPlaneConformanceTraceWatch,
  type ExecutableControlPlaneTraceEvent,
  runExecutableControlPlaneConformance,
} from '../../../actor-core-testing/src/index.js';
import { createRuntimeHost, type RuntimeHost } from './runtime-host';

type SessionStatus = 'idle' | 'running' | 'interrupted' | 'reconciliation_required' | 'reconciled';

type SessionRecord = {
  readonly sessionId: string;
  readonly checkpointId: string | null;
  readonly revision: number;
  readonly projectionRevision: number;
  readonly expectedProjectionRevision: number;
  readonly effectCount: number;
  readonly reconciliationState: 'clear' | 'pending' | 'required';
  readonly status: SessionStatus;
};

type SessionCommand =
  | { readonly type: 'START_AGENT_SESSION'; readonly sessionId: string }
  | { readonly type: 'GET_AGENT_SESSION'; readonly sessionId: string }
  | { readonly type: 'INTERRUPT_AGENT_SESSION'; readonly sessionId: string }
  | { readonly type: 'RESUME_AGENT_SESSION'; readonly sessionId: string }
  | {
      readonly type: 'RECONCILE_AGENT_SESSION';
      readonly sessionId: string;
      readonly revision: number;
    }
  | {
      readonly type: 'SET_PROJECTION_REVISION';
      readonly sessionId: string;
      readonly revision: number;
      readonly expectedRevision: number;
    }
  | {
      readonly type: 'EXPORT_AGENT_SESSION_CHECKPOINT';
      readonly sessionId: string;
    }
  | {
      readonly type: 'IMPORT_AGENT_SESSION_CHECKPOINT';
      readonly sessionId: string;
      readonly checkpoint: SessionRecord;
    };

type SessionEvent =
  | ({
      readonly type: 'TRACE_UPDATED';
    } & ExecutableControlPlaneTraceEvent)
  | {
      readonly type: 'SESSION_UPDATED';
      readonly sessionId: string;
      readonly status: SessionStatus;
      readonly revision: number;
    };

type SessionContext = {
  readonly sessions: Record<string, SessionRecord>;
};

const CONTROL_PLANE_ACTOR_KEY = 'controlPlaneSession';

function createSessionRecord(sessionId: string): SessionRecord {
  return {
    sessionId,
    checkpointId: null,
    revision: 0,
    projectionRevision: 0,
    expectedProjectionRevision: 0,
    effectCount: 0,
    reconciliationState: 'clear',
    status: 'idle',
  };
}

function buildControlPlaneTopology() {
  const behavior = defineBehavior<SessionCommand, SessionEvent>()
    .withContext({
      sessions: {},
    } satisfies SessionContext)
    .onMessage(({ message, context }) => {
      const current = context.sessions[message.sessionId] ?? createSessionRecord(message.sessionId);

      if (message.type === 'GET_AGENT_SESSION') {
        return { reply: current };
      }

      if (message.type === 'START_AGENT_SESSION') {
        const next = {
          ...current,
          revision: current.revision + 1,
          effectCount: current.effectCount + 1,
          status: 'running' as const,
        };
        return {
          context: {
            sessions: {
              ...context.sessions,
              [message.sessionId]: next,
            },
          },
          reply: next,
          emit: [
            {
              type: 'TRACE_UPDATED',
              scenario: 'success',
              receiptKind: 'result',
              commandType: message.type,
              sessionId: message.sessionId,
              revision: next.revision,
            },
            {
              type: 'SESSION_UPDATED',
              sessionId: message.sessionId,
              status: next.status,
              revision: next.revision,
            },
          ],
        };
      }

      if (message.type === 'INTERRUPT_AGENT_SESSION') {
        const next = {
          ...current,
          checkpointId: `checkpoint:${message.sessionId}:${current.revision + 1}`,
          revision: current.revision + 1,
          status: 'interrupted' as const,
          reconciliationState: 'pending' as const,
        };
        return {
          context: {
            sessions: {
              ...context.sessions,
              [message.sessionId]: next,
            },
          },
          reply: next,
          emit: [
            {
              type: 'TRACE_UPDATED',
              scenario: 'interruption_resume',
              receiptKind: 'reconciliation',
              commandType: message.type,
              sessionId: message.sessionId,
              revision: next.revision,
              detail: 'checkpoint_recorded_before_resume',
            },
          ],
        };
      }

      if (message.type === 'RESUME_AGENT_SESSION') {
        const next = {
          ...current,
          status: 'reconciliation_required' as const,
          reconciliationState: 'pending' as const,
        };
        return {
          context: {
            sessions: {
              ...context.sessions,
              [message.sessionId]: next,
            },
          },
          reply: next,
          emit: [
            {
              type: 'TRACE_UPDATED',
              scenario: 'interruption_resume',
              receiptKind: 'reconciliation',
              commandType: message.type,
              sessionId: message.sessionId,
              revision: next.revision,
              detail: 'resume_requires_reconciliation',
            },
          ],
        };
      }

      if (message.type === 'RECONCILE_AGENT_SESSION') {
        const next = {
          ...current,
          revision: Math.max(current.revision, message.revision),
          status: 'reconciled' as const,
          reconciliationState: 'clear' as const,
        };
        return {
          context: {
            sessions: {
              ...context.sessions,
              [message.sessionId]: next,
            },
          },
          reply: next,
          emit: [
            {
              type: 'TRACE_UPDATED',
              scenario: 'operator_reconciliation',
              receiptKind: 'reconciliation',
              commandType: message.type,
              sessionId: message.sessionId,
              revision: next.revision,
            },
            {
              type: 'TRACE_UPDATED',
              scenario: 'operator_reconciliation',
              receiptKind: 'result',
              commandType: message.type,
              sessionId: message.sessionId,
              revision: next.revision,
            },
          ],
        };
      }

      if (message.type === 'SET_PROJECTION_REVISION') {
        const next = {
          ...current,
          projectionRevision: message.revision,
          expectedProjectionRevision: message.expectedRevision,
        };
        return {
          context: {
            sessions: {
              ...context.sessions,
              [message.sessionId]: next,
            },
          },
          reply: {
            session: next,
            stale: message.revision < next.revision || message.expectedRevision !== next.revision,
          },
          emit:
            message.revision < next.revision || message.expectedRevision !== next.revision
              ? [
                  {
                    type: 'TRACE_UPDATED',
                    scenario: 'stale_projection',
                    receiptKind: 'stale_projection',
                    commandType: message.type,
                    sessionId: message.sessionId,
                    revision: next.revision,
                    detail: `projection=${message.revision} expected=${message.expectedRevision}`,
                  },
                ]
              : [],
        };
      }

      if (message.type === 'EXPORT_AGENT_SESSION_CHECKPOINT') {
        return { reply: current };
      }

      const next = message.checkpoint;
      return {
        context: {
          sessions: {
            ...context.sessions,
            [message.sessionId]: next,
          },
        },
        reply: next,
      };
    })
    .build();

  return defineActorWebTopology({
    nodes: {
      local: node('local'),
    },
    actors: {
      controlPlaneSession: actor({
        id: 'control-plane-session',
        node: 'local',
        behavior,
      }),
    },
  });
}

async function readSession(host: RuntimeHost, sessionId: string): Promise<SessionRecord> {
  const result = await host.ask(
    CONTROL_PLANE_ACTOR_KEY,
    JSON.stringify({
      type: 'GET_AGENT_SESSION',
      sessionId,
    }),
    2_000
  );
  if (!result.ok) {
    throw new Error(result.error);
  }
  expect(result.ok).toBe(true);
  return result.value as SessionRecord;
}

async function waitForTraceEvent(
  traceEvents: readonly ExecutableControlPlaneTraceEvent[],
  predicate: (event: ExecutableControlPlaneTraceEvent) => boolean,
  message: string,
  timeoutMs = 500
): Promise<ExecutableControlPlaneTraceEvent> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const matched = traceEvents.find(predicate);
    if (matched) {
      return matched;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

type GatewayTraceReceipt = {
  readonly receiptId?: string;
  readonly receiptKind?: string;
  readonly status?: string;
  readonly reason?: {
    readonly code?: string;
    readonly detail?: string;
  };
  readonly result?: {
    readonly output?: unknown;
  };
};

type GatewayTrace = {
  readonly traceId?: string;
  readonly commandId?: string;
  readonly revision?: number;
  readonly receipts?: readonly GatewayTraceReceipt[];
};

type GatewayTraceProjection = {
  readonly trace?: GatewayTrace | null;
};

type CommandTraceContext = {
  readonly scenario: ExecutableControlPlaneTraceEvent['scenario'];
  readonly commandType: string;
  readonly sessionId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSessionRecord(value: unknown): value is SessionRecord {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.revision === 'number' &&
    typeof value.projectionRevision === 'number' &&
    typeof value.expectedProjectionRevision === 'number' &&
    typeof value.effectCount === 'number' &&
    typeof value.reconciliationState === 'string' &&
    typeof value.status === 'string'
  );
}

function mapGatewayReceiptEvent(
  receipt: GatewayTraceReceipt,
  context: CommandTraceContext,
  trace: GatewayTrace
): ExecutableControlPlaneTraceEvent | null {
  const revision = typeof trace.revision === 'number' ? trace.revision : undefined;

  if (receipt.receiptKind === 'command_admission') {
    return {
      scenario: context.scenario,
      receiptKind: 'command_admission',
      receiptStatus: 'observed',
      commandType: context.commandType,
      sessionId: context.sessionId,
      revision,
      provenance: 'gateway_receipt',
    };
  }

  if (receipt.receiptKind === 'authorization') {
    return {
      scenario: context.scenario,
      receiptKind: 'authorization',
      receiptStatus: 'authorized',
      commandType: context.commandType,
      sessionId: context.sessionId,
      revision,
      provenance: 'gateway_receipt',
    };
  }

  if (receipt.receiptKind === 'result') {
    return {
      scenario: context.scenario,
      receiptKind: 'result',
      receiptStatus: 'succeeded',
      commandType: context.commandType,
      sessionId: context.sessionId,
      revision,
      provenance: 'gateway_receipt',
    };
  }

  if (receipt.receiptKind === 'rejection') {
    return {
      scenario: context.scenario,
      receiptKind: 'rejection',
      receiptStatus: 'rejected',
      commandType: context.commandType,
      sessionId: context.sessionId,
      revision,
      detail: receipt.reason?.detail,
      reasonCode: receipt.reason?.code,
      provenance: 'gateway_receipt',
    };
  }

  if (receipt.receiptKind === 'reconciliation') {
    return {
      scenario: context.scenario,
      receiptKind: 'reconciliation',
      receiptStatus: 'reconciled',
      commandType: context.commandType,
      sessionId: context.sessionId,
      revision,
      provenance: 'gateway_receipt',
    };
  }

  if (receipt.receiptKind === 'projection' && receipt.status === 'stale_projection') {
    return {
      scenario: context.scenario,
      receiptKind: 'projection',
      receiptStatus: 'stale_projection',
      commandType: context.commandType,
      sessionId: context.sessionId,
      revision,
      provenance: 'gateway_receipt',
    };
  }

  return null;
}

function deriveGatewayResultEvidence(
  receipt: GatewayTraceReceipt,
  context: CommandTraceContext
): ExecutableControlPlaneTraceEvent[] {
  const output = receipt.result?.output;

  if (context.scenario === 'interruption_resume' && isSessionRecord(output)) {
    if (output.reconciliationState === 'pending') {
      return [
        {
          scenario: 'interruption_resume',
          receiptKind: 'reconciliation',
          commandType: context.commandType,
          sessionId: context.sessionId,
          revision: output.revision,
          detail: 'resume_requires_reconciliation',
          provenance: 'gateway_result_output',
        },
      ];
    }
    return [];
  }

  if (context.scenario === 'operator_reconciliation' && isSessionRecord(output)) {
    if (output.reconciliationState === 'clear') {
      return [
        {
          scenario: 'operator_reconciliation',
          receiptKind: 'reconciliation',
          commandType: context.commandType,
          sessionId: context.sessionId,
          revision: output.revision,
          detail: 'operator_reconciliation_completed',
          provenance: 'gateway_result_output',
        },
      ];
    }
    return [];
  }

  if (
    context.scenario === 'stale_projection' &&
    isRecord(output) &&
    output.stale === true &&
    isSessionRecord(output.session)
  ) {
    return [
      {
        scenario: 'stale_projection',
        receiptKind: 'projection',
        receiptStatus: 'stale_projection',
        commandType: context.commandType,
        sessionId: context.sessionId,
        revision: output.session.revision,
        detail: `projection=${output.session.projectionRevision} expected=${output.session.expectedProjectionRevision}`,
        provenance: 'gateway_result_output',
      },
    ];
  }

  return [];
}

function createDriverRuntime() {
  const checkpointStore = createInMemoryAgentSessionCheckpointStore();
  let servedHost: RuntimeHost | undefined;
  let remoteHost: RuntimeHost | undefined;
  const traceEvents: ExecutableControlPlaneTraceEvent[] = [];
  const seenEvidenceKeys = new Set<string>();
  const commandContexts = new Map<string, CommandTraceContext>();
  let checkpoint: SessionRecord | undefined;
  let stopTraceWatch: (() => void) | undefined;

  const trackCommand = (commandId: string, context: CommandTraceContext) => {
    commandContexts.set(commandId, context);
    return { commandId };
  };

  const appendProjectionEvidence = (projection: GatewayTraceProjection): void => {
    const trace = projection.trace;
    if (!trace?.commandId) {
      return;
    }
    const context = commandContexts.get(trace.commandId);
    if (!context) {
      return;
    }

    for (const receipt of trace.receipts ?? []) {
      const receiptKey =
        receipt.receiptId ??
        `${trace.traceId ?? trace.commandId}:${receipt.receiptKind ?? 'unknown'}:${receipt.status ?? 'unknown'}`;
      if (seenEvidenceKeys.has(receiptKey)) {
        continue;
      }
      seenEvidenceKeys.add(receiptKey);

      const mapped = mapGatewayReceiptEvent(receipt, context, trace);
      if (mapped) {
        traceEvents.push(mapped);
      }

      if (receipt.receiptKind === 'result') {
        for (const derived of deriveGatewayResultEvidence(receipt, context)) {
          const derivedKey = `${receiptKey}:${derived.receiptKind}:${derived.detail ?? derived.provenance}`;
          if (!seenEvidenceKeys.has(derivedKey)) {
            seenEvidenceKeys.add(derivedKey);
            traceEvents.push(derived);
          }
        }
      }
    }
  };

  const attachRemoteTraceWatch = (activeHost: RuntimeHost): void => {
    stopTraceWatch?.();
    const watch = activeHost.watchTrace(CONTROL_PLANE_ACTOR_KEY, (projection) => {
      appendProjectionEvidence(projection as GatewayTraceProjection);
    });
    expect(watch.ok).toBe(true);
    if (!watch.ok) {
      throw new Error(watch.error);
    }
    stopTraceWatch = watch.value;
  };

  const createServedHost = async (): Promise<RuntimeHost> => {
    const started = await createRuntimeHost(buildControlPlaneTopology(), {
      node: 'local',
      distributed: {
        gateway: {
          expose: [CONTROL_PLANE_ACTOR_KEY],
          auth: {
            verifyToken: ({ token }) => token === 'gateway-secret',
          },
          commandAdmission: {
            resolvePrincipal: () => ({
              id: 'principal:control-plane-operator',
              kind: 'authenticated',
              role: 'operator',
            }),
            policy: async ({ message }) => {
              if (
                message.type === 'START_AGENT_SESSION' &&
                typeof (message as { sessionId?: unknown }).sessionId === 'string' &&
                (message as { sessionId: string }).sessionId.startsWith('deny-')
              ) {
                return {
                  outcome: 'rejected' as const,
                  policy: 'control-plane-default',
                  code: 'authorization_denied',
                  detail: 'operator approval missing',
                };
              }

              return {
                outcome: 'authorized' as const,
                policy: `control-plane:${message.type.toLowerCase()}`,
              };
            },
            idempotency: async ({ metadata }) => {
              if (metadata.idempotencyKey === 'duplicate-session-start') {
                return {
                  outcome: 'duplicate' as const,
                  code: 'duplicate_idempotency_key',
                  detail: 'duplicate session start suppressed',
                };
              }

              return {
                outcome: 'available' as const,
                settle: async () => {},
              };
            },
            onDecision: async () => {},
          },
        },
      },
      checkpoint: {
        store: checkpointStore,
        required: true,
      },
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      throw new Error(started.error);
    }
    servedHost = started.value;
    return servedHost;
  };

  const createRemoteHost = async (): Promise<RuntimeHost> => {
    const served = servedHost ?? (await createServedHost());
    const gatewayUrl = served.getStatus().gatewayUrl;
    if (!gatewayUrl) {
      throw new Error('Expected authenticated control-plane gateway URL.');
    }
    const started = await createRuntimeHost(buildControlPlaneTopology(), {
      remote: {
        gateway: {
          url: gatewayUrl,
          auth: {
            token: 'gateway-secret',
          },
        },
      },
      checkpoint: {
        store: checkpointStore,
        required: true,
      },
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      throw new Error(started.error);
    }
    remoteHost = started.value;
    attachRemoteTraceWatch(remoteHost);
    return remoteHost;
  };

  const ensureRemoteHost = async (): Promise<RuntimeHost> => remoteHost ?? createRemoteHost();

  const driver: ExecutableControlPlaneConformanceDriver = {
    describeTarget: () =>
      'createRuntimeHost(control-plane-session authenticated remote gateway executable driver)',
    async watchTrace(): Promise<ExecutableControlPlaneConformanceTraceWatch> {
      await ensureRemoteHost();
      return {
        traceEvents,
        stop: () => {
          stopTraceWatch?.();
          stopTraceWatch = undefined;
        },
      };
    },
    async rejectUnauthorized(watch) {
      const activeHost = await ensureRemoteHost();
      const startIndex = watch.traceEvents.length;
      const rejected = await activeHost.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'START_AGENT_SESSION',
          sessionId: 'deny-session-1',
        }),
        2_000,
        trackCommand('cmd:reject:deny-session-1', {
          scenario: 'rejection',
          commandType: 'START_AGENT_SESSION',
          sessionId: 'deny-session-1',
        })
      );
      expect(rejected.ok).toBe(false);
      await waitForTraceEvent(
        watch.traceEvents,
        (event) =>
          event.scenario === 'rejection' &&
          event.receiptKind === 'rejection' &&
          event.reasonCode === 'authorization_denied' &&
          event.provenance === 'gateway_receipt',
        'expected rejection trace event'
      );
      const session = await readSession(activeHost, 'deny-session-1');
      return {
        ok: true,
        evidence: {
          traceEvents: watch.traceEvents
            .slice(startIndex)
            .filter((event) => event.scenario === 'rejection' && event.receiptKind === 'rejection'),
          effectCount: session.effectCount,
          authoritativeRevision: session.revision,
          reconciliationState: session.reconciliationState,
        },
      };
    },
    async executeAuthorized(watch) {
      const activeHost = await ensureRemoteHost();
      const startIndex = watch.traceEvents.length;
      const sent = await activeHost.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'START_AGENT_SESSION',
          sessionId: 'exec-session-1',
        }),
        2_000,
        trackCommand('cmd:success:exec-session-1', {
          scenario: 'success',
          commandType: 'START_AGENT_SESSION',
          sessionId: 'exec-session-1',
        })
      );
      expect(sent.ok).toBe(true);
      await waitForTraceEvent(
        watch.traceEvents,
        (event) =>
          event.scenario === 'success' &&
          event.sessionId === 'exec-session-1' &&
          event.receiptKind === 'result' &&
          event.provenance === 'gateway_receipt',
        'expected success result trace event for exec-session-1'
      );
      const session = await readSession(activeHost, 'exec-session-1');
      return {
        ok: true,
        evidence: {
          traceEvents: watch.traceEvents
            .slice(startIndex)
            .filter((event) => event.scenario === 'success'),
          effectCount: session.effectCount,
          authoritativeRevision: session.revision,
          reconciliationState: session.reconciliationState,
        },
      };
    },
    async interruptAndResume(watch) {
      const activeHost = await ensureRemoteHost();
      const startIndex = watch.traceEvents.length;
      const interrupted = await activeHost.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'INTERRUPT_AGENT_SESSION',
          sessionId: 'resume-session-1',
        }),
        2_000,
        {
          commandId: 'cmd:interrupt:resume-session-1',
        }
      );
      expect(interrupted.ok).toBe(true);
      const exported = await activeHost.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'EXPORT_AGENT_SESSION_CHECKPOINT',
          sessionId: 'resume-session-1',
        }),
        2_000,
        {
          commandId: 'cmd:export:resume-session-1',
        }
      );
      expect(exported.ok).toBe(true);
      checkpoint = exported.ok ? (exported.value as SessionRecord) : undefined;
      stopTraceWatch?.();
      stopTraceWatch = undefined;
      await remoteHost?.stop();
      remoteHost = undefined;
      await servedHost?.stop();
      servedHost = undefined;
      const restarted = await ensureRemoteHost();
      expect(checkpoint).toBeDefined();
      const imported = await restarted.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'IMPORT_AGENT_SESSION_CHECKPOINT',
          sessionId: 'resume-session-1',
          checkpoint,
        }),
        2_000,
        {
          commandId: 'cmd:import:resume-session-1',
        }
      );
      expect(imported.ok).toBe(true);
      const resumed = await restarted.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'RESUME_AGENT_SESSION',
          sessionId: 'resume-session-1',
        }),
        2_000,
        trackCommand('cmd:resume:resume-session-1', {
          scenario: 'interruption_resume',
          commandType: 'RESUME_AGENT_SESSION',
          sessionId: 'resume-session-1',
        })
      );
      expect(resumed.ok).toBe(true);
      await waitForTraceEvent(
        watch.traceEvents,
        (event) =>
          event.scenario === 'interruption_resume' &&
          event.sessionId === 'resume-session-1' &&
          event.receiptKind === 'reconciliation' &&
          event.provenance === 'gateway_result_output',
        'expected interruption_resume reconciliation trace event for resume-session-1'
      );
      const session = await readSession(restarted, 'resume-session-1');
      return {
        ok: true,
        evidence: {
          traceEvents: watch.traceEvents
            .slice(startIndex)
            .filter(
              (event) =>
                event.scenario === 'interruption_resume' && event.sessionId === 'resume-session-1'
            ),
          checkpointId: session.checkpointId ?? undefined,
          authoritativeRevision: session.revision,
          effectCount: session.effectCount,
          reconciliationState: session.reconciliationState,
        },
      };
    },
    async suppressDuplicateEffect(watch) {
      const activeHost = await ensureRemoteHost();
      const startIndex = watch.traceEvents.length;
      const first = await activeHost.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'START_AGENT_SESSION',
          sessionId: 'duplicate-session-1',
        }),
        2_000,
        {
          commandId: 'cmd:duplicate:first',
          idempotencyKey: 'first-session-start',
        }
      );
      expect(first.ok).toBe(true);
      const duplicate = await activeHost.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'START_AGENT_SESSION',
          sessionId: 'duplicate-session-1',
        }),
        2_000,
        {
          ...trackCommand('cmd:duplicate:second', {
            scenario: 'duplicate_suppression',
            commandType: 'START_AGENT_SESSION',
            sessionId: 'duplicate-session-1',
          }),
          idempotencyKey: 'duplicate-session-start',
        }
      );
      expect(duplicate.ok).toBe(false);
      await waitForTraceEvent(
        watch.traceEvents,
        (event) =>
          event.scenario === 'duplicate_suppression' &&
          event.receiptKind === 'rejection' &&
          event.reasonCode === 'duplicate_idempotency_key' &&
          event.provenance === 'gateway_receipt',
        'expected duplicate_suppression rejection trace event'
      );
      const session = await readSession(activeHost, 'duplicate-session-1');
      return {
        ok: true,
        evidence: {
          traceEvents: watch.traceEvents
            .slice(startIndex)
            .filter(
              (event) =>
                event.scenario === 'duplicate_suppression' ||
                (event.scenario === 'success' &&
                  event.commandType === 'START_AGENT_SESSION' &&
                  event.sessionId === 'duplicate-session-1')
            ),
          effectCount: session.effectCount,
          authoritativeRevision: session.revision,
          reconciliationState: session.reconciliationState,
        },
      };
    },
    async detectStaleProjection(watch) {
      const activeHost = await ensureRemoteHost();
      const startIndex = watch.traceEvents.length;
      const started = await activeHost.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'START_AGENT_SESSION',
          sessionId: 'stale-session-1',
        }),
        2_000,
        {
          commandId: 'cmd:stale:start',
        }
      );
      expect(started.ok).toBe(true);
      const stale = await activeHost.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'SET_PROJECTION_REVISION',
          sessionId: 'stale-session-1',
          revision: 0,
          expectedRevision: 2,
        }),
        2_000,
        trackCommand('cmd:stale:projection', {
          scenario: 'stale_projection',
          commandType: 'SET_PROJECTION_REVISION',
          sessionId: 'stale-session-1',
        })
      );
      expect(stale.ok).toBe(true);
      const response = stale.ok
        ? (stale.value as {
            session: SessionRecord;
            stale: boolean;
          })
        : undefined;
      expect(response?.stale).toBe(true);
      await waitForTraceEvent(
        watch.traceEvents,
        (event) =>
          event.scenario === 'stale_projection' &&
          event.sessionId === 'stale-session-1' &&
          event.receiptKind === 'projection' &&
          event.receiptStatus === 'stale_projection' &&
          event.provenance === 'gateway_result_output',
        'expected stale_projection trace event for stale-session-1'
      );
      return {
        ok: true,
        evidence: {
          traceEvents: watch.traceEvents
            .slice(startIndex)
            .filter(
              (event) =>
                event.scenario === 'stale_projection' && event.sessionId === 'stale-session-1'
            ),
          authoritativeRevision: response?.session.revision,
          projectedRevision: response?.session.projectionRevision,
          reconciliationState: response?.session.reconciliationState,
        },
      };
    },
    async reconcileSession(watch) {
      const activeHost = await ensureRemoteHost();
      const startIndex = watch.traceEvents.length;
      const reconciled = await activeHost.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'RECONCILE_AGENT_SESSION',
          sessionId: 'resume-session-1',
          revision: 3,
        }),
        2_000,
        trackCommand('cmd:reconcile:resume-session-1', {
          scenario: 'operator_reconciliation',
          commandType: 'RECONCILE_AGENT_SESSION',
          sessionId: 'resume-session-1',
        })
      );
      expect(reconciled.ok).toBe(true);
      await waitForTraceEvent(
        watch.traceEvents,
        (event) =>
          event.scenario === 'operator_reconciliation' &&
          event.sessionId === 'resume-session-1' &&
          event.receiptKind === 'reconciliation' &&
          event.provenance === 'gateway_result_output',
        'expected operator_reconciliation reconciliation trace event for resume-session-1'
      );
      await waitForTraceEvent(
        watch.traceEvents,
        (event) =>
          event.scenario === 'operator_reconciliation' &&
          event.sessionId === 'resume-session-1' &&
          event.receiptKind === 'result' &&
          event.provenance === 'gateway_receipt',
        'expected operator_reconciliation result trace event for resume-session-1'
      );
      const session = await readSession(activeHost, 'resume-session-1');
      return {
        ok: true,
        evidence: {
          traceEvents: watch.traceEvents
            .slice(startIndex)
            .filter((event) => event.scenario === 'operator_reconciliation'),
          authoritativeRevision: session.revision,
          effectCount: session.effectCount,
          reconciliationState: session.reconciliationState,
          checkpointId: session.checkpointId ?? undefined,
        },
      };
    },
  };

  return {
    driver,
    stop: async () => {
      stopTraceWatch?.();
      stopTraceWatch = undefined;
      await remoteHost?.stop();
      remoteHost = undefined;
      await servedHost?.stop();
      servedHost = undefined;
    },
  };
}

describe('runtime host executable control-plane conformance', () => {
  let runtime: ReturnType<typeof createDriverRuntime> | undefined;

  afterEach(async () => {
    await runtime?.stop();
    runtime = undefined;
  });

  it('executes the neutral control-plane scenarios against a real runtime host', async () => {
    runtime = createDriverRuntime();
    const report = await runExecutableControlPlaneConformance(runtime.driver);

    expect(report.ok).toBe(true);
    expect(report.scenarios.success.effectCount).toBe(1);
    expect(report.scenarios.duplicate_suppression.effectCount).toBe(1);
    expect(report.scenarios.operator_reconciliation.reconciliationState).toBe('clear');
  });
});
