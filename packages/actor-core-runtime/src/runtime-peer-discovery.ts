export interface RuntimePeerDiscoveryRecord {
  readonly nodeAddress: string;
  readonly url: string;
  readonly nodeId?: string;
  readonly incarnation?: string;
  readonly protocolVersion?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface RuntimePeerDiscoveryEndpointInput {
  readonly nodeAddress: string;
  readonly url?: string;
  readonly protocol?: 'ws' | 'wss';
  readonly host?: string;
  readonly port?: number;
  readonly path?: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly nodeId?: string;
  readonly incarnation?: string;
  readonly protocolVersion?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export type RuntimePeerDiscoveryEvent =
  | {
      readonly type: 'peer.available' | 'peer.updated';
      readonly peer: RuntimePeerDiscoveryRecord;
    }
  | {
      readonly type: 'peer.unavailable';
      readonly nodeAddress: string;
      readonly reason?: string;
    };

export interface RuntimePeerDiscoveryProvider {
  getPeers():
    | readonly RuntimePeerDiscoveryRecord[]
    | Promise<readonly RuntimePeerDiscoveryRecord[]>;
  subscribe?(listener: (event: RuntimePeerDiscoveryEvent) => void): () => void;
  registerSelf?(peer: RuntimePeerDiscoveryRecord): void | Promise<void>;
  unregisterSelf?(nodeAddress: string): void | Promise<void>;
}

export interface InMemoryRuntimePeerDiscoveryProvider extends RuntimePeerDiscoveryProvider {
  upsertPeer(peer: RuntimePeerDiscoveryRecord): void;
  removePeer(nodeAddress: string, reason?: string): void;
  clear(): void;
}

function clonePeer(peer: RuntimePeerDiscoveryRecord): RuntimePeerDiscoveryRecord {
  return {
    nodeAddress: peer.nodeAddress,
    url: peer.url,
    ...(peer.nodeId ? { nodeId: peer.nodeId } : {}),
    ...(peer.incarnation ? { incarnation: peer.incarnation } : {}),
    ...(peer.protocolVersion ? { protocolVersion: peer.protocolVersion } : {}),
    ...(peer.metadata ? { metadata: { ...peer.metadata } } : {}),
  };
}

const RUNTIME_PEER_DISCOVERY_SECRET_KEY_PATTERN =
  /(authorization|cookie|credential|jwt|pass(word)?|private[-_]?key|secret|session|token|api[-_]?key)/i;

function sanitizePeerMetadata(
  metadata?: Readonly<Record<string, string>>
): Readonly<Record<string, string>> | undefined {
  if (!metadata) {
    return undefined;
  }

  const filtered = Object.entries(metadata).filter(
    ([key]) => !RUNTIME_PEER_DISCOVERY_SECRET_KEY_PATTERN.test(key)
  );

  return filtered.length > 0 ? Object.fromEntries(filtered) : undefined;
}

function isSecretLikeRuntimePeerDiscoveryKey(key: string): boolean {
  return RUNTIME_PEER_DISCOVERY_SECRET_KEY_PATTERN.test(key);
}

function sanitizeRuntimePeerDiscoverySearchParams(url: URL): void {
  const next = new URLSearchParams();

  for (const [key, value] of Array.from(url.searchParams.entries()).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (isSecretLikeRuntimePeerDiscoveryKey(key)) {
      continue;
    }

    next.append(key, value);
  }

  url.search = next.toString();
}

function hasAuthorityOnlyRuntimePeerDiscoveryUrl(urlInput: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+(?:[?#]|$)/i.test(urlInput);
}

function normalizeRuntimePeerDiscoveryPath(path?: string): string {
  if (!path) {
    return '/';
  }

  return path.startsWith('/') ? path : `/${path}`;
}

function buildRuntimePeerDiscoveryUrl(input: RuntimePeerDiscoveryEndpointInput): string {
  if (input.url) {
    return sanitizeRuntimePeerDiscoveryUrl(input.url);
  }

  if (!input.host || !Number.isFinite(input.port)) {
    throw new Error(
      'Runtime peer discovery endpoint input requires either a url or a host/port pair.'
    );
  }

  const url = new URL(
    `${input.protocol ?? 'ws'}://${input.host}:${input.port}${normalizeRuntimePeerDiscoveryPath(input.path)}`
  );

  for (const [key, value] of Object.entries(input.query ?? {}).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (isSecretLikeRuntimePeerDiscoveryKey(key)) {
      continue;
    }

    url.searchParams.set(key, value);
  }

  return url.toString();
}

function sanitizeRuntimePeerDiscoveryUrl(urlInput: string): string {
  const url = new URL(urlInput);

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('Runtime peer discovery record url must use ws: or wss:.');
  }

  if (url.username || url.password) {
    throw new Error('Runtime peer discovery record url must not include embedded credentials.');
  }

  sanitizeRuntimePeerDiscoverySearchParams(url);
  if (url.pathname === '/' && hasAuthorityOnlyRuntimePeerDiscoveryUrl(urlInput)) {
    const search = url.search.length > 0 ? url.search : '';
    return `${url.protocol}//${url.host}${search}`;
  }

  return url.toString();
}

function normalizeRuntimePeerDiscoveryRecord(
  peer: RuntimePeerDiscoveryRecord
): RuntimePeerDiscoveryRecord {
  assertPeer(peer);

  const metadata = sanitizePeerMetadata(peer.metadata);
  const record: RuntimePeerDiscoveryRecord = {
    nodeAddress: peer.nodeAddress,
    url: sanitizeRuntimePeerDiscoveryUrl(peer.url),
    ...(peer.nodeId ? { nodeId: peer.nodeId } : {}),
    ...(peer.incarnation ? { incarnation: peer.incarnation } : {}),
    ...(peer.protocolVersion ? { protocolVersion: peer.protocolVersion } : {}),
    ...(metadata ? { metadata } : {}),
  };

  return clonePeer(record);
}

export function createRuntimePeerDiscoveryRecord(
  input: RuntimePeerDiscoveryEndpointInput
): RuntimePeerDiscoveryRecord {
  const metadata = sanitizePeerMetadata(input.metadata);
  const record: RuntimePeerDiscoveryRecord = {
    nodeAddress: input.nodeAddress,
    url: buildRuntimePeerDiscoveryUrl(input),
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    ...(input.incarnation ? { incarnation: input.incarnation } : {}),
    ...(input.protocolVersion ? { protocolVersion: input.protocolVersion } : {}),
    ...(metadata ? { metadata } : {}),
  };

  return normalizeRuntimePeerDiscoveryRecord(record);
}

function assertPeer(peer: RuntimePeerDiscoveryRecord): void {
  if (!peer.nodeAddress || peer.nodeAddress.trim().length === 0) {
    throw new Error('Runtime peer discovery record requires a non-empty nodeAddress.');
  }

  if (!peer.url || peer.url.trim().length === 0) {
    throw new Error('Runtime peer discovery record requires a non-empty url.');
  }
}

export function createStaticRuntimePeerDiscoveryProvider(
  peers: readonly RuntimePeerDiscoveryRecord[]
): RuntimePeerDiscoveryProvider {
  const records = peers.map((peer) => normalizeRuntimePeerDiscoveryRecord(peer));

  return {
    getPeers(): readonly RuntimePeerDiscoveryRecord[] {
      return records.map(clonePeer);
    },
  };
}

export function createInMemoryRuntimePeerDiscoveryProvider(
  initialPeers: readonly RuntimePeerDiscoveryRecord[] = []
): InMemoryRuntimePeerDiscoveryProvider {
  const peers = new Map<string, RuntimePeerDiscoveryRecord>();
  const listeners = new Set<(event: RuntimePeerDiscoveryEvent) => void>();
  const pendingMutations: Array<() => void> = [];
  let processingMutations = false;

  const emit = (event: RuntimePeerDiscoveryEvent): void => {
    const snapshot =
      event.type === 'peer.unavailable'
        ? event
        : {
            type: event.type,
            peer: clonePeer(event.peer),
          };
    for (const listener of Array.from(listeners)) {
      try {
        listener(snapshot);
      } catch {
        // Discovery listeners are observers; one failure must not stall queued mutations.
      }
    }
  };

  const runSerializedMutation = (mutation: () => void): void => {
    let firstMutationError: unknown;
    pendingMutations.push(mutation);
    if (processingMutations) {
      return;
    }

    processingMutations = true;
    try {
      while (pendingMutations.length > 0) {
        const nextMutation = pendingMutations.shift();
        try {
          nextMutation?.();
        } catch (error) {
          firstMutationError ??= error;
        }
      }
    } finally {
      processingMutations = false;
    }

    if (firstMutationError !== undefined) {
      throw firstMutationError;
    }
  };

  const upsertPeer = (peer: RuntimePeerDiscoveryRecord): void => {
    runSerializedMutation(() => {
      const next = normalizeRuntimePeerDiscoveryRecord(peer);
      const eventType = peers.has(next.nodeAddress) ? 'peer.updated' : 'peer.available';
      peers.set(next.nodeAddress, next);
      emit({ type: eventType, peer: next });
    });
  };

  const removePeer = (nodeAddress: string, reason?: string): void => {
    runSerializedMutation(() => {
      if (!peers.delete(nodeAddress)) {
        return;
      }

      emit({
        type: 'peer.unavailable',
        nodeAddress,
        ...(reason ? { reason } : {}),
      });
    });
  };

  for (const peer of initialPeers) {
    upsertPeer(peer);
  }

  return {
    getPeers(): readonly RuntimePeerDiscoveryRecord[] {
      return Array.from(peers.values()).map(clonePeer);
    },
    subscribe(listener: (event: RuntimePeerDiscoveryEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    registerSelf(peer: RuntimePeerDiscoveryRecord): void {
      upsertPeer(peer);
    },
    unregisterSelf(nodeAddress: string): void {
      removePeer(nodeAddress, 'node stopped');
    },
    upsertPeer,
    removePeer,
    clear(): void {
      for (const nodeAddress of Array.from(peers.keys())) {
        removePeer(nodeAddress, 'discovery cleared');
      }
    },
  };
}
