import type {
  BrandedStringParseResult,
  ChildProcessClaimDuplicateResult,
  ChildProcessHandle,
  ChildProcessSignalResult,
  ChildProcessSpawnResult,
  NodeProviderLifecycleFailure,
  ProviderLifecycleAcquisitionKey,
  ProviderLifecycleActivationKey,
  ProviderLifecycleCancellationFact,
  ProviderReadinessCheckResult,
} from './node-provider-lifecycle-contract.js';

declare const NODE_PROVIDER_LIFECYCLE_EFFECT_IDEMPOTENCY_KEY_BRAND: unique symbol;

export type NodeProviderLifecycleEffectIdempotencyKey = string & {
  readonly [NODE_PROVIDER_LIFECYCLE_EFFECT_IDEMPOTENCY_KEY_BRAND]: 'NodeProviderLifecycleEffectIdempotencyKey';
};

export type NodeProviderLifecycleEffectKind =
  | 'duplicate_prevention'
  | 'spawn'
  | 'signal'
  | 'readiness'
  | 'filesystem_probe'
  | 'model_cache_inspect'
  | 'cancellation';

export interface NodeProviderLifecycleFilesystemProbeFact {
  readonly target: string;
  readonly exists: boolean;
  readonly entries: readonly string[];
  readonly writable: boolean;
  readonly observedAt: string;
}

export type NodeProviderLifecycleFilesystemProbeResult =
  | {
      readonly outcome: 'probed';
      readonly fact: NodeProviderLifecycleFilesystemProbeFact;
    }
  | {
      readonly outcome: 'failed';
      readonly failure: NodeProviderLifecycleFailure;
    };

export interface NodeProviderLifecycleModelCacheInspectionFact {
  readonly provider: string;
  readonly modelId: string;
  readonly cacheKey: string;
  readonly status: 'warm' | 'cold' | 'missing';
  readonly bytesOnDisk: number | null;
  readonly observedAt: string;
}

export type NodeProviderLifecycleModelCacheInspectionResult =
  | {
      readonly outcome: 'inspected';
      readonly fact: NodeProviderLifecycleModelCacheInspectionFact;
    }
  | {
      readonly outcome: 'failed';
      readonly failure: NodeProviderLifecycleFailure;
    };

export type NodeProviderLifecycleCancellationResult =
  | {
      readonly outcome: 'cancelled';
      readonly fact: ProviderLifecycleCancellationFact;
    }
  | {
      readonly outcome: 'failed';
      readonly failure: NodeProviderLifecycleFailure;
    };

export interface NodeProviderLifecycleEffectIdempotencyKeyInput {
  readonly kind: NodeProviderLifecycleEffectKind;
  readonly provider: string;
  readonly operationKey: string;
  readonly activationKey?: ProviderLifecycleActivationKey;
  readonly acquisitionKey?: ProviderLifecycleAcquisitionKey;
  readonly handle?: ChildProcessHandle;
  readonly target?: string;
}

export interface NodeProviderLifecycleEffectClaimInput {
  readonly idempotencyKey: NodeProviderLifecycleEffectIdempotencyKey;
  readonly kind: NodeProviderLifecycleEffectKind;
}

export type NodeProviderLifecycleEffectStatus = 'pending' | 'recorded';

interface NodeProviderLifecycleEffectRecordBase<
  TKind extends NodeProviderLifecycleEffectKind,
  TResult,
> {
  readonly idempotencyKey: NodeProviderLifecycleEffectIdempotencyKey;
  readonly kind: TKind;
  readonly recordedAt: string;
  readonly result: TResult;
}

export type NodeProviderLifecycleDuplicatePreventionRecord = NodeProviderLifecycleEffectRecordBase<
  'duplicate_prevention',
  ChildProcessClaimDuplicateResult
>;

export type NodeProviderLifecycleSpawnRecord = NodeProviderLifecycleEffectRecordBase<
  'spawn',
  ChildProcessSpawnResult
>;

export type NodeProviderLifecycleSignalRecord = NodeProviderLifecycleEffectRecordBase<
  'signal',
  ChildProcessSignalResult
>;

export type NodeProviderLifecycleReadinessRecord = NodeProviderLifecycleEffectRecordBase<
  'readiness',
  ProviderReadinessCheckResult
>;

export type NodeProviderLifecycleFilesystemProbeRecord = NodeProviderLifecycleEffectRecordBase<
  'filesystem_probe',
  NodeProviderLifecycleFilesystemProbeResult
>;

export type NodeProviderLifecycleModelCacheInspectionRecord = NodeProviderLifecycleEffectRecordBase<
  'model_cache_inspect',
  NodeProviderLifecycleModelCacheInspectionResult
>;

export type NodeProviderLifecycleCancellationRecord = NodeProviderLifecycleEffectRecordBase<
  'cancellation',
  NodeProviderLifecycleCancellationResult
>;

