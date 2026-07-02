import {
  createNodeProviderActor,
  type NodeProviderActor,
  type NodeProviderActorProjection,
} from '../node-provider-actor.js';
import {
  type BrandedStringParseResult,
  type ChildProcessClaimDuplicateResult,
  type ChildProcessHandle,
  type ChildProcessObserveExitResult,
  type ChildProcessSignalResult,
  type ChildProcessSpawnResult,
  type ChildProcessTailOutputResult,
  createChildProcessHandle,
  createProviderLifecycleAcquisitionKey,
  createProviderLifecycleActivationKey,
  type createProviderLifecycleCancellationFact,
  createProviderLifecycleClaimFact,
  createProviderLifecycleProcessFact,
  createProviderLifecycleReadinessFact,
  createProviderLifecycleSignalFact,
  type NodeProviderLifecycleFailure,
  type ProviderLifecycleAcquisitionKey,
  type ProviderLifecycleActivationKey,
  type ProviderReadinessCheckInput,
  type ProviderReadinessCheckResult,
} from '../node-provider-lifecycle-contract.js';
import {
  createInMemoryNodeProviderLifecycleEffectJournal,
  type InMemoryNodeProviderLifecycleEffectJournal,
  type NodeProviderLifecycleEffectJournalEntry,
  type NodeProviderLifecycleFilesystemProbeResult,
  type NodeProviderLifecycleModelCacheInspectionResult,
} from '../node-provider-lifecycle-effect-journal.js';
import { createNodeSessionActor } from '../node-session-actor.js';
import {
  createSessionActorFailure,
  type NodeSessionActor,
  type NodeSessionActorProjection,
  type SessionActorObservedProviderFact,
} from '../node-session-actor-contract.js';

/**
 * Compatibility proving slice for an embedded actor-web host behind CLI-like
 * runtime/session/provider facades. This is a deterministic fixture, not a
 * public API replacement or a real integration adapter.
 */

export interface EmbeddedRuntimeHostCompatibilityFixtureOptions {
  readonly providerId?: string;
  readonly providerLabel?: string;
  readonly endpoint?: string;
  readonly executable?: string;
  readonly args?: readonly string[];
  readonly clockStartMs?: number;
  readonly filesystemProbe?: NodeProviderLifecycleFilesystemProbeResult;
  readonly modelCacheInspect?: NodeProviderLifecycleModelCacheInspectionResult;
  readonly duplicateClaim?: ChildProcessClaimDuplicateResult;
  readonly spawn?: ChildProcessSpawnResult;
  readonly readiness?:
    | ProviderReadinessCheckResult
    | ((input: ProviderReadinessCheckInput) => ProviderReadinessCheckResult);
  readonly signal?: ChildProcessSignalResult;
  readonly observeExit?: ChildProcessObserveExitResult;
  readonly tailOutput?: ChildProcessTailOutputResult;
  readonly observedFacts?: readonly SessionActorObservedProviderFact[];
}

export interface EmbeddedRuntimeHostCompatibilityDisclaimer {
  readonly purpose: 'compatibility proving slice';
  readonly integrationBoundary: 'not a fas-local integration';
  readonly apiBoundary: 'not a public API replacement';
}

export interface EmbeddedRuntimeHostCreateSessionInput {
  readonly sessionId?: string;
  readonly openedAt?: string;
}

export interface EmbeddedRuntimeHostAcquireInput {
  readonly activationKey?: string | ProviderLifecycleActivationKey;
  readonly acquisitionKey?: string | ProviderLifecycleAcquisitionKey;
}

export interface EmbeddedRuntimeHostChatInput {
  readonly provider: EmbeddedRuntimeHostCompatibilityProvider;
  readonly turnId?: string;
  readonly submittedAt?: string;
  readonly prompt: string;
  readonly observedFacts?: readonly SessionActorObservedProviderFact[];
}

export interface EmbeddedRuntimeHostProviderCallCounts {
  readonly claimDuplicate: number;
  readonly spawn: number;
  readonly signal: number;
  readonly observeExit: number;
  readonly tailOutput: number;
  readonly readiness: number;
  readonly filesystemProbe: number;
  readonly modelCacheInspect: number;
}

