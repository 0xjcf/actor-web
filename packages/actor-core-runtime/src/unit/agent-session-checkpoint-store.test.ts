import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyAgentSessionCheckpointReadResult,
  createAgentSessionCheckpointEnvelope,
  createInMemoryAgentSessionCheckpointStore,
  deriveAgentSessionCheckpointRehydration,
  parseAgentSessionCheckpointEnvelope,
} from '../agent-session-checkpoint-store.js';
import * as browserEntry from '../browser.js';
import * as rootEntry from '../index.js';
import * as nodeEntry from '../node.js';

const TEST_CONTINUATION_FORMATS = [
  {
    provider: 'test-provider',
    adapter: 'test-provider-adapter',
    formatVersion: 1,
  },
] as const;

afterEach(() => {
  vi.doUnmock('node:fs/promises');
  vi.resetModules();
  vi.restoreAllMocks();
});

function createCheckpointEnvelope(
  overrides: Partial<Parameters<typeof createAgentSessionCheckpointEnvelope>[0]> = {}
) {
  return createAgentSessionCheckpointEnvelope({
    sessionId: 'session:checkpoint:001',
    checkpointId: 'checkpoint:001',
    actor: {
      actorId: 'runtime://agent/session:checkpoint:001',
      sessionId: 'session:checkpoint:001',
      turnId: 'turn:001',
      traceId: 'trace:001',
      commandId: 'command:001',
      correlationId: 'corr:001',
      causationId: 'cause:001',
    },
    deterministic: {
      history: [{ role: 'user', content: 'Resume the prior turn.' }],
      steps: 1,
      pendingToolCalls: [],
      lastError: null,
    },
    effect: {
      effectId: 'effect:001',
      effectAttemptId: 'effect-attempt:001',
      phase: 'intent_recorded',
      irreversible: true,
      intent: {
        effectType: 'tool_call',
        toolName: 'repo.diff',
        idempotencyScope: 'tool:repo.diff',
      },
    },
    continuation: {
      provider: 'test-provider',
      adapter: 'test-provider-adapter',
      formatVersion: 1,
      payload: {
        cursor: 'opaque-provider-state',
      },
      payloadBytes: new TextEncoder().encode(
        JSON.stringify({
          cursor: 'opaque-provider-state',
        })
      ).byteLength,
      redaction: {
        disposition: 'none',
        fields: [],
      },
    },
    reconciliation: {
      status: 'pending',
      reason: 'awaiting_effect_receipt',
    },
    recordedAt: '2026-07-29T13:45:00.000Z',
    expiresAt: null,
    ...overrides,
  });
}

