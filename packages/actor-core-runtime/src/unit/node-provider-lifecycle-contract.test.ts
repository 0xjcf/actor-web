import { describe, expect, it } from 'vitest';
import * as browserEntry from '../browser.js';
import * as rootEntry from '../index.js';
import * as nodeEntry from '../node.js';
import {
  type BrandedStringParseResult,
  type ChildProcessHandle,
  type ChildProcessPort,
  createChildProcessHandle,
  createChildProcessOutputTail,
  createNodeProviderLifecycleFailure,
  createProviderLifecycleAcquisitionKey,
  createProviderLifecycleActivationKey,
  createProviderLifecycleCancellationFact,
  createProviderLifecycleClaimFact,
  createProviderLifecycleDuplicateFact,
  createProviderLifecycleExitFact,
  createProviderLifecycleIdleShutdownFact,
  createProviderLifecycleProcessFact,
  createProviderLifecycleReadinessFact,
  createProviderLifecycleSignalFact,
  type ProviderLifecycleAcquisitionKey,
  type ProviderLifecycleActivationKey,
  type ProviderReadinessPort,
  parseChildProcessHandle,
  parseProviderLifecycleAcquisitionKey,
  parseProviderLifecycleActivationKey,
} from '../node-provider-lifecycle-contract.js';

