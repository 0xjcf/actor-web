import { describe, expect, it } from 'vitest';
import * as browserEntry from '../browser.js';
import * as rootEntry from '../index.js';
import * as nodeEntry from '../node.js';
import { createNodeProviderActor } from '../node-provider-actor.js';
import {
  type BrandedStringParseResult,
  type ChildProcessClaimDuplicateResult,
  type ChildProcessHandle,
  type ChildProcessObserveExitResult,
  type ChildProcessSignalResult,
  type ChildProcessSpawnResult,
  type ChildProcessTailOutputResult,
  createChildProcessHandle,
  createChildProcessOutputTail,
  createProviderLifecycleAcquisitionKey,
  createProviderLifecycleActivationKey,
  createProviderLifecycleClaimFact,
  createProviderLifecycleProcessFact,
  createProviderLifecycleReadinessFact,
  createProviderLifecycleSignalFact,
  type ProviderLifecycleAcquisitionKey,
  type ProviderLifecycleActivationKey,
  type ProviderReadinessCheckResult,
} from '../node-provider-lifecycle-contract.js';
import { createInMemoryNodeProviderLifecycleEffectJournal } from '../node-provider-lifecycle-effect-journal.js';
import {
  describeProviderActorConformance,
  type ProviderActorConformanceScenario,
  type ProviderActorConformanceScenarioOptions,
} from '../testing/provider-actor-conformance.js';

function expectValid<TValue extends string>(result: BrandedStringParseResult<TValue>): TValue {
  expect(result.outcome).toBe('valid');
  if (result.outcome !== 'valid') {
    throw new Error(`Expected valid branded value, received ${result.reason}`);
  }
  return result.value;
}

function makeHandle(value: string): ChildProcessHandle {
  return expectValid(createChildProcessHandle(value));
}

function makeActivationKey(value: string): ProviderLifecycleActivationKey {
  return expectValid(createProviderLifecycleActivationKey(value));
}

function makeAcquisitionKey(value: string): ProviderLifecycleAcquisitionKey {
  return expectValid(createProviderLifecycleAcquisitionKey(value));
}

const BASE_TIME_MS = Date.parse('2026-07-02T15:00:00.000Z');