describe('agent session checkpoint store', () => {
  it('stores provider-neutral checkpoint envelopes with explicit read/write outcomes', async () => {
    const store = createInMemoryAgentSessionCheckpointStore({
      now: () => new Date('2026-07-29T13:45:30.000Z'),
    });
    const envelope = createCheckpointEnvelope();

    await expect(
      store.read({
        sessionId: 'session:checkpoint:001',
      })
    ).resolves.toEqual({
      outcome: 'missing',
      sessionId: 'session:checkpoint:001',
    });

    await expect(store.write(envelope)).resolves.toEqual({
      outcome: 'stored',
      envelope,
    });

    await expect(
      store.read({
        sessionId: 'session:checkpoint:001',
      })
    ).resolves.toEqual({
      outcome: 'present',
      envelope,
    });
  });

  it('derives duplicate, expired, and reconciliation-required outcomes without claiming silent replay', async () => {
    const store = createInMemoryAgentSessionCheckpointStore();
    const deferredEnvelope = createCheckpointEnvelope();

    await expect(store.write(deferredEnvelope)).resolves.toEqual({
      outcome: 'stored',
      envelope: deferredEnvelope,
    });
    await expect(store.write(deferredEnvelope)).resolves.toEqual({
      outcome: 'duplicate',
      envelope: deferredEnvelope,
      previous: deferredEnvelope,
    });
    await expect(
      store.read({
        sessionId: deferredEnvelope.sessionId,
      })
    ).resolves.toEqual({
      outcome: 'present',
      envelope: deferredEnvelope,
    });
    expect(
      deriveAgentSessionCheckpointRehydration(
        {
          outcome: 'present',
          envelope: deferredEnvelope,
        },
        {
          supportedContinuationFormats: TEST_CONTINUATION_FORMATS,
        }
      )
    ).toEqual({
      outcome: 'deferred_for_reconciliation',
      envelope: deferredEnvelope,
      reason: 'Irreversible effect intent was recorded without a settled receipt.',
    });

    const expiredEnvelope = createCheckpointEnvelope({
      checkpointId: 'checkpoint:expired',
      recordedAt: '2026-07-29T13:45:00.000Z',
      expiresAt: '2026-07-29T13:44:59.000Z',
      reconciliation: {
        status: 'clear',
      },
      effect: {
        effectId: 'effect:expired',
        effectAttemptId: 'effect-attempt:expired',
        phase: 'receipt_recorded',
        irreversible: true,
        intent: {
          effectType: 'tool_call',
          toolName: 'repo.diff',
          idempotencyScope: 'tool:repo.diff',
        },
        receipt: { outcome: 'ok' },
      },
    });
    await expect(store.write(expiredEnvelope)).resolves.toEqual({
      outcome: 'expired',
      envelope: expiredEnvelope,
    });
  });

  it('classifies checkpoint read precedence as expired before stale before redacted before present', () => {
    const now = new Date('2026-07-29T13:47:00.000Z');

    const expiredContinuationEnvelope = createCheckpointEnvelope({
      checkpointId: 'checkpoint:expired-continuation-precedence',
      staleAt: '2026-07-29T13:46:00.000Z',
      redactedFields: ['continuation.payload'],
      continuation: {
        provider: 'test-provider',
        adapter: 'test-provider-adapter',
        formatVersion: 1,
        payload: {
          cursor: 'opaque-provider-state',
        },
        payloadBytes: new TextEncoder().encode(
          JSON.stringify({
            cursor: 'opaque-provider-state',
          })
        ).byteLength,
        expiresAt: '2026-07-29T13:46:30.000Z',
        redaction: {
          disposition: 'none',
          fields: [],
        },
      },
    });
    expect(
      classifyAgentSessionCheckpointReadResult(expiredContinuationEnvelope, now)
    ).toMatchObject({
      outcome: 'expired',
      envelope: expiredContinuationEnvelope,
    });

    const staleRedactedEnvelope = createCheckpointEnvelope({
      checkpointId: 'checkpoint:stale-redacted-precedence',
      staleAt: '2026-07-29T13:46:00.000Z',
      redactedFields: ['continuation.payload'],
    });
    expect(classifyAgentSessionCheckpointReadResult(staleRedactedEnvelope, now)).toMatchObject({
      outcome: 'stale',
      envelope: staleRedactedEnvelope,
    });

    const metadataOnlyEnvelope = createCheckpointEnvelope({
      checkpointId: 'checkpoint:redacted-fallback',
      continuation: {
        provider: 'test-provider',
        adapter: 'test-provider-adapter',
        formatVersion: 1,
        payload: null,
        payloadBytes: 0,
        redaction: {
          disposition: 'metadata_only',
          fields: ['continuation.resumeToken'],
        },
      },
      redactedFields: [],
      effect: null,
      reconciliation: {
        status: 'clear',
      },
    });
    expect(classifyAgentSessionCheckpointReadResult(metadataOnlyEnvelope, now)).toEqual({
      outcome: 'redacted',
      envelope: metadataOnlyEnvelope,
      fields: ['continuation.resumeToken'],
    });

    const presentEnvelope = createCheckpointEnvelope({
      checkpointId: 'checkpoint:present-precedence',
      effect: null,
      reconciliation: {
        status: 'clear',
      },
    });
    expect(classifyAgentSessionCheckpointReadResult(presentEnvelope, now)).toEqual({
      outcome: 'present',
      envelope: presentEnvelope,
    });
  });

  it('rejects construction and parsing inputs that cannot round-trip as the checkpoint contract', () => {
    const envelope = createCheckpointEnvelope();
    const invalidIdentity = {
      ...envelope,
      actor: {
        ...envelope.actor,
        actorId: '',
      },
    } as Parameters<typeof createAgentSessionCheckpointEnvelope>[0];
    expect(() => createAgentSessionCheckpointEnvelope(invalidIdentity)).toThrow(
      'Agent session checkpoint actor identity is invalid.'
    );

    const invalidEffect = {
      ...envelope,
      effect: {
        ...envelope.effect,
        phase: 'unknown',
      },
    } as unknown as Parameters<typeof createAgentSessionCheckpointEnvelope>[0];
    expect(() => createAgentSessionCheckpointEnvelope(invalidEffect)).toThrow(
      'Agent session checkpoint effect state is invalid.'
    );

    const customJson = Object.defineProperty({ state: 'not-round-trippable' }, 'toJSON', {
      value: () => ({ state: 'different' }),
    });
    const invalidDeterministicState = {
      ...envelope,
      deterministic: customJson,
    } as unknown as Parameters<typeof createAgentSessionCheckpointEnvelope>[0];
    expect(() => createAgentSessionCheckpointEnvelope(invalidDeterministicState)).toThrow(
      'Agent session checkpoint deterministic state must be JSON-safe.'
    );

    const cyclicState: Record<string, unknown> = {};
    cyclicState.self = cyclicState;
    const invalidCyclicState = {
      ...envelope,
      deterministic: cyclicState,
    } as unknown as Parameters<typeof createAgentSessionCheckpointEnvelope>[0];
    expect(() => createAgentSessionCheckpointEnvelope(invalidCyclicState)).toThrow(
      'Agent session checkpoint deterministic state must be JSON-safe.'
    );

    const invalidSparseState = {
      ...envelope,
      deterministic: new Array(1),
    } as unknown as Parameters<typeof createAgentSessionCheckpointEnvelope>[0];
    expect(() => createAgentSessionCheckpointEnvelope(invalidSparseState)).toThrow(
      'Agent session checkpoint deterministic state must be JSON-safe.'
    );

    const serializedEnvelope = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
    const continuation = serializedEnvelope.continuation as Record<string, unknown>;
    expect(
      parseAgentSessionCheckpointEnvelope({
        ...serializedEnvelope,
        continuation: {
          ...continuation,
          payloadBytes: Number(continuation.payloadBytes) + 1,
        },
      })
    ).toMatchObject({
      ok: false,
      reason: 'corrupt',
    });
    expect(
      parseAgentSessionCheckpointEnvelope({
        ...serializedEnvelope,
        continuation: {
          ...continuation,
          redaction: {
            disposition: 'metadata_only',
            fields: ['continuation.payload'],
          },
        },
      })
    ).toMatchObject({
      ok: false,
      reason: 'corrupt',
    });
    expect(() =>
      createCheckpointEnvelope({
        sessionId: '\ud800',
        actor: {
          ...envelope.actor,
          sessionId: '\ud800',
        },
      })
    ).toThrow('Agent session checkpoint requires a non-empty sessionId.');
    expect(() =>
      createCheckpointEnvelope({
        checkpointId: '\ud800',
      })
    ).toThrow('Agent session checkpoint requires a non-empty checkpointId.');
    expect(() =>
      createCheckpointEnvelope({
        recordedAt: '2026-07-29 13:45:00Z',
      })
    ).toThrow('Agent session checkpoint recordedAt must be an ISO timestamp.');
  });

  it('requires exact adapter continuation compatibility and never resumes metadata-only payloads', async () => {
    const envelope = createCheckpointEnvelope({
      reconciliation: {
        status: 'clear',
      },
      effect: null,
    });
    const present = {
      outcome: 'present' as const,
      envelope,
    };

    expect(deriveAgentSessionCheckpointRehydration(present)).toMatchObject({
      outcome: 'manual_recovery_required',
      reason: 'continuation_incompatible',
    });
    expect(
      deriveAgentSessionCheckpointRehydration(present, {
        supportedContinuationFormats: [
          {
            provider: 'test-provider',
            adapter: 'test-provider-adapter',
            formatVersion: 2,
          },
        ],
      })
    ).toMatchObject({
      outcome: 'manual_recovery_required',
      reason: 'continuation_incompatible',
    });
    expect(
      deriveAgentSessionCheckpointRehydration(present, {
        supportedContinuationFormats: TEST_CONTINUATION_FORMATS,
      })
    ).toEqual({
      outcome: 'resumed',
      envelope,
    });

    const metadataOnlyEnvelope = createCheckpointEnvelope({
      checkpointId: 'checkpoint:metadata-only',
      continuation: {
        provider: 'test-provider',
        adapter: 'test-provider-adapter',
        formatVersion: 1,
        payload: null,
        payloadBytes: 0,
        redaction: {
          disposition: 'metadata_only',
          fields: [],
        },
      },
      redactedFields: [],
      reconciliation: {
        status: 'clear',
      },
      effect: null,
    });
    const store = createInMemoryAgentSessionCheckpointStore();
    await expect(store.write(metadataOnlyEnvelope)).resolves.toMatchObject({
      outcome: 'stored',
    });
    const read = await store.read({ sessionId: metadataOnlyEnvelope.sessionId });
    expect(read).toEqual({
      outcome: 'redacted',
      envelope: metadataOnlyEnvelope,
      fields: [],
    });
    expect(deriveAgentSessionCheckpointRehydration(read)).toMatchObject({
      outcome: 'manual_recovery_required',
      reason: 'redacted',
    });
  });

  it('uses an injected in-memory clock for deterministic expiry and preserves __proto__ sessions', async () => {
    let now = new Date('2026-07-29T13:45:00.000Z');
    const store = createInMemoryAgentSessionCheckpointStore({
      now: () => now,
    });
    const expiringEnvelope = createCheckpointEnvelope({
      expiresAt: '2026-07-29T13:46:00.000Z',
    });
    await expect(store.write(expiringEnvelope)).resolves.toMatchObject({
      outcome: 'stored',
    });
    now = new Date('2026-07-29T13:46:00.000Z');
    await expect(store.read({ sessionId: expiringEnvelope.sessionId })).resolves.toEqual({
      outcome: 'expired',
      envelope: expiringEnvelope,
    });

    const prototypeEnvelope = createCheckpointEnvelope({
      sessionId: '__proto__',
      checkpointId: 'checkpoint:prototype',
      actor: {
        ...expiringEnvelope.actor,
        sessionId: '__proto__',
      },
      expiresAt: null,
    });
    await expect(store.write(prototypeEnvelope)).resolves.toMatchObject({
      outcome: 'stored',
    });
    const snapshot = store.getSnapshot();
    expect(Object.getPrototypeOf(snapshot)).toBeNull();
    expect(Object.hasOwn(snapshot, '__proto__')).toBe(true);
    expect(snapshot.__proto__).toBe(prototypeEnvelope);
  });

  it('invalidates an expired provider continuation before rehydration', async () => {
    const store = createInMemoryAgentSessionCheckpointStore({
      now: () => new Date('2026-07-29T13:45:30.000Z'),
    });
    const envelope = createCheckpointEnvelope({
      checkpointId: 'checkpoint:expired-continuation',
      continuation: {
        provider: 'test-provider',
        adapter: 'test-provider-adapter',
        formatVersion: 1,
        payload: {
          cursor: 'opaque-provider-state',
        },
        payloadBytes: new TextEncoder().encode(
          JSON.stringify({
            cursor: 'opaque-provider-state',
          })
        ).byteLength,
        expiresAt: '2026-07-30T13:45:00.000Z',
        redaction: {
          disposition: 'none',
          fields: [],
        },
      },
      expiresAt: '2026-08-01T13:45:00.000Z',
    });

    await expect(store.write(envelope)).resolves.toMatchObject({
      outcome: 'stored',
    });
    const readResult = await store.read({
      sessionId: envelope.sessionId,
      now: () => new Date('2026-07-31T13:45:00.000Z'),
    });
    expect(readResult).toEqual({
      outcome: 'expired',
      envelope,
    });
    expect(deriveAgentSessionCheckpointRehydration(readResult)).toMatchObject({
      outcome: 'manual_recovery_required',
      reason: 'expired',
    });
  });

  it('uses the node filesystem adapter for corrupt, version-mismatch, redacted, and stale checkpoints', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'actor-web-checkpoints-'));
    const nodeStore = nodeEntry.createNodeFileSystemAgentSessionCheckpointStore({
      directory,
      redactOpaqueContinuation: true,
      now: () => new Date('2026-07-29T13:45:30.000Z'),
    });
    const envelope = createCheckpointEnvelope({
      checkpointId: 'checkpoint:node',
      staleAt: '2026-07-29T13:46:00.000Z',
      reconciliation: {
        status: 'clear',
      },
      effect: {
        effectId: 'effect:node',
        effectAttemptId: 'effect-attempt:node',
        phase: 'receipt_recorded',
        irreversible: true,
        intent: {
          effectType: 'tool_call',
          toolName: 'repo.diff',
          idempotencyScope: 'tool:repo.diff',
        },
        receipt: { outcome: 'ok' },
      },
    });

    await expect(nodeStore.write(envelope)).resolves.toMatchObject({
      outcome: 'stored',
      envelope: {
        checkpointId: 'checkpoint:node',
        redactedFields: ['continuation.payload'],
      },
    });
    const redactedRead = await nodeStore.read({ sessionId: envelope.sessionId });
    expect(redactedRead).toMatchObject({
      outcome: 'redacted',
      envelope: {
        checkpointId: 'checkpoint:node',
      },
      fields: ['continuation.payload'],
    });
    expect(deriveAgentSessionCheckpointRehydration(redactedRead)).toMatchObject({
      outcome: 'manual_recovery_required',
      reason: 'redacted',
    });
    const staleRedactedStore = nodeEntry.createNodeFileSystemAgentSessionCheckpointStore({
      directory,
      now: () => new Date('2026-07-29T13:47:00.000Z'),
    });
    await expect(staleRedactedStore.read({ sessionId: envelope.sessionId })).resolves.toMatchObject(
      {
        outcome: 'stale',
        envelope: {
          checkpointId: 'checkpoint:node',
          redactedFields: ['continuation.payload'],
        },
      }
    );

    const rawFilePath = path.join(directory, `${encodeURIComponent(envelope.sessionId)}.json`);
    await writeFile(
      rawFilePath,
      JSON.stringify({
        schemaVersion: 99,
        sessionId: envelope.sessionId,
      })
    );
    await expect(nodeStore.read({ sessionId: envelope.sessionId })).resolves.toEqual({
      outcome: 'version_mismatch',
      sessionId: envelope.sessionId,
      foundVersion: 99,
      supportedVersions: [1],
    });

    await writeFile(rawFilePath, '{not-json');
    await expect(nodeStore.read({ sessionId: envelope.sessionId })).resolves.toMatchObject({
      outcome: 'corrupt',
      sessionId: envelope.sessionId,
    });

    await writeFile(
      rawFilePath,
      JSON.stringify({
        ...envelope,
        actor: {
          ...envelope.actor,
          sessionId: 'session:checkpoint:mismatched-actor',
        },
      })
    );
    const mismatchedRead = await nodeStore.read({ sessionId: envelope.sessionId });
    expect(mismatchedRead).toEqual({
      outcome: 'corrupt',
      sessionId: envelope.sessionId,
      detail: 'Checkpoint file is malformed or not JSON-safe.',
    });
    expect(deriveAgentSessionCheckpointRehydration(mismatchedRead)).toEqual({
      outcome: 'manual_recovery_required',
      sessionId: envelope.sessionId,
      reason: 'corrupt',
      detail: 'Checkpoint file is malformed or not JSON-safe.',
    });

    const staleStore = nodeEntry.createNodeFileSystemAgentSessionCheckpointStore({
      directory,
      now: () => new Date('2026-07-29T13:47:00.000Z'),
    });
    await writeFile(rawFilePath, JSON.stringify(envelope));
    await expect(staleStore.read({ sessionId: envelope.sessionId })).resolves.toEqual({
      outcome: 'stale',
      envelope,
    });
  });

  it('treats same checkpointId writes as duplicate after a stale persisted outcome', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'actor-web-checkpoints-duplicate-'));
    const initialStore = nodeEntry.createNodeFileSystemAgentSessionCheckpointStore({
      directory,
      redactOpaqueContinuation: false,
      now: () => new Date('2026-07-29T13:45:30.000Z'),
    });

    const staleEnvelope = createCheckpointEnvelope({
      checkpointId: 'checkpoint:stale-duplicate',
      staleAt: '2026-07-29T13:46:00.000Z',
      expiresAt: '2026-07-30T13:45:00.000Z',
      effect: null,
      reconciliation: {
        status: 'clear',
      },
    });
    await expect(initialStore.write(staleEnvelope)).resolves.toMatchObject({
      outcome: 'stored',
    });

    const staleStore = nodeEntry.createNodeFileSystemAgentSessionCheckpointStore({
      directory,
      redactOpaqueContinuation: false,
      now: () => new Date('2026-07-29T13:47:00.000Z'),
    });
    await expect(staleStore.read({ sessionId: staleEnvelope.sessionId })).resolves.toEqual({
      outcome: 'stale',
      envelope: staleEnvelope,
    });
    await expect(staleStore.write(staleEnvelope)).resolves.toEqual({
      outcome: 'duplicate',
      envelope: staleEnvelope,
      previous: staleEnvelope,
    });
  });

  it('treats same checkpointId writes as duplicate after an expired persisted outcome', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'actor-web-checkpoints-duplicate-'));
    const initialStore = nodeEntry.createNodeFileSystemAgentSessionCheckpointStore({
      directory,
      redactOpaqueContinuation: false,
      now: () => new Date('2026-07-29T13:45:30.000Z'),
    });
    const expiredStore = nodeEntry.createNodeFileSystemAgentSessionCheckpointStore({
      directory,
      redactOpaqueContinuation: false,
      now: () => new Date('2026-07-29T13:47:00.000Z'),
    });
    const expiredEnvelope = createCheckpointEnvelope({
      checkpointId: 'checkpoint:expired-duplicate',
      expiresAt: '2026-07-29T13:46:00.000Z',
      effect: null,
      reconciliation: {
        status: 'clear',
      },
    });
    await expect(initialStore.write(expiredEnvelope)).resolves.toMatchObject({
      outcome: 'stored',
    });
    await expect(expiredStore.read({ sessionId: expiredEnvelope.sessionId })).resolves.toEqual({
      outcome: 'expired',
      envelope: expiredEnvelope,
    });
    await expect(expiredStore.write(expiredEnvelope)).resolves.toEqual({
      outcome: 'duplicate',
      envelope: expiredEnvelope,
      previous: expiredEnvelope,
    });
  });

  it('caps persisted checkpoint reads without relying on stat plus readFile', async () => {
    const maxBytes = 64;
    const sessionId = 'session:checkpoint:read-cap';
    const mockedClose = vi.fn(async () => undefined);
    const mockedRead = vi.fn(async (buffer: Buffer) => {
      expect(buffer.byteLength).toBe(maxBytes + 1);
      buffer.fill('x');
      return {
        bytesRead: buffer.byteLength,
        buffer,
      };
    });
    const mockedReadFile = vi.fn(async () => Buffer.alloc(maxBytes + 1, 'x'));
    const mockedOpen = vi.fn(async () => ({
      read: mockedRead,
      close: mockedClose,
    }));

    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return {
        ...actual,
        open: mockedOpen,
        readFile: mockedReadFile,
      };
    });

    const nodeModule = await import('../node-agent-session-checkpoint-store.js');
    const nodeStore = nodeModule.createNodeFileSystemAgentSessionCheckpointStore({
      directory: '/tmp/actor-web-checkpoints-read-cap',
      maxBytes,
    });

    await expect(nodeStore.read({ sessionId })).resolves.toEqual({
      outcome: 'corrupt',
      sessionId,
      detail: 'checkpoint_too_large',
    });
    expect(mockedOpen).toHaveBeenCalledTimes(1);
    expect(mockedRead).toHaveBeenCalledTimes(1);
    expect(mockedClose).toHaveBeenCalledTimes(1);
    expect(mockedReadFile).not.toHaveBeenCalled();
  });

  it('closes the capped-read file handle when a node checkpoint read fails mid-stream', async () => {
    const sessionId = 'session:checkpoint:read-error';
    const mockedClose = vi.fn(async () => undefined);
    const mockedRead = vi.fn(async () => {
      throw new Error('boom');
    });
    const mockedOpen = vi.fn(async () => ({
      read: mockedRead,
      close: mockedClose,
    }));

    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return {
        ...actual,
        open: mockedOpen,
      };
    });

    const nodeModule = await import('../node-agent-session-checkpoint-store.js');
    const nodeStore = nodeModule.createNodeFileSystemAgentSessionCheckpointStore({
      directory: '/tmp/actor-web-checkpoints-read-error',
      maxBytes: 64,
    });

    await expect(nodeStore.read({ sessionId })).resolves.toEqual({
      outcome: 'corrupt',
      sessionId,
      detail: 'filesystem_read_failed',
    });
    expect(mockedOpen).toHaveBeenCalledTimes(1);
    expect(mockedRead).toHaveBeenCalledTimes(1);
    expect(mockedClose).toHaveBeenCalledTimes(1);
  });

  it('enforces too_large at the real persisted-byte boundary of the node adapter', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'actor-web-checkpoints-size-'));
    const measurementStore = nodeEntry.createNodeFileSystemAgentSessionCheckpointStore({
      directory,
      redactOpaqueContinuation: true,
    });
    const envelope = createCheckpointEnvelope({
      checkpointId: 'checkpoint:size-boundary',
      reconciliation: {
        status: 'clear',
      },
      effect: {
        effectId: 'effect:size-boundary',
        effectAttemptId: 'effect-attempt:size-boundary',
        phase: 'receipt_recorded',
        irreversible: true,
        intent: {
          effectType: 'tool_call',
          toolName: 'repo.diff',
          idempotencyScope: 'tool:repo.diff',
        },
        receipt: { outcome: 'ok' },
      },
    });

    await expect(measurementStore.write(envelope)).resolves.toMatchObject({
      outcome: 'stored',
    });
    const rawFilePath = path.join(directory, `${encodeURIComponent(envelope.sessionId)}.json`);
    const persisted = await readFile(rawFilePath, 'utf8');
    const persistedBytes = new TextEncoder().encode(persisted).byteLength;

    const strictStore = nodeEntry.createNodeFileSystemAgentSessionCheckpointStore({
      directory: await mkdtemp(path.join(tmpdir(), 'actor-web-checkpoints-too-large-')),
      maxBytes: persistedBytes - 1,
      redactOpaqueContinuation: true,
    });

    await expect(strictStore.write(envelope)).resolves.toEqual({
      outcome: 'too_large',
      envelope: expect.objectContaining({
        checkpointId: 'checkpoint:size-boundary',
      }),
      sizeBytes: persistedBytes,
      maxBytes: persistedBytes - 1,
    });
  });

  it('fails closed for filesystem identity, size, encoding, and permission boundaries', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'actor-web-checkpoints-hardened-'));
    const store = nodeEntry.createNodeFileSystemAgentSessionCheckpointStore({
      directory,
      redactOpaqueContinuation: false,
      now: () => new Date('2026-07-29T13:45:30.000Z'),
    });
    const envelope = createCheckpointEnvelope({
      checkpointId: 'checkpoint:hardened',
    });
    const { write } = store;

    await expect(write(envelope)).resolves.toMatchObject({
      outcome: 'stored',
    });
    const rawFilePath = path.join(directory, `${encodeURIComponent(envelope.sessionId)}.json`);
    const fileStats = await stat(rawFilePath);
    expect(fileStats.mode & 0o777).toBe(0o600);

    const otherEnvelope = createCheckpointEnvelope({
      sessionId: 'session:checkpoint:other',
      checkpointId: 'checkpoint:other',
      actor: {
        ...envelope.actor,
        sessionId: 'session:checkpoint:other',
      },
    });
    await writeFile(rawFilePath, JSON.stringify(otherEnvelope));
    await expect(store.read({ sessionId: envelope.sessionId })).resolves.toEqual({
      outcome: 'corrupt',
      sessionId: envelope.sessionId,
      detail: 'session_id_mismatch',
    });

    const smallStore = nodeEntry.createNodeFileSystemAgentSessionCheckpointStore({
      directory,
      maxBytes: 16,
    });
    await writeFile(rawFilePath, JSON.stringify(envelope));
    await expect(smallStore.read({ sessionId: envelope.sessionId })).resolves.toEqual({
      outcome: 'corrupt',
      sessionId: envelope.sessionId,
      detail: 'checkpoint_too_large',
    });

    await expect(store.read({ sessionId: '\ud800' })).resolves.toEqual({
      outcome: 'corrupt',
      sessionId: '\ud800',
      detail: 'invalid_session_id',
    });
    await expect(
      store.write({
        ...envelope,
        sessionId: '\ud800',
      })
    ).resolves.toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_session_id',
    });
    await expect(
      store.write({
        ...envelope,
        checkpointId: '\ud800',
      })
    ).resolves.toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_checkpoint_id',
    });
  });

  it('serializes same-session filesystem writes across store instances in one host process', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'actor-web-checkpoints-concurrent-'));
    const firstStore = nodeEntry.createNodeFileSystemAgentSessionCheckpointStore({
      directory,
      redactOpaqueContinuation: false,
      now: () => new Date('2026-07-29T13:45:30.000Z'),
    });
    const secondStore = nodeEntry.createNodeFileSystemAgentSessionCheckpointStore({
      directory: path.relative(process.cwd(), directory),
      redactOpaqueContinuation: false,
      now: () => new Date('2026-07-29T13:45:30.000Z'),
    });
    const firstEnvelope = createCheckpointEnvelope({
      checkpointId: 'checkpoint:concurrent:first',
    });
    const secondEnvelope = createCheckpointEnvelope({
      checkpointId: 'checkpoint:concurrent:second',
    });

    await expect(
      Promise.all([firstStore.write(firstEnvelope), secondStore.write(secondEnvelope)])
    ).resolves.toMatchObject([{ outcome: 'stored' }, { outcome: 'replaced' }]);
    await expect(firstStore.read({ sessionId: firstEnvelope.sessionId })).resolves.toEqual({
      outcome: 'present',
      envelope: secondEnvelope,
    });
  });

  it('returns manual recovery when no checkpoint exists before an attempt starts', () => {
    expect(
      deriveAgentSessionCheckpointRehydration({
        outcome: 'missing',
        sessionId: 'session:missing-before-attempt',
      })
    ).toEqual({
      outcome: 'manual_recovery_required',
      sessionId: 'session:missing-before-attempt',
      reason: 'missing',
    });
  });

  it('resumes after a settled receipt was checkpointed without forcing duplicate irreversible effects', () => {
    const settledEnvelope = createCheckpointEnvelope({
      checkpointId: 'checkpoint:settled',
      reconciliation: {
        status: 'clear',
      },
      effect: {
        effectId: 'effect:settled',
        effectAttemptId: 'effect-attempt:settled',
        phase: 'receipt_recorded',
        irreversible: true,
        intent: {
          effectType: 'tool_call',
          toolName: 'repo.diff',
          idempotencyScope: 'tool:repo.diff',
        },
        receipt: { outcome: 'ok' },
      },
    });

    expect(
      deriveAgentSessionCheckpointRehydration(
        {
          outcome: 'present',
          envelope: settledEnvelope,
        },
        {
          supportedContinuationFormats: TEST_CONTINUATION_FORMATS,
        }
      )
    ).toEqual({
      outcome: 'resumed',
      envelope: settledEnvelope,
    });
  });
});

describe('agent session checkpoint exports', () => {
  it('keeps provider-neutral checkpoint contracts on the root entrypoint and node durability on the node entrypoint', () => {
    expect(rootEntry.createInMemoryAgentSessionCheckpointStore).toBeTypeOf('function');
    expect(rootEntry.createAgentSessionCheckpointEnvelope).toBeTypeOf('function');
    expect(rootEntry.parseAgentSessionCheckpointEnvelope).toBeTypeOf('function');
    expect(nodeEntry.createNodeFileSystemAgentSessionCheckpointStore).toBeTypeOf('function');
    expect('createNodeFileSystemAgentSessionCheckpointStore' in rootEntry).toBe(false);
    expect('createNodeFileSystemAgentSessionCheckpointStore' in browserEntry).toBe(false);
  });
});
