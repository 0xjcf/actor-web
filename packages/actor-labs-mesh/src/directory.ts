import type { ActorAddress } from '@actor-web/runtime';
import { compareMeshIncarnation, type MeshIncarnation } from './membership.js';

export interface MeshDirectoryEntry {
  readonly address: ActorAddress;
  readonly ownerNode: string;
  readonly ownerIncarnation: MeshIncarnation;
  readonly version: number;
  readonly updatedAt: number;
  readonly tombstone?: boolean;
  readonly ttl?: number;
}

export interface MeshDirectoryState {
  readonly entries: Readonly<Record<string, MeshDirectoryEntry>>;
}

export type MeshDirectoryMergeCode =
  | 'accepted'
  | 'owner-conflict'
  | 'stale-incarnation'
  | 'stale-version'
  | 'same-entry';

export interface MeshDirectoryMergeResult {
  readonly accepted: boolean;
  readonly code: MeshDirectoryMergeCode;
  readonly state: MeshDirectoryState;
}

export interface MeshDirectoryLookupOptions {
  readonly now?: number;
}

export function createMeshDirectoryState(
  entries: readonly MeshDirectoryEntry[] = []
): MeshDirectoryState {
  return entries.reduce<MeshDirectoryState>(
    (state, entry) => applyMeshDirectoryEntry(state, entry).state,
    { entries: {} }
  );
}

export function applyMeshDirectoryEntry(
  state: MeshDirectoryState,
  entry: MeshDirectoryEntry
): MeshDirectoryMergeResult {
  const current = state.entries[entry.address];

  if (!current) {
    return acceptDirectoryEntry(state, entry, 'accepted');
  }

  if (current.ownerNode !== entry.ownerNode) {
    return { accepted: false, code: 'owner-conflict', state };
  }

  const incarnationOrder = compareMeshIncarnation(entry.ownerIncarnation, current.ownerIncarnation);
  if (incarnationOrder < 0) {
    return { accepted: false, code: 'stale-incarnation', state };
  }

  if (incarnationOrder === 0) {
    if (entry.version < current.version) {
      return { accepted: false, code: 'stale-version', state };
    }

    if (entry.version === current.version && entry.updatedAt <= current.updatedAt) {
      return { accepted: false, code: 'same-entry', state };
    }
  }

  return acceptDirectoryEntry(state, entry, 'accepted');
}

export function mergeMeshDirectoryEntries(
  state: MeshDirectoryState,
  entries: readonly MeshDirectoryEntry[]
): MeshDirectoryState {
  return entries.reduce((next, entry) => applyMeshDirectoryEntry(next, entry).state, state);
}

export function resolveMeshDirectoryLocation(
  state: MeshDirectoryState,
  address: ActorAddress,
  options: MeshDirectoryLookupOptions = {}
): string | undefined {
  const entry = state.entries[address];
  if (!entry || entry.tombstone) {
    return undefined;
  }

  if (entry.ttl !== undefined && options.now !== undefined && entry.ttl <= options.now) {
    return undefined;
  }

  return entry.ownerNode;
}

export function exportMeshDirectoryEntries(state: MeshDirectoryState): MeshDirectoryEntry[] {
  return Object.values(state.entries).map(cloneDirectoryEntry);
}

function acceptDirectoryEntry(
  state: MeshDirectoryState,
  entry: MeshDirectoryEntry,
  code: MeshDirectoryMergeCode
): MeshDirectoryMergeResult {
  return {
    accepted: true,
    code,
    state: {
      entries: {
        ...state.entries,
        [entry.address]: cloneDirectoryEntry(entry),
      },
    },
  };
}

function cloneDirectoryEntry(entry: MeshDirectoryEntry): MeshDirectoryEntry {
  return {
    address: entry.address,
    ownerNode: entry.ownerNode,
    ownerIncarnation: entry.ownerIncarnation,
    version: entry.version,
    updatedAt: entry.updatedAt,
    ...(entry.tombstone ? { tombstone: true } : {}),
    ...(entry.ttl !== undefined ? { ttl: entry.ttl } : {}),
  };
}
