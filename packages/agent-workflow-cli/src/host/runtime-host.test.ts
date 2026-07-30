/**
 * Tests for the v0 in-process runtime host.
 *
 * Host behavior is exercised through the programmatic API with topology values
 * built inline (same pattern as the runtime's own topology tests). Module
 * loading is exercised against dependency-free fixtures in os.tmpdir(), and
 * spawn-from-file against a fixture under the package's node_modules so the
 * bare `@actor-web/runtime` specifier resolves from the fixture's location.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  type ActorMessage,
  type AgentExecutionIdempotencySettlementOutcome,
  actor,
  defineActorWebTopology,
  defineBehavior,
  enableDevModeForCLI,
  node,
  resetDevMode,
} from '@actor-web/runtime';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadModuleExport } from './load-module';
import {
  createRuntimeHost,
  executeCommand,
  type RuntimeHost,
  splitExecScript,
} from './runtime-host';

type CounterMsg = { type: 'INCREMENT' } | { type: 'GET_COUNT' };

function buildCounterTopology() {
  const counter = defineBehavior<CounterMsg>()
    .withContext({ count: 0 })
    .onMessage(({ message, context }) => {
      if (message.type === 'INCREMENT') {
        const count = context.count + 1;
        return { context: { count }, emit: [{ type: 'COUNT_CHANGED', count }] };
      }
      if (message.type === 'GET_COUNT') {
        return { reply: { count: context.count } };
      }
      return {};
    })
    .build();

  return defineActorWebTopology({
    nodes: { local: node('local') },
    actors: { counter: actor({ id: 'counter', node: 'local', behavior: counter }) },
  });
}

function buildDistributedCounterTopology() {
  const counter = defineBehavior<CounterMsg>()
    .withContext({ count: 0 })
    .onMessage(({ message, context }) => {
      if (message.type === 'INCREMENT') {
        const count = context.count + 1;
        return { context: { count }, emit: [{ type: 'COUNT_CHANGED', count }] };
      }
      if (message.type === 'GET_COUNT') {
        return { reply: { count: context.count } };
      }
      return {};
    })
    .build();

  return defineActorWebTopology({
    nodes: {
      server: node('server-node'),
      worker: node('worker-node'),
    },
    actors: {
      serverCounter: actor({ id: 'server-counter', node: 'server', behavior: counter }),
      workerCounter: actor({ id: 'worker-counter', node: 'worker', behavior: counter }),
    },
  });
}

type AgentPackage = {
  readonly ACTOR_WEB_LLM_TOOL_NAME: 'llm';
  createAgentLoopBehavior(options?: { readonly system?: string }): unknown;
};

async function loadAgentPackage(): Promise<AgentPackage | null> {
  try {
    return (await import('@actor-web/agent')) as AgentPackage;
  } catch {
    return null;
  }
}

function buildAgentLoopTopology(input: {
  readonly agentPackage: AgentPackage;
  readonly grantLlm: boolean;
}) {
  return defineActorWebTopology({
    nodes: { local: node('local') },
    actors: {
      agent: actor({
        id: 'agent',
        node: 'local',
        behavior: input.agentPackage.createAgentLoopBehavior({
          system: 'You are a runtime-hosted agent.',
        }),
        tools: input.grantLlm ? [input.agentPackage.ACTOR_WEB_LLM_TOOL_NAME] : [],
      }),
    },
  });
}

async function waitFor<T>(
  read: () => T | undefined | Promise<T | undefined>,
  message: string,
  timeoutMs = 2_000
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await read();
    if (value !== undefined) {
      return value;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error(message);
}

// ============================================================================
// MODULE LOADING ADAPTER
// ============================================================================

describe('loadModuleExport', () => {
  let fixtureDir: string;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'actor-web-cli-load-'));
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it('loads a default export', async () => {
    const file = join(fixtureDir, 'default-export.mjs');
    await writeFile(file, 'export default { hello: 1 };\n');

    const result = await loadModuleExport(file);
    expect(result).toEqual({ ok: true, value: { hello: 1 } });
  });

  it('falls back to a sole named export', async () => {
    const file = join(fixtureDir, 'sole-named.mjs');
    await writeFile(file, 'export const topology = { sole: true };\n');

    const result = await loadModuleExport(file);
    expect(result).toEqual({ ok: true, value: { sole: true } });
  });

  it('selects a named export when requested', async () => {
    const file = join(fixtureDir, 'named.mjs');
    await writeFile(file, 'export const a = 1;\nexport const b = 2;\n');

    const result = await loadModuleExport(file, { exportName: 'b' });
    expect(result).toEqual({ ok: true, value: 2 });
  });

  it('reports a missing file as a fact', async () => {
    const result = await loadModuleExport(join(fixtureDir, 'does-not-exist.mjs'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Module not found');
    }
  });

  it('reports a missing named export with the available exports', async () => {
    const file = join(fixtureDir, 'missing-named.mjs');
    await writeFile(file, 'export const a = 1;\n');

    const result = await loadModuleExport(file, { exportName: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('"nope" not found');
      expect(result.error).toContain('a');
    }
  });

  it('reports a broken module as a fact instead of throwing', async () => {
    const file = join(fixtureDir, 'broken.mjs');
    await writeFile(file, 'export default {;\n');

    const result = await loadModuleExport(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Failed to load');
    }
  });

  it('reports ambiguous exports (no default, several named) as a fact', async () => {
    const file = join(fixtureDir, 'ambiguous.mjs');
    await writeFile(file, 'export const a = 1;\nexport const b = 2;\n');

    const result = await loadModuleExport(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('multiple named exports');
    }
  });
});

// ============================================================================
// RUNTIME HOST
// ============================================================================

describe('createRuntimeHost', () => {
  let host: RuntimeHost;

  beforeEach(async () => {
    const started = await createRuntimeHost(buildCounterTopology());
    expect(started.ok).toBe(true);
    if (started.ok) {
      host = started.value;
    }
  });

  afterEach(async () => {
    await host.stop();
  });

  it('lists topology actors with origin and address', async () => {
    const actors = await host.listActors();
    expect(actors).toHaveLength(1);
    expect(actors[0].key).toBe('counter');
    expect(actors[0].origin).toBe('topology');
    expect(actors[0].path).toContain('counter');
  });

  it('sends a message and observes the effect via ask', async () => {
    const sent = await host.send('counter', '{"type":"INCREMENT"}');
    expect(sent.ok).toBe(true);

    const reply = await host.ask('counter', '{"type":"GET_COUNT"}', 2000);
    expect(reply).toEqual({ ok: true, value: { count: 1 } });
  });

  it('surfaces distributed transport membership separately from directory readiness facts', async () => {
    await host.stop();
    const topology = buildDistributedCounterTopology();
    const workerStarted = await createRuntimeHost(topology, {
      node: 'worker',
      distributed: {
        transport: true,
      },
    });
    expect(workerStarted.ok).toBe(true);
    if (!workerStarted.ok) {
      return;
    }

    const serverStarted = await createRuntimeHost(topology, {
      node: 'server',
      distributed: {
        transport: true,
        peers: {
          worker: workerStarted.value.getStatus().transportUrl ?? '',
        },
        connect: ['worker'],
      },
    });
    expect(serverStarted.ok).toBe(true);
    if (!serverStarted.ok) {
      await workerStarted.value.stop();
      return;
    }

    try {
      const status = await waitFor(async () => {
        const next = serverStarted.value.getStatus();
        const peer = next.transport?.peers.find((entry) => entry.nodeAddress === 'worker-node');
        const readiness = next.cluster?.directoryReadiness?.find(
          (entry) => entry.nodeAddress === 'worker-node'
        );
        return peer?.connected && readiness?.status === 'ready' ? next : undefined;
      }, 'Expected distributed host status to report connected transport and ready directory');

      expect(status.mode).toBe('distributed');
      expect(status.gatewayUrl).toBeNull();
      expect(status.transportUrl).toMatch(/^ws:\/\/127\.0\.0\.1:/);
      expect(status.transport).toMatchObject({
        connectedNodes: ['worker-node'],
      });
      expect(status.cluster?.directoryReadiness).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            nodeAddress: 'worker-node',
            status: 'ready',
          }),
        ])
      );
    } finally {
      await serverStarted.value.stop();
      await workerStarted.value.stop();
    }
  });

  it('routes distributed send and ask to remote actor addresses after peer readiness', async () => {
    await host.stop();
    const topology = buildDistributedCounterTopology();
    const workerStarted = await createRuntimeHost(topology, {
      node: 'worker',
      distributed: {
        transport: true,
      },
    });
    expect(workerStarted.ok).toBe(true);
    if (!workerStarted.ok) {
      return;
    }

    const serverStarted = await createRuntimeHost(topology, {
      node: 'server',
      distributed: {
        transport: true,
        peers: {
          worker: workerStarted.value.getStatus().transportUrl ?? '',
        },
        connect: ['worker'],
      },
    });
    expect(serverStarted.ok).toBe(true);
    if (!serverStarted.ok) {
      await workerStarted.value.stop();
      return;
    }

    try {
      await waitFor(
        () =>
          serverStarted.value.getStatus().cluster?.directoryReadiness?.[0]?.status === 'ready'
            ? true
            : undefined,
        'Expected remote directory readiness before cross-node send'
      );

      const sent = await serverStarted.value.send(
        'actor://worker-node/worker-counter',
        '{"type":"INCREMENT"}'
      );
      const reply = await serverStarted.value.ask(
        'actor://worker-node/worker-counter',
        '{"type":"GET_COUNT"}',
        2_000
      );

      expect(sent).toEqual({
        ok: true,
        value: 'Sent INCREMENT to actor://worker-node/worker-counter',
      });
      expect(reply).toEqual({ ok: true, value: { count: 1 } });
    } finally {
      await serverStarted.value.stop();
      await workerStarted.value.stop();
    }
  });

  it('fails closed when distributed exposure leaves localhost without an explicit unsafe override', async () => {
    await host.stop();
    const started = await createRuntimeHost(buildDistributedCounterTopology(), {
      node: 'server',
      distributed: {
        gateway: {
          host: '0.0.0.0',
        },
      },
    });

    expect(started).toEqual({
      ok: false,
      error:
        'Distributed host rejected: unsafe_exposure_requires_override (gateway host "0.0.0.0" is not loopback-safe. Pass allowUnsafeExposure to bind outside localhost.)',
    });
  });

  it('routes local send and ask through the shared admission seam with an explicit system principal', async () => {
    const decisions: unknown[] = [];
    await host.stop();
    const started = await createRuntimeHost(buildCounterTopology(), {
      commandAdmission: {
        principal: {
          id: 'principal:cli-system',
          kind: 'system',
          role: 'operator',
        },
        policy: async ({ principal }) => ({
          outcome: 'authorized',
          policy: `${principal.kind}-default-allow`,
        }),
        onDecision: (decision) => {
          decisions.push(decision);
        },
      },
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    host = started.value;

    const sent = await host.send('counter', '{"type":"INCREMENT"}');
    expect(sent.ok).toBe(true);

    const reply = await host.ask('counter', '{"type":"GET_COUNT"}', 2000);
    expect(reply).toEqual({ ok: true, value: { count: 1 } });
    expect(decisions).toContainEqual(
      expect.objectContaining({
        admissionReceipt: expect.objectContaining({
          actorId: 'actor://local/counter',
        }),
        principal: expect.objectContaining({
          id: 'principal:cli-system',
          kind: 'system',
          role: 'operator',
        }),
        authorizationReceipt: expect.objectContaining({
          authorization: expect.objectContaining({
            policy: 'system-default-allow',
            decision: 'approved',
          }),
        }),
      })
    );
  });

  it('fails closed when local command admission omits the explicit principal or durable decision sink', async () => {
    await host.stop();
    const missingPrincipal = await createRuntimeHost(buildCounterTopology(), {
      commandAdmission: {
        policy: async () => ({
          outcome: 'authorized',
          policy: 'cli-policy-v3',
        }),
        onDecision: async () => {},
      } as unknown as import('./runtime-host').RuntimeHostCommandAdmissionOptions,
    });
    expect(missingPrincipal.ok).toBe(true);
    if (!missingPrincipal.ok) {
      return;
    }
    host = missingPrincipal.value;

    const principalRejected = await host.send('counter', '{"type":"INCREMENT"}');
    expect(principalRejected).toEqual({
      ok: false,
      error: 'Send rejected: missing_principal (commandAdmission requires an explicit principal.)',
    });

    await host.stop();
    const missingSink = await createRuntimeHost(buildCounterTopology(), {
      commandAdmission: {
        principal: {
          id: 'principal:cli-system',
          kind: 'system',
        },
        policy: async () => ({
          outcome: 'authorized',
          policy: 'cli-policy-v3',
        }),
      } as unknown as import('./runtime-host').RuntimeHostCommandAdmissionOptions,
    });
    expect(missingSink.ok).toBe(true);
    if (!missingSink.ok) {
      return;
    }
    host = missingSink.value;

    const sinkRejected = await host.ask('counter', '{"type":"GET_COUNT"}', 2000);
    expect(sinkRejected).toEqual({
      ok: false,
      error:
        'Ask rejected: missing_decision_sink (commandAdmission requires an explicit durable decision sink.)',
    });
  });

  it('rejects credential-bearing local principals before dispatch and never leaks them into callback facts', async () => {
    const decisions: unknown[] = [];
    await host.stop();
    const started = await createRuntimeHost(buildCounterTopology(), {
      commandAdmission: {
        principal: {
          id: 'principal:cli-system',
          kind: 'system',
          token: 'cli-secret-token',
          claims: {
            apiKey: 'cli-api-key',
          },
        } as AgentExecutionCommandPrincipal,
        policy: async () => ({
          outcome: 'authorized',
          policy: 'system-default-allow',
        }),
        onDecision: (decision) => {
          decisions.push(decision);
        },
      },
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    host = started.value;

    const rejected = await host.send('counter', '{"type":"INCREMENT"}');
    const reply = await host.ask('counter', '{"type":"GET_COUNT"}', 2000);

    expect(rejected).toEqual({
      ok: false,
      error:
        'Send rejected: credential_bearing_principal (principal.token is secret-bearing. Supply a credential-free principal.)',
    });
    expect(reply).toEqual({
      ok: false,
      error:
        'Ask rejected: credential_bearing_principal (principal.token is secret-bearing. Supply a credential-free principal.)',
    });
    expect(JSON.stringify(decisions)).not.toContain('cli-secret-token');
    expect(JSON.stringify(decisions)).not.toContain('cli-api-key');
  });

  it('fails closed when the local admission policy denies or throws', async () => {
    await host.stop();
    const started = await createRuntimeHost(buildCounterTopology(), {
      commandAdmission: {
        principal: {
          id: 'principal:cli-system',
          kind: 'system',
        },
        policy: async ({ message }) => {
          if (message.type === 'GET_COUNT') {
            throw new Error('policy offline');
          }
          return {
            outcome: 'rejected',
            policy: 'cli-policy-v1',
            code: 'authorization_denied',
            detail: 'manual approval missing',
          };
        },
        onDecision: async () => {},
      },
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    host = started.value;

    const denied = await host.send('counter', '{"type":"INCREMENT"}');
    expect(denied).toEqual({
      ok: false,
      error: 'Send rejected: authorization_denied (manual approval missing)',
    });

    const failedClosed = await host.ask('counter', '{"type":"GET_COUNT"}', 2000);
    expect(failedClosed).toEqual({
      ok: false,
      error:
        'Ask rejected: policy_adapter_failure (Policy adapter threw before returning a decision.)',
    });
  });

  it('preserves legacy local send or ask behavior when command admission is not configured', async () => {
    const sent = await host.send('counter', '{"type":"INCREMENT"}');
    expect(sent.ok).toBe(true);

    const reply = await host.ask('counter', '{"type":"GET_COUNT"}', 2000);
    expect(reply).toEqual({ ok: true, value: { count: 1 } });
  });

  it('fails closed when local command admission is configured without a policy adapter', async () => {
    await host.stop();
    const started = await createRuntimeHost(buildCounterTopology(), {
      commandAdmission: {
        principal: {
          id: 'principal:cli-system',
          kind: 'system',
        },
        onDecision: async () => {},
      } as unknown as import('./runtime-host').RuntimeHostCommandAdmissionOptions,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    host = started.value;

    const rejected = await host.send('counter', '{"type":"INCREMENT"}');
    expect(rejected).toEqual({
      ok: false,
      error:
        'Send rejected: missing_policy_adapter (commandAdmission requires an explicit policy adapter.)',
    });
  });

  it('rejects duplicate idempotency claims before local send or ask dispatch and fails closed on claim errors', async () => {
    await host.stop();
    const decisions: unknown[] = [];
    const settlements: AgentExecutionIdempotencySettlementOutcome[] = [];
    const started = await createRuntimeHost(buildCounterTopology(), {
      commandAdmission: {
        principal: {
          id: 'principal:cli-system',
          kind: 'system',
        },
        policy: async () => ({
          outcome: 'authorized',
          policy: 'cli-policy-v2',
        }),
        idempotency: async ({ metadata, kind }) => {
          if (metadata.idempotencyKey === 'idem-duplicate') {
            return {
              outcome: 'duplicate',
              code: kind === 'ask' ? 'duplicate_idempotency_key' : undefined,
              detail: 'duplicate command already observed',
            };
          }
          if (metadata.idempotencyKey === 'idem-claim-error') {
            throw new Error('claim store offline');
          }
          return {
            outcome: 'available',
            settle: async (outcome) => {
              settlements.push(outcome);
            },
          };
        },
        onDecision: (decision) => {
          decisions.push(decision);
        },
      },
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    host = started.value;

    const duplicateSend = await host.send('counter', '{"type":"INCREMENT"}', {
      idempotencyKey: 'idem-duplicate',
    });
    const duplicateAsk = await host.ask('counter', '{"type":"GET_COUNT"}', 2000, {
      idempotencyKey: 'idem-duplicate',
    });
    const claimFailure = await host.send('counter', '{"type":"INCREMENT"}', {
      idempotencyKey: 'idem-claim-error',
    });
    const laterCount = await host.ask('counter', '{"type":"GET_COUNT"}', 2000);

    expect(duplicateSend).toEqual({
      ok: false,
      error: 'Send rejected: duplicate_idempotency_key (duplicate command already observed)',
    });
    expect(duplicateAsk).toEqual({
      ok: false,
      error: 'Ask rejected: duplicate_idempotency_key (duplicate command already observed)',
    });
    expect(claimFailure).toEqual({
      ok: false,
      error:
        'Send rejected: idempotency_adapter_failure (Idempotency adapter threw before returning a claim result.)',
    });
    expect(laterCount).toEqual({ ok: true, value: { count: 0 } });
    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rejectionReceipt: expect.objectContaining({
            reason: expect.objectContaining({
              code: 'duplicate_idempotency_key',
            }),
          }),
        }),
        expect.objectContaining({
          rejectionReceipt: expect.objectContaining({
            reason: expect.objectContaining({
              code: 'idempotency_adapter_failure',
            }),
          }),
        }),
      ])
    );
  });

  it('settles local idempotency claims before or after dispatch based on sink and dispatch outcomes', async () => {
    await host.stop();
    enableDevModeForCLI();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sinkBlock = vi.fn(async () => {
      throw new Error('sink offline');
    });
    const sinkSettlements: AgentExecutionIdempotencySettlementOutcome[] = [];
    const sinkBlocked = await createRuntimeHost(buildCounterTopology(), {
      commandAdmission: {
        principal: {
          id: 'principal:cli-system',
          kind: 'system',
        },
        policy: async () => ({
          outcome: 'authorized',
          policy: 'cli-policy-v4',
        }),
        idempotency: async () => ({
          outcome: 'available',
          settle: async (outcome) => {
            sinkSettlements.push(outcome);
          },
        }),
        onDecision: sinkBlock,
      },
    });
    expect(sinkBlocked.ok).toBe(true);
    if (!sinkBlocked.ok) {
      return;
    }
    host = sinkBlocked.value;

    const sinkFailure = await host.send('counter', '{"type":"INCREMENT"}');
    const countAfterSinkFailure = await host.ask('counter', '{"type":"GET_COUNT"}', 2000);

    expect(sinkFailure).toEqual({
      ok: false,
      error:
        'Send rejected: decision_sink_failure (Decision sink threw before recording the admission decision.)',
    });
    expect(countAfterSinkFailure).toEqual({
      ok: false,
      error:
        'Ask rejected: decision_sink_failure (Decision sink threw before recording the admission decision.)',
    });
    expect(sinkSettlements).toContain('not_dispatched');
    expect(JSON.stringify(sinkFailure)).not.toContain('sink offline');
    expect(JSON.stringify(countAfterSinkFailure)).not.toContain('sink offline');
    expect(consoleError).toHaveBeenCalledWith(
      '❌ [ACTOR_WEB_CLI_HOST] Decision sink failure',
      expect.objectContaining({
        operation: 'send',
        failure: 'decision_sink_failure',
        errorClass: 'error_instance',
      })
    );
    expect(consoleError).toHaveBeenCalledWith(
      '❌ [ACTOR_WEB_CLI_HOST] Decision sink failure',
      expect.objectContaining({
        operation: 'ask',
        failure: 'decision_sink_failure',
        errorClass: 'error_instance',
      })
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('sink offline');
    consoleError.mockRestore();
    resetDevMode();

    await host.stop();
    const throwingBehavior = defineBehavior<CounterMsg>()
      .withContext({ count: 0 })
      .onMessage(({ message, context }) => {
        if (message.type === 'INCREMENT') {
          throw new Error('dispatch exploded');
        }
        if (message.type === 'GET_COUNT') {
          return { reply: { count: context.count } };
        }
        return {};
      })
      .build();
    const dispatchSettlements: AgentExecutionIdempotencySettlementOutcome[] = [];
    const dispatchBlocked = await createRuntimeHost(
      defineActorWebTopology({
        nodes: { local: node('local') },
        actors: { counter: actor({ id: 'counter', node: 'local', behavior: throwingBehavior }) },
      }),
      {
        commandAdmission: {
          principal: {
            id: 'principal:cli-system',
            kind: 'system',
          },
          policy: async () => ({
            outcome: 'authorized',
            policy: 'cli-policy-v4',
          }),
          idempotency: async () => ({
            outcome: 'available',
            settle: async (outcome) => {
              dispatchSettlements.push(outcome);
            },
          }),
          onDecision: async () => {},
        },
      }
    );
    expect(dispatchBlocked.ok).toBe(true);
    if (!dispatchBlocked.ok) {
      return;
    }
    host = dispatchBlocked.value;

    const dispatchFailure = await host.send('counter', '{"type":"INCREMENT"}');

    expect(dispatchFailure).toEqual({
      ok: false,
      error: 'Send failed: dispatch exploded',
    });
    expect(dispatchSettlements).toContain('dispatch_indeterminate');

    await host.stop();
    const postDispatchSettlements: AgentExecutionIdempotencySettlementOutcome[] = [];
    let dispatchCount = 0;
    const postDispatchBlocked = await createRuntimeHost(buildCounterTopology(), {
      commandAdmission: {
        principal: {
          id: 'principal:cli-system',
          kind: 'system',
        },
        policy: async () => ({
          outcome: 'authorized',
          policy: 'cli-policy-v4',
        }),
        idempotency: async () => ({
          outcome: 'available',
          settle: async (outcome) => {
            postDispatchSettlements.push(outcome);
            if (outcome === 'dispatch_succeeded') {
              throw new Error('settlement secret settlement-token-123');
            }
          },
        }),
        onDecision: async () => {},
      },
    });
    expect(postDispatchBlocked.ok).toBe(true);
    if (!postDispatchBlocked.ok) {
      return;
    }
    host = postDispatchBlocked.value;

    const dispatched = await host.send('counter', '{"type":"INCREMENT"}');
    const counterRef = host.resolve('counter');
    const counterSnapshot = counterRef?.getSnapshot() as
      | { context?: { count?: number } }
      | undefined;

    expect(dispatched).toEqual({
      ok: false,
      error: 'Send failed: Dispatch outcome could not be recorded after execution.',
    });
    dispatchCount = counterSnapshot?.context?.count ?? -1;
    expect(dispatchCount).toBe(1);
    expect(postDispatchSettlements).toEqual(['dispatch_succeeded']);
    expect(JSON.stringify(dispatched)).not.toContain('settlement-token-123');
  });

  it('rejects malformed local admission metadata without dispatching or throwing', async () => {
    await host.stop();
    const started = await createRuntimeHost(buildCounterTopology(), {
      commandAdmission: {
        principal: {
          id: 'principal:cli-system',
          kind: 'system',
        },
        policy: async () => ({
          outcome: 'authorized',
          policy: 'cli-policy-v2',
        }),
        onDecision: async () => {},
      },
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    host = started.value;

    const invalid = await host.send('counter', '{"type":"INCREMENT"}', { revision: -1 });
    const count = await host.ask('counter', '{"type":"GET_COUNT"}', 2000);

    expect(invalid).toEqual({
      ok: false,
      error: 'Send rejected: invalid_command_metadata (revision must be a non-negative integer.)',
    });
    expect(count).toEqual({ ok: true, value: { count: 0 } });
  });

  it('preserves payload fields that overlap with admission vocabulary', async () => {
    const observed: Array<ActorMessage & Message> = [];
    await host.stop();
    const overlapBehavior = defineBehavior<CounterMsg | (ActorMessage & Message)>()
      .withContext({ count: 0 })
      .onMessage(({ message, context }) => {
        observed.push(message);
        if (message.type === 'INCREMENT') {
          const count = context.count + 1;
          return { context: { count }, emit: [{ type: 'COUNT_CHANGED', count }] };
        }
        if (message.type === 'GET_COUNT') {
          return { reply: { count: context.count } };
        }
        return { context };
      })
      .build();
    const started = await createRuntimeHost(
      defineActorWebTopology({
        nodes: { local: node('local') },
        actors: { counter: actor({ id: 'counter', node: 'local', behavior: overlapBehavior }) },
      }),
      {
        commandAdmission: {
          principal: {
            id: 'principal:cli-system',
            kind: 'system',
          },
          policy: async () => ({
            outcome: 'authorized',
            policy: 'cli-policy-v2',
          }),
          onDecision: async () => {},
        },
      }
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    host = started.value;

    const payload = {
      type: 'INCREMENT',
      revision: 7,
      capability: 'counter.increment',
      approval: { state: 'granted' as const },
      idempotencyKey: 'domain-owned-value',
    };
    const sent = await host.send('counter', JSON.stringify(payload));

    expect(sent).toEqual({
      ok: true,
      value: expect.stringContaining('Sent INCREMENT'),
    });
    expect(observed.at(-1)).toEqual(payload);
  });

  it('fails closed when metadata supplies idempotency without an adapter', async () => {
    await host.stop();
    const started = await createRuntimeHost(buildCounterTopology(), {
      commandAdmission: {
        principal: {
          id: 'principal:cli-system',
          kind: 'system',
        },
        policy: async () => ({
          outcome: 'authorized',
          policy: 'cli-policy-v2',
        }),
        onDecision: async () => {},
      },
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    host = started.value;

    const rejected = await host.send('counter', '{"type":"INCREMENT"}', {
      idempotencyKey: 'idem-no-adapter',
    });

    expect(rejected).toEqual({
      ok: false,
      error:
        'Send rejected: missing_idempotency_adapter (commandAdmission metadata.idempotencyKey requires an explicit idempotency adapter.)',
    });
  });

  it('resolves targets by key and by actor:// path', async () => {
    const byKey = host.resolve('counter');
    expect(byKey).toBeDefined();
    const byPath = host.resolve(byKey?.address ?? '');
    expect(byPath).toBe(byKey);
  });

  it('streams emitted events through watch until unsubscribed', async () => {
    const events: ActorMessage[] = [];
    const watching = host.watch('counter', (event) => events.push(event));
    expect(watching.ok).toBe(true);

    await host.send('counter', '{"type":"INCREMENT"}');
    expect(events.some((event) => event.type === 'COUNT_CHANGED')).toBe(true);

    if (watching.ok) {
      watching.value();
    }
    const seen = events.length;
    await host.send('counter', '{"type":"INCREMENT"}');
    expect(events).toHaveLength(seen);
  });

  it('renders host status through the shared console command path', async () => {
    const outcome = await executeCommand(host, 'status', new Map());
    expect(outcome).toEqual({
      ok: true,
      lines: ['mode=in-process node=local', 'gateway=(disabled)', 'transport=(disabled)'],
    });
  });

  it('returns facts for unknown targets and malformed messages', async () => {
    const unknown = await host.send('nope', '{"type":"X"}');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.error).toContain('Unknown actor "nope"');
    }

    const badJson = await host.send('counter', '{nope');
    expect(badJson.ok).toBe(false);
    if (!badJson.ok) {
      expect(badJson.error).toContain('Invalid JSON');
    }

    const noType = await host.send('counter', '{"kind":"X"}');
    expect(noType.ok).toBe(false);
    if (!noType.ok) {
      expect(noType.error).toContain('string "type"');
    }
  });

  it('rejects an unknown --node selection as a fact', async () => {
    const started = await createRuntimeHost(buildCounterTopology(), { node: 'remote' });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error).toContain('Node "remote" not found');
      expect(started.error).toContain('local');
    }
  });

  it('hosts @actor-web/agent loops with an explicitly registered llm provider', async () => {
    const agentPackage = await loadAgentPackage();
    expect(agentPackage).not.toBeNull();
    if (!agentPackage) {
      return;
    }
    const provider = (request: { readonly messages: readonly { readonly content: string }[] }) => ({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: `hosted:${request.messages.at(-1)?.content}`,
        },
      },
    });
    const started = await createRuntimeHost(
      buildAgentLoopTopology({ agentPackage, grantLlm: true }),
      {
        agent: { llm: provider },
      }
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    try {
      const reply = await started.value.ask(
        'agent',
        '{"type":"START_AGENT","prompt":"ship v1"}',
        2000
      );

      expect(reply).toMatchObject({
        ok: true,
        value: {
          ok: true,
          status: 'responded',
          message: {
            role: 'assistant',
            content: 'hosted:ship v1',
          },
        },
      });
    } finally {
      await started.value.stop();
    }
  });

  it('keeps the hosted llm provider behind topology toolAccess', async () => {
    const agentPackage = await loadAgentPackage();
    expect(agentPackage).not.toBeNull();
    if (!agentPackage) {
      return;
    }
    let called = false;
    const provider = () => {
      called = true;
      return {
        ok: true,
        value: {
          message: {
            role: 'assistant',
            content: 'should not run',
          },
        },
      };
    };
    const started = await createRuntimeHost(
      buildAgentLoopTopology({ agentPackage, grantLlm: false }),
      {
        agent: { llm: provider },
      }
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    try {
      const reply = await started.value.ask(
        'agent',
        '{"type":"START_AGENT","prompt":"blocked"}',
        2000
      );

      expect(called).toBe(false);
      expect(reply).toMatchObject({
        ok: true,
        value: {
          ok: false,
          error: {
            code: 'LLM_TOOL_UNAVAILABLE',
          },
        },
      });
    } finally {
      await started.value.stop();
    }
  });
});

// ============================================================================
// DYNAMIC SPAWN FROM FILE
// ============================================================================

describe('spawnFromFile', () => {
  // Fixture lives under the package's node_modules so its bare
  // `@actor-web/runtime` import resolves through pnpm's workspace links.
  const fixtureDir = resolve(__dirname, '../../node_modules/.actor-web-cli-test-fixtures');
  const behaviorFile = join(fixtureDir, 'echo-behavior.mjs');
  let host: RuntimeHost;

  beforeAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(
      behaviorFile,
      [
        "import { defineBehavior } from '@actor-web/runtime';",
        'export default defineBehavior()',
        '  .withContext({ seen: 0 })',
        '  .onMessage(({ message, context }) => {',
        "    if (message.type === 'PING') {",
        '      return { context: { seen: context.seen + 1 }, reply: { pong: context.seen + 1 } };',
        '    }',
        '    return {};',
        '  })',
        '  .build();',
        '',
      ].join('\n')
    );
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const started = await createRuntimeHost(buildCounterTopology());
    expect(started.ok).toBe(true);
    if (started.ok) {
      host = started.value;
    }
  });

  afterEach(async () => {
    await host.stop();
  });

  it('spawns a behavior module and serves ask on it', async () => {
    const spawned = await host.spawnFromFile(behaviorFile, 'echo1');
    expect(spawned.ok).toBe(true);
    if (spawned.ok) {
      expect(spawned.value.origin).toBe('spawned');
    }

    const reply = await host.ask('echo1', '{"type":"PING"}', 2000);
    expect(reply).toEqual({ ok: true, value: { pong: 1 } });

    const actors = await host.listActors();
    expect(actors.map((entry) => entry.key).sort()).toEqual(['counter', 'echo1']);
  });

  it('rejects a duplicate actor id as a fact', async () => {
    const first = await host.spawnFromFile(behaviorFile, 'echo1');
    expect(first.ok).toBe(true);

    const second = await host.spawnFromFile(behaviorFile, 'echo1');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toContain('already registered');
    }
  });

  it('reports a missing behavior module as a fact', async () => {
    const spawned = await host.spawnFromFile(join(fixtureDir, 'missing.mjs'), 'ghost');
    expect(spawned.ok).toBe(false);
    if (!spawned.ok) {
      expect(spawned.error).toContain('Module not found');
    }
  });
});

// ============================================================================
// EXEC SCRIPT SPLITTING
// ============================================================================

describe('splitExecScript', () => {
  it('splits commands on semicolons and trims whitespace', () => {
    expect(splitExecScript('ls;  help ; exit')).toEqual(['ls', 'help', 'exit']);
  });

  it('drops empty segments', () => {
    expect(splitExecScript('; ls;; help ;')).toEqual(['ls', 'help']);
  });

  it('keeps semicolons inside double-quoted JSON strings', () => {
    expect(splitExecScript('send a {"text":"a;b"}; ls')).toEqual(['send a {"text":"a;b"}', 'ls']);
  });

  it('keeps semicolons inside single-quoted regions', () => {
    expect(splitExecScript("send a 'x;y'; ls")).toEqual(["send a 'x;y'", 'ls']);
  });

  it('honors backslash escapes inside strings', () => {
    expect(splitExecScript('send a {"text":"say \\";\\" ok"}; ls')).toEqual([
      'send a {"text":"say \\";\\" ok"}',
      'ls',
    ]);
  });
});

// ============================================================================
// CONSOLE GRAMMAR
// ============================================================================

describe('executeCommand', () => {
  let host: RuntimeHost;
  let watches: Map<string, () => void>;

  beforeEach(async () => {
    const started = await createRuntimeHost(buildCounterTopology());
    expect(started.ok).toBe(true);
    if (started.ok) {
      host = started.value;
    }
    watches = new Map();
  });

  afterEach(async () => {
    for (const unsubscribe of watches.values()) {
      unsubscribe();
    }
    await host.stop();
  });

  it('lists actors via ls', async () => {
    const outcome = await executeCommand(host, 'ls', watches);
    expect(outcome.ok).toBe(true);
    expect(outcome.lines.some((line) => line.includes('counter'))).toBe(true);
  });

  it('parses send with JSON containing spaces', async () => {
    const outcome = await executeCommand(host, 'send counter {"type": "INCREMENT"}', watches);
    expect(outcome.ok).toBe(true);

    const reply = await executeCommand(host, 'ask counter {"type":"GET_COUNT"}', watches);
    expect(reply.ok).toBe(true);
    expect(reply.lines[0]).toBe('{"count":1}');
  });

  it('parses a trailing ask timeout without eating JSON', async () => {
    const outcome = await executeCommand(host, 'ask counter {"type":"GET_COUNT"} 2000', watches);
    expect(outcome.ok).toBe(true);
    expect(outcome.lines[0]).toBe('{"count":0}');
  });

  it('watch streams events through the context callback and unwatch stops them', async () => {
    const events: Array<{ target: string; event: ActorMessage }> = [];
    const watching = await executeCommand(host, 'watch counter', watches, {
      onEvent: (target, event) => events.push({ target, event }),
    });
    expect(watching.ok).toBe(true);
    expect(watches.has('counter')).toBe(true);

    await executeCommand(host, 'send counter {"type":"INCREMENT"}', watches);
    expect(events.some(({ event }) => event.type === 'COUNT_CHANGED')).toBe(true);

    const unwatched = await executeCommand(host, 'unwatch counter', watches);
    expect(unwatched.ok).toBe(true);
    expect(watches.size).toBe(0);
  });

  it('reports unknown commands and surfaces usage for partial ones', async () => {
    const unknown = await executeCommand(host, 'frobnicate', watches);
    expect(unknown.ok).toBe(false);
    expect(unknown.lines[0]).toContain('Unknown command');

    const usage = await executeCommand(host, 'send counter', watches);
    expect(usage.ok).toBe(false);
    expect(usage.lines[0]).toContain('Usage: send');
  });

  it('help lists every verb and exit signals shutdown', async () => {
    const help = await executeCommand(host, 'help', watches);
    for (const verb of ['ls', 'spawn', 'send', 'ask', 'watch', 'unwatch', 'exit']) {
      expect(help.lines.join('\n')).toContain(verb);
    }

    const exit = await executeCommand(host, 'exit', watches);
    expect(exit.exit).toBe(true);
  });
});
