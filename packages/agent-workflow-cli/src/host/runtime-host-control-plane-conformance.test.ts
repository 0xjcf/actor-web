import {
  actor,
  defineActorWebTopology,
  defineBehavior,
  type Message,
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

function isTraceEvent(event: Message): event is SessionEvent & { type: 'TRACE_UPDATED' } {
  return event.type === 'TRACE_UPDATED';
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

function createDriverRuntime() {
  let host: RuntimeHost | undefined;
  const traceEvents: ExecutableControlPlaneTraceEvent[] = [];
  const decisions: unknown[] = [];
  let checkpoint: SessionRecord | undefined;
  let stopWatch: (() => void) | undefined;

  const attachWatch = (activeHost: RuntimeHost): void => {
    stopWatch?.();
    const watch = activeHost.watch(CONTROL_PLANE_ACTOR_KEY, (event) => {
      if (isTraceEvent(event)) {
        traceEvents.push({
          scenario: event.scenario,
          receiptKind: event.receiptKind,
          commandType: event.commandType,
          sessionId: event.sessionId,
          revision: event.revision,
          detail: event.detail,
        });
      }
    });
    expect(watch.ok).toBe(true);
    if (!watch.ok) {
      throw new Error(watch.error);
    }
    stopWatch = watch.value;
  };

  const createHost = async (): Promise<RuntimeHost> => {
    const started = await createRuntimeHost(buildControlPlaneTopology(), {
      commandAdmission: {
        principal: {
          id: 'principal:control-plane-operator',
          kind: 'authenticated',
          role: 'operator',
        },
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
        onDecision: async (decision) => {
          const messageType =
            typeof (
              decision as {
                readonly message?: { readonly type?: unknown };
              }
            ).message?.type === 'string'
              ? ((
                  decision as {
                    readonly message?: { readonly type?: string };
                  }
                ).message?.type ?? 'unknown')
              : 'unknown';
          const sessionId =
            typeof (
              decision as {
                readonly message?: { readonly sessionId?: unknown };
              }
            ).message?.sessionId === 'string'
              ? ((
                  decision as {
                    readonly message?: { readonly sessionId?: string };
                  }
                ).message?.sessionId ?? 'unknown')
              : 'unknown';

          decisions.push(decision);
          if (!decision.ok) {
            traceEvents.push({
              scenario:
                decision.rejectionReceipt?.reason?.code === 'duplicate_idempotency_key'
                  ? 'duplicate_suppression'
                  : 'rejection',
              receiptKind: 'rejection',
              commandType: messageType,
              sessionId,
              detail: decision.rejectionReceipt?.reason?.detail,
            });
            return;
          }

          traceEvents.push({
            scenario:
              messageType === 'RECONCILE_AGENT_SESSION' ? 'operator_reconciliation' : 'success',
            receiptKind: 'command_admission',
            commandType: messageType,
            sessionId,
          });
          traceEvents.push({
            scenario:
              messageType === 'RECONCILE_AGENT_SESSION' ? 'operator_reconciliation' : 'success',
            receiptKind: 'authorization',
            commandType: messageType,
            sessionId,
          });
        },
      },
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      throw new Error(started.error);
    }
    host = started.value;
    attachWatch(host);
    return host;
  };

  const ensureHost = async (): Promise<RuntimeHost> => host ?? createHost();

  const driver: ExecutableControlPlaneConformanceDriver = {
    describeTarget: () => 'createRuntimeHost(control-plane-session local executable driver)',
    async watchTrace(): Promise<ExecutableControlPlaneConformanceTraceWatch> {
      await ensureHost();
      return {
        traceEvents,
        stop: () => {
          stopWatch?.();
          stopWatch = undefined;
        },
      };
    },
    async rejectUnauthorized(watch) {
      const activeHost = await ensureHost();
      const startIndex = watch.traceEvents.length;
      const rejected = await activeHost.send(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'START_AGENT_SESSION',
          sessionId: 'deny-session-1',
        })
      );
      expect(rejected.ok).toBe(false);
      await waitForTraceEvent(
        watch.traceEvents,
        (event) => event.scenario === 'rejection' && event.receiptKind === 'rejection',
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
      const activeHost = await ensureHost();
      const startIndex = watch.traceEvents.length;
      const sent = await activeHost.send(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'START_AGENT_SESSION',
          sessionId: 'exec-session-1',
        })
      );
      expect(sent.ok).toBe(true);
      await activeHost.flush();
      await waitForTraceEvent(
        watch.traceEvents,
        (event) =>
          event.scenario === 'success' &&
          event.sessionId === 'exec-session-1' &&
          event.receiptKind === 'result',
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
      const activeHost = await ensureHost();
      const startIndex = watch.traceEvents.length;
      const interrupted = await activeHost.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'INTERRUPT_AGENT_SESSION',
          sessionId: 'resume-session-1',
        }),
        2_000
      );
      expect(interrupted.ok).toBe(true);
      await activeHost.flush();
      const exported = await activeHost.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'EXPORT_AGENT_SESSION_CHECKPOINT',
          sessionId: 'resume-session-1',
        }),
        2_000
      );
      expect(exported.ok).toBe(true);
      checkpoint = exported.ok ? (exported.value as SessionRecord) : undefined;
      stopWatch?.();
      stopWatch = undefined;
      await activeHost.stop();
      host = undefined;
      const restarted = await ensureHost();
      expect(checkpoint).toBeDefined();
      const imported = await restarted.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'IMPORT_AGENT_SESSION_CHECKPOINT',
          sessionId: 'resume-session-1',
          checkpoint,
        }),
        2_000
      );
      expect(imported.ok).toBe(true);
      const resumed = await restarted.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'RESUME_AGENT_SESSION',
          sessionId: 'resume-session-1',
        }),
        2_000
      );
      expect(resumed.ok).toBe(true);
      await restarted.flush();
      await waitForTraceEvent(
        watch.traceEvents,
        (event) =>
          event.scenario === 'interruption_resume' &&
          event.sessionId === 'resume-session-1' &&
          event.receiptKind === 'reconciliation',
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
      const activeHost = await ensureHost();
      const startIndex = watch.traceEvents.length;
      const first = await activeHost.send(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'START_AGENT_SESSION',
          sessionId: 'duplicate-session-1',
        }),
        {
          idempotencyKey: 'first-session-start',
        }
      );
      expect(first.ok).toBe(true);
      const duplicate = await activeHost.send(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'START_AGENT_SESSION',
          sessionId: 'duplicate-session-1',
        }),
        {
          idempotencyKey: 'duplicate-session-start',
        }
      );
      expect(duplicate.ok).toBe(false);
      await waitForTraceEvent(
        watch.traceEvents,
        (event) => event.scenario === 'duplicate_suppression' && event.receiptKind === 'rejection',
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
      const activeHost = await ensureHost();
      const startIndex = watch.traceEvents.length;
      const started = await activeHost.send(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'START_AGENT_SESSION',
          sessionId: 'stale-session-1',
        })
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
        2_000
      );
      expect(stale.ok).toBe(true);
      await activeHost.flush();
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
          event.receiptKind === 'stale_projection',
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
      const activeHost = await ensureHost();
      const startIndex = watch.traceEvents.length;
      const reconciled = await activeHost.ask(
        CONTROL_PLANE_ACTOR_KEY,
        JSON.stringify({
          type: 'RECONCILE_AGENT_SESSION',
          sessionId: 'resume-session-1',
          revision: 3,
        }),
        2_000
      );
      expect(reconciled.ok).toBe(true);
      await activeHost.flush();
      await waitForTraceEvent(
        watch.traceEvents,
        (event) =>
          event.scenario === 'operator_reconciliation' &&
          event.sessionId === 'resume-session-1' &&
          event.receiptKind === 'reconciliation',
        'expected operator_reconciliation reconciliation trace event for resume-session-1'
      );
      await waitForTraceEvent(
        watch.traceEvents,
        (event) =>
          event.scenario === 'operator_reconciliation' &&
          event.sessionId === 'resume-session-1' &&
          event.receiptKind === 'result',
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
      stopWatch?.();
      stopWatch = undefined;
      if (host) {
        await host.stop();
        host = undefined;
      }
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
