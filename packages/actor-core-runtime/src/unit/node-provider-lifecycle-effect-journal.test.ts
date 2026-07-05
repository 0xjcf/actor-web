import { describe, expect, it } from 'vitest';
import * as browserEntry from '../browser.js';
import * as rootEntry from '../index.js';
import * as nodeEntry from '../node.js';
import {
  type BrandedStringParseResult,
  type ChildProcessHandle,
  createChildProcessHandle,
  createNodeProviderLifecycleFailure,
  createProviderLifecycleAcquisitionKey,
  createProviderLifecycleActivationKey,
  createProviderLifecycleCancellationFact,
  createProviderLifecycleDuplicateFact,
  createProviderLifecycleProcessFact,
  createProviderLifecycleReadinessFact,
  createProviderLifecycleSignalFact,
  type ProviderLifecycleAcquisitionKey,
  type ProviderLifecycleActivationKey,
} from '../node-provider-lifecycle-contract.js';
import {
  createInMemoryNodeProviderLifecycleEffectJournal,
  createNodeProviderLifecycleEffectIdempotencyKey,
  createNodeProviderLifecycleEffectRecord,
  type NodeProviderLifecycleEffectIdempotencyKey,
} from '../node-provider-lifecycle-effect-journal.js';

function expectValid<TValue extends string>(result: BrandedStringParseResult<TValue>): TValue {
  expect(result.outcome).toBe('valid');
  if (result.outcome !== 'valid') {
    throw new Error(`Expected valid branded string, received ${result.reason}`);
  }
  return result.value;
}

function createHandle(value: string): ChildProcessHandle {
  return expectValid(createChildProcessHandle(value));
}

function createActivationKey(value: string): ProviderLifecycleActivationKey {
  return expectValid(createProviderLifecycleActivationKey(value));
}

function createAcquisitionKey(value: string): ProviderLifecycleAcquisitionKey {
  return expectValid(createProviderLifecycleAcquisitionKey(value));
}

function createEffectKey(
  overrides: Partial<Parameters<typeof createNodeProviderLifecycleEffectIdempotencyKey>[0]> = {}
): NodeProviderLifecycleEffectIdempotencyKey {
  return expectValid(
    createNodeProviderLifecycleEffectIdempotencyKey({
      kind: 'spawn',
      provider: 'mlx_lm.server',
      operationKey: 'boot-001',
      activationKey: createActivationKey('activation:provider-host:001'),
      acquisitionKey: createAcquisitionKey('acquisition:provider-host:001'),
      ...overrides,
    })
  );
}

function tryMutatingRecordedProcess(record: unknown, provider: string, pid: number): void {
  try {
    const mutable = record as {
      result: {
        process: {
          provider: string;
          pid: number;
        };
      };
    };
    mutable.result.process.provider = provider;
    mutable.result.process.pid = pid;
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
  }
}