type MutableProviderCallCounts = {
  -readonly [K in keyof EmbeddedRuntimeHostProviderCallCounts]: number;
};

export interface EmbeddedRuntimeHostProviderJournalProjection {
  readonly size: number;
  readonly kinds: readonly string[];
  readonly entries: Readonly<Record<string, NodeProviderLifecycleEffectJournalEntry>>;
}

export interface EmbeddedRuntimeHostProviderProjection {
  readonly providerId: string;
  readonly status: NodeProviderActorProjection['status'];
  readonly ready: boolean;
  readonly activationKey: ProviderLifecycleActivationKey | null;
  readonly acquisitionKey: ProviderLifecycleAcquisitionKey | null;
  readonly handle: ChildProcessHandle | null;
  readonly endpoint: string | null;
  readonly failure: NodeProviderLifecycleFailure | null;
  readonly restartCount: number;
  readonly idleDeadline: string | null;
  readonly lastObservedAt: string | null;
  readonly stdoutTail: NodeProviderActorProjection['stdoutTail'];
  readonly stderrTail: NodeProviderActorProjection['stderrTail'];
  readonly calls: EmbeddedRuntimeHostProviderCallCounts;
  readonly journal: EmbeddedRuntimeHostProviderJournalProjection;
}

export interface EmbeddedRuntimeHostProviderFactEvent {
  readonly type: 'provider_fact';
  readonly provider: EmbeddedRuntimeHostProviderProjection;
  readonly session: EmbeddedRuntimeHostSessionProjection;
  readonly fact: SessionActorObservedProviderFact;
}

export interface EmbeddedRuntimeHostProviderProjectionEvent {
  readonly type: 'provider_projection';
  readonly provider: EmbeddedRuntimeHostProviderProjection;
}

export type EmbeddedRuntimeHostProviderEvent =
  | EmbeddedRuntimeHostProviderFactEvent
  | EmbeddedRuntimeHostProviderProjectionEvent;

export interface EmbeddedRuntimeHostSessionProjection extends NodeSessionActorProjection {}

export interface EmbeddedRuntimeHostCreateSessionResult {
  readonly outcome: 'session_created' | 'session_rejected';
  readonly session: EmbeddedRuntimeHostCompatibilitySession;
  readonly projection: EmbeddedRuntimeHostSessionProjection;
}

export interface EmbeddedRuntimeHostAcquireResult {
  readonly outcome:
    | 'provider_ready'
    | 'provider_starting'
    | 'provider_failed'
    | 'provider_duplicate';
  readonly provider: EmbeddedRuntimeHostCompatibilityProvider;
  readonly projection: EmbeddedRuntimeHostProviderProjection;
}

export interface EmbeddedRuntimeHostInspectResult {
  readonly outcome: 'provider_inspected';
  readonly provider: EmbeddedRuntimeHostCompatibilityProvider | null;
  readonly projection: EmbeddedRuntimeHostProviderProjection;
}

export interface EmbeddedRuntimeHostStopResult {
  readonly outcome: 'provider_stopped' | 'provider_failed';
  readonly provider: EmbeddedRuntimeHostCompatibilityProvider | null;
  readonly projection: EmbeddedRuntimeHostProviderProjection;
}

export interface EmbeddedRuntimeHostRestartResult extends EmbeddedRuntimeHostAcquireResult {}

export interface EmbeddedRuntimeHostChatResult {
  readonly outcome: 'turn_completed' | 'turn_failed' | 'turn_cancelled' | 'turn_rejected';
  readonly session: EmbeddedRuntimeHostSessionProjection;
  readonly provider: EmbeddedRuntimeHostProviderProjection;
  readonly observedFacts: readonly SessionActorObservedProviderFact[];
}

export interface EmbeddedRuntimeHostCompatibilitySession {
  readonly id: string;
  snapshot(): EmbeddedRuntimeHostSessionProjection;
  chat(input: EmbeddedRuntimeHostChatInput): Promise<EmbeddedRuntimeHostChatResult>;
}

