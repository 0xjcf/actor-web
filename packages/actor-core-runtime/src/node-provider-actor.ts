import type {
  ChildProcessClaimDuplicateResult,
  ChildProcessHandle,
  ChildProcessPort,
  ChildProcessSignalResult,
  ChildProcessSpawnResult,
  NodeProviderLifecycleFailure,
  ProviderLifecycleAcquisitionKey,
  ProviderLifecycleActivationKey,
  ProviderReadinessCheckResult,
  ProviderReadinessPort,
  ProviderReadinessStrategy,
} from './node-provider-lifecycle-contract.js';
import {
  createNodeProviderLifecycleFailure,
  createProviderLifecycleCancellationFact,
  createProviderLifecycleIdleShutdownFact,
} from './node-provider-lifecycle-contract.js';
import type {
  NodeProviderLifecycleCancellationResult,
  NodeProviderLifecycleEffectClaimInput,
  NodeProviderLifecycleEffectJournal,
  NodeProviderLifecycleFilesystemProbeResult,
  NodeProviderLifecycleModelCacheInspectionResult,
} from './node-provider-lifecycle-effect-journal.js';
import {
  createNodeProviderLifecycleEffectIdempotencyKey,
  createNodeProviderLifecycleEffectRecord,
} from './node-provider-lifecycle-effect-journal.js';

export type NodeProviderActorStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'failed';

export interface NodeProviderActorOutputProjection {
  readonly lines: readonly string[];
  readonly truncated: boolean;
  readonly totalCaptured: number;
}

export interface NodeProviderActorProjection {
  readonly status: NodeProviderActorStatus;
  readonly activationKey: ProviderLifecycleActivationKey | null;
  readonly acquisitionKey: ProviderLifecycleAcquisitionKey | null;
  readonly handle: ChildProcessHandle | null;
  readonly endpoint: string | null;
  readonly ready: boolean;
  readonly failure: NodeProviderLifecycleFailure | null;
  readonly restartCount: number;
  readonly idleSince: string | null;
  readonly idleDeadline: string | null;
  readonly stdoutTail: NodeProviderActorOutputProjection;
  readonly stderrTail: NodeProviderActorOutputProjection;
  readonly lastObservedAt: string | null;
}

export type NodeProviderActorCommand =
  | {
      readonly type: 'ACQUIRE_PROVIDER';
      readonly activationKey: ProviderLifecycleActivationKey;
      readonly acquisitionKey: ProviderLifecycleAcquisitionKey;
    }
  | {
      readonly type: 'CANCEL_PROVIDER';
      readonly requestedBy?: 'operator' | 'runtime' | 'host';
      readonly reason?:
        | 'activation_replaced'
        | 'shutdown_requested'
        | 'readiness_failed'
        | 'duplicate_detected';
    }
  | {
      readonly type: 'CHECK_PROVIDER_READINESS';
    }
  | {
      readonly type: 'RELEASE_PROVIDER';
      readonly acquisitionKey?: ProviderLifecycleAcquisitionKey;
    }
  | {
      readonly type: 'TICK_IDLE_SHUTDOWN';
    }
  | {
      readonly type: 'OBSERVE_PROVIDER_EXIT';
    };

export interface NodeProviderActorFilesystemPort {
  probe(
    input: Readonly<{
      target: string;
    }>
  ):
    | NodeProviderLifecycleFilesystemProbeResult
    | Promise<NodeProviderLifecycleFilesystemProbeResult>;
}

export interface NodeProviderActorModelCachePort {
  inspect(
    input: Readonly<{
      provider: string;
      modelId: string;
      cacheKey: string;
    }>
  ):
    | NodeProviderLifecycleModelCacheInspectionResult
    | Promise<NodeProviderLifecycleModelCacheInspectionResult>;
}

export interface NodeProviderActorClock {
  nowIso(): string;
  nowMs(): number;
}

export interface NodeProviderActorPorts {
  readonly childProcess: ChildProcessPort;
  readonly readiness: ProviderReadinessPort;
  readonly filesystem: NodeProviderActorFilesystemPort;
  readonly modelCache: NodeProviderActorModelCachePort;
  readonly journal: NodeProviderLifecycleEffectJournal;
  readonly clock: NodeProviderActorClock;
}