describe('node provider lifecycle effect journal', () => {
  it('creates stable idempotency keys from explicit lifecycle facts', () => {
    const activationKey = createActivationKey('activation:provider-host:001');
    const acquisitionKey = createAcquisitionKey('acquisition:provider-host:001');
    const idempotencyKey = createEffectKey({ activationKey, acquisitionKey });

    expect(
      createNodeProviderLifecycleEffectIdempotencyKey({
        kind: 'spawn',
        provider: 'mlx_lm.server',
        operationKey: 'boot-001',
        activationKey,
        acquisitionKey,
      })
    ).toEqual({
      outcome: 'valid',
      value: idempotencyKey,
    });
    expect(String(idempotencyKey)).toContain('node-provider-lifecycle-effect:key');
    expect(String(idempotencyKey)).toContain(encodeURIComponent('mlx_lm.server'));
    expect(
      createNodeProviderLifecycleEffectIdempotencyKey({
        kind: 'spawn',
        provider: '',
        operationKey: 'boot-001',
      })
    ).toEqual({
      outcome: 'invalid',
      reason: 'expected_non_empty_string',
      value: '',
    });
  });

  it('claims once and replays recorded facts without authorizing duplicate effect reruns', () => {
    const journal = createInMemoryNodeProviderLifecycleEffectJournal();
    const activationKey = createActivationKey('activation:provider-host:001');
    const acquisitionKey = createAcquisitionKey('acquisition:provider-host:001');
    const handle = createHandle('child:provider-host:001');
    const idempotencyKey = createEffectKey({ activationKey, acquisitionKey });

    expect(
      journal.claim({
        idempotencyKey,
        kind: 'spawn',
      })
    ).toEqual({
      outcome: 'claimed',
      idempotencyKey,
      kind: 'spawn',
    });
    expect(
      journal.claim({
        idempotencyKey,
        kind: 'spawn',
      })
    ).toEqual({
      outcome: 'duplicate',
      idempotencyKey,
      kind: 'spawn',
      status: 'pending',
    });

    const spawned = createProviderLifecycleProcessFact({
      handle,
      activationKey,
      acquisitionKey,
      provider: 'mlx_lm.server',
      pid: 4242,
      processGroup: 'isolated',
      startedAt: '2026-07-02T04:00:05.000Z',
    });
    const record = createNodeProviderLifecycleEffectRecord({
      idempotencyKey,
      kind: 'spawn',
      recordedAt: '2026-07-02T04:00:06.000Z',
      result: {
        outcome: 'spawned',
        process: spawned,
      },
    });

    expect(journal.record(record)).toEqual({
      outcome: 'recorded',
      record,
    });
    expect(
      journal.claim({
        idempotencyKey,
        kind: 'spawn',
      })
    ).toEqual({
      outcome: 'duplicate',
      idempotencyKey,
      kind: 'spawn',
      status: 'recorded',
      record,
    });
    expect(journal.replay({ idempotencyKey, kind: 'spawn' })).toEqual({
      outcome: 'recorded',
      record,
    });
  });

  it('protects stored journal history from original replay and snapshot mutation', async () => {
    const journal = createInMemoryNodeProviderLifecycleEffectJournal();
    const activationKey = createActivationKey('activation:provider-host:001');
    const acquisitionKey = createAcquisitionKey('acquisition:provider-host:001');
    const handle = createHandle('child:provider-host:001');
    const idempotencyKey = createEffectKey({ activationKey, acquisitionKey });
    const record = createNodeProviderLifecycleEffectRecord({
      idempotencyKey,
      kind: 'spawn',
      recordedAt: '2026-07-02T04:00:06.000Z',
      result: {
        outcome: 'spawned',
        process: createProviderLifecycleProcessFact({
          handle,
          activationKey,
          acquisitionKey,
          provider: 'mlx_lm.server',
          pid: 4242,
          processGroup: 'isolated',
          startedAt: '2026-07-02T04:00:05.000Z',
        }),
      },
    });
    const expectedRecord = createNodeProviderLifecycleEffectRecord({
      idempotencyKey,
      kind: 'spawn',
      recordedAt: '2026-07-02T04:00:06.000Z',
      result: {
        outcome: 'spawned',
        process: createProviderLifecycleProcessFact({
          handle,
          activationKey,
          acquisitionKey,
          provider: 'mlx_lm.server',
          pid: 4242,
          processGroup: 'isolated',
          startedAt: '2026-07-02T04:00:05.000Z',
        }),
      },
    });

    expect(journal.claim({ idempotencyKey, kind: 'spawn' })).toMatchObject({
      outcome: 'claimed',
    });
    expect(journal.record(record)).toEqual({
      outcome: 'recorded',
      record: expectedRecord,
    });

    tryMutatingRecordedProcess(record, 'mutated.original', 9999);

    const firstReplay = await journal.replay({ idempotencyKey, kind: 'spawn' });
    expect(firstReplay).toEqual({
      outcome: 'recorded',
      record: expectedRecord,
    });
    if (firstReplay.outcome !== 'recorded') {
      throw new Error('Expected recorded replay');
    }
    expect(Object.isFrozen(firstReplay.record)).toBe(true);
    expect(Object.isFrozen(firstReplay.record.result)).toBe(true);
    if (firstReplay.record.result.outcome !== 'spawned') {
      throw new Error('Expected spawned replay result');
    }
    expect(Object.isFrozen(firstReplay.record.result.process)).toBe(true);

    tryMutatingRecordedProcess(firstReplay.record, 'mutated.replay', 8888);

    const snapshot = journal.getSnapshot();
    const snapshotEntry = snapshot[idempotencyKey];
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshotEntry)).toBe(true);
    expect(snapshotEntry).toEqual({
      kind: 'spawn',
      status: 'recorded',
      record: expectedRecord,
    });
    if (!snapshotEntry.record) {
      throw new Error('Expected recorded snapshot entry');
    }
    expect(Object.isFrozen(snapshotEntry.record)).toBe(true);
    tryMutatingRecordedProcess(snapshotEntry.record, 'mutated.snapshot', 7777);

    expect(journal.replay({ idempotencyKey, kind: 'spawn' })).toEqual({
      outcome: 'recorded',
      record: expectedRecord,
    });
    expect(journal.claim({ idempotencyKey, kind: 'spawn' })).toEqual({
      outcome: 'duplicate',
      idempotencyKey,
      kind: 'spawn',
      status: 'recorded',
      record: expectedRecord,
    });
  });

  it('covers missing pending duplicate-record and kind-mismatch branches', async () => {
    const journal = createInMemoryNodeProviderLifecycleEffectJournal();
    const activationKey = createActivationKey('activation:provider-host:001');
    const acquisitionKey = createAcquisitionKey('acquisition:provider-host:001');
    const handle = createHandle('child:provider-host:001');
    const missingKey = createEffectKey({
      operationKey: 'missing-claim-001',
      activationKey,
      acquisitionKey,
    });
    const idempotencyKey = createEffectKey({
      operationKey: 'negative-branch-001',
      activationKey,
      acquisitionKey,
    });
    const record = createNodeProviderLifecycleEffectRecord({
      idempotencyKey,
      kind: 'spawn',
      recordedAt: '2026-07-02T04:00:07.000Z',
      result: {
        outcome: 'spawned',
        process: createProviderLifecycleProcessFact({
          handle,
          activationKey,
          acquisitionKey,
          provider: 'mlx_lm.server',
          pid: 4242,
          processGroup: 'isolated',
          startedAt: '2026-07-02T04:00:07.000Z',
        }),
      },
    });
    const secondRecord = createNodeProviderLifecycleEffectRecord({
      idempotencyKey,
      kind: 'spawn',
      recordedAt: '2026-07-02T04:00:08.000Z',
      result: {
        outcome: 'spawned',
        process: createProviderLifecycleProcessFact({
          handle,
          activationKey,
          acquisitionKey,
          provider: 'mutated.provider',
          pid: 9999,
          processGroup: 'isolated',
          startedAt: '2026-07-02T04:00:08.000Z',
        }),
      },
    });
    const mismatchedRecord = createNodeProviderLifecycleEffectRecord({
      idempotencyKey,
      kind: 'signal',
      recordedAt: '2026-07-02T04:00:09.000Z',
      result: {
        outcome: 'missing',
        handle,
        signal: 'SIGTERM',
      },
    });

    expect(await journal.replay({ idempotencyKey: missingKey, kind: 'spawn' })).toEqual({
      outcome: 'missing',
      idempotencyKey: missingKey,
      kind: 'spawn',
    });
    expect(await journal.record(record)).toEqual({
      outcome: 'missing_claim',
      idempotencyKey,
      kind: 'spawn',
    });
    expect(await journal.claim({ idempotencyKey, kind: 'spawn' })).toEqual({
      outcome: 'claimed',
      idempotencyKey,
      kind: 'spawn',
    });
    expect(await journal.replay({ idempotencyKey, kind: 'spawn' })).toEqual({
      outcome: 'pending',
      idempotencyKey,
      kind: 'spawn',
    });
    expect(await journal.claim({ idempotencyKey, kind: 'signal' })).toMatchObject({
      outcome: 'error',
      failure: {
        code: 'invalid_request',
        retryable: false,
        details: {
          idempotencyKey,
          expectedKind: 'spawn',
          actualKind: 'signal',
        },
      },
    });

    expect(await journal.record(record)).toEqual({
      outcome: 'recorded',
      record,
    });
    expect(await journal.record(secondRecord)).toEqual({
      outcome: 'already_recorded',
      record,
    });
    expect(await journal.record(mismatchedRecord)).toMatchObject({
      outcome: 'error',
      failure: {
        code: 'invalid_request',
        retryable: false,
        details: {
          idempotencyKey,
          expectedKind: 'spawn',
          actualKind: 'signal',
        },
      },
    });
    expect(await journal.replay({ idempotencyKey, kind: 'signal' })).toMatchObject({
      outcome: 'error',
      failure: {
        code: 'invalid_request',
        retryable: false,
        details: {
          idempotencyKey,
          expectedKind: 'spawn',
          actualKind: 'signal',
        },
      },
    });
  });

  it('records and replays duplicate-prevention results as journal data only', () => {
    const journal = createInMemoryNodeProviderLifecycleEffectJournal();
    const activationKey = createActivationKey('activation:provider-host:001');
    const acquisitionKey = createAcquisitionKey('acquisition:provider-host:001');
    const handle = createHandle('child:provider-host:001');
    const idempotencyKey = createEffectKey({
      kind: 'duplicate_prevention',
      operationKey: 'claim-001',
      activationKey,
      acquisitionKey,
    });
    const duplicate = createProviderLifecycleDuplicateFact({
      activationKey,
      acquisitionKey,
      provider: 'mlx_lm.server',
      handle,
      detectedAt: '2026-07-02T04:00:04.000Z',
      disposition: 'duplicate',
    });
    const record = createNodeProviderLifecycleEffectRecord({
      idempotencyKey,
      kind: 'duplicate_prevention',
      recordedAt: '2026-07-02T04:00:04.000Z',
      result: {
        outcome: 'duplicate',
        duplicate,
      },
    });

    expect(
      journal.claim({
        idempotencyKey,
        kind: 'duplicate_prevention',
      })
    ).toEqual({
      outcome: 'claimed',
      idempotencyKey,
      kind: 'duplicate_prevention',
    });
    expect(journal.record(record)).toEqual({
      outcome: 'recorded',
      record,
    });
    expect(
      journal.claim({
        idempotencyKey,
        kind: 'duplicate_prevention',
      })
    ).toEqual({
      outcome: 'duplicate',
      idempotencyKey,
      kind: 'duplicate_prevention',
      status: 'recorded',
      record,
    });
    expect(journal.replay({ idempotencyKey, kind: 'duplicate_prevention' })).toEqual({
      outcome: 'recorded',
      record,
    });
  });

  it('replays spawn signal readiness and failure facts verbatim as data', () => {
    const journal = createInMemoryNodeProviderLifecycleEffectJournal();
    const activationKey = createActivationKey('activation:provider-host:001');
    const acquisitionKey = createAcquisitionKey('acquisition:provider-host:001');
    const handle = createHandle('child:provider-host:001');

    const spawnKey = createEffectKey({
      kind: 'spawn',
      operationKey: 'boot-002',
      activationKey,
      acquisitionKey,
    });
    const signalKey = createEffectKey({
      kind: 'signal',
      operationKey: 'shutdown-001',
      activationKey,
      acquisitionKey,
      handle,
    });
    const readinessKey = createEffectKey({
      kind: 'readiness',
      operationKey: 'health-001',
      activationKey,
      acquisitionKey,
      handle,
      target: 'http://127.0.0.1:8080/health',
    });
    const failureKey = createEffectKey({
      kind: 'spawn',
      operationKey: 'boot-003',
      activationKey,
      acquisitionKey,
    });

    const spawnRecord = createNodeProviderLifecycleEffectRecord({
      idempotencyKey: spawnKey,
      kind: 'spawn',
      recordedAt: '2026-07-02T04:00:06.000Z',
      result: {
        outcome: 'spawned',
        process: createProviderLifecycleProcessFact({
          handle,
          activationKey,
          acquisitionKey,
          provider: 'mlx_lm.server',
          pid: 4242,
          processGroup: 'isolated',
          startedAt: '2026-07-02T04:00:05.000Z',
        }),
      },
    });
    const signalRecord = createNodeProviderLifecycleEffectRecord({
      idempotencyKey: signalKey,
      kind: 'signal',
      recordedAt: '2026-07-02T04:00:10.000Z',
      result: {
        outcome: 'signaled',
        fact: createProviderLifecycleSignalFact({
          handle,
          signal: 'SIGTERM',
          reason: 'shutdown',
          observedAt: '2026-07-02T04:00:10.000Z',
        }),
      },
    });
    const readinessRecord = createNodeProviderLifecycleEffectRecord({
      idempotencyKey: readinessKey,
      kind: 'readiness',
      recordedAt: '2026-07-02T04:00:11.000Z',
      result: {
        outcome: 'ready',
        fact: createProviderLifecycleReadinessFact({
          handle,
          attempt: 1,
          strategy: 'http',
          target: 'http://127.0.0.1:8080/health',
          observedAt: '2026-07-02T04:00:11.000Z',
          detail: '200 OK',
        }),
      },
    });
    const failureRecord = createNodeProviderLifecycleEffectRecord({
      idempotencyKey: failureKey,
      kind: 'spawn',
      recordedAt: '2026-07-02T04:00:12.000Z',
      result: {
        outcome: 'failed',
        failure: createNodeProviderLifecycleFailure({
          code: 'startup_timeout',
          message: 'Provider never became ready.',
          retryable: true,
          details: { provider: 'mlx_lm.server' },
        }),
      },
    });

    for (const record of [spawnRecord, signalRecord, readinessRecord, failureRecord]) {
      expect(
        journal.claim({
          idempotencyKey: record.idempotencyKey,
          kind: record.kind,
        })
      ).toMatchObject({ outcome: 'claimed' });
      expect(journal.record(record)).toEqual({
        outcome: 'recorded',
        record,
      });
    }

    expect(journal.replay({ idempotencyKey: spawnKey, kind: 'spawn' })).toEqual({
      outcome: 'recorded',
      record: spawnRecord,
    });
    expect(journal.replay({ idempotencyKey: signalKey, kind: 'signal' })).toEqual({
      outcome: 'recorded',
      record: signalRecord,
    });
    expect(journal.replay({ idempotencyKey: readinessKey, kind: 'readiness' })).toEqual({
      outcome: 'recorded',
      record: readinessRecord,
    });
    expect(journal.replay({ idempotencyKey: failureKey, kind: 'spawn' })).toEqual({
      outcome: 'recorded',
      record: failureRecord,
    });
  });

  it('replays filesystem cache and model-cache inspection facts as plain data', () => {
    const journal = createInMemoryNodeProviderLifecycleEffectJournal();
    const filesystemKey = createEffectKey({
      kind: 'filesystem_probe',
      operationKey: 'cache-dir-001',
      target: '/tmp/provider-cache',
    });
    const modelCacheKey = createEffectKey({
      kind: 'model_cache_inspect',
      operationKey: 'models-001',
      target: 'mlx-community/Qwen3-8B',
    });

    const filesystemRecord = createNodeProviderLifecycleEffectRecord({
      idempotencyKey: filesystemKey,
      kind: 'filesystem_probe',
      recordedAt: '2026-07-02T04:00:20.000Z',
      result: {
        outcome: 'probed',
        fact: {
          target: '/tmp/provider-cache',
          exists: true,
          entries: ['models', 'locks'],
          writable: false,
          observedAt: '2026-07-02T04:00:20.000Z',
        },
      },
    });
    const modelCacheRecord = createNodeProviderLifecycleEffectRecord({
      idempotencyKey: modelCacheKey,
      kind: 'model_cache_inspect',
      recordedAt: '2026-07-02T04:00:21.000Z',
      result: {
        outcome: 'inspected',
        fact: {
          provider: 'mlx_lm.server',
          modelId: 'mlx-community/Qwen3-8B',
          cacheKey: 'qwen3-8b',
          status: 'warm',
          bytesOnDisk: 1024,
          observedAt: '2026-07-02T04:00:21.000Z',
        },
      },
    });

    for (const record of [filesystemRecord, modelCacheRecord]) {
      expect(
        journal.claim({
          idempotencyKey: record.idempotencyKey,
          kind: record.kind,
        })
      ).toMatchObject({ outcome: 'claimed' });
      expect(journal.record(record)).toEqual({
        outcome: 'recorded',
        record,
      });
    }

    expect(journal.replay({ idempotencyKey: filesystemKey, kind: 'filesystem_probe' })).toEqual({
      outcome: 'recorded',
      record: filesystemRecord,
    });
    expect(journal.replay({ idempotencyKey: modelCacheKey, kind: 'model_cache_inspect' })).toEqual({
      outcome: 'recorded',
      record: modelCacheRecord,
    });
  });

  it('preserves cancellation records with reason and attribution', () => {
    const journal = createInMemoryNodeProviderLifecycleEffectJournal();
    const activationKey = createActivationKey('activation:provider-host:001');
    const cancellationKey = createEffectKey({
      kind: 'cancellation',
      operationKey: 'cancel-001',
      activationKey,
    });
    const record = createNodeProviderLifecycleEffectRecord({
      idempotencyKey: cancellationKey,
      kind: 'cancellation',
      recordedAt: '2026-07-02T04:00:30.000Z',
      result: {
        outcome: 'cancelled',
        fact: createProviderLifecycleCancellationFact({
          requestedBy: 'runtime',
          reason: 'readiness_failed',
          requestedAt: '2026-07-02T04:00:30.000Z',
          activationKey,
        }),
      },
    });

    expect(
      journal.claim({
        idempotencyKey: cancellationKey,
        kind: 'cancellation',
      })
    ).toMatchObject({ outcome: 'claimed' });
    expect(journal.record(record)).toEqual({
      outcome: 'recorded',
      record,
    });
    expect(journal.replay({ idempotencyKey: cancellationKey, kind: 'cancellation' })).toEqual({
      outcome: 'recorded',
      record,
    });
  });

  it('exports journal helpers from node only', () => {
    expect(nodeEntry.createInMemoryNodeProviderLifecycleEffectJournal).toBeTypeOf('function');
    expect(nodeEntry.createNodeProviderLifecycleEffectIdempotencyKey).toBeTypeOf('function');
    expect('createInMemoryNodeProviderLifecycleEffectJournal' in rootEntry).toBe(false);
    expect('createNodeProviderLifecycleEffectIdempotencyKey' in rootEntry).toBe(false);
    expect('createInMemoryNodeProviderLifecycleEffectJournal' in browserEntry).toBe(false);
    expect('createNodeProviderLifecycleEffectIdempotencyKey' in browserEntry).toBe(false);
  });
});