export interface EmbeddedRuntimeHostCompatibilityProvider {
  readonly id: string;
  snapshot(): EmbeddedRuntimeHostProviderProjection;
  subscribe(listener: (event: EmbeddedRuntimeHostProviderEvent) => void): () => void;
  close(): void;
}

export interface EmbeddedRuntimeHostCompatibilityProviderManager {
  acquire(input?: EmbeddedRuntimeHostAcquireInput): Promise<EmbeddedRuntimeHostAcquireResult>;
  inspect(): EmbeddedRuntimeHostInspectResult;
  stop(): Promise<EmbeddedRuntimeHostStopResult>;
  restart(input?: EmbeddedRuntimeHostAcquireInput): Promise<EmbeddedRuntimeHostRestartResult>;
}

export interface EmbeddedRuntimeHostCompatibilityFixture {
  readonly compatibility: EmbeddedRuntimeHostCompatibilityDisclaimer;
  readonly providerManager: EmbeddedRuntimeHostCompatibilityProviderManager;
  createSession(
    input?: EmbeddedRuntimeHostCreateSessionInput
  ): Promise<EmbeddedRuntimeHostCreateSessionResult>;
}

interface MutableProviderShell {
  actor: NodeProviderActor;
  journal: InMemoryNodeProviderLifecycleEffectJournal;
  calls: MutableProviderCallCounts;
  wrapper: EmbeddedRuntimeHostCompatibilityProvider & {
    readonly __emit: (event: EmbeddedRuntimeHostProviderEvent) => void;
  };
  lastAcquire: {
    activationKey: ProviderLifecycleActivationKey | null;
    acquisitionKey: ProviderLifecycleAcquisitionKey | null;
  };
}

interface MutableProcessState {
  handle: ChildProcessHandle | null;
  running: boolean;
  signaled: boolean;
  cancellation: ReturnType<typeof createProviderLifecycleCancellationFact> | null;
}

const DEFAULT_PROVIDER_ID = 'provider:embedded-runtime-host';
const DEFAULT_PROVIDER_LABEL = 'embedded-runtime-host-fixture';
const DEFAULT_PROVIDER_OUTPUT = 'Hello from the embedded runtime host fixture.';

export const embeddedRuntimeHostCompatibilityDisclaimer: EmbeddedRuntimeHostCompatibilityDisclaimer =
  Object.freeze({
    purpose: 'compatibility proving slice',
    integrationBoundary: 'not a fas-local integration',
    apiBoundary: 'not a public API replacement',
  });

function expectValid<TValue extends string>(result: BrandedStringParseResult<TValue>): TValue {
  if (result.outcome !== 'valid') {
    throw new Error(`Expected valid branded value, received ${result.reason}`);
  }
  return result.value;
}

function cloneData<TValue>(value: TValue): TValue {
  return structuredClone(value);
}

function toIsoOrNow(value: string | undefined, fallback: () => string): string {
  return value ?? fallback();
}

function createClock(startMs: number) {
  let nowMs = startMs;
  return {
    nowIso(): string {
      return new Date(nowMs).toISOString();
    },
    nowMs(): number {
      return nowMs;
    },
    tick(ms = 1_000): string {
      nowMs += ms;
      return new Date(nowMs).toISOString();
    },
  };
}

function createDefaultObservedFacts(
  turnId: string,
  submittedAt: string
): readonly SessionActorObservedProviderFact[] {
  const baseMs = Date.parse(submittedAt);
  const deltaObservedAt = new Date(baseMs + 1_000).toISOString();
  const completedAt = new Date(baseMs + 2_000).toISOString();
  return [
    {
      type: 'PROVIDER_DELTA',
      turnId,
      sequence: 1,
      delta: 'Hello',
      checkpoint: 'checkpoint:delta:1',
      observedAt: deltaObservedAt,
    },
    {
      type: 'TURN_COMPLETED',
      turnId,
      sequence: 2,
      checkpoint: 'checkpoint:terminal:completed',
      completedAt,
      output: DEFAULT_PROVIDER_OUTPUT,
    },
  ];
}

