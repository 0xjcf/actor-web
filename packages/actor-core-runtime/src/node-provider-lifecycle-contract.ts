import type { JsonValue } from './types.js';

declare const CHILD_PROCESS_HANDLE_BRAND: unique symbol;
declare const PROVIDER_LIFECYCLE_ACTIVATION_KEY_BRAND: unique symbol;
declare const PROVIDER_LIFECYCLE_ACQUISITION_KEY_BRAND: unique symbol;

export type ChildProcessHandle = string & {
  readonly [CHILD_PROCESS_HANDLE_BRAND]: 'ChildProcessHandle';
};

export type ProviderLifecycleActivationKey = string & {
  readonly [PROVIDER_LIFECYCLE_ACTIVATION_KEY_BRAND]: 'ProviderLifecycleActivationKey';
};

export type ProviderLifecycleAcquisitionKey = string & {
  readonly [PROVIDER_LIFECYCLE_ACQUISITION_KEY_BRAND]: 'ProviderLifecycleAcquisitionKey';
};

export type ChildProcessSignal =
  | 'SIGTERM'
  | 'SIGKILL'
  | 'SIGINT'
  | 'SIGHUP'
  | 'SIGUSR1'
  | 'SIGUSR2';

export type ChildProcessGroupPolicy = 'isolated' | 'shared' | 'none';

export type ProviderLifecycleSignalReason =
  | 'shutdown'
  | 'restart'
  | 'cancellation'
  | 'idle_shutdown';

export type ProviderReadinessStrategy = 'http' | 'stderr' | 'custom';

export type NodeProviderLifecycleFailureCode =
  | 'invalid_request'
  | 'missing_executable'
  | 'port_conflict'
  | 'startup_timeout'
  | 'cancelled'
  | 'duplicate'
  | 'already_running'
  | 'exited'
  | 'crashed'
  | 'readiness_failed'
  | 'signal_failed'
  | 'output_backpressure'
  | 'tail_failed';

export interface NodeProviderLifecycleFailure {
  readonly code: NodeProviderLifecycleFailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: JsonValue;
}

export type BrandedStringParseResult<TValue extends string> =
  | {
      readonly outcome: 'valid';
      readonly value: TValue;
    }
  | {
      readonly outcome: 'invalid';
      readonly reason: 'expected_non_empty_string';
      readonly value: unknown;
    };

export interface ProviderLifecycleClaimFact {
  readonly activationKey: ProviderLifecycleActivationKey;
  readonly acquisitionKey: ProviderLifecycleAcquisitionKey;
  readonly provider: string;
  readonly claimedAt: string;
}

export interface ProviderLifecycleDuplicateFact {
  readonly activationKey: ProviderLifecycleActivationKey;
  readonly acquisitionKey: ProviderLifecycleAcquisitionKey;
  readonly provider: string;
  readonly handle: ChildProcessHandle;
  readonly detectedAt: string;
  readonly disposition: 'already_running' | 'duplicate';
}

export interface ProviderLifecycleProcessFact {
  readonly handle: ChildProcessHandle;
  readonly activationKey: ProviderLifecycleActivationKey;
  readonly acquisitionKey: ProviderLifecycleAcquisitionKey;
  readonly provider: string;
  readonly pid: number | null;
  readonly processGroup: ChildProcessGroupPolicy;
  readonly startedAt: string;
}

export interface ProviderLifecycleCancellationFact {
  readonly requestedBy: 'operator' | 'runtime' | 'host';
  readonly reason:
    | 'activation_replaced'
    | 'shutdown_requested'
    | 'readiness_failed'
    | 'duplicate_detected';
  readonly requestedAt: string;
  readonly activationKey?: ProviderLifecycleActivationKey;
}

export interface ProviderLifecycleIdleShutdownFact {
  readonly idleSince: string;
  readonly shutdownRequestedAt: string;
  readonly inactivityWindowMs: number;
  readonly acquisitionKey: ProviderLifecycleAcquisitionKey;
}

