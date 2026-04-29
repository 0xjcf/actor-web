import { describe, expect, it } from 'vitest';
import {
  createInMemoryRuntimePeerDiscoveryProvider,
  createStaticRuntimePeerDiscoveryProvider,
  type RuntimePeerDiscoveryEvent,
} from '../runtime-peer-discovery.js';

describe('runtime peer discovery providers', () => {
  it('returns immutable snapshots from static discovery', async () => {
    const discovery = createStaticRuntimePeerDiscoveryProvider([
      {
        nodeAddress: 'server-node',
        url: 'ws://127.0.0.1:4101',
        metadata: {
          role: 'server',
        },
      },
    ]);

    const first = await discovery.getPeers();
    (first[0]?.metadata as Record<string, string>).role = 'mutated';
    const second = await discovery.getPeers();

    expect(second).toEqual([
      {
        nodeAddress: 'server-node',
        url: 'ws://127.0.0.1:4101',
        metadata: {
          role: 'server',
        },
      },
    ]);
  });

  it('emits available, updated, and unavailable events from in-memory discovery', () => {
    const discovery = createInMemoryRuntimePeerDiscoveryProvider();
    const events: RuntimePeerDiscoveryEvent[] = [];
    const unsubscribe = discovery.subscribe?.((event) => {
      events.push(event);
    });

    discovery.upsertPeer({
      nodeAddress: 'server-node',
      url: 'ws://127.0.0.1:4101',
    });
    discovery.upsertPeer({
      nodeAddress: 'server-node',
      url: 'ws://127.0.0.1:4102',
    });
    discovery.removePeer('server-node', 'node stopped');
    unsubscribe?.();
    discovery.upsertPeer({
      nodeAddress: 'worker-node',
      url: 'ws://127.0.0.1:4103',
    });

    expect(events).toEqual([
      {
        type: 'peer.available',
        peer: {
          nodeAddress: 'server-node',
          url: 'ws://127.0.0.1:4101',
        },
      },
      {
        type: 'peer.updated',
        peer: {
          nodeAddress: 'server-node',
          url: 'ws://127.0.0.1:4102',
        },
      },
      {
        type: 'peer.unavailable',
        nodeAddress: 'server-node',
        reason: 'node stopped',
      },
    ]);
  });
});
