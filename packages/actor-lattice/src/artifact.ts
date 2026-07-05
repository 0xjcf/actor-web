import { createHash } from 'node:crypto';
import type { ArtifactQuery, ArtifactRecord } from './protocol.js';

export interface ArtifactStore {
  readonly artifacts: readonly ArtifactRecord[];
}

export function createArtifactStore(): ArtifactStore {
  return { artifacts: [] };
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
}

function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function artifactIdentity(type: string, key?: string): string {
  return `${type}:${key ?? ''}`;
}

export function createContentHash(payload: unknown, metadata?: Record<string, unknown>): string {
  return hashText(stableStringify({ metadata: metadata ?? null, payload }));
}

export function getLatestArtifacts(store: ArtifactStore): readonly ArtifactRecord[] {
  const latestByIdentity = new Map<string, ArtifactRecord>();
  for (const artifact of store.artifacts) {
    latestByIdentity.set(artifactIdentity(artifact.type, artifact.key), artifact);
  }
  return [...latestByIdentity.values()].sort((left, right) =>
    artifactIdentity(left.type, left.key).localeCompare(artifactIdentity(right.type, right.key))
  );
}

export function queryArtifacts(
  store: ArtifactStore,
  query: ArtifactQuery = {}
): readonly ArtifactRecord[] {
  const source = query.history ? store.artifacts : getLatestArtifacts(store);
  return source.filter((artifact) => {
    if (query.typeFilter && artifact.type !== query.typeFilter) {
      return false;
    }
    if (query.key !== undefined && artifact.key !== query.key) {
      return false;
    }
    return true;
  });
}

export function publishArtifact(
  store: ArtifactStore,
  artifact: Omit<ArtifactRecord, 'artifactId' | 'version' | 'contentHash'> & {
    readonly contentHash?: string;
  }
): {
  readonly store: ArtifactStore;
  readonly artifact: ArtifactRecord;
  readonly published: boolean;
} {
  const identity = artifactIdentity(artifact.type, artifact.key);
  const latest = [...store.artifacts]
    .reverse()
    .find((candidate) => artifactIdentity(candidate.type, candidate.key) === identity);
  const contentHash =
    artifact.contentHash ?? createContentHash(artifact.payload, artifact.metadata);

  if (latest && latest.producer === artifact.producer && latest.contentHash === contentHash) {
    return {
      store,
      artifact: latest,
      published: false,
    };
  }

  const version = (latest?.version ?? 0) + 1;
  const record: ArtifactRecord = {
    artifactId: `${identity}@${version}`,
    version,
    contentHash,
    ...artifact,
  };

  return {
    store: {
      artifacts: [...store.artifacts, record],
    },
    artifact: record,
    published: true,
  };
}
