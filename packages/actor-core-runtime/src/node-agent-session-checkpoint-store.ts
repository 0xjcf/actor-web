import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type AgentSessionCheckpointEnvelope,
  type AgentSessionCheckpointReadInput,
  type AgentSessionCheckpointReadResult,
  type AgentSessionCheckpointStore,
  type AgentSessionCheckpointWriteResult,
  classifyAgentSessionCheckpointReadResult,
  hasAgentSessionCheckpointEnvelope,
  getAgentSessionCheckpointSupportedSchemaVersions,
  isDuplicateAgentSessionCheckpointReadResult,
  parseAgentSessionCheckpointEnvelope,
} from './agent-session-checkpoint-store.js';

export interface NodeFileSystemAgentSessionCheckpointStoreOptions {
  readonly directory: string;
  readonly maxBytes?: number;
  readonly now?: () => Date;
  readonly redactOpaqueContinuation?: boolean;
}

const processLocalSessionWriteChains = new Map<string, Promise<void>>();

async function withProcessLocalSessionWriteLock<TResult>(
  sessionFilePath: string,
  operation: () => Promise<TResult>
): Promise<TResult> {
  const previous = processLocalSessionWriteChains.get(sessionFilePath) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => current);
  processLocalSessionWriteChains.set(sessionFilePath, chain);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (processLocalSessionWriteChains.get(sessionFilePath) === chain) {
      processLocalSessionWriteChains.delete(sessionFilePath);
    }
  }
}

function serializeCheckpointEnvelope(envelope: AgentSessionCheckpointEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

function measureSerializedCheckpointBytes(serializedEnvelope: string): number {
  return new TextEncoder().encode(serializedEnvelope).byteLength;
}

function encodeCheckpointIdentifier(value: string): string | null {
  try {
    return encodeURIComponent(value);
  } catch {
    return null;
  }
}

function toSessionFilePath(directory: string, sessionId: string): string | null {
  const encodedSessionId = encodeCheckpointIdentifier(sessionId);
  return encodedSessionId === null ? null : path.join(directory, `${encodedSessionId}.json`);
}

function toTempFilePath(filePath: string, checkpointId: string): string | null {
  const encodedCheckpointId = encodeCheckpointIdentifier(checkpointId);
  return encodedCheckpointId === null ? null : `${filePath}.${encodedCheckpointId}.tmp`;
}

function redactEnvelope(envelope: AgentSessionCheckpointEnvelope): AgentSessionCheckpointEnvelope {
  if (envelope.continuation === null) {
    return envelope;
  }
  return Object.freeze({
    ...envelope,
    continuation: Object.freeze({
      ...envelope.continuation,
      payload: null,
      redaction: Object.freeze({
        disposition: 'metadata_only' as const,
        fields: Object.freeze(
          Array.from(new Set([...envelope.continuation.redaction.fields, 'continuation.payload']))
        ),
      }),
    }),
    redactedFields: Object.freeze(
      Array.from(new Set([...envelope.redactedFields, 'continuation.payload']))
    ),
  });
}

function classifyParseFailure(
  sessionId: string,
  parsed: ReturnType<typeof parseAgentSessionCheckpointEnvelope>
): AgentSessionCheckpointReadResult {
  if (parsed.ok) {
    return {
      outcome: 'corrupt',
      sessionId,
      detail: 'unexpected_parse_state',
    };
  }
  if (parsed.reason === 'version_mismatch') {
    return {
      outcome: 'version_mismatch',
      sessionId,
      foundVersion: parsed.schemaVersion ?? null,
      supportedVersions: getAgentSessionCheckpointSupportedSchemaVersions(),
    };
  }
  return {
    outcome: 'corrupt',
    sessionId,
    detail: 'Checkpoint file is malformed or not JSON-safe.',
  };
}

async function readCheckpointFileCapped(
  filePath: string,
  maxBytes: number
): Promise<
  | { readonly ok: true; readonly rawBytes: Buffer }
  | {
      readonly ok: false;
      readonly outcome: 'missing' | 'corrupt';
      readonly sessionId?: string;
      readonly detail?: 'checkpoint_too_large' | 'filesystem_read_failed';
    }
> {
  let fileHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fileHandle = await open(filePath, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        ok: false,
        outcome: 'missing',
      };
    }
    return {
      ok: false,
      outcome: 'corrupt',
      detail: 'filesystem_read_failed',
    };
  }

  const chunks: Buffer[] = [];
  let bytesReadTotal = 0;
  try {
    while (bytesReadTotal <= maxBytes) {
      const chunkSize = Math.min(64 * 1024, maxBytes + 1 - bytesReadTotal);
      const buffer = Buffer.allocUnsafe(chunkSize);
      const { bytesRead } = await fileHandle.read(buffer, 0, chunkSize, null);
      if (bytesRead === 0) {
        break;
      }
      chunks.push(buffer.subarray(0, bytesRead));
      bytesReadTotal += bytesRead;
    }
  } catch {
    return {
      ok: false,
      outcome: 'corrupt',
      detail: 'filesystem_read_failed',
    };
  } finally {
    await fileHandle.close().catch(() => undefined);
  }

  if (bytesReadTotal > maxBytes) {
    return {
      ok: false,
      outcome: 'corrupt',
      detail: 'checkpoint_too_large',
    };
  }

  return {
    ok: true,
    rawBytes: Buffer.concat(chunks, bytesReadTotal),
  };
}