function projectSession(
  snapshot: NodeSessionActorProjection
): EmbeddedRuntimeHostSessionProjection {
  return cloneData(snapshot);
}

function projectProvider(
  providerId: string,
  actorSnapshot: NodeProviderActorProjection,
  calls: EmbeddedRuntimeHostProviderCallCounts,
  journal: InMemoryNodeProviderLifecycleEffectJournal
): EmbeddedRuntimeHostProviderProjection {
  const entries = journal.getSnapshot();
  const kinds = Object.values(entries)
    .map((entry) => entry.kind)
    .sort();
  return cloneData({
    providerId,
    status: actorSnapshot.status,
    ready: actorSnapshot.ready,
    activationKey: actorSnapshot.activationKey,
    acquisitionKey: actorSnapshot.acquisitionKey,
    handle: actorSnapshot.handle,
    endpoint: actorSnapshot.endpoint,
    failure: actorSnapshot.failure,
    restartCount: actorSnapshot.restartCount,
    idleDeadline: actorSnapshot.idleDeadline,
    lastObservedAt: actorSnapshot.lastObservedAt,
    stdoutTail: actorSnapshot.stdoutTail,
    stderrTail: actorSnapshot.stderrTail,
    calls,
    journal: {
      size: Object.keys(entries).length,
      kinds,
      entries,
    },
  });
}