function expectValid<TValue extends string>(result: BrandedStringParseResult<TValue>): TValue {
  expect(result.outcome).toBe('valid');
  if (result.outcome !== 'valid') {
    throw new Error(`Expected valid branded string, received ${result.reason}`);
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

describe('node provider lifecycle contract', () => {
  it('accepts non-empty branded ingress and rejects empty brand values', () => {
    const handle = makeHandle('child:provider-host:001');
    const activationKey = makeActivationKey('activation:provider-host:001');
    const acquisitionKey = makeAcquisitionKey('acquisition:provider-host:001');

    expect(parseChildProcessHandle(handle)).toEqual({
      outcome: 'valid',
      value: handle,
    });
    expect(parseProviderLifecycleActivationKey(activationKey)).toEqual({
      outcome: 'valid',
      value: activationKey,
    });
    expect(parseProviderLifecycleAcquisitionKey(acquisitionKey)).toEqual({
      outcome: 'valid',
      value: acquisitionKey,
    });

    expect(createChildProcessHandle('')).toEqual({
      outcome: 'invalid',
      reason: 'expected_non_empty_string',
      value: '',
    });
    expect(createProviderLifecycleActivationKey('   ')).toEqual({
      outcome: 'invalid',
      reason: 'expected_non_empty_string',
      value: '   ',
    });
    expect(createProviderLifecycleAcquisitionKey(null)).toEqual({
      outcome: 'invalid',
      reason: 'expected_non_empty_string',
      value: null,
    });
  });

  it('builds bounded output tails plus cancellation and idle-shutdown facts as plain data', () => {
    const handle = makeHandle('child:provider-host:001');
    const activationKey = makeActivationKey('activation:provider-host:001');
    const acquisitionKey = makeAcquisitionKey('acquisition:provider-host:001');
    const cancellation = createProviderLifecycleCancellationFact({
      requestedBy: 'runtime',
      reason: 'activation_replaced',
      requestedAt: '2026-07-02T04:00:00.000Z',
      activationKey,
    });
    const idleShutdown = createProviderLifecycleIdleShutdownFact({
      idleSince: '2026-07-02T04:10:00.000Z',
      shutdownRequestedAt: '2026-07-02T04:12:00.000Z',
      inactivityWindowMs: 120000,
      acquisitionKey,
    });

    expect(cancellation).toEqual({
      requestedBy: 'runtime',
      reason: 'activation_replaced',
      requestedAt: '2026-07-02T04:00:00.000Z',
      activationKey,
    });
    expect(idleShutdown).toEqual({
      idleSince: '2026-07-02T04:10:00.000Z',
      shutdownRequestedAt: '2026-07-02T04:12:00.000Z',
      inactivityWindowMs: 120000,
      acquisitionKey,
    });

    expect(
      createChildProcessOutputTail({
        handle,
        limit: 2,
        stdout: ['boot', 'warming', 'ready'],
        stderr: ['warn-1', 'warn-2', 'warn-3'],
      })
    ).toEqual({
      handle,
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
    });

    expect(
      createChildProcessOutputTail({
        handle,
        limit: 0,
        stdout: ['boot', 'warming'],
        stderr: ['warn'],
      })
    ).toEqual({
      handle,
      limit: 0,
      stdout: [],
      stderr: [],
      truncated: {
        stdout: true,
        stderr: true,
      },
      totalCaptured: {
        stdout: 2,
        stderr: 1,
      },
    });

    expect(
      createChildProcessOutputTail({
        handle,
        limit: -3,
        stdout: ['boot'],
        stderr: ['warn-1', 'warn-2'],
      })
    ).toEqual({
      handle,
      limit: 0,
      stdout: [],
      stderr: [],
      truncated: {
        stdout: true,
        stderr: true,
      },
      totalCaptured: {
        stdout: 1,
        stderr: 2,
      },
    });

    for (const limit of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(
        createChildProcessOutputTail({
          handle,
          limit,
          stdout: ['boot', 'warming', 'ready'],
          stderr: ['warn'],
        })
      ).toEqual({
        handle,
        limit: 0,
        stdout: [],
        stderr: [],
        truncated: {
          stdout: true,
          stderr: true,
        },
        totalCaptured: {
          stdout: 3,
          stderr: 1,
        },
      });
    }
  });

  it('covers duplicate prevention outcomes for claimed, already-running, duplicate, and error', async () => {
    const handle = makeHandle('child:provider-host:001');
    const activationKey = makeActivationKey('activation:provider-host:001');
    const acquisitionKey = makeAcquisitionKey('acquisition:provider-host:001');

    const claim = createProviderLifecycleClaimFact({
      activationKey,
      acquisitionKey,
      provider: 'mlx_lm.server',
      claimedAt: '2026-07-02T04:00:01.000Z',
    });
    const running = createProviderLifecycleDuplicateFact({
      activationKey,
      acquisitionKey,
      provider: 'mlx_lm.server',
      handle,
      detectedAt: '2026-07-02T04:00:02.000Z',
      disposition: 'already_running',
    });
    const duplicate = createProviderLifecycleDuplicateFact({
      activationKey,
      acquisitionKey,
      provider: 'mlx_lm.server',
      handle,
      detectedAt: '2026-07-02T04:00:03.000Z',
      disposition: 'duplicate',
    });

    const childProcessPort: ChildProcessPort = {
      claimDuplicate(input) {
        if (input.provider === 'mlx_lm.server') {
          return { outcome: 'claimed', claim };
        }
        if (input.provider === 'mlx_lm.reuse') {
          return { outcome: 'already_running', running };
        }
        if (input.provider === 'mlx_lm.duplicate') {
          return { outcome: 'duplicate', duplicate };
        }
        return {
          outcome: 'error',
          error: createNodeProviderLifecycleFailure({
            code: 'duplicate',
            message: 'Claim registry lookup failed.',
            retryable: true,
            details: { provider: input.provider },
          }),
        };
      },
      spawn() {
        throw new Error('not used');
      },
      signal() {
        throw new Error('not used');
      },
      observeExit() {
        throw new Error('not used');
      },
      tailOutput() {
        throw new Error('not used');
      },
    };

    expect(
      await childProcessPort.claimDuplicate({
        activationKey,
        acquisitionKey,
        provider: 'mlx_lm.server',
      })
    ).toEqual({
      outcome: 'claimed',
      claim,
    });
    expect(
      await childProcessPort.claimDuplicate({
        activationKey,
        acquisitionKey,
        provider: 'mlx_lm.reuse',
      })
    ).toEqual({
      outcome: 'already_running',
      running,
    });
    expect(
      await childProcessPort.claimDuplicate({
        activationKey,
        acquisitionKey,
        provider: 'mlx_lm.duplicate',
      })
    ).toEqual({
      outcome: 'duplicate',
      duplicate,
    });
    expect(
      await childProcessPort.claimDuplicate({
        activationKey,
        acquisitionKey,
        provider: 'mlx_lm.error',
      })
    ).toEqual({
      outcome: 'error',
      error: {
        code: 'duplicate',
        message: 'Claim registry lookup failed.',
        retryable: true,
        details: { provider: 'mlx_lm.error' },
      },
    });
  });

  it('covers spawn reused and failed lifecycle outcomes including missing executable port conflict and startup timeout', async () => {
    const handle = makeHandle('child:provider-host:001');
    const activationKey = makeActivationKey('activation:provider-host:001');
    const acquisitionKey = makeAcquisitionKey('acquisition:provider-host:001');

    const spawned = createProviderLifecycleProcessFact({
      handle,
      activationKey,
      acquisitionKey,
      provider: 'mlx_lm.server',
      pid: 4242,
      processGroup: 'isolated',
      startedAt: '2026-07-02T04:00:05.000Z',
    });
    const reused = createProviderLifecycleProcessFact({
      handle,
      activationKey,
      acquisitionKey,
      provider: 'mlx_lm.reuse',
      pid: 4343,
      processGroup: 'shared',
      startedAt: '2026-07-02T04:00:06.000Z',
    });

    const childProcessPort: ChildProcessPort = {
      claimDuplicate() {
        throw new Error('not used');
      },
      spawn(input) {
        if (input.provider === 'mlx_lm.server') {
          return { outcome: 'spawned', process: spawned };
        }
        if (input.provider === 'mlx_lm.reuse') {
          return { outcome: 'reused', process: reused };
        }

        const code =
          input.provider === 'mlx_lm.missing'
            ? 'missing_executable'
            : input.provider === 'mlx_lm.port-conflict'
              ? 'port_conflict'
              : 'startup_timeout';
        return {
          outcome: 'failed',
          failure: createNodeProviderLifecycleFailure({
            code,
            message: `${input.provider} failed during startup`,
            retryable: code !== 'missing_executable',
            details: {
              executable: input.executable,
              provider: input.provider,
            },
          }),
        };
      },
      signal() {
        throw new Error('not used');
      },
      observeExit() {
        throw new Error('not used');
      },
      tailOutput() {
        throw new Error('not used');
      },
    };

    expect(
      await childProcessPort.spawn({
        activationKey,
        acquisitionKey,
        provider: 'mlx_lm.server',
        executable: 'python',
        args: ['-m', 'mlx_lm.server'],
        processGroup: 'isolated',
      })
    ).toEqual({
      outcome: 'spawned',
      process: spawned,
    });
    expect(
      await childProcessPort.spawn({
        activationKey,
        acquisitionKey,
        provider: 'mlx_lm.reuse',
        executable: 'python',
        args: ['-m', 'mlx_lm.server'],
        processGroup: 'shared',
      })
    ).toEqual({
      outcome: 'reused',
      process: reused,
    });
    expect(
      await childProcessPort.spawn({
        activationKey,
        acquisitionKey,
        provider: 'mlx_lm.missing',
        executable: 'missing-python',
        args: ['-m', 'mlx_lm.server'],
        processGroup: 'isolated',
      })
    ).toEqual({
      outcome: 'failed',
      failure: {
        code: 'missing_executable',
        message: 'mlx_lm.missing failed during startup',
        retryable: false,
        details: {
          executable: 'missing-python',
          provider: 'mlx_lm.missing',
        },
      },
    });
    expect(
      await childProcessPort.spawn({
        activationKey,
        acquisitionKey,
        provider: 'mlx_lm.port-conflict',
        executable: 'python',
        args: ['-m', 'mlx_lm.server'],
        processGroup: 'isolated',
      })
    ).toEqual({
      outcome: 'failed',
      failure: {
        code: 'port_conflict',
        message: 'mlx_lm.port-conflict failed during startup',
        retryable: true,
        details: {
          executable: 'python',
          provider: 'mlx_lm.port-conflict',
        },
      },
    });
    expect(
      await childProcessPort.spawn({
        activationKey,
        acquisitionKey,
        provider: 'mlx_lm.timeout',
        executable: 'python',
        args: ['-m', 'mlx_lm.server'],
        processGroup: 'isolated',
      })
    ).toEqual({
      outcome: 'failed',
      failure: {
        code: 'startup_timeout',
        message: 'mlx_lm.timeout failed during startup',
        retryable: true,
        details: {
          executable: 'python',
          provider: 'mlx_lm.timeout',
        },
      },
    });
  });

  it('covers signal tail readiness and exit outcomes with lifecycle-specific failure data', async () => {
    const handle = makeHandle('child:provider-host:001');
    const activationKey = makeActivationKey('activation:provider-host:001');
    const acquisitionKey = makeAcquisitionKey('acquisition:provider-host:001');
    const cancellation = createProviderLifecycleCancellationFact({
      requestedBy: 'runtime',
      reason: 'readiness_failed',
      requestedAt: '2026-07-02T04:00:10.000Z',
      activationKey,
    });
    const idleShutdown = createProviderLifecycleIdleShutdownFact({
      idleSince: '2026-07-02T04:09:00.000Z',
      shutdownRequestedAt: '2026-07-02T04:10:00.000Z',
      inactivityWindowMs: 60000,
      acquisitionKey,
    });
    const readyFact = createProviderLifecycleReadinessFact({
      handle,
      attempt: 1,
      strategy: 'http',
      target: 'http://127.0.0.1:8080/health',
      observedAt: '2026-07-02T04:00:11.000Z',
      detail: '200 OK',
    });
    const waitingFact = createProviderLifecycleReadinessFact({
      handle,
      attempt: 2,
      strategy: 'stderr',
      target: 'stdout:ready',
      observedAt: '2026-07-02T04:00:12.000Z',
      detail: 'still warming',
    });
    const crashedExit = createProviderLifecycleExitFact({
      handle,
      exitOutcome: 'crashed',
      exitCode: 1,
      signal: null,
      observedAt: '2026-07-02T04:00:13.000Z',
    });
    const cancelledExit = createProviderLifecycleExitFact({
      handle,
      exitOutcome: 'cancelled',
      exitCode: null,
      signal: 'SIGTERM',
      observedAt: '2026-07-02T04:00:14.000Z',
      cancellation,
      idleShutdown,
    });

    const childProcessPort: ChildProcessPort = {
      claimDuplicate() {
        throw new Error('not used');
      },
      spawn() {
        throw new Error('not used');
      },
      signal(input) {
        if (input.signal === 'SIGTERM') {
          return {
            outcome: 'signaled',
            fact: createProviderLifecycleSignalFact({
              handle: input.handle,
              signal: input.signal,
              reason: input.reason,
              observedAt: '2026-07-02T04:00:15.000Z',
              cancellation: input.cancellation,
              idleShutdown: input.idleShutdown,
            }),
          };
        }
        if (input.signal === 'SIGINT') {
          return {
            outcome: 'missing',
            handle: input.handle,
            signal: input.signal,
          };
        }
        return {
          outcome: 'failed',
          failure: createNodeProviderLifecycleFailure({
            code: 'signal_failed',
            message: 'Process group rejected SIGKILL.',
            retryable: false,
            details: { handle: input.handle, signal: input.signal },
          }),
        };
      },
      observeExit() {
        return {
          outcome: 'running',
          handle,
        };
      },
      tailOutput(input) {
        if (input.limit === 1) {
          return {
            outcome: 'tailed',
            tail: createChildProcessOutputTail({
              handle: input.handle,
              limit: input.limit,
              stdout: ['boot', 'ready'],
              stderr: ['warn'],
            }),
          };
        }
        if (input.limit === 5) {
          return {
            outcome: 'failed',
            failure: createNodeProviderLifecycleFailure({
              code: 'output_backpressure',
              message: 'stderr consumer is saturated.',
              retryable: true,
              details: { handle: input.handle, limit: input.limit },
            }),
          };
        }
        return {
          outcome: 'failed',
          failure: createNodeProviderLifecycleFailure({
            code: 'tail_failed',
            message: 'Unable to read bounded process output tail.',
            retryable: false,
            details: { handle: input.handle, limit: input.limit },
          }),
        };
      },
    };

    const readinessPort: ProviderReadinessPort = {
      check(input) {
        if (input.attempt === 1) {
          return {
            outcome: 'ready',
            fact: readyFact,
          };
        }
        if (input.attempt === 2) {
          return {
            outcome: 'waiting',
            fact: waitingFact,
          };
        }
        if (input.attempt === 3) {
          return {
            outcome: 'failed',
            failure: createNodeProviderLifecycleFailure({
              code: 'readiness_failed',
              message: 'Probe returned 503.',
              retryable: true,
              details: { attempt: input.attempt },
            }),
            fact: createProviderLifecycleReadinessFact({
              handle: input.handle,
              attempt: input.attempt,
              strategy: input.strategy,
              target: input.target,
              observedAt: '2026-07-02T04:00:16.000Z',
              detail: '503 Service Unavailable',
            }),
            exit: crashedExit,
            cancellation,
          };
        }
        return {
          outcome: 'error',
          error: createNodeProviderLifecycleFailure({
            code: 'invalid_request',
            message: 'Unsupported readiness target format.',
            retryable: false,
            details: { target: input.target },
          }),
        };
      },
    };

    expect(
      await childProcessPort.signal({
        handle,
        signal: 'SIGTERM',
        reason: 'idle_shutdown',
        cancellation,
        idleShutdown,
      })
    ).toEqual({
      outcome: 'signaled',
      fact: {
        handle,
        signal: 'SIGTERM',
        reason: 'idle_shutdown',
        observedAt: '2026-07-02T04:00:15.000Z',
        cancellation,
        idleShutdown,
      },
    });
    expect(
      await childProcessPort.signal({
        handle,
        signal: 'SIGINT',
        reason: 'restart',
      })
    ).toEqual({
      outcome: 'missing',
      handle,
      signal: 'SIGINT',
    });
    expect(
      await childProcessPort.signal({
        handle,
        signal: 'SIGKILL',
        reason: 'shutdown',
      })
    ).toEqual({
      outcome: 'failed',
      failure: {
        code: 'signal_failed',
        message: 'Process group rejected SIGKILL.',
        retryable: false,
        details: { handle, signal: 'SIGKILL' },
      },
    });

    expect(await childProcessPort.tailOutput({ handle, limit: 1 })).toEqual({
      outcome: 'tailed',
      tail: {
        handle,
        limit: 1,
        stdout: ['ready'],
        stderr: ['warn'],
        truncated: {
          stdout: true,
          stderr: false,
        },
        totalCaptured: {
          stdout: 2,
          stderr: 1,
        },
      },
    });
    expect(await childProcessPort.tailOutput({ handle, limit: 5 })).toEqual({
      outcome: 'failed',
      failure: {
        code: 'output_backpressure',
        message: 'stderr consumer is saturated.',
        retryable: true,
        details: { handle, limit: 5 },
      },
    });
    expect(await childProcessPort.tailOutput({ handle, limit: 6 })).toEqual({
      outcome: 'failed',
      failure: {
        code: 'tail_failed',
        message: 'Unable to read bounded process output tail.',
        retryable: false,
        details: { handle, limit: 6 },
      },
    });

    expect(
      await readinessPort.check({
        handle,
        attempt: 1,
        strategy: 'http',
        target: 'http://127.0.0.1:8080/health',
      })
    ).toEqual({
      outcome: 'ready',
      fact: readyFact,
    });
    expect(
      await readinessPort.check({
        handle,
        attempt: 2,
        strategy: 'stderr',
        target: 'stdout:ready',
      })
    ).toEqual({
      outcome: 'waiting',
      fact: waitingFact,
    });
    expect(
      await readinessPort.check({
        handle,
        attempt: 3,
        strategy: 'http',
        target: 'http://127.0.0.1:8080/health',
      })
    ).toEqual({
      outcome: 'failed',
      failure: {
        code: 'readiness_failed',
        message: 'Probe returned 503.',
        retryable: true,
        details: { attempt: 3 },
      },
      fact: {
        handle,
        attempt: 3,
        strategy: 'http',
        target: 'http://127.0.0.1:8080/health',
        observedAt: '2026-07-02T04:00:16.000Z',
        detail: '503 Service Unavailable',
      },
      exit: crashedExit,
      cancellation,
    });
    expect(
      await readinessPort.check({
        handle,
        attempt: 4,
        strategy: 'custom',
        target: 'bad-target',
      })
    ).toEqual({
      outcome: 'error',
      error: {
        code: 'invalid_request',
        message: 'Unsupported readiness target format.',
        retryable: false,
        details: { target: 'bad-target' },
      },
    });

    expect(
      createProviderLifecycleReadinessFact({
        handle,
        attempt: 5,
        strategy: 'custom',
        target: 'stderr:ready',
        observedAt: '2026-07-02T04:00:18.000Z',
        detail: '',
      })
    ).toEqual({
      handle,
      attempt: 5,
      strategy: 'custom',
      target: 'stderr:ready',
      observedAt: '2026-07-02T04:00:18.000Z',
      detail: '',
    });

    expect(await childProcessPort.observeExit({ handle })).toEqual({
      outcome: 'running',
      handle,
    });
    expect(crashedExit).toEqual({
      handle,
      exitOutcome: 'crashed',
      exitCode: 1,
      signal: null,
      observedAt: '2026-07-02T04:00:13.000Z',
    });
    expect(cancelledExit).toEqual({
      handle,
      exitOutcome: 'cancelled',
      exitCode: null,
      signal: 'SIGTERM',
      observedAt: '2026-07-02T04:00:14.000Z',
      cancellation,
      idleShutdown,
    });
    expect(
      createProviderLifecycleExitFact({
        handle,
        exitOutcome: 'exited',
        exitCode: 0,
        signal: null,
        observedAt: '2026-07-02T04:00:17.000Z',
      })
    ).toEqual({
      handle,
      exitOutcome: 'exited',
      exitCode: 0,
      signal: null,
      observedAt: '2026-07-02T04:00:17.000Z',
    });
  });

  it('keeps the lifecycle contract visible only from the node entrypoint', () => {
    expect(nodeEntry.createChildProcessHandle).toBeTypeOf('function');
    expect(nodeEntry.parseProviderLifecycleActivationKey).toBeTypeOf('function');
    expect(nodeEntry.createProviderLifecycleProcessFact).toBeTypeOf('function');

    expect('createChildProcessHandle' in browserEntry).toBe(false);
    expect('createChildProcessHandle' in rootEntry).toBe(false);
    expect('createProviderLifecycleProcessFact' in browserEntry).toBe(false);
    expect('createProviderLifecycleProcessFact' in rootEntry).toBe(false);
  });
});