export interface ProviderLifecycleSignalFact {
  readonly handle: ChildProcessHandle;
  readonly signal: ChildProcessSignal;
  readonly reason: ProviderLifecycleSignalReason;
  readonly observedAt: string;
  readonly cancellation?: ProviderLifecycleCancellationFact;
  readonly idleShutdown?: ProviderLifecycleIdleShutdownFact;
}

export interface ProviderLifecycleExitFact {
  readonly handle: ChildProcessHandle;
  readonly exitOutcome: 'exited' | 'crashed' | 'cancelled';
  readonly exitCode: number | null;
  readonly signal: ChildProcessSignal | null;
  readonly observedAt: string;
  readonly cancellation?: ProviderLifecycleCancellationFact;
  readonly idleShutdown?: ProviderLifecycleIdleShutdownFact;
}

export interface ProviderLifecycleReadinessFact {
  readonly handle: ChildProcessHandle;
  readonly attempt: number;
  readonly strategy: ProviderReadinessStrategy;
  readonly target: string;
  readonly observedAt: string;
  readonly detail?: string;
}

export interface ChildProcessOutputTail {
  readonly handle: ChildProcessHandle;
  readonly limit: number;
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
}

export interface ChildProcessClaimDuplicateInput {
  readonly activationKey: ProviderLifecycleActivationKey;
  readonly acquisitionKey: ProviderLifecycleAcquisitionKey;
  readonly provider: string;
}

export type ChildProcessClaimDuplicateResult =
  | {
      readonly outcome: 'claimed';
      readonly claim: ProviderLifecycleClaimFact;
    }
  | {
      readonly outcome: 'already_running';
      readonly running: ProviderLifecycleDuplicateFact;
    }
  | {
      readonly outcome: 'duplicate';
      readonly duplicate: ProviderLifecycleDuplicateFact;
    }
  | {
      readonly outcome: 'error';
      readonly error: NodeProviderLifecycleFailure;
    };

export interface ChildProcessSpawnInput {
  readonly activationKey: ProviderLifecycleActivationKey;
  readonly acquisitionKey: ProviderLifecycleAcquisitionKey;
  readonly provider: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly processGroup: ChildProcessGroupPolicy;
}

export type ChildProcessSpawnResult =
  | {
      readonly outcome: 'spawned';
      readonly process: ProviderLifecycleProcessFact;
    }
  | {
      readonly outcome: 'reused';
      readonly process: ProviderLifecycleProcessFact;
    }
  | {
      readonly outcome: 'failed';
      readonly failure: NodeProviderLifecycleFailure;
    };

export interface ChildProcessSignalInput {
  readonly handle: ChildProcessHandle;
  readonly signal: ChildProcessSignal;
  readonly reason: ProviderLifecycleSignalReason;
  readonly cancellation?: ProviderLifecycleCancellationFact;
  readonly idleShutdown?: ProviderLifecycleIdleShutdownFact;
}

export type ChildProcessSignalResult =
  | {
      readonly outcome: 'signaled';
      readonly fact: ProviderLifecycleSignalFact;
    }
  | {
      readonly outcome: 'missing';
      readonly handle: ChildProcessHandle;
      readonly signal: ChildProcessSignal;
    }
  | {
      readonly outcome: 'failed';
      readonly failure: NodeProviderLifecycleFailure;
    };

export interface ChildProcessObserveExitInput {
  readonly handle: ChildProcessHandle;
}

export type ChildProcessObserveExitResult =
  | {
      readonly outcome: 'running';
      readonly handle: ChildProcessHandle;
    }
  | {
      readonly outcome: 'exited';
      readonly fact: ProviderLifecycleExitFact;
    }
  | {
      readonly outcome: 'crashed';
      readonly fact: ProviderLifecycleExitFact;
    }
  | {
      readonly outcome: 'cancelled';
      readonly fact: ProviderLifecycleExitFact;
    }
  | {
      readonly outcome: 'error';
      readonly error: NodeProviderLifecycleFailure;
    };