export function createEmbeddedRuntimeHostCompatibilityFixture(
  options: EmbeddedRuntimeHostCompatibilityFixtureOptions = {}
): EmbeddedRuntimeHostCompatibilityFixture {
  const providerId = options.providerId ?? DEFAULT_PROVIDER_ID;
  const providerLabel = options.providerLabel ?? DEFAULT_PROVIDER_LABEL;
  const endpoint = options.endpoint ?? 'http://127.0.0.1:4242';
  const executable = options.executable ?? 'mlx_lm.server';
  const args = options.args ?? ['--host', '127.0.0.1', '--port', '4242'];
  const clock = createClock(options.clockStartMs ?? Date.parse('2026-07-02T16:30:00.000Z'));
  const processState: MutableProcessState = {
    handle: null,
    running: false,
    signaled: false,
    cancellation: null,
  };

  let acquireSequence = 0;
  let sessionSequence = 0;
  let turnSequence = 0;
  let providerShell: MutableProviderShell | null = null;

  function createProviderShell(): MutableProviderShell {
    const journal = createInMemoryNodeProviderLifecycleEffectJournal();
    const calls: MutableProviderCallCounts = {
      claimDuplicate: 0,
      spawn: 0,
      signal: 0,
      observeExit: 0,
      tailOutput: 0,
      readiness: 0,
      filesystemProbe: 0,
      modelCacheInspect: 0,
    };
    const listeners = new Set<(event: EmbeddedRuntimeHostProviderEvent) => void>();

    const emit = (event: EmbeddedRuntimeHostProviderEvent): void => {
      for (const listener of listeners) {
        listener(cloneData(event));
      }
    };

    const actor = createNodeProviderActor({
      provider: executable,
      executable,
      args,
      endpoint,
      processGroup: 'isolated',
      readiness: {
        strategy: 'http',
        target: `${endpoint}/v1/models`,
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
          probe({ target }) {
            calls.filesystemProbe += 1;
            return (
              options.filesystemProbe ?? {
                outcome: 'probed' as const,
                fact: {
                  target,
                  exists: true,
                  entries: [executable],
                  writable: true,
                  observedAt: clock.tick(),
                },
              }
            );
          },
        },
        modelCache: {
          inspect({ provider, modelId, cacheKey }) {
            calls.modelCacheInspect += 1;
            return (
              options.modelCacheInspect ?? {
                outcome: 'inspected' as const,
                fact: {
                  provider,
                  modelId,
                  cacheKey,
                  status: 'warm' as const,
                  bytesOnDisk: 1024,
                  observedAt: clock.tick(),
                },
              }
            );
          },
        },
        childProcess: {
          claimDuplicate({ activationKey, acquisitionKey, provider }) {
            calls.claimDuplicate += 1;
            if (options.duplicateClaim) {
              return options.duplicateClaim;
            }
            return {
              outcome: 'claimed' as const,
              claim: createProviderLifecycleClaimFact({
                activationKey,
                acquisitionKey,
                provider,
                claimedAt: clock.tick(),
              }),
            };
          },
          spawn({ activationKey, acquisitionKey, provider, processGroup }) {
            calls.spawn += 1;
            if (options.spawn) {
              if (options.spawn.outcome === 'spawned' || options.spawn.outcome === 'reused') {
                processState.handle = options.spawn.process.handle;
                processState.running = true;
                processState.signaled = false;
              }
              return options.spawn;
            }
            const handle = expectValid(
              createChildProcessHandle(
                `child:${providerId}:${String(calls.spawn).padStart(3, '0')}`
              )
            );
            processState.handle = handle;
            processState.running = true;
            processState.signaled = false;
            processState.cancellation = null;
            return {
              outcome: 'spawned' as const,
              process: createProviderLifecycleProcessFact({
                handle,
                activationKey,
                acquisitionKey,
                provider,
                pid: 4242,
                processGroup,
                startedAt: clock.tick(),
              }),
            };
          },
          signal({ handle, signal, reason, cancellation, idleShutdown }) {
            calls.signal += 1;
            if (options.signal) {
              return options.signal;
            }
            processState.handle = handle;
            processState.signaled = true;
            processState.cancellation = cancellation ?? null;
            return {
              outcome: 'signaled' as const,
              fact: createProviderLifecycleSignalFact({
                handle,
                signal,
                reason,
                observedAt: clock.tick(),
                ...(cancellation ? { cancellation } : {}),
                ...(idleShutdown ? { idleShutdown } : {}),
              }),
            };
          },
          observeExit({ handle }) {
            calls.observeExit += 1;
            if (options.observeExit) {
              return options.observeExit;
            }
            if (processState.running && processState.signaled) {
              processState.running = false;
              processState.signaled = false;
              processState.handle = null;
              return {
                outcome: 'cancelled' as const,
                fact: {
                  handle,
                  exitOutcome: 'cancelled' as const,
                  exitCode: 0,
                  signal: 'SIGTERM' as const,
                  observedAt: clock.tick(),
                  ...(processState.cancellation ? { cancellation: processState.cancellation } : {}),
                },
              };
            }
            return {
              outcome: 'running' as const,
              handle,
            };
          },
          tailOutput({ handle, limit }) {
            calls.tailOutput += 1;
            if (options.tailOutput) {
              return options.tailOutput;
            }
            return {
              outcome: 'tailed' as const,
              tail: {
                handle,
                limit,
                stdout: [],
                stderr: [],
                truncated: {
                  stdout: false,
                  stderr: false,
                },
                totalCaptured: {
                  stdout: 0,
                  stderr: 0,
                },
              },
            };
          },
        },
        readiness: {
          check(input) {
            calls.readiness += 1;
            if (typeof options.readiness === 'function') {
              return options.readiness(input);
            }
            if (options.readiness) {
              return options.readiness;
            }
            return {
              outcome: 'ready' as const,
              fact: createProviderLifecycleReadinessFact({
                handle: input.handle,
                attempt: input.attempt,
                strategy: input.strategy,
                target: input.target,
                observedAt: clock.tick(),
                detail: 'ready',
              }),
            };
          },
        },
      },
    });

    const wrapper: EmbeddedRuntimeHostCompatibilityProvider & {
      readonly __emit: (event: EmbeddedRuntimeHostProviderEvent) => void;
    } = {
      id: providerId,
      snapshot(): EmbeddedRuntimeHostProviderProjection {
        return projectProvider(providerId, actor.getSnapshot(), calls, journal);
      },
      subscribe(listener: (event: EmbeddedRuntimeHostProviderEvent) => void): () => void {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      close(): void {
        listeners.clear();
      },
      __emit: emit,
    };

    return {
      actor,
      journal,
      calls,
      wrapper,
      lastAcquire: {
        activationKey: null,
        acquisitionKey: null,
      },
    };
  }

  function ensureProviderShell(): MutableProviderShell {
    providerShell ??= createProviderShell();
    return providerShell;
  }

  function classifyAcquireOutcome(
    projection: EmbeddedRuntimeHostProviderProjection
  ): EmbeddedRuntimeHostAcquireResult['outcome'] {
    if (projection.failure?.code === 'duplicate') {
      return 'provider_duplicate';
    }
    if (projection.failure) {
      return 'provider_failed';
    }
    if (projection.ready) {
      return 'provider_ready';
    }
    return 'provider_starting';
  }

  async function acquireProvider(
    input: EmbeddedRuntimeHostAcquireInput = {}
  ): Promise<EmbeddedRuntimeHostAcquireResult> {
    const shell = ensureProviderShell();
    const activationKey = expectValid(
      createProviderLifecycleActivationKey(
        input.activationKey ??
          `activation:${providerId}:${String(++acquireSequence).padStart(3, '0')}`
      )
    );
    const acquisitionKey = expectValid(
      createProviderLifecycleAcquisitionKey(
        input.acquisitionKey ??
          `acquisition:${providerId}:${String(acquireSequence).padStart(3, '0')}`
      )
    );

    const current = shell.actor.getSnapshot();
    const isRepeatedAcquire =
      shell.lastAcquire.activationKey === activationKey &&
      shell.lastAcquire.acquisitionKey === acquisitionKey &&
      (current.ready || current.status === 'starting' || current.failure !== null);

    if (!isRepeatedAcquire) {
      const acquiredSnapshot = await shell.actor.dispatch({
        type: 'ACQUIRE_PROVIDER',
        activationKey,
        acquisitionKey,
      });
      if (
        acquiredSnapshot.status === 'starting' &&
        acquiredSnapshot.failure === null &&
        acquiredSnapshot.handle
      ) {
        await shell.actor.dispatch({
          type: 'CHECK_PROVIDER_READINESS',
        });
      }
      shell.lastAcquire = {
        activationKey,
        acquisitionKey,
      };
    }

    const projection = shell.wrapper.snapshot();
    return {
      outcome: classifyAcquireOutcome(projection),
      provider: shell.wrapper,
      projection,
    };
  }

  async function stopProvider(): Promise<EmbeddedRuntimeHostStopResult> {
    const shell = ensureProviderShell();
    const snapshot = shell.actor.getSnapshot();
    if (snapshot.handle) {
      await shell.actor.dispatch({
        type: 'CANCEL_PROVIDER',
        requestedBy: 'host',
        reason: 'shutdown_requested',
      });
      await shell.actor.dispatch({
        type: 'OBSERVE_PROVIDER_EXIT',
      });
    }
    const projection = shell.wrapper.snapshot();
    return {
      outcome:
        projection.failure && projection.status === 'failed'
          ? 'provider_failed'
          : 'provider_stopped',
      provider: shell.wrapper,
      projection,
    };
  }

  async function restartProvider(
    input: EmbeddedRuntimeHostAcquireInput = {}
  ): Promise<EmbeddedRuntimeHostRestartResult> {
    await stopProvider();
    return acquireProvider(input);
  }

  const providerManager: EmbeddedRuntimeHostCompatibilityProviderManager = {
    acquire: acquireProvider,
    inspect(): EmbeddedRuntimeHostInspectResult {
      const shell = ensureProviderShell();
      return {
        outcome: 'provider_inspected',
        provider: shell.wrapper,
        projection: shell.wrapper.snapshot(),
      };
    },
    stop: stopProvider,
    restart: restartProvider,
  };

  return {
    compatibility: embeddedRuntimeHostCompatibilityDisclaimer,
    providerManager,
    async createSession(
      input: EmbeddedRuntimeHostCreateSessionInput = {}
    ): Promise<EmbeddedRuntimeHostCreateSessionResult> {
      sessionSequence += 1;
      const actor: NodeSessionActor = createNodeSessionActor();
      const sessionId = input.sessionId ?? `session:${String(sessionSequence).padStart(3, '0')}`;
      const openedAt = toIsoOrNow(input.openedAt, () => clock.tick());
      const projection = await actor.dispatch({
        type: 'CREATE_SESSION',
        sessionId,
        openedAt,
      });

      const session: EmbeddedRuntimeHostCompatibilitySession = {
        id: sessionId,
        snapshot(): EmbeddedRuntimeHostSessionProjection {
          return projectSession(actor.getSnapshot());
        },
        async chat(
          chatInput: EmbeddedRuntimeHostChatInput
        ): Promise<EmbeddedRuntimeHostChatResult> {
          const shell = ensureProviderShell();
          const providerProjection = chatInput.provider.snapshot();
          let sessionProjection = actor.getSnapshot();

          if (!providerProjection.ready) {
            return {
              outcome: 'turn_rejected',
              session: projectSession({
                ...sessionProjection,
                failure: createSessionActorFailure({
                  code: 'provider_required',
                  message: 'Provider must be ready before chat turns can start.',
                  retryable: false,
                }),
              }),
              provider: providerProjection,
              observedFacts: [],
            };
          }

          if (sessionProjection.provider?.id !== chatInput.provider.id) {
            sessionProjection = await actor.dispatch({
              type: 'ATTACH_PROVIDER',
              providerId: chatInput.provider.id,
              attachedAt: clock.tick(),
              metadata: {
                label: providerLabel,
              },
            });
          }

          turnSequence += 1;
          const turnId = chatInput.turnId ?? `turn:${String(turnSequence).padStart(3, '0')}`;
          const submittedAt = toIsoOrNow(chatInput.submittedAt, () => clock.tick());
          sessionProjection = await actor.dispatch({
            type: 'SUBMIT_TURN',
            turnId,
            submittedAt,
            input: {
              prompt: chatInput.prompt,
            },
          });
          if (sessionProjection.failure) {
            return {
              outcome: 'turn_rejected',
              session: projectSession(sessionProjection),
              provider: providerProjection,
              observedFacts: [],
            };
          }

          const observedFacts =
            chatInput.observedFacts ??
            options.observedFacts ??
            createDefaultObservedFacts(turnId, submittedAt);

          for (const fact of observedFacts) {
            sessionProjection = await actor.dispatch({
              type: 'OBSERVE_PROVIDER_FACT',
              fact,
            });
            const projectedSession = projectSession(sessionProjection);
            const projectedProvider = shell.wrapper.snapshot();
            const typedFact = cloneData(fact);
            const event: EmbeddedRuntimeHostProviderFactEvent = {
              type: 'provider_fact',
              provider: projectedProvider,
              session: projectedSession,
              fact: typedFact,
            };
            // Emit after the session projection updates so subscribers observe the
            // same fact order the session actor consumed through OBSERVE_PROVIDER_FACT.
            shell.wrapper.__emit(event);

            if (sessionProjection.failure) {
              return {
                outcome: 'turn_rejected',
                session: projectedSession,
                provider: projectedProvider,
                observedFacts: cloneData(observedFacts),
              };
            }
          }

          const finalSession = projectSession(sessionProjection);
          const finalProvider = shell.wrapper.snapshot();
          const outcome =
            finalSession.turn?.status === 'completed'
              ? 'turn_completed'
              : finalSession.turn?.status === 'failed'
                ? 'turn_failed'
                : finalSession.turn?.status === 'cancelled'
                  ? 'turn_cancelled'
                  : 'turn_rejected';

          return {
            outcome,
            session: finalSession,
            provider: finalProvider,
            observedFacts: cloneData(observedFacts),
          };
        },
      };

      return {
        outcome: projection.failure ? 'session_rejected' : 'session_created',
        session,
        projection: projectSession(projection),
      };
    },
  };
}