export type NodeProviderLifecycleEffectRecord =
  | NodeProviderLifecycleDuplicatePreventionRecord
  | NodeProviderLifecycleSpawnRecord
  | NodeProviderLifecycleSignalRecord
  | NodeProviderLifecycleReadinessRecord
  | NodeProviderLifecycleFilesystemProbeRecord
  | NodeProviderLifecycleModelCacheInspectionRecord
  | NodeProviderLifecycleCancellationRecord;

export type NodeProviderLifecycleEffectRecordInput = NodeProviderLifecycleEffectRecord;

export type NodeProviderLifecycleEffectClaimResult =
  | {
      readonly outcome: 'claimed';
      readonly idempotencyKey: NodeProviderLifecycleEffectIdempotencyKey;
      readonly kind: NodeProviderLifecycleEffectKind;
    }
  | {
      readonly outcome: 'duplicate';
      readonly idempotencyKey: NodeProviderLifecycleEffectIdempotencyKey;
      readonly kind: NodeProviderLifecycleEffectKind;
      readonly status: NodeProviderLifecycleEffectStatus;
      readonly record?: NodeProviderLifecycleEffectRecord;
    }
  | {
      readonly outcome: 'error';
      readonly failure: NodeProviderLifecycleFailure;
    };

export type NodeProviderLifecycleEffectRecordResult =
  | {
      readonly outcome: 'recorded';
      readonly record: NodeProviderLifecycleEffectRecord;
    }
  | {
      readonly outcome: 'missing_claim';
      readonly idempotencyKey: NodeProviderLifecycleEffectIdempotencyKey;
      readonly kind: NodeProviderLifecycleEffectKind;
    }
  | {
      readonly outcome: 'already_recorded';
      readonly record: NodeProviderLifecycleEffectRecord;
    }
  | {
      readonly outcome: 'error';
      readonly failure: NodeProviderLifecycleFailure;
    };

export type NodeProviderLifecycleEffectReplayResult =
  | {
      readonly outcome: 'missing';
      readonly idempotencyKey: NodeProviderLifecycleEffectIdempotencyKey;
      readonly kind: NodeProviderLifecycleEffectKind;
    }
  | {
      readonly outcome: 'pending';
      readonly idempotencyKey: NodeProviderLifecycleEffectIdempotencyKey;
      readonly kind: NodeProviderLifecycleEffectKind;
    }
  | {
      readonly outcome: 'recorded';
      readonly record: NodeProviderLifecycleEffectRecord;
    }
  | {
      readonly outcome: 'error';
      readonly failure: NodeProviderLifecycleFailure;
    };

export interface NodeProviderLifecycleEffectJournalEntry {
  readonly kind: NodeProviderLifecycleEffectKind;
  readonly status: NodeProviderLifecycleEffectStatus;
  readonly record?: NodeProviderLifecycleEffectRecord;
}

export interface NodeProviderLifecycleEffectJournal {
  claim(
    input: NodeProviderLifecycleEffectClaimInput
  ): NodeProviderLifecycleEffectClaimResult | Promise<NodeProviderLifecycleEffectClaimResult>;
  record(
    record: NodeProviderLifecycleEffectRecord
  ): NodeProviderLifecycleEffectRecordResult | Promise<NodeProviderLifecycleEffectRecordResult>;
  replay(
    input: NodeProviderLifecycleEffectClaimInput
  ): NodeProviderLifecycleEffectReplayResult | Promise<NodeProviderLifecycleEffectReplayResult>;
}