describeProviderActorConformance({
  name: 'node-only provider actor',
  createScenario(
    options: ProviderActorConformanceScenarioOptions = {}
  ): ProviderActorConformanceScenario {
    const activationKey = makeActivationKey('activation:provider:001');
    const acquisitionKey = makeAcquisitionKey('acquisition:provider:001');
    const handle = makeHandle('child:provider:001');
    const endpoint = 'http://127.0.0.1:4242';
    const journal = createInMemoryNodeProviderLifecycleEffectJournal();
    const calls = {
      claimDuplicate: 0,
      spawn: 0,
      signal: 0,
      observeExit: 0,
      tailOutput: 0,
      readiness: 0,
      filesystemProbe: 0,
      modelCacheInspect: 0,
    };

    let nowMs = BASE_TIME_MS;
    const clock = {
      nowIso(): string {
        return new Date(nowMs).toISOString();
      },
      nowMs(): number {
        return nowMs;
      },
    };

    const defaultDuplicateClaim: ChildProcessClaimDuplicateResult = {
      outcome: 'claimed',
      claim: createProviderLifecycleClaimFact({
        activationKey,
        acquisitionKey,
        provider: 'mlx_lm.server',
        claimedAt: clock.nowIso(),
      }),
    };
    const defaultSpawn: ChildProcessSpawnResult = {
      outcome: 'spawned',
      process: createProviderLifecycleProcessFact({
        handle,
        activationKey,
        acquisitionKey,
        provider: 'mlx_lm.server',
        pid: 4242,
        processGroup: 'isolated',
        startedAt: clock.nowIso(),
      }),
    };
    const readinessQueue = options.readiness;
    const defaultReadiness: ProviderReadinessCheckResult = {
      outcome: 'ready',
      fact: createProviderLifecycleReadinessFact({
        handle,
        attempt: 1,
        strategy: 'http',
        target: 'http://127.0.0.1:4242/v1/models',
        observedAt: clock.nowIso(),
        detail: 'ready',
      }),
    };
    const defaultSignal: ChildProcessSignalResult = {
      outcome: 'signaled',
      fact: createProviderLifecycleSignalFact({
        handle,
        signal: 'SIGTERM',
        reason: 'cancellation',
        observedAt: clock.nowIso(),
      }),
    };
    const defaultObserveExit: ChildProcessObserveExitResult = {
      outcome: 'running',
      handle,
    };
    const defaultTailOutput: ChildProcessTailOutputResult = {
      outcome: 'tailed',
      tail: createChildProcessOutputTail({
        handle,
        limit: 2,
        stdout: [],
        stderr: [],
      }),
    };
    const defaultFilesystemProbe = {
      outcome: 'probed' as const,
      fact: {
        target: '/opt/mlx',
        exists: true,
        entries: ['mlx_lm.server'],
        writable: true,
        observedAt: clock.nowIso(),
      },
    };
    const defaultModelCacheInspect = {
      outcome: 'inspected' as const,
      fact: {
        provider: 'mlx_lm.server',
        modelId: 'mlx-community/Llama-3.2-3B-Instruct-4bit',
        cacheKey: 'mlx-cache',
        status: 'warm' as const,
        bytesOnDisk: 1024,
        observedAt: clock.nowIso(),
      },
    };

    const actor = createNodeProviderActor({
      provider: 'mlx_lm.server',
      executable: 'mlx_lm.server',
      args: ['--host', '127.0.0.1', '--port', '4242'],
      endpoint,
      processGroup: 'isolated',
      readiness: {
        strategy: 'http',
        target: 'http://127.0.0.1:4242/v1/models',
        startupTimeoutMs: 60_000,
      },
      idleShutdownMs: 30_000,
      outputTailLimit: 2,
      filesystemProbeTarget: '/opt/mlx',
      modelId: 'mlx-community/Llama-3.2-3B-Instruct-4bit',
      modelCacheKey: 'mlx-cache',
      ports: {
        journal,
        clock,
        filesystem: {
          probe() {
            calls.filesystemProbe += 1;
            return options.filesystemProbe ?? defaultFilesystemProbe;
          },
        },
        modelCache: {
          inspect() {
            calls.modelCacheInspect += 1;
            return options.modelCacheInspect ?? defaultModelCacheInspect;
          },
        },
        childProcess: {
          claimDuplicate() {
            calls.claimDuplicate += 1;
            return options.duplicateClaim ?? defaultDuplicateClaim;
          },
          spawn() {
            calls.spawn += 1;
            return options.spawn ?? defaultSpawn;
          },
          signal() {
            calls.signal += 1;
            return options.signal ?? defaultSignal;
          },
          observeExit() {
            calls.observeExit += 1;
            return options.observeExit ?? defaultObserveExit;
          },
          tailOutput() {
            calls.tailOutput += 1;
            return options.tailOutput ?? defaultTailOutput;
          },
        },
        readiness: {
          check({ attempt }) {
            calls.readiness += 1;
            if (Array.isArray(readinessQueue)) {
              return (
                readinessQueue[Math.min(attempt - 1, readinessQueue.length - 1)] ?? defaultReadiness
              );
            }
            if (typeof readinessQueue === 'function') {
              return readinessQueue(attempt);
            }
            return defaultReadiness;
          },
        },
      },
    });

    return {
      actor,
      journal,
      activationKey,
      acquisitionKey,
      handle,
      endpoint,
      calls,
      advanceTime(ms: number): void {
        nowMs += ms;
      },
    };
  },
});

describe('node provider actor exports', () => {
  it('exports the provider actor only from the node entrypoint', () => {
    expect(nodeEntry.createNodeProviderActor).toBeTypeOf('function');
    expect('createNodeProviderActor' in rootEntry).toBe(false);
    expect('createNodeProviderActor' in browserEntry).toBe(false);
  });
});

