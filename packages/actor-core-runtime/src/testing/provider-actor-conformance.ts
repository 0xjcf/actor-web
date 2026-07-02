import { describe, expect, it } from 'vitest';
import type { NodeProviderActor, NodeProviderActorProjection } from '../node-provider-actor.js';
import type {
  ChildProcessClaimDuplicateResult,
  ChildProcessObserveExitResult,
  ChildProcessSignalResult,
  ChildProcessSpawnResult,
  ChildProcessTailOutputResult,
  NodeProviderLifecycleFailure,
  ProviderReadinessCheckResult,
} from '../node-provider-lifecycle-contract.js';
import type {
  InMemoryNodeProviderLifecycleEffectJournal,
  NodeProviderLifecycleFilesystemProbeResult,
  NodeProviderLifecycleModelCacheInspectionResult,
} from '../node-provider-lifecycle-effect-journal.js';

export interface ProviderActorConformanceScenarioOptions {
  readonly duplicateClaim?: ChildProcessClaimDuplicateResult;
  readonly spawn?: ChildProcessSpawnResult;
  readonly readiness?:
    | readonly ProviderReadinessCheckResult[]
    | ((attempt: number) => ProviderReadinessCheckResult);
  readonly signal?: ChildProcessSignalResult;
  readonly observeExit?: ChildProcessObserveExitResult;
  readonly tailOutput?: ChildProcessTailOutputResult;
  readonly filesystemProbe?: NodeProviderLifecycleFilesystemProbeResult;
  readonly modelCacheInspect?: NodeProviderLifecycleModelCacheInspectionResult;
}

export interface ProviderActorConformanceScenario {
  readonly actor: NodeProviderActor;
  readonly journal: InMemoryNodeProviderLifecycleEffectJournal;
  readonly activationKey: string;
  readonly acquisitionKey: string;
  readonly handle: string;
  readonly endpoint: string;
  readonly calls: Readonly<{
    claimDuplicate: number;
    spawn: number;
    signal: number;
    observeExit: number;
    tailOutput: number;
    readiness: number;
    filesystemProbe: number;
    modelCacheInspect: number;
  }>;
  advanceTime(ms: number): void;
}

export interface ProviderActorConformanceHarness {
  readonly name: string;
  createScenario(
    options?: ProviderActorConformanceScenarioOptions
  ): ProviderActorConformanceScenario;
}

async function acquire(
  scenario: ProviderActorConformanceScenario
): Promise<NodeProviderActorProjection> {
  return scenario.actor.dispatch({
    type: 'ACQUIRE_PROVIDER',
    activationKey: scenario.activationKey as never,
    acquisitionKey: scenario.acquisitionKey as never,
  });
}

async function checkReadiness(
  scenario: ProviderActorConformanceScenario
): Promise<NodeProviderActorProjection> {
  return scenario.actor.dispatch({
    type: 'CHECK_PROVIDER_READINESS',
  });
}

function expectFailureCode(
  snapshot: NodeProviderActorProjection,
  code: NodeProviderLifecycleFailure['code']
): void {
  expect(snapshot.failure?.code).toBe(code);
}

function journalKinds(scenario: ProviderActorConformanceScenario): readonly string[] {
  return Object.values(scenario.journal.getSnapshot()).map((entry) => entry.kind);
}