/**
 * Coordinates same-session writes across store instances in this Node process.
 * A host that shares the directory across processes must enforce single-writer
 * session ownership before calling this adapter.
 */
export function createNodeFileSystemAgentSessionCheckpointStore(
  options: NodeFileSystemAgentSessionCheckpointStoreOptions
): AgentSessionCheckpointStore {
  const directory = path.resolve(options.directory);
  const maxBytes = options.maxBytes ?? 256 * 1024;
  const now = options.now ?? (() => new Date());
  const redactOpaqueContinuation = options.redactOpaqueContinuation ?? true;

  const readCheckpoint = async (
    input: AgentSessionCheckpointReadInput
  ): Promise<AgentSessionCheckpointReadResult> => {
    const filePath = toSessionFilePath(directory, input.sessionId);
    if (filePath === null) {
      return {
        outcome: 'corrupt',
        sessionId: input.sessionId,
        detail: 'invalid_session_id',
      };
    }
    const rawRead = await readCheckpointFileCapped(filePath, maxBytes);
    if (!rawRead.ok) {
      if (rawRead.outcome === 'missing') {
        return {
          outcome: 'missing',
          sessionId: input.sessionId,
        };
      }
      return {
        outcome: 'corrupt',
        sessionId: input.sessionId,
        detail: rawRead.detail ?? 'filesystem_read_failed',
      };
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawRead.rawBytes.toString('utf8'));
    } catch {
      return {
        outcome: 'corrupt',
        sessionId: input.sessionId,
        detail: 'invalid_json',
      };
    }
    const parsedEnvelope = parseAgentSessionCheckpointEnvelope(parsedJson);
    if (!parsedEnvelope.ok) {
      return classifyParseFailure(input.sessionId, parsedEnvelope);
    }
    if (parsedEnvelope.value.sessionId !== input.sessionId) {
      return {
        outcome: 'corrupt',
        sessionId: input.sessionId,
        detail: 'session_id_mismatch',
      };
    }
    return classifyAgentSessionCheckpointReadResult(parsedEnvelope.value, input.now?.() ?? now());
  };

  return {
    read: readCheckpoint,
    async write(
      envelope: AgentSessionCheckpointEnvelope
    ): Promise<AgentSessionCheckpointWriteResult> {
      const nextEnvelope = redactOpaqueContinuation ? redactEnvelope(envelope) : envelope;
      const serializedEnvelope = serializeCheckpointEnvelope(nextEnvelope);
      const sizeBytes = measureSerializedCheckpointBytes(serializedEnvelope);
      if (sizeBytes > maxBytes) {
        return {
          outcome: 'too_large',
          envelope: nextEnvelope,
          sizeBytes,
          maxBytes,
        };
      }
      const filePath = toSessionFilePath(directory, nextEnvelope.sessionId);
      if (filePath === null) {
        return {
          outcome: 'rejected',
          envelope: nextEnvelope,
          reason: 'invalid_session_id',
        };
      }
      const tempFilePath = toTempFilePath(filePath, nextEnvelope.checkpointId);
      if (tempFilePath === null) {
        return {
          outcome: 'rejected',
          envelope: nextEnvelope,
          reason: 'invalid_checkpoint_id',
        };
      }
      return withProcessLocalSessionWriteLock<AgentSessionCheckpointWriteResult>(
        filePath,
        async () => {
          const previous = await readCheckpoint({ sessionId: nextEnvelope.sessionId });
          const previousEnvelope = hasAgentSessionCheckpointEnvelope(previous)
            ? previous.envelope
            : undefined;
          if (isDuplicateAgentSessionCheckpointReadResult(previous, nextEnvelope.checkpointId)) {
            return {
              outcome: 'duplicate',
              envelope: previous.envelope,
              previous: previous.envelope,
            };
          }
          const writeNow = now();
          const expiresAt = nextEnvelope.expiresAt ? Date.parse(nextEnvelope.expiresAt) : null;
          if (expiresAt !== null && !Number.isNaN(expiresAt) && expiresAt <= writeNow.getTime()) {
            return {
              outcome: 'expired',
              envelope: nextEnvelope,
            };
          }
          const continuationExpiresAt = nextEnvelope.continuation?.expiresAt
            ? Date.parse(nextEnvelope.continuation.expiresAt)
            : null;
          if (
            continuationExpiresAt !== null &&
            !Number.isNaN(continuationExpiresAt) &&
            continuationExpiresAt <= writeNow.getTime()
          ) {
            return {
              outcome: 'expired',
              envelope: nextEnvelope,
            };
          }
          try {
            await mkdir(directory, { recursive: true });
            await writeFile(tempFilePath, serializedEnvelope, { mode: 0o600 });
            await rename(tempFilePath, filePath);
          } catch {
            await rm(tempFilePath, { force: true }).catch(() => undefined);
            return {
              outcome: 'rejected',
              envelope: nextEnvelope,
              reason: 'filesystem_write_failed',
            };
          }
          if (previousEnvelope) {
            return {
              outcome: 'replaced',
              envelope: nextEnvelope,
              previous: previousEnvelope,
            };
          }
          return {
            outcome: 'stored',
            envelope: nextEnvelope,
          };
        }
      );
    },
  };
}