export interface NodeProviderActorOptions {
  readonly provider: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly endpoint: string;
  readonly processGroup: 'isolated' | 'shared' | 'none';
  readonly readiness: Readonly<{
    strategy: ProviderReadinessStrategy;
    target: string;
    startupTimeoutMs: number;
  }>;
  readonly idleShutdownMs: number;
  readonly outputTailLimit: number;
  readonly filesystemProbeTarget: string;
  readonly modelId: string;
  readonly modelCacheKey: string;
  readonly ports: NodeProviderActorPorts;
}

export interface NodeProviderActor {
  dispatch(command: NodeProviderActorCommand): Promise<NodeProviderActorProjection>;
  getSnapshot(): NodeProviderActorProjection;
}

function emptyOutputProjection(): NodeProviderActorOutputProjection {
  return {
    lines: [],
    truncated: false,
    totalCaptured: 0,
  };
}

function createInitialProjection(): NodeProviderActorProjection {
  return {
    status: 'idle',
    activationKey: null,
    acquisitionKey: null,
    handle: null,
    endpoint: null,
    ready: false,
    failure: null,
    restartCount: 0,
    idleSince: null,
    idleDeadline: null,
    stdoutTail: emptyOutputProjection(),
    stderrTail: emptyOutputProjection(),
    lastObservedAt: null,
  };
}

function toOutputProjection(
  tail: Readonly<{
    readonly stdout: readonly string[];
    readonly stderr: readonly string[];
    readonly truncated: {
      readonly stdout: boolean;
      readonly stderr: boolean;
    };
    readonly totalCaptured: {
      readonly stdout: number;
      readonly stderr: number;
    };
  }>
): Pick<NodeProviderActorProjection, 'stdoutTail' | 'stderrTail'> {
  return {
    stdoutTail: {
      lines: tail.stdout,
      truncated: tail.truncated.stdout,
      totalCaptured: tail.totalCaptured.stdout,
    },
    stderrTail: {
      lines: tail.stderr,
      truncated: tail.truncated.stderr,
      totalCaptured: tail.totalCaptured.stderr,
    },
  };
}

function projectFailure(
  projection: NodeProviderActorProjection,
  failure: NodeProviderLifecycleFailure,
  observedAt: string | null
): NodeProviderActorProjection {
  return {
    ...projection,
    status: 'failed',
    ready: false,
    failure,
    idleSince: null,
    idleDeadline: null,
    lastObservedAt: observedAt,
  };
}

function createActorFailure(
  code: NodeProviderLifecycleFailure['code'],
  message: string,
  details?: NodeProviderLifecycleFailure['details']
): NodeProviderLifecycleFailure {
  return createNodeProviderLifecycleFailure({
    code,
    message,
    retryable: false,
    ...(details === undefined ? {} : { details }),
  });
}

type JournaledEffectResult<TResult> =
  | {
      readonly outcome: 'recorded';
      readonly result: TResult;
      readonly replayed: boolean;
    }
  | {
      readonly outcome: 'error';
      readonly failure: NodeProviderLifecycleFailure;
    };

type NodeProviderActorEffectResult =
  | ChildProcessClaimDuplicateResult
  | ChildProcessSpawnResult
  | ChildProcessSignalResult
  | ProviderReadinessCheckResult
  | NodeProviderLifecycleFilesystemProbeResult
  | NodeProviderLifecycleModelCacheInspectionResult
  | NodeProviderLifecycleCancellationResult;

function toThrownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createEffectThrowFailure(input: {
  readonly kind: NodeProviderLifecycleEffectClaimInput['kind'];
  readonly operationKey: string;
  readonly phase: 'perform' | 'record';
  readonly error: unknown;
}): NodeProviderLifecycleFailure {
  const message = toThrownErrorMessage(input.error);
  return createActorFailure(
    'invalid_request',
    `Node provider actor ${input.phase} failed for lifecycle effect "${input.kind}": ${message}`,
    {
      kind: input.kind,
      operationKey: input.operationKey,
      phase: input.phase,
      message,
    }
  );
}

