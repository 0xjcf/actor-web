export interface RuntimePeerDiscoveryRecord {
  readonly nodeAddress: string;
  readonly url: string;
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
  const records = peers.map((peer) => {
    assertPeer(peer);
    return clonePeer(peer);
  });

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

  const emit = (event: RuntimePeerDiscoveryEvent): void => {
    const snapshot =
      event.type === 'peer.unavailable'
        ? event
        : {
            type: event.type,
            peer: clonePeer(event.peer),
          };
    for (const listener of Array.from(listeners)) {
      listener(snapshot);
    }
  };

  const upsertPeer = (peer: RuntimePeerDiscoveryRecord): void => {
    assertPeer(peer);
    const next = clonePeer(peer);
    const eventType = peers.has(next.nodeAddress) ? 'peer.updated' : 'peer.available';
    peers.set(next.nodeAddress, next);
    emit({ type: eventType, peer: next });
  };

  const removePeer = (nodeAddress: string, reason?: string): void => {
    if (!peers.delete(nodeAddress)) {
      return;
    }

    emit({
      type: 'peer.unavailable',
      nodeAddress,
      ...(reason ? { reason } : {}),
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