export interface InMemoryNodeProviderLifecycleEffectJournal
  extends NodeProviderLifecycleEffectJournal {
  getSnapshot(): Readonly<Record<string, NodeProviderLifecycleEffectJournalEntry>>;
  clear(): void;
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

function encodeComponent(value: string): string {
  return encodeURIComponent(value);
}

function createFailure(
  code: NodeProviderLifecycleFailure['code'],
  message: string,
  details?: NodeProviderLifecycleFailure['details']
): NodeProviderLifecycleFailure {
  return {
    code,
    message,
    retryable: false,
    ...(details === undefined ? {} : { details }),
  };
}

function createKindMismatchFailure(options: {
  readonly idempotencyKey: NodeProviderLifecycleEffectIdempotencyKey;
  readonly expected: NodeProviderLifecycleEffectKind;
  readonly actual: NodeProviderLifecycleEffectKind;
}): NodeProviderLifecycleFailure {
  return createFailure(
    'invalid_request',
    'Node provider lifecycle effect kind did not match the existing journal entry.',
    {
      idempotencyKey: options.idempotencyKey,
      expectedKind: options.expected,
      actualKind: options.actual,
    }
  );
}

function cloneJsonCompatible<TValue>(value: TValue): TValue {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as TValue;
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function cloneAndFreezeJsonCompatible<TValue>(value: TValue): TValue {
  return deepFreeze(cloneJsonCompatible(value));
}

function exposeRecord(
  record: NodeProviderLifecycleEffectRecord
): NodeProviderLifecycleEffectRecord {
  return cloneAndFreezeJsonCompatible(record);
}

function exposeEntry(
  entry: NodeProviderLifecycleEffectJournalEntry
): NodeProviderLifecycleEffectJournalEntry {
  return cloneAndFreezeJsonCompatible(entry);
}

export function createNodeProviderLifecycleEffectIdempotencyKey(
  input: NodeProviderLifecycleEffectIdempotencyKeyInput
): BrandedStringParseResult<NodeProviderLifecycleEffectIdempotencyKey> {
  if (!hasNonEmptyString(input.provider)) {
    return parseBrandedString<NodeProviderLifecycleEffectIdempotencyKey>(input.provider);
  }
  if (!hasNonEmptyString(input.operationKey)) {
    return parseBrandedString<NodeProviderLifecycleEffectIdempotencyKey>(input.operationKey);
  }

  return {
    outcome: 'valid',
    value: [
      'node-provider-lifecycle-effect',
      'key',
      `kind=${input.kind}`,
      `provider=${encodeComponent(input.provider)}`,
      `operation=${encodeComponent(input.operationKey)}`,
      ...(input.activationKey ? [`activation=${encodeComponent(input.activationKey)}`] : []),
      ...(input.acquisitionKey ? [`acquisition=${encodeComponent(input.acquisitionKey)}`] : []),
      ...(input.handle ? [`handle=${encodeComponent(input.handle)}`] : []),
      ...(input.target ? [`target=${encodeComponent(input.target)}`] : []),
    ].join(':') as NodeProviderLifecycleEffectIdempotencyKey,
  };
}

export function createNodeProviderLifecycleEffectRecord<
  TRecord extends NodeProviderLifecycleEffectRecord,
>(record: TRecord): TRecord {
  return {
    idempotencyKey: record.idempotencyKey,
    kind: record.kind,
    recordedAt: record.recordedAt,
    result: record.result,
  } as TRecord;
}

export function createInMemoryNodeProviderLifecycleEffectJournal(): InMemoryNodeProviderLifecycleEffectJournal {
  const entries = new Map<string, NodeProviderLifecycleEffectJournalEntry>();

  return {
    claim(input): NodeProviderLifecycleEffectClaimResult {
      const current = entries.get(input.idempotencyKey);
      if (!current) {
        entries.set(input.idempotencyKey, {
          kind: input.kind,
          status: 'pending',
        });
        return {
          outcome: 'claimed',
          idempotencyKey: input.idempotencyKey,
          kind: input.kind,
        };
      }

      if (current.kind !== input.kind) {
        return {
          outcome: 'error',
          failure: createKindMismatchFailure({
            idempotencyKey: input.idempotencyKey,
            expected: current.kind,
            actual: input.kind,
          }),
        };
      }

      return current.status === 'recorded'
        ? {
            outcome: 'duplicate',
            idempotencyKey: input.idempotencyKey,
            kind: input.kind,
            status: 'recorded',
            record: current.record ? exposeRecord(current.record) : undefined,
          }
        : {
            outcome: 'duplicate',
            idempotencyKey: input.idempotencyKey,
            kind: input.kind,
            status: 'pending',
          };
    },
    record(record): NodeProviderLifecycleEffectRecordResult {
      const current = entries.get(record.idempotencyKey);
      if (!current) {
        return {
          outcome: 'missing_claim',
          idempotencyKey: record.idempotencyKey,
          kind: record.kind,
        };
      }

      if (current.kind !== record.kind) {
        return {
          outcome: 'error',
          failure: createKindMismatchFailure({
            idempotencyKey: record.idempotencyKey,
            expected: current.kind,
            actual: record.kind,
          }),
        };
      }

      if (current.status === 'recorded' && current.record) {
        return {
          outcome: 'already_recorded',
          record: exposeRecord(current.record),
        };
      }

      const nextRecord = cloneAndFreezeJsonCompatible(
        createNodeProviderLifecycleEffectRecord(record)
      );
      entries.set(record.idempotencyKey, {
        kind: record.kind,
        status: 'recorded',
        record: nextRecord,
      });
      return {
        outcome: 'recorded',
        record: exposeRecord(nextRecord),
      };
    },
    replay(input): NodeProviderLifecycleEffectReplayResult {
      const current = entries.get(input.idempotencyKey);
      if (!current) {
        return {
          outcome: 'missing',
          idempotencyKey: input.idempotencyKey,
          kind: input.kind,
        };
      }

      if (current.kind !== input.kind) {
        return {
          outcome: 'error',
          failure: createKindMismatchFailure({
            idempotencyKey: input.idempotencyKey,
            expected: current.kind,
            actual: input.kind,
          }),
        };
      }

      return current.status === 'recorded' && current.record
        ? {
            outcome: 'recorded',
            record: exposeRecord(current.record),
          }
        : {
            outcome: 'pending',
            idempotencyKey: input.idempotencyKey,
            kind: input.kind,
          };
    },
    getSnapshot(): Readonly<Record<string, NodeProviderLifecycleEffectJournalEntry>> {
      return Object.freeze(
        Object.fromEntries(
          Array.from(entries.entries()).map(([idempotencyKey, entry]) => [
            idempotencyKey,
            exposeEntry(entry),
          ])
        )
      );
    },
    clear(): void {
      entries.clear();
    },
  };
}