function createDirectProviderActorTestHarness(input?: {
  readonly spawn?: () => ChildProcessSpawnResult;
  readonly createJournal?: (
    baseJournal: ReturnType<typeof createInMemoryNodeProviderLifecycleEffectJournal>
  ) => Parameters<typeof createNodeProviderActor>[0]['ports']['journal'];
}) {
  const activationKey = makeActivationKey('activation:provider:direct');
  const acquisitionKey = makeAcquisitionKey('acquisition:provider:direct');
  const handle = makeHandle('child:provider:direct');
  const baseJournal = createInMemoryNodeProviderLifecycleEffectJournal();
  const clock = {
    nowIso: () => '2026-07-04T18:00:00.000Z',
    nowMs: () => Date.parse('2026-07-04T18:00:00.000Z'),
  };
  const claimDuplicate: ChildProcessClaimDuplicateResult = {
    outcome: 'claimed',
    claim: createProviderLifecycleClaimFact({
      activationKey,
      acquisitionKey,
      provider: 'mlx_lm.server',
      claimedAt: clock.nowIso(),
    }),
  };
  const defaultSpawn: ChildProcessSpawnResult = {
    outcome: 'spawned',
    process: createProviderLifecycleProcessFact({
      handle,
      activationKey,
      acquisitionKey,
      provider: 'mlx_lm.server',
      pid: 4242,
      processGroup: 'isolated',
      startedAt: clock.nowIso(),
    }),
  };
  const journal = input?.createJournal?.(baseJournal) ?? {
    claim: baseJournal.claim.bind(baseJournal),
    record: baseJournal.record.bind(baseJournal),
    replay: baseJournal.replay.bind(baseJournal),
  };
  const actor = createNodeProviderActor({
    provider: 'mlx_lm.server',
    executable: 'mlx_lm.server',
    args: ['--host', '127.0.0.1', '--port', '4242'],
    endpoint: 'http://127.0.0.1:4242',
    processGroup: 'isolated',
    readiness: {
      strategy: 'http',
      target: 'http://127.0.0.1:4242/v1/models',
      startupTimeoutMs: 60_000,
    },
    idleShutdownMs: 30_000,
    outputTailLimit: 2,
    filesystemProbeTarget: '/opt/mlx',
    modelId: 'mlx-community/Llama-3.2-3B-Instruct-4bit',
    modelCacheKey: 'mlx-cache',
    ports: {
      clock,
      journal,
      filesystem: {
        probe: () => ({
          outcome: 'probed' as const,
          fact: {
            target: '/opt/mlx',
            exists: true,
            entries: ['mlx_lm.server'],
            writable: true,
            observedAt: clock.nowIso(),
          },
        }),
      },
      modelCache: {
        inspect: () => ({
          outcome: 'inspected' as const,
          fact: {
            provider: 'mlx_lm.server',
            modelId: 'mlx-community/Llama-3.2-3B-Instruct-4bit',
            cacheKey: 'mlx-cache',
            status: 'warm' as const,
            bytesOnDisk: 1024,
            observedAt: clock.nowIso(),
          },
        }),
      },
      childProcess: {
        claimDuplicate: () => claimDuplicate,
        spawn: () => (input?.spawn ? input.spawn() : defaultSpawn),
        signal: () => ({
          outcome: 'signaled' as const,
          fact: createProviderLifecycleSignalFact({
            handle,
            signal: 'SIGTERM',
            reason: 'shutdown',
            observedAt: clock.nowIso(),
          }),
        }),
        observeExit: () => ({
          outcome: 'running' as const,
          handle,
        }),
        tailOutput: () => ({
          outcome: 'tailed' as const,
          tail: createChildProcessOutputTail({
            handle,
            limit: 2,
            stdout: [],
            stderr: [],
          }),
        }),
      },
      readiness: {
        check: () => ({
          outcome: 'ready' as const,
          fact: createProviderLifecycleReadinessFact({
            handle,
            attempt: 1,
            strategy: 'http',
            target: 'http://127.0.0.1:4242/v1/models',
            observedAt: clock.nowIso(),
            detail: 'ready',
          }),
        }),
      },
    },
  });

  return { actor, activationKey, acquisitionKey, journal: baseJournal };
}

describe('node provider actor claimed-effect exception handling', () => {
  it('resolves with failure projection data when perform throws after a claim', async () => {
    const harness = createDirectProviderActorTestHarness({
      spawn: () => {
        throw new Error('spawn exploded');
      },
    });

    const projection = await harness.actor.dispatch({
      type: 'ACQUIRE_PROVIDER',
      activationKey: harness.activationKey,
      acquisitionKey: harness.acquisitionKey,
    });

    expect(projection).toMatchObject({
      status: 'failed',
      ready: false,
    });
    expect(projection.failure?.message).toContain('spawn exploded');
    expect(
      Object.values(harness.journal.getSnapshot()).every((entry) => entry.status === 'recorded')
    ).toBe(true);
  });

  it('resolves with failure projection data when journal.record throws after a claim', async () => {
    const harness = createDirectProviderActorTestHarness({
      createJournal(baseJournal) {
        let shouldThrowForSpawn = true;
        return {
          claim: baseJournal.claim.bind(baseJournal),
          replay: baseJournal.replay.bind(baseJournal),
          record(record) {
            if (record.kind === 'spawn' && shouldThrowForSpawn) {
              shouldThrowForSpawn = false;
              throw new Error('journal record exploded');
            }
            return baseJournal.record(record);
          },
        };
      },
    });

    const projection = await harness.actor.dispatch({
      type: 'ACQUIRE_PROVIDER',
      activationKey: harness.activationKey,
      acquisitionKey: harness.acquisitionKey,
    });

    expect(projection).toMatchObject({
      status: 'failed',
      ready: false,
    });
    expect(projection.failure?.message).toContain('journal record exploded');
    expect(
      Object.values(harness.journal.getSnapshot()).every((entry) => entry.status === 'recorded')
    ).toBe(true);
  });
});