export interface ChildProcessTailOutputInput {
  readonly handle: ChildProcessHandle;
  readonly limit: number;
}

export type ChildProcessTailOutputResult =
  | {
      readonly outcome: 'tailed';
      readonly tail: ChildProcessOutputTail;
    }
  | {
      readonly outcome: 'failed';
      readonly failure: NodeProviderLifecycleFailure;
    };

export interface ProviderReadinessCheckInput {
  readonly handle: ChildProcessHandle;
  readonly attempt: number;
  readonly strategy: ProviderReadinessStrategy;
  readonly target: string;
}

export type ProviderReadinessCheckResult =
  | {
      readonly outcome: 'ready';
      readonly fact: ProviderLifecycleReadinessFact;
    }
  | {
      readonly outcome: 'waiting';
      readonly fact: ProviderLifecycleReadinessFact;
    }
  | {
      readonly outcome: 'failed';
      readonly failure: NodeProviderLifecycleFailure;
      readonly fact?: ProviderLifecycleReadinessFact;
      readonly exit?: ProviderLifecycleExitFact;
      readonly cancellation?: ProviderLifecycleCancellationFact;
    }
  | {
      readonly outcome: 'error';
      readonly error: NodeProviderLifecycleFailure;
    };

export interface ChildProcessPort {
  claimDuplicate(
    input: ChildProcessClaimDuplicateInput
  ): ChildProcessClaimDuplicateResult | Promise<ChildProcessClaimDuplicateResult>;
  spawn(input: ChildProcessSpawnInput): ChildProcessSpawnResult | Promise<ChildProcessSpawnResult>;
  signal(
    input: ChildProcessSignalInput
  ): ChildProcessSignalResult | Promise<ChildProcessSignalResult>;
  observeExit(
    input: ChildProcessObserveExitInput
  ): ChildProcessObserveExitResult | Promise<ChildProcessObserveExitResult>;
  tailOutput(
    input: ChildProcessTailOutputInput
  ): ChildProcessTailOutputResult | Promise<ChildProcessTailOutputResult>;
}

