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