function createStructuredEffectFailureResult(
  kind: NodeProviderLifecycleEffectClaimInput['kind'],
  failure: NodeProviderLifecycleFailure
): NodeProviderActorEffectResult {
  switch (kind) {
    case 'duplicate_prevention':
      return {
        outcome: 'error',
        error: failure,
      };
    case 'readiness':
      return {
        outcome: 'failed',
        failure,
      };
    case 'spawn':
    case 'signal':
    case 'filesystem_probe':
    case 'model_cache_inspect':
    case 'cancellation':
      return {
        outcome: 'failed',
        failure,
      };
  }
}

export function createNodeProviderActor(options: NodeProviderActorOptions): NodeProviderActor {
  let projection = createInitialProjection();
  let readinessAttempts = 0;
  let startupStartedAtMs: number | null = null;

  async function runEffect<TResult extends NodeProviderActorEffectResult>(params: {
    readonly kind:
      | 'duplicate_prevention'
      | 'spawn'
      | 'signal'
      | 'readiness'
      | 'filesystem_probe'
      | 'model_cache_inspect'
      | 'cancellation';
    readonly operationKey: string;
    readonly activationKey?: ProviderLifecycleActivationKey;
    readonly acquisitionKey?: ProviderLifecycleAcquisitionKey;
    readonly handle?: ChildProcessHandle;
    readonly target?: string;
    readonly perform: () => TResult | Promise<TResult>;
  }): Promise<JournaledEffectResult<TResult>> {
    const keyResult = createNodeProviderLifecycleEffectIdempotencyKey({
      kind: params.kind,
      provider: options.provider,
      operationKey: params.operationKey,
      activationKey: params.activationKey,
      acquisitionKey: params.acquisitionKey,
      handle: params.handle,
      target: params.target,
    });
    if (keyResult.outcome !== 'valid') {
      return {
        outcome: 'error',
        failure: createActorFailure(
          'invalid_request',
          'Node provider actor could not create a lifecycle effect key.',
          {
            kind: params.kind,
            operationKey: params.operationKey,
          }
        ),
      };
    }

    const claim = await options.ports.journal.claim({
      idempotencyKey: keyResult.value,
      kind: params.kind,
    });
    if (claim.outcome === 'error') {
      return {
        outcome: 'error',
        failure: claim.failure,
      };
    }
    if (claim.outcome === 'duplicate') {
      if (claim.record) {
        return {
          outcome: 'recorded',
          result: claim.record.result as TResult,
          replayed: true,
        };
      }
      return {
        outcome: 'error',
        failure: createActorFailure(
          'duplicate',
          'Node provider actor observed an already-pending lifecycle effect.',
          {
            kind: params.kind,
            operationKey: params.operationKey,
          }
        ),
      };
    }

    const result = await (async (): Promise<TResult> => {
      try {
        return await params.perform();
      } catch (error) {
        return createStructuredEffectFailureResult(
          params.kind,
          createEffectThrowFailure({
            kind: params.kind,
            operationKey: params.operationKey,
            phase: 'perform',
            error,
          })
        ) as TResult;
      }
    })();
    const record = createNodeProviderLifecycleEffectRecord({
      idempotencyKey: keyResult.value,
      kind: params.kind,
      recordedAt: options.ports.clock.nowIso(),
      result,
    } as never);
    const recorded = await (async () => {
      try {
        return await options.ports.journal.record(record);
      } catch (error) {
        const failureRecord = createNodeProviderLifecycleEffectRecord({
          idempotencyKey: keyResult.value,
          kind: params.kind,
          recordedAt: options.ports.clock.nowIso(),
          result: createStructuredEffectFailureResult(
            params.kind,
            createEffectThrowFailure({
              kind: params.kind,
              operationKey: params.operationKey,
              phase: 'record',
              error,
            })
          ),
        } as never);
        return await options.ports.journal.record(failureRecord);
      }
    })();
    if (recorded.outcome === 'error') {
      return {
        outcome: 'error',
        failure: recorded.failure,
      };
    }
    if (recorded.outcome === 'missing_claim') {
      return {
        outcome: 'error',
        failure: createActorFailure(
          'invalid_request',
          'Node provider actor could not persist a lifecycle effect record.',
          {
            kind: params.kind,
            operationKey: params.operationKey,
          }
        ),
      };
    }
    return {
      outcome: 'recorded',
      result:
        recorded.outcome === 'already_recorded'
          ? (recorded.record.result as TResult)
          : (recorded.record.result as TResult),
      replayed: recorded.outcome === 'already_recorded',
    };
  }

  async function captureOutputTail(
    handle: ChildProcessHandle
  ): Promise<NodeProviderLifecycleFailure | null> {
    const tail = await options.ports.childProcess.tailOutput({
      handle,
      limit: options.outputTailLimit,
    });
    if (tail.outcome === 'failed') {
      return tail.failure;
    }
    projection = {
      ...projection,
      ...toOutputProjection(tail.tail),
    };
    return null;
  }

  async function acquireProvider(
    activationKey: ProviderLifecycleActivationKey,
    acquisitionKey: ProviderLifecycleAcquisitionKey
  ): Promise<NodeProviderActorProjection> {
    projection = {
      ...projection,
      activationKey,
      acquisitionKey,
      endpoint: options.endpoint,
      failure: null,
      idleSince: null,
      idleDeadline: null,
      lastObservedAt: options.ports.clock.nowIso(),
    };

    const filesystem = await runEffect({
      kind: 'filesystem_probe',
      operationKey: `filesystem:${options.filesystemProbeTarget}`,
      activationKey,
      acquisitionKey,
      target: options.filesystemProbeTarget,
      perform: () =>
        options.ports.filesystem.probe({
          target: options.filesystemProbeTarget,
        }),
    });
    if (filesystem.outcome === 'error') {
      projection = projectFailure(projection, filesystem.failure, options.ports.clock.nowIso());
      return projection;
    }
    if (filesystem.result.outcome === 'failed') {
      projection = projectFailure(
        projection,
        filesystem.result.failure,
        options.ports.clock.nowIso()
      );
      return projection;
    }

    const modelCache = await runEffect({
      kind: 'model_cache_inspect',
      operationKey: `cache:${options.modelCacheKey}`,
      activationKey,
      acquisitionKey,
      perform: () =>
        options.ports.modelCache.inspect({
          provider: options.provider,
          modelId: options.modelId,
          cacheKey: options.modelCacheKey,
        }),
    });
    if (modelCache.outcome === 'error') {
      projection = projectFailure(projection, modelCache.failure, options.ports.clock.nowIso());
      return projection;
    }
    if (modelCache.result.outcome === 'failed') {
      projection = projectFailure(
        projection,
        modelCache.result.failure,
        options.ports.clock.nowIso()
      );
      return projection;
    }

    const duplicate = await runEffect({
      kind: 'duplicate_prevention',
      operationKey: `acquire:${activationKey}:${acquisitionKey}`,
      activationKey,
      acquisitionKey,
      perform: () =>
        options.ports.childProcess.claimDuplicate({
          activationKey,
          acquisitionKey,
          provider: options.provider,
        }),
    });
    if (duplicate.outcome === 'error') {
      projection = projectFailure(projection, duplicate.failure, options.ports.clock.nowIso());
      return projection;
    }

    if (duplicate.result.outcome === 'already_running') {
      projection = {
        ...projection,
        status: 'running',
        handle: duplicate.result.running.handle,
        ready: true,
        failure: null,
        idleSince: null,
        lastObservedAt: duplicate.result.running.detectedAt,
      };
      readinessAttempts = 0;
      startupStartedAtMs = null;
      return projection;
    }

    if (duplicate.result.outcome === 'duplicate') {
      projection = {
        ...projection,
        status: projection.handle ? projection.status : 'starting',
        handle: duplicate.result.duplicate.handle,
        ready: projection.ready,
        failure: createActorFailure(
          'duplicate',
          'Provider acquisition was already in progress or already satisfied.',
          {
            disposition: duplicate.result.duplicate.disposition,
            activationKey,
            acquisitionKey,
          }
        ),
        lastObservedAt: duplicate.result.duplicate.detectedAt,
      };
      return projection;
    }

    if (duplicate.result.outcome === 'error') {
      projection = projectFailure(projection, duplicate.result.error, options.ports.clock.nowIso());
      return projection;
    }

    const spawn = await runEffect({
      kind: 'spawn',
      operationKey: `spawn:${activationKey}:${acquisitionKey}`,
      activationKey,
      acquisitionKey,
      perform: () =>
        options.ports.childProcess.spawn({
          activationKey,
          acquisitionKey,
          provider: options.provider,
          executable: options.executable,
          args: options.args,
          processGroup: options.processGroup,
        }),
    });
    if (spawn.outcome === 'error') {
      projection = projectFailure(projection, spawn.failure, options.ports.clock.nowIso());
      return projection;
    }
    if (spawn.result.outcome === 'failed') {
      projection = projectFailure(projection, spawn.result.failure, options.ports.clock.nowIso());
      return projection;
    }

    const process = spawn.result.process;
    projection = {
      ...projection,
      status: 'starting',
      handle: process.handle,
      endpoint: options.endpoint,
      ready: false,
      failure: null,
      idleSince: null,
      idleDeadline: null,
      lastObservedAt: process.startedAt,
    };
    readinessAttempts = 0;
    startupStartedAtMs = options.ports.clock.nowMs();
    return projection;
  }

  async function failReadinessAndSignal(
    failure: NodeProviderLifecycleFailure,
    observedAt: string | null
  ): Promise<NodeProviderActorProjection> {
    const handle = projection.handle;
    projection = projectFailure(projection, failure, observedAt);
    startupStartedAtMs = null;
    if (!handle) {
      return projection;
    }

    const cancellation = createProviderLifecycleCancellationFact({
      requestedBy: 'runtime',
      reason: 'readiness_failed',
      requestedAt: options.ports.clock.nowIso(),
      ...(projection.activationKey ? { activationKey: projection.activationKey } : {}),
    });
    const cancellationEffect = await runEffect({
      kind: 'cancellation',
      operationKey: `cancellation:readiness_failed:${handle}`,
      activationKey: projection.activationKey ?? undefined,
      acquisitionKey: projection.acquisitionKey ?? undefined,
      handle,
      perform: () => ({
        outcome: 'cancelled' as const,
        fact: cancellation,
      }),
    });
    if (cancellationEffect.outcome === 'error') {
      projection = projectFailure(
        projection,
        cancellationEffect.failure,
        options.ports.clock.nowIso()
      );
      return projection;
    }
    const signal = await runEffect({
      kind: 'signal',
      operationKey: `signal:readiness_failed:${handle}`,
      activationKey: projection.activationKey ?? undefined,
      acquisitionKey: projection.acquisitionKey ?? undefined,
      handle,
      perform: () =>
        options.ports.childProcess.signal({
          handle,
          signal: 'SIGTERM',
          reason: 'cancellation',
          cancellation: cancellationEffect.result.fact,
        }),
    });
    if (signal.outcome === 'error') {
      projection = projectFailure(projection, signal.failure, options.ports.clock.nowIso());
      return projection;
    }
    if (signal.result.outcome === 'failed') {
      projection = projectFailure(projection, signal.result.failure, options.ports.clock.nowIso());
      return projection;
    }
    return projection;
  }

  async function checkReadiness(): Promise<NodeProviderActorProjection> {
    if (!projection.handle || projection.status === 'idle' || projection.status === 'failed') {
      return projection;
    }

    const nowMs = options.ports.clock.nowMs();
    if (
      startupStartedAtMs !== null &&
      !projection.ready &&
      nowMs - startupStartedAtMs >= options.readiness.startupTimeoutMs
    ) {
      return failReadinessAndSignal(
        createActorFailure(
          'startup_timeout',
          'Provider readiness did not complete before the configured timeout.',
          {
            timeoutMs: options.readiness.startupTimeoutMs,
            target: options.readiness.target,
            attempts: readinessAttempts,
          }
        ),
        options.ports.clock.nowIso()
      );
    }

    readinessAttempts += 1;
    const readiness = await runEffect({
      kind: 'readiness',
      operationKey: `readiness:${projection.handle}:${readinessAttempts}`,
      activationKey: projection.activationKey ?? undefined,
      acquisitionKey: projection.acquisitionKey ?? undefined,
      handle: projection.handle,
      target: options.readiness.target,
      perform: () =>
        options.ports.readiness.check({
          handle: projection.handle as ChildProcessHandle,
          attempt: readinessAttempts,
          strategy: options.readiness.strategy,
          target: options.readiness.target,
        }),
    });

    if (readiness.outcome === 'error') {
      projection = projectFailure(projection, readiness.failure, options.ports.clock.nowIso());
      return projection;
    }

    switch (readiness.result.outcome) {
      case 'ready':
        projection = {
          ...projection,
          status: 'running',
          ready: true,
          failure: null,
          idleSince: null,
          idleDeadline: null,
          lastObservedAt: readiness.result.fact.observedAt,
        };
        startupStartedAtMs = null;
        return projection;
      case 'waiting':
        projection = {
          ...projection,
          status: 'starting',
          ready: false,
          failure: null,
          lastObservedAt: readiness.result.fact.observedAt,
        };
        return projection;
      case 'failed':
        return failReadinessAndSignal(
          readiness.result.failure,
          readiness.result.fact?.observedAt ??
            readiness.result.exit?.observedAt ??
            readiness.result.cancellation?.requestedAt ??
            options.ports.clock.nowIso()
        );
      case 'error':
        return failReadinessAndSignal(readiness.result.error, options.ports.clock.nowIso());
    }
  }

  async function cancelProvider(
    requestedBy: 'operator' | 'runtime' | 'host',
    reason: 'activation_replaced' | 'shutdown_requested' | 'readiness_failed' | 'duplicate_detected'
  ): Promise<NodeProviderActorProjection> {
    if (!projection.handle) {
      return projection;
    }

    const cancellation = createProviderLifecycleCancellationFact({
      requestedBy,
      reason,
      requestedAt: options.ports.clock.nowIso(),
      ...(projection.activationKey ? { activationKey: projection.activationKey } : {}),
    });

    const cancellationEffect = await runEffect({
      kind: 'cancellation',
      operationKey: `cancellation:${reason}:${projection.handle}`,
      activationKey: projection.activationKey ?? undefined,
      acquisitionKey: projection.acquisitionKey ?? undefined,
      handle: projection.handle,
      perform: () => ({
        outcome: 'cancelled' as const,
        fact: cancellation,
      }),
    });
    if (cancellationEffect.outcome === 'error') {
      projection = projectFailure(
        projection,
        cancellationEffect.failure,
        options.ports.clock.nowIso()
      );
      return projection;
    }

    const signal = await runEffect({
      kind: 'signal',
      operationKey: `signal:${reason}:${projection.handle}`,
      activationKey: projection.activationKey ?? undefined,
      acquisitionKey: projection.acquisitionKey ?? undefined,
      handle: projection.handle,
      perform: () =>
        options.ports.childProcess.signal({
          handle: projection.handle as ChildProcessHandle,
          signal: 'SIGTERM',
          reason: 'cancellation',
          cancellation,
        }),
    });
    if (signal.outcome === 'error') {
      projection = projectFailure(projection, signal.failure, options.ports.clock.nowIso());
      return projection;
    }

    if (signal.result.outcome === 'failed') {
      projection = projectFailure(projection, signal.result.failure, options.ports.clock.nowIso());
      return projection;
    }

    projection = {
      ...projection,
      status: 'stopping',
      ready: false,
      failure: null,
      idleSince: null,
      idleDeadline: null,
      lastObservedAt:
        signal.result.outcome === 'signaled'
          ? signal.result.fact.observedAt
          : options.ports.clock.nowIso(),
    };
    return projection;
  }

  async function tickIdleShutdown(): Promise<NodeProviderActorProjection> {
    if (
      projection.status !== 'running' ||
      !projection.handle ||
      !projection.idleSince ||
      !projection.idleDeadline ||
      options.ports.clock.nowIso() < projection.idleDeadline
    ) {
      return projection;
    }

    const idleShutdown = createProviderLifecycleIdleShutdownFact({
      idleSince: projection.idleSince,
      shutdownRequestedAt: options.ports.clock.nowIso(),
      inactivityWindowMs: options.idleShutdownMs,
      acquisitionKey: projection.acquisitionKey as ProviderLifecycleAcquisitionKey,
    });

    const signal = await runEffect({
      kind: 'signal',
      operationKey: `idle-shutdown:${projection.handle}:${projection.idleDeadline}`,
      activationKey: projection.activationKey ?? undefined,
      acquisitionKey: projection.acquisitionKey ?? undefined,
      handle: projection.handle,
      perform: () =>
        options.ports.childProcess.signal({
          handle: projection.handle as ChildProcessHandle,
          signal: 'SIGTERM',
          reason: 'idle_shutdown',
          idleShutdown,
        }),
    });
    if (signal.outcome === 'error') {
      projection = projectFailure(projection, signal.failure, options.ports.clock.nowIso());
      return projection;
    }
    if (signal.result.outcome === 'failed') {
      projection = projectFailure(projection, signal.result.failure, options.ports.clock.nowIso());
      return projection;
    }

    projection = {
      ...projection,
      status: 'stopping',
      ready: false,
      idleSince: null,
      idleDeadline: null,
      lastObservedAt:
        signal.result.outcome === 'signaled'
          ? signal.result.fact.observedAt
          : idleShutdown.shutdownRequestedAt,
    };
    return projection;
  }

  async function observeExit(): Promise<NodeProviderActorProjection> {
    if (!projection.handle) {
      return projection;
    }

    const handle = projection.handle;
    const exit = await options.ports.childProcess.observeExit({
      handle,
    });

    if (exit.outcome === 'error') {
      projection = projectFailure(projection, exit.error, options.ports.clock.nowIso());
      return projection;
    }
    if (exit.outcome === 'running') {
      projection = {
        ...projection,
        lastObservedAt: options.ports.clock.nowIso(),
      };
      return projection;
    }

    const tailFailure = await captureOutputTail(handle);
    if (tailFailure) {
      projection = projectFailure(projection, tailFailure, exit.fact.observedAt);
      return projection;
    }

    if (exit.outcome === 'crashed') {
      projection = {
        ...projection,
        status: 'failed',
        handle: null,
        ready: false,
        restartCount: projection.restartCount + 1,
        idleSince: null,
        idleDeadline: null,
        failure: createActorFailure('crashed', 'Provider process crashed.', {
          exitCode: exit.fact.exitCode,
          signal: exit.fact.signal,
        }),
        lastObservedAt: exit.fact.observedAt,
      };
    } else if (exit.outcome === 'exited') {
      projection = {
        ...projection,
        status: 'idle',
        handle: null,
        ready: false,
        idleSince: null,
        idleDeadline: null,
        failure: createActorFailure('exited', 'Provider process exited.', {
          exitCode: exit.fact.exitCode,
          signal: exit.fact.signal,
        }),
        lastObservedAt: exit.fact.observedAt,
      };
    } else {
      projection = {
        ...projection,
        status: 'idle',
        handle: null,
        ready: false,
        idleSince: null,
        idleDeadline: null,
        failure: null,
        lastObservedAt: exit.fact.observedAt,
      };
    }

    startupStartedAtMs = null;
    readinessAttempts = 0;
    return projection;
  }

  return {
    async dispatch(command): Promise<NodeProviderActorProjection> {
      switch (command.type) {
        case 'ACQUIRE_PROVIDER':
          return acquireProvider(command.activationKey, command.acquisitionKey);
        case 'CANCEL_PROVIDER':
          return cancelProvider(
            command.requestedBy ?? 'runtime',
            command.reason ?? 'shutdown_requested'
          );
        case 'CHECK_PROVIDER_READINESS':
          return checkReadiness();
        case 'RELEASE_PROVIDER':
          if (
            projection.status === 'running' &&
            projection.ready &&
            (!command.acquisitionKey || command.acquisitionKey === projection.acquisitionKey)
          ) {
            const idleDeadlineMs = options.ports.clock.nowMs() + options.idleShutdownMs;
            const idleSince = options.ports.clock.nowIso();
            projection = {
              ...projection,
              idleSince,
              idleDeadline: new Date(idleDeadlineMs).toISOString(),
              lastObservedAt: idleSince,
            };
          }
          return projection;
        case 'TICK_IDLE_SHUTDOWN':
          return tickIdleShutdown();
        case 'OBSERVE_PROVIDER_EXIT':
          return observeExit();
      }
    },
    getSnapshot(): NodeProviderActorProjection {
      return projection;
    },
  };
}
