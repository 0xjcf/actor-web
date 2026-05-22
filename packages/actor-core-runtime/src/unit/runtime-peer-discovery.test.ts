import { describe, expect, it } from 'vitest';
import {
  createInMemoryRuntimePeerDiscoveryProvider,
  createRuntimePeerDiscoveryRecord,
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

  it('sanitizes direct records passed to static discovery providers', async () => {
    const peer = {
      nodeAddress: 'server-node',
      url: 'wss://runtime.internal/mesh?role=server&token=drop-me&zone=use1',
      metadata: {
        role: 'server',
        apiKey: 'drop-me',
      },
    };
    const discovery = createStaticRuntimePeerDiscoveryProvider([peer]);

    expect(await discovery.getPeers()).toEqual([
      {
        nodeAddress: 'server-node',
        url: 'wss://runtime.internal/mesh?role=server&zone=use1',
        metadata: {
          role: 'server',
        },
      },
    ]);
    expect(peer).toEqual({
      nodeAddress: 'server-node',
      url: 'wss://runtime.internal/mesh?role=server&token=drop-me&zone=use1',
      metadata: {
        role: 'server',
        apiKey: 'drop-me',
      },
    });
  });

  it('rejects invalid direct records passed to static discovery providers', () => {
    expect(() =>
      createStaticRuntimePeerDiscoveryProvider([
        {
          nodeAddress: 'server-node',
          url: 'https://runtime.internal/mesh?role=server',
        },
      ])
    ).toThrowError('Runtime peer discovery record url must use ws: or wss:.');
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

  it('normalizes deployment endpoint input into a provider-neutral discovery record', () => {
    expect(
      createRuntimePeerDiscoveryRecord({
        nodeAddress: 'server-node',
        protocol: 'wss',
        host: 'runtime.internal',
        port: 443,
        path: 'mesh',
        query: {
          zone: 'use1',
          role: 'server',
          access_token: 'drop-me',
        },
        nodeId: 'node-1',
        incarnation: 'boot-1',
        protocolVersion: 'actor-web-runtime/1',
        metadata: {
          role: 'server',
          region: 'iad',
          apiKey: 'drop-me',
          authorization: 'drop-me-too',
        },
      })
    ).toEqual({
      nodeAddress: 'server-node',
      url: 'wss://runtime.internal/mesh?role=server&zone=use1',
      nodeId: 'node-1',
      incarnation: 'boot-1',
      protocolVersion: 'actor-web-runtime/1',
      metadata: {
        role: 'server',
        region: 'iad',
      },
    });
  });

  it('sanitizes secret-like query params from raw discovery urls', () => {
    expect(
      createRuntimePeerDiscoveryRecord({
        nodeAddress: 'server-node',
        url: 'wss://runtime.internal/mesh?role=server&token=drop-me&zone=use1',
      })
    ).toEqual({
      nodeAddress: 'server-node',
      url: 'wss://runtime.internal/mesh?role=server&zone=use1',
    });
  });

  it('rejects raw discovery urls with unsupported protocols', () => {
    expect(() =>
      createRuntimePeerDiscoveryRecord({
        nodeAddress: 'server-node',
        url: 'https://runtime.internal/mesh?role=server',
      })
    ).toThrowError('Runtime peer discovery record url must use ws: or wss:.');
  });

  it('rejects raw discovery urls with embedded credentials', () => {
    expect(() =>
      createRuntimePeerDiscoveryRecord({
        nodeAddress: 'server-node',
        url: 'wss://user:secret@runtime.internal/mesh?role=server',
      })
    ).toThrowError('Runtime peer discovery record url must not include embedded credentials.');
  });

  it('supports self registration and unregistration through the discovery provider port', async () => {
    const discovery = createInMemoryRuntimePeerDiscoveryProvider();

    discovery.registerSelf?.({
      nodeAddress: 'server-node',
      url: 'ws://127.0.0.1:4101',
    });
    expect(await discovery.getPeers()).toEqual([
      {
        nodeAddress: 'server-node',
        url: 'ws://127.0.0.1:4101',
      },
    ]);

    discovery.unregisterSelf?.('server-node');
    expect(await discovery.getPeers()).toEqual([]);
  });

  it('sanitizes direct records passed through in-memory upsert and registerSelf', async () => {
    const discovery = createInMemoryRuntimePeerDiscoveryProvider();
    const upsertPeer = {
      nodeAddress: 'server-node',
      url: 'wss://runtime.internal/mesh?token=drop-me&zone=use1',
      metadata: {
        role: 'server',
        sessionId: 'drop-me',
      },
    };
    const registerPeer = {
      nodeAddress: 'worker-node',
      url: 'wss://worker.internal/runtime?password=drop-me&zone=use1',
      metadata: {
        role: 'worker',
        authorization: 'drop-me',
      },
    };

    discovery.upsertPeer(upsertPeer);
    discovery.registerSelf?.(registerPeer);

    expect(await discovery.getPeers()).toEqual([
      {
        nodeAddress: 'server-node',
        url: 'wss://runtime.internal/mesh?zone=use1',
        metadata: {
          role: 'server',
        },
      },
      {
        nodeAddress: 'worker-node',
        url: 'wss://worker.internal/runtime?zone=use1',
        metadata: {
          role: 'worker',
        },
      },
    ]);
    expect(upsertPeer).toEqual({
      nodeAddress: 'server-node',
      url: 'wss://runtime.internal/mesh?token=drop-me&zone=use1',
      metadata: {
        role: 'server',
        sessionId: 'drop-me',
      },
    });
    expect(registerPeer).toEqual({
      nodeAddress: 'worker-node',
      url: 'wss://worker.internal/runtime?password=drop-me&zone=use1',
      metadata: {
        role: 'worker',
        authorization: 'drop-me',
      },
    });
  });

  it('rejects invalid direct records passed through in-memory providers', () => {
    const discovery = createInMemoryRuntimePeerDiscoveryProvider();

    expect(() =>
      discovery.upsertPeer({
        nodeAddress: 'server-node',
        url: 'wss://user:secret@runtime.internal/mesh?role=server',
      })
    ).toThrowError('Runtime peer discovery record url must not include embedded credentials.');

    expect(() =>
      discovery.registerSelf?.({
        nodeAddress: 'worker-node',
        url: 'https://worker.internal/runtime?role=worker',
      })
    ).toThrowError('Runtime peer discovery record url must use ws: or wss:.');
  });

  it('serializes reentrant mutations so available, updated, and unavailable events stay ordered', async () => {
    const discovery = createInMemoryRuntimePeerDiscoveryProvider();
    const events: RuntimePeerDiscoveryEvent[] = [];

    discovery.subscribe?.((event) => {
      events.push(event);

      if (event.type === 'peer.available') {
        discovery.upsertPeer({
          nodeAddress: event.peer.nodeAddress,
          url: 'ws://127.0.0.1:4102',
        });
        discovery.removePeer(event.peer.nodeAddress, 'listener removed');
      }
    });

    discovery.upsertPeer({
      nodeAddress: 'server-node',
      url: 'ws://127.0.0.1:4101',
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
        reason: 'listener removed',
      },
    ]);
    expect(await discovery.getPeers()).toEqual([]);
  });

  it('continues queued reentrant mutations when a listener throws', async () => {
    const discovery = createInMemoryRuntimePeerDiscoveryProvider();
    const throwingListenerEvents: string[] = [];
    const observerEvents: string[] = [];

    discovery.subscribe?.((event) => {
      throwingListenerEvents.push(event.type);

      if (event.type === 'peer.available') {
        discovery.upsertPeer({
          nodeAddress: event.peer.nodeAddress,
          url: 'ws://127.0.0.1:4102',
        });
        throw new Error('listener failed');
      }
    });
    discovery.subscribe?.((event) => {
      observerEvents.push(event.type);
    });

    expect(() =>
      discovery.upsertPeer({
        nodeAddress: 'server-node',
        url: 'ws://127.0.0.1:4101',
      })
    ).not.toThrow();

    expect(throwingListenerEvents).toEqual(['peer.available', 'peer.updated']);
    expect(observerEvents).toEqual(['peer.available', 'peer.updated']);
    expect(await discovery.getPeers()).toEqual([
      {
        nodeAddress: 'server-node',
        url: 'ws://127.0.0.1:4102',
      },
    ]);
  });
});
