import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type AgentSessionCheckpointEnvelope,
  type AgentSessionCheckpointReadInput,
  type AgentSessionCheckpointReadResult,
  type AgentSessionCheckpointStore,
  type AgentSessionCheckpointWriteResult,
  getAgentSessionCheckpointEnvelopeSizeBytes,
  getAgentSessionCheckpointSupportedSchemaVersions,
  parseAgentSessionCheckpointEnvelope,
} from './agent-session-checkpoint-store.js';

export interface NodeFileSystemAgentSessionCheckpointStoreOptions {
  readonly directory: string;
  readonly maxBytes?: number;
  readonly now?: () => Date;
  readonly redactOpaqueContinuation?: boolean;
}

function toSessionFilePath(directory: string, sessionId: string): string {
  return path.join(directory, `${encodeURIComponent(sessionId)}.json`);
}

function toTempFilePath(filePath: string, checkpointId: string): string {
  return `${filePath}.${encodeURIComponent(checkpointId)}.tmp`;
}

function redactEnvelope(
  envelope: AgentSessionCheckpointEnvelope
): AgentSessionCheckpointEnvelope {
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
          Array.from(
            new Set([
              ...envelope.continuation.redaction.fields,
              'continuation.payload',
            ])
          )
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

export function createNodeFileSystemAgentSessionCheckpointStore(
  options: NodeFileSystemAgentSessionCheckpointStoreOptions
): AgentSessionCheckpointStore {
  const maxBytes = options.maxBytes ?? 256 * 1024;
  const now = options.now ?? (() => new Date());
  const redactOpaqueContinuation = options.redactOpaqueContinuation ?? true;

  return {
    async read(input: AgentSessionCheckpointReadInput) {
      const filePath = toSessionFilePath(options.directory, input.sessionId);
      let raw: string;
      try {
        raw = await readFile(filePath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return {
            outcome: 'missing',
            sessionId: input.sessionId,
          };
        }
        return {
          outcome: 'corrupt',
          sessionId: input.sessionId,
          detail: 'filesystem_read_failed',
        };
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch (error) {
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
      const readNow = input.now?.() ?? now();
      const expiresAt = parsedEnvelope.value.expiresAt
        ? Date.parse(parsedEnvelope.value.expiresAt)
        : null;
      if (parsedEnvelope.value.redactedFields.length > 0) {
        return {
          outcome: 'redacted',
          envelope: parsedEnvelope.value,
          fields: parsedEnvelope.value.redactedFields,
        };
      }
      if (expiresAt !== null && !Number.isNaN(expiresAt) && expiresAt <= readNow.getTime()) {
        return {
          outcome: 'expired',
          envelope: parsedEnvelope.value,
        };
      }
      const staleAt = parsedEnvelope.value.staleAt
        ? Date.parse(parsedEnvelope.value.staleAt)
        : null;
      if (staleAt !== null && !Number.isNaN(staleAt) && staleAt <= readNow.getTime()) {
        return {
          outcome: 'stale',
          envelope: parsedEnvelope.value,
        };
      }
      return {
        outcome: 'present',
        envelope: parsedEnvelope.value,
      };
    },
    async write(envelope: AgentSessionCheckpointEnvelope): Promise<AgentSessionCheckpointWriteResult> {
      const writeNow = now();
      const expiresAt = envelope.expiresAt ? Date.parse(envelope.expiresAt) : null;
      if (expiresAt !== null && !Number.isNaN(expiresAt) && expiresAt <= writeNow.getTime()) {
        return {
          outcome: 'expired',
          envelope,
        };
      }
      const nextEnvelope = redactOpaqueContinuation ? redactEnvelope(envelope) : envelope;
      const sizeBytes = getAgentSessionCheckpointEnvelopeSizeBytes(nextEnvelope);
      if (sizeBytes > maxBytes) {
        return {
          outcome: 'too_large',
          envelope: nextEnvelope,
          sizeBytes,
          maxBytes,
        };
      }
      const filePath = toSessionFilePath(options.directory, nextEnvelope.sessionId);
      const tempFilePath = toTempFilePath(filePath, nextEnvelope.checkpointId);
      const previous = await this.read({ sessionId: nextEnvelope.sessionId });
      if (previous.outcome === 'present' && previous.envelope.checkpointId === nextEnvelope.checkpointId) {
        return {
          outcome: 'duplicate',
          envelope: previous.envelope,
          previous: previous.envelope,
        };
      }
      if (
        previous.outcome === 'redacted' &&
        previous.envelope.checkpointId === nextEnvelope.checkpointId
      ) {
        return {
          outcome: 'duplicate',
          envelope: previous.envelope,
          previous: previous.envelope,
        };
      }
      try {
        await mkdir(options.directory, { recursive: true });
        await writeFile(tempFilePath, JSON.stringify(nextEnvelope, null, 2));
        await rename(tempFilePath, filePath);
      } catch (error) {
        await rm(tempFilePath, { force: true }).catch(() => undefined);
        return {
          outcome: 'rejected',
          envelope: nextEnvelope,
          reason: 'filesystem_write_failed',
        };
      }
      if (
        previous.outcome === 'present' ||
        previous.outcome === 'stale' ||
        previous.outcome === 'expired' ||
        previous.outcome === 'redacted'
      ) {
        return {
          outcome: 'replaced',
          envelope: nextEnvelope,
          previous: previous.envelope,
        };
      }
      return {
        outcome: 'stored',
        envelope: nextEnvelope,
      };
    },
  };
}