export interface ProviderReadinessPort {
  check(
    input: ProviderReadinessCheckInput
  ): ProviderReadinessCheckResult | Promise<ProviderReadinessCheckResult>;
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseBrandedString<TValue extends string>(
  value: unknown
): BrandedStringParseResult<TValue> {
  if (!hasNonEmptyString(value)) {
    return {
      outcome: 'invalid',
      reason: 'expected_non_empty_string',
      value,
    };
  }

  return {
    outcome: 'valid',
    value: value as TValue,
  };
}

export function createChildProcessHandle(
  value: unknown
): BrandedStringParseResult<ChildProcessHandle> {
  return parseBrandedString<ChildProcessHandle>(value);
}

export function parseChildProcessHandle(
  value: unknown
): BrandedStringParseResult<ChildProcessHandle> {
  return parseBrandedString<ChildProcessHandle>(value);
}

export function createProviderLifecycleActivationKey(
  value: unknown
): BrandedStringParseResult<ProviderLifecycleActivationKey> {
  return parseBrandedString<ProviderLifecycleActivationKey>(value);
}

export function parseProviderLifecycleActivationKey(
  value: unknown
): BrandedStringParseResult<ProviderLifecycleActivationKey> {
  return parseBrandedString<ProviderLifecycleActivationKey>(value);
}

export function createProviderLifecycleAcquisitionKey(
  value: unknown
): BrandedStringParseResult<ProviderLifecycleAcquisitionKey> {
  return parseBrandedString<ProviderLifecycleAcquisitionKey>(value);
}

export function parseProviderLifecycleAcquisitionKey(
  value: unknown
): BrandedStringParseResult<ProviderLifecycleAcquisitionKey> {
  return parseBrandedString<ProviderLifecycleAcquisitionKey>(value);
}

export function createNodeProviderLifecycleFailure(
  input: NodeProviderLifecycleFailure
): NodeProviderLifecycleFailure {
  return {
    code: input.code,
    message: input.message,
    retryable: input.retryable,
    ...(input.details === undefined ? {} : { details: input.details }),
  };
}

export function createProviderLifecycleClaimFact(
  input: ProviderLifecycleClaimFact
): ProviderLifecycleClaimFact {
  return {
    activationKey: input.activationKey,
    acquisitionKey: input.acquisitionKey,
    provider: input.provider,
    claimedAt: input.claimedAt,
  };
}

export function createProviderLifecycleDuplicateFact(
  input: ProviderLifecycleDuplicateFact
): ProviderLifecycleDuplicateFact {
  return {
    activationKey: input.activationKey,
    acquisitionKey: input.acquisitionKey,
    provider: input.provider,
    handle: input.handle,
    detectedAt: input.detectedAt,
    disposition: input.disposition,
  };
}

export function createProviderLifecycleProcessFact(
  input: ProviderLifecycleProcessFact
): ProviderLifecycleProcessFact {
  return {
    handle: input.handle,
    activationKey: input.activationKey,
    acquisitionKey: input.acquisitionKey,
    provider: input.provider,
    pid: input.pid,
    processGroup: input.processGroup,
    startedAt: input.startedAt,
  };
}

export function createProviderLifecycleCancellationFact(
  input: ProviderLifecycleCancellationFact
): ProviderLifecycleCancellationFact {
  return {
    requestedBy: input.requestedBy,
    reason: input.reason,
    requestedAt: input.requestedAt,
    ...(input.activationKey ? { activationKey: input.activationKey } : {}),
  };
}

export function createProviderLifecycleIdleShutdownFact(
  input: ProviderLifecycleIdleShutdownFact
): ProviderLifecycleIdleShutdownFact {
  return {
    idleSince: input.idleSince,
    shutdownRequestedAt: input.shutdownRequestedAt,
    inactivityWindowMs: input.inactivityWindowMs,
    acquisitionKey: input.acquisitionKey,
  };
}

export function createProviderLifecycleSignalFact(
  input: ProviderLifecycleSignalFact
): ProviderLifecycleSignalFact {
  return {
    handle: input.handle,
    signal: input.signal,
    reason: input.reason,
    observedAt: input.observedAt,
    ...(input.cancellation ? { cancellation: input.cancellation } : {}),
    ...(input.idleShutdown ? { idleShutdown: input.idleShutdown } : {}),
  };
}

export function createProviderLifecycleExitFact(
  input: ProviderLifecycleExitFact
): ProviderLifecycleExitFact {
  return {
    handle: input.handle,
    exitOutcome: input.exitOutcome,
    exitCode: input.exitCode,
    signal: input.signal,
    observedAt: input.observedAt,
    ...(input.cancellation ? { cancellation: input.cancellation } : {}),
    ...(input.idleShutdown ? { idleShutdown: input.idleShutdown } : {}),
  };
}

export function createProviderLifecycleReadinessFact(
  input: ProviderLifecycleReadinessFact
): ProviderLifecycleReadinessFact {
  return {
    handle: input.handle,
    attempt: input.attempt,
    strategy: input.strategy,
    target: input.target,
    observedAt: input.observedAt,
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
  };
}

export function createChildProcessOutputTail(input: {
  readonly handle: ChildProcessHandle;
  readonly limit: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}): ChildProcessOutputTail {
  const limit = Number.isFinite(input.limit) ? Math.max(0, Math.trunc(input.limit)) : 0;
  const stdout = limit === 0 ? [] : input.stdout.slice(-limit);
  const stderr = limit === 0 ? [] : input.stderr.slice(-limit);
  return {
    handle: input.handle,
    limit,
    stdout,
    stderr,
    truncated: {
      stdout: input.stdout.length > limit,
      stderr: input.stderr.length > limit,
    },
    totalCaptured: {
      stdout: input.stdout.length,
      stderr: input.stderr.length,
    },
  };
}