export function describeProviderActorConformance(harness: ProviderActorConformanceHarness): void {
  describe(`ProviderActor conformance: ${harness.name}`, () => {
    it('acquires on the happy path, journals non-replayable effects, and becomes ready after /v1/models succeeds', async () => {
      const scenario = harness.createScenario();

      const starting = await acquire(scenario);
      expect(starting.status).toBe('starting');
      expect(starting.ready).toBe(false);
      expect(starting.handle).toBe(scenario.handle);
      expect(starting.endpoint).toBe(scenario.endpoint);
      expect(scenario.calls.claimDuplicate).toBe(1);
      expect(scenario.calls.spawn).toBe(1);

      const ready = await checkReadiness(scenario);
      expect(ready.status).toBe('running');
      expect(ready.ready).toBe(true);
      expect(ready.failure).toBeNull();
      expect(journalKinds(scenario)).toEqual([
        'filesystem_probe',
        'model_cache_inspect',
        'duplicate_prevention',
        'spawn',
        'readiness',
      ]);
    });

    it('reuses an already-running endpoint without spawning again', async () => {
      const scenario = harness.createScenario({
        duplicateClaim: {
          outcome: 'already_running',
          running: {
            activationKey: scenarioKey('activation:reuse'),
            acquisitionKey: scenarioKey('acquisition:reuse'),
            provider: 'mlx_lm.server',
            handle: scenarioKey('child:provider:reuse'),
            detectedAt: '2026-07-02T15:00:01.000Z',
            disposition: 'already_running',
          } as never,
        },
      });

      const snapshot = await acquire(scenario);
      expect(snapshot.status).toBe('running');
      expect(snapshot.ready).toBe(true);
      expect(snapshot.endpoint).toBe(scenario.endpoint);
      expect(scenario.calls.spawn).toBe(0);
    });

    it('projects spawn started before readiness completes, then preserves waiting facts', async () => {
      const scenario = harness.createScenario({
        readiness: [
          {
            outcome: 'waiting',
            fact: {
              handle: scenarioKey('child:provider:001'),
              attempt: 1,
              strategy: 'http',
              target: 'http://127.0.0.1:4242/v1/models',
              observedAt: '2026-07-02T15:00:02.000Z',
              detail: 'booting',
            } as never,
          },
        ],
      });

      const starting = await acquire(scenario);
      expect(starting.status).toBe('starting');
      const waiting = await checkReadiness(scenario);
      expect(waiting.status).toBe('starting');
      expect(waiting.ready).toBe(false);
      expect(waiting.lastObservedAt).toBe('2026-07-02T15:00:02.000Z');
    });

    it('projects missing executable and port conflict spawn failures as data', async () => {
      for (const code of ['missing_executable', 'port_conflict'] as const) {
        const scenario = harness.createScenario({
          spawn: {
            outcome: 'failed',
            failure: {
              code,
              message: `${code} failure`,
              retryable: false,
            },
          },
        });

        const snapshot = await acquire(scenario);
        expect(snapshot.status).toBe('failed');
        expectFailureCode(snapshot, code);
      }
    });

    it('projects startup timeout without throwing when readiness stays pending too long', async () => {
      const scenario = harness.createScenario({
        readiness: [
          {
            outcome: 'waiting',
            fact: {
              handle: scenarioKey('child:provider:001'),
              attempt: 1,
              strategy: 'http',
              target: 'http://127.0.0.1:4242/v1/models',
              observedAt: '2026-07-02T15:00:02.000Z',
              detail: 'booting',
            } as never,
          },
        ],
      });

      await acquire(scenario);
      await checkReadiness(scenario);
      scenario.advanceTime(61_000);
      const timedOut = await checkReadiness(scenario);
      expect(timedOut.status).toBe('failed');
      expectFailureCode(timedOut, 'startup_timeout');
    });

    it('projects model mismatch and health-check readiness failures as data', async () => {
      const mismatch = harness.createScenario({
        readiness: [
          {
            outcome: 'failed',
            failure: {
              code: 'readiness_failed',
              message: 'Model mismatch',
              retryable: false,
              details: {
                expectedModel: 'mlx-community/Llama-3.2-3B-Instruct-4bit',
                actualModel: 'other-model',
              },
            },
            fact: {
              handle: scenarioKey('child:provider:001'),
              attempt: 1,
              strategy: 'http',
              target: 'http://127.0.0.1:4242/v1/models',
              observedAt: '2026-07-02T15:00:03.000Z',
              detail: 'model mismatch',
            } as never,
          },
        ],
      });
      await acquire(mismatch);
      const mismatchSnapshot = await checkReadiness(mismatch);
      expectFailureCode(mismatchSnapshot, 'readiness_failed');
      expect(mismatchSnapshot.failure?.details).toMatchObject({
        expectedModel: 'mlx-community/Llama-3.2-3B-Instruct-4bit',
      });

      const health = harness.createScenario({
        readiness: [
          {
            outcome: 'failed',
            failure: {
              code: 'readiness_failed',
              message: 'Health check failed',
              retryable: true,
              details: {
                target: 'http://127.0.0.1:4242/v1/models',
                attempt: 1,
              },
            },
            fact: {
              handle: scenarioKey('child:provider:001'),
              attempt: 1,
              strategy: 'http',
              target: 'http://127.0.0.1:4242/v1/models',
              observedAt: '2026-07-02T15:00:04.000Z',
              detail: '503 Service Unavailable',
            } as never,
          },
        ],
      });
      await acquire(health);
      const healthSnapshot = await checkReadiness(health);
      expectFailureCode(healthSnapshot, 'readiness_failed');
      expect(healthSnapshot.failure?.details).toMatchObject({
        target: 'http://127.0.0.1:4242/v1/models',
        attempt: 1,
      });
    });

    it('cancels during startup, journals cancellation and signal facts, and does not leak restart classification', async () => {
      const scenario = harness.createScenario({
        observeExit: {
          outcome: 'cancelled',
          fact: {
            handle: scenarioKey('child:provider:001'),
            exitOutcome: 'cancelled',
            exitCode: null,
            signal: 'SIGTERM',
            observedAt: '2026-07-02T15:00:05.000Z',
          } as never,
        },
      });

      await acquire(scenario);
      const stopping = await scenario.actor.dispatch({
        type: 'CANCEL_PROVIDER',
        requestedBy: 'runtime',
        reason: 'shutdown_requested',
      });
      expect(stopping.status).toBe('stopping');

      const stopped = await scenario.actor.dispatch({
        type: 'OBSERVE_PROVIDER_EXIT',
      });
      expect(stopped.status).toBe('idle');
      expect(stopped.restartCount).toBe(0);
      expect(journalKinds(scenario)).toContain('cancellation');
      expect(journalKinds(scenario)).toContain('signal');
    });

    it('distinguishes crashed and exited classifications, incrementing restart count only for crashes', async () => {
      const crashed = harness.createScenario({
        observeExit: {
          outcome: 'crashed',
          fact: {
            handle: scenarioKey('child:provider:001'),
            exitOutcome: 'crashed',
            exitCode: 137,
            signal: 'SIGKILL',
            observedAt: '2026-07-02T15:00:06.000Z',
          } as never,
        },
      });
      await acquire(crashed);
      const crashedSnapshot = await crashed.actor.dispatch({
        type: 'OBSERVE_PROVIDER_EXIT',
      });
      expect(crashedSnapshot.restartCount).toBe(1);
      expectFailureCode(crashedSnapshot, 'crashed');

      const exited = harness.createScenario({
        observeExit: {
          outcome: 'exited',
          fact: {
            handle: scenarioKey('child:provider:001'),
            exitOutcome: 'exited',
            exitCode: 0,
            signal: null,
            observedAt: '2026-07-02T15:00:07.000Z',
          } as never,
        },
      });
      await acquire(exited);
      const exitedSnapshot = await exited.actor.dispatch({
        type: 'OBSERVE_PROVIDER_EXIT',
      });
      expect(exitedSnapshot.restartCount).toBe(0);
      expectFailureCode(exitedSnapshot, 'exited');
    });

    it('shuts down on fake idle ticks after release and keeps bounded stdout and stderr tails', async () => {
      const scenario = harness.createScenario({
        tailOutput: {
          outcome: 'tailed',
          tail: {
            handle: scenarioKey('child:provider:001'),
            limit: 2,
            stdout: ['warming', 'ready'],
            stderr: ['warn-2', 'warn-3'],
            truncated: {
              stdout: true,
              stderr: true,
            },
            totalCaptured: {
              stdout: 3,
              stderr: 3,
            },
          } as never,
        },
        observeExit: {
          outcome: 'cancelled',
          fact: {
            handle: scenarioKey('child:provider:001'),
            exitOutcome: 'cancelled',
            exitCode: null,
            signal: 'SIGTERM',
            observedAt: '2026-07-02T15:00:08.000Z',
          } as never,
        },
      });

      await acquire(scenario);
      await checkReadiness(scenario);
      await scenario.actor.dispatch({
        type: 'RELEASE_PROVIDER',
        acquisitionKey: scenario.acquisitionKey as never,
      });
      scenario.advanceTime(31_000);
      const stopping = await scenario.actor.dispatch({
        type: 'TICK_IDLE_SHUTDOWN',
      });
      expect(stopping.status).toBe('stopping');

      const stopped = await scenario.actor.dispatch({
        type: 'OBSERVE_PROVIDER_EXIT',
      });
      expect(stopped.stdoutTail).toEqual({
        lines: ['warming', 'ready'],
        truncated: true,
        totalCaptured: 3,
      });
      expect(stopped.stderrTail).toEqual({
        lines: ['warn-2', 'warn-3'],
        truncated: true,
        totalCaptured: 3,
      });
    });

    it('collapses repeated acquire calls into one claimed duplicate-prevention effect and projects duplicates instead of throwing', async () => {
      const scenario = harness.createScenario();

      const first = await acquire(scenario);
      const second = await acquire(scenario);

      expect(first.status).toBe('starting');
      expect(second.failure?.code).toBe('duplicate');
      expect(scenario.calls.claimDuplicate).toBe(1);
      expect(journalKinds(scenario).filter((kind) => kind === 'duplicate_prevention')).toHaveLength(
        1
      );
    });

    it('projects fake port failures as data for duplicate, filesystem, model cache, signal, exit observation, readiness, and tail capture', async () => {
      const duplicate = harness.createScenario({
        duplicateClaim: {
          outcome: 'error',
          error: {
            code: 'duplicate',
            message: 'duplicate registry failed',
            retryable: true,
          },
        },
      });
      expectFailureCode(await acquire(duplicate), 'duplicate');

      const filesystem = harness.createScenario({
        filesystemProbe: {
          outcome: 'failed',
          failure: {
            code: 'missing_executable',
            message: 'filesystem probe failed',
            retryable: false,
          },
        },
      });
      expectFailureCode(await acquire(filesystem), 'missing_executable');

      const modelCache = harness.createScenario({
        modelCacheInspect: {
          outcome: 'failed',
          failure: {
            code: 'readiness_failed',
            message: 'cache inspect failed',
            retryable: true,
          },
        },
      });
      expectFailureCode(await acquire(modelCache), 'readiness_failed');

      const readiness = harness.createScenario({
        readiness: [
          {
            outcome: 'error',
            error: {
              code: 'readiness_failed',
              message: 'readiness port error',
              retryable: true,
            },
          },
        ],
      });
      await acquire(readiness);
      expectFailureCode(await checkReadiness(readiness), 'readiness_failed');

      const signal = harness.createScenario({
        signal: {
          outcome: 'failed',
          failure: {
            code: 'signal_failed',
            message: 'signal port failed',
            retryable: true,
          },
        },
      });
      await acquire(signal);
      expectFailureCode(
        await signal.actor.dispatch({
          type: 'CANCEL_PROVIDER',
        }),
        'signal_failed'
      );

      const observe = harness.createScenario({
        observeExit: {
          outcome: 'error',
          error: {
            code: 'crashed',
            message: 'observe exit failed',
            retryable: true,
          },
        },
      });
      await acquire(observe);
      expectFailureCode(
        await observe.actor.dispatch({
          type: 'OBSERVE_PROVIDER_EXIT',
        }),
        'crashed'
      );

      const tail = harness.createScenario({
        observeExit: {
          outcome: 'exited',
          fact: {
            handle: scenarioKey('child:provider:001'),
            exitOutcome: 'exited',
            exitCode: 0,
            signal: null,
            observedAt: '2026-07-02T15:00:09.000Z',
          } as never,
        },
        tailOutput: {
          outcome: 'failed',
          failure: {
            code: 'tail_failed',
            message: 'tail capture failed',
            retryable: true,
          },
        },
      });
      await acquire(tail);
      expectFailureCode(
        await tail.actor.dispatch({
          type: 'OBSERVE_PROVIDER_EXIT',
        }),
        'tail_failed'
      );
    });
  });
}

function scenarioKey<TValue extends string>(value: TValue): TValue {
  return value;
}
