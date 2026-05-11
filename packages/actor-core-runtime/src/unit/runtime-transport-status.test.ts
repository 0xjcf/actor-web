import { describe, expect, it } from 'vitest';
import type { MessageTransport } from '../actor-system.js';
import {
  deriveRuntimePeerStatus,
  getRuntimePeerStatus,
  getRuntimeTransportStatus,
  type RuntimeTransportIdempotencyStatus,
} from '../runtime-transport-status.js';
import type {
  RuntimeTransportPeerStats,
  RuntimeTransportStats,
} from '../runtime-transport-telemetry.js';

class StatusTestTransport implements MessageTransport {
  constructor(
    private readonly connectedNodes: readonly string[],
    private readonly stats?: RuntimeTransportStats
  ) {}

  async send(): Promise<void> {}

  subscribe(): () => void {
    return () => {};
  }

  async connect(_address: string): Promise<void> {}

  async disconnect(_address: string): Promise<void> {}

  getConnectedNodes(): string[] {
    return [...this.connectedNodes];
  }

  isConnected(address: string): boolean {
    return this.connectedNodes.includes(address);
  }

  getStats(): RuntimeTransportStats | undefined {
    return this.stats ? cloneTransportStats(this.stats) : undefined;
  }

  getPeerStats(nodeAddress: string): RuntimeTransportPeerStats | undefined {
    const stats = this.stats?.peers[nodeAddress];
    return stats ? { ...stats } : undefined;
  }
}

function createPeerStats(
  nodeAddress: string,
  overrides: Partial<RuntimeTransportPeerStats> = {}
): RuntimeTransportPeerStats {
  return {
    nodeAddress,
    state: 'connected',
    connectedAt: '2026-04-29T10:00:00.000Z',
    lastSeenAt: '2026-04-29T10:00:05.000Z',
    lastSentSequence: 0,
    lastReceivedSequence: 0,
    framesSent: 0,
    framesReceived: 0,
    framesAcked: 0,
    framesRetried: 0,
    retryExhaustedCount: 0,
    outboundQueueDepth: 0,
    outboundQueueLimit: 0,
    outboundFramesDropped: 0,
    backpressureDropCount: 0,
    duplicateFramesDropped: 0,
    idempotencyCacheEvictions: 0,
    idempotencyWindowSize: 1024,
    idempotencyProviderEnabled: false,
    idempotencyProviderClaimCount: 0,
    idempotencyProviderDuplicateCount: 0,
    idempotencyProviderErrorCount: 0,
    malformedFramesDropped: 0,
    validationFramesDropped: 0,
    sequenceGapCount: 0,
    handshakeAcceptedCount: 0,
    handshakeRejectedCount: 0,
    disconnectCount: 0,
    reconnectCount: 0,
    heartbeatTimeoutCount: 0,
    ...overrides,
  };
}

function createTransportStats(
  peers: Record<string, RuntimeTransportPeerStats>
): RuntimeTransportStats {
  return {
    nodeAddress: 'server-node',
    startedAt: '2026-04-29T10:00:00.000Z',
    connectedPeerCount: Object.values(peers).filter((peer) => peer.state === 'connected').length,
    framesSent: 0,
    framesReceived: 0,
    framesAcked: 0,
    framesRetried: 0,
    retryExhaustedCount: 0,
    outboundQueueDepth: 0,
    outboundQueueLimit: 0,
    outboundFramesDropped: 0,
    backpressureDropCount: 0,
    duplicateFramesDropped: 0,
    idempotencyCacheEvictions: 0,
    idempotencyWindowSize: 1024,
    idempotencyProviderEnabled: false,
    idempotencyProviderClaimCount: 0,
    idempotencyProviderDuplicateCount: 0,
    idempotencyProviderErrorCount: 0,
    malformedFramesDropped: 0,
    validationFramesDropped: 0,
    sequenceGapCount: 0,
    handshakeAcceptedCount: 0,
    handshakeRejectedCount: 0,
    disconnectCount: 0,
    reconnectCount: 0,
    heartbeatTimeoutCount: 0,
    peers,
  };
}

function cloneTransportStats(stats: RuntimeTransportStats): RuntimeTransportStats {
  return {
    ...stats,
    peers: Object.fromEntries(
      Object.entries(stats.peers).map(([nodeAddress, peer]) => [nodeAddress, { ...peer }])
    ),
  };
}

function expectDefaultIdempotencyStatus(
  status: RuntimeTransportIdempotencyStatus | undefined
): void {
  expect(status).toMatchObject({
    windowSize: 1024,
    providerEnabled: false,
    providerClaimCount: 0,
    providerDuplicateCount: 0,
    providerErrorCount: 0,
  });
}

describe('runtime transport status', () => {
  it('derives connected and fresh peer status from recent peer stats', () => {
    const status = deriveRuntimePeerStatus('worker-node', {
      isConnected: true,
      stats: createPeerStats('worker-node'),
      staleAfterMs: 30_000,
      now: Date.parse('2026-04-29T10:00:20.000Z'),
    });

    expect(status).toMatchObject({
      nodeAddress: 'worker-node',
      state: 'connected',
      connected: true,
      fresh: true,
      staleAfterMs: 30_000,
    });
    expectDefaultIdempotencyStatus(status.idempotency);
  });

  it('marks connected peers stale when last seen exceeds the freshness window', () => {
    const status = deriveRuntimePeerStatus('worker-node', {
      isConnected: true,
      stats: createPeerStats('worker-node'),
      staleAfterMs: 10_000,
      now: Date.parse('2026-04-29T10:00:20.001Z'),
    });

    expect(status.connected).toBe(false);
    expect(status.fresh).toBe(false);
    expect(status.staleReason).toBe('Peer has not been seen within 10000ms.');
  });

  it('preserves explicit freshness opt-out when staleAfterMs is zero', () => {
    const status = deriveRuntimePeerStatus('worker-node', {
      isConnected: true,
      stats: createPeerStats('worker-node'),
      staleAfterMs: 0,
      now: Date.parse('2026-04-29T11:00:00.000Z'),
    });

    expect(status.connected).toBe(true);
    expect(status.fresh).toBe(true);
    expect(status.staleAfterMs).toBe(0);
  });

  it('treats transports without peer stats as fresh when the transport reports connected', () => {
    const transport = new StatusTestTransport(['worker-node']);

    expect(getRuntimePeerStatus(transport, 'worker-node')).toMatchObject({
      nodeAddress: 'worker-node',
      state: 'connected',
      connected: true,
      fresh: true,
    });
  });

  it('normalizes transport connected nodes from derived peer freshness', () => {
    const stats = createTransportStats({
      'fresh-worker': createPeerStats('fresh-worker', {
        lastSeenAt: '2026-04-29T10:00:20.000Z',
      }),
      'stale-worker': createPeerStats('stale-worker', {
        lastSeenAt: '2026-04-29T10:00:00.000Z',
      }),
      'stopped-worker': createPeerStats('stopped-worker', {
        state: 'disconnected',
        disconnectedAt: '2026-04-29T10:00:10.000Z',
      }),
    });
    const transport = new StatusTestTransport(['fresh-worker', 'stale-worker'], stats);

    const status = getRuntimeTransportStatus(transport, {
      staleAfterMs: 15_000,
      now: Date.parse('2026-04-29T10:00:30.000Z'),
    });

    expect(status.connectedNodes).toEqual(['fresh-worker']);
    expectDefaultIdempotencyStatus(status.idempotency);
    expect(status.peers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeAddress: 'fresh-worker',
          connected: true,
          fresh: true,
          idempotency: expect.objectContaining({
            windowSize: 1024,
            providerEnabled: false,
          }),
        }),
        expect.objectContaining({
          nodeAddress: 'stale-worker',
          connected: false,
          fresh: false,
        }),
        expect.objectContaining({
          nodeAddress: 'stopped-worker',
          connected: false,
          fresh: false,
          state: 'disconnected',
        }),
      ])
    );
  });

  it('surfaces additive idempotency provider status from transport stats', () => {
    const transport = new StatusTestTransport(['worker-node'], {
      ...createTransportStats({
        'worker-node': createPeerStats('worker-node', {
          idempotencyProviderEnabled: true,
          idempotencyProviderClaimCount: 2,
          idempotencyProviderDuplicateCount: 1,
          idempotencyProviderErrorCount: 1,
          lastIdempotencyProviderErrorAt: '2026-04-29T10:00:10.000Z',
          lastIdempotencyProviderErrorMessage: 'provider unavailable',
        }),
      }),
      idempotencyProviderEnabled: true,
      idempotencyProviderClaimCount: 2,
      idempotencyProviderDuplicateCount: 1,
      idempotencyProviderErrorCount: 1,
      lastIdempotencyProviderErrorAt: '2026-04-29T10:00:10.000Z',
      lastIdempotencyProviderErrorMessage: 'provider unavailable',
    });

    expect(getRuntimeTransportStatus(transport)).toMatchObject({
      idempotency: {
        windowSize: 1024,
        providerEnabled: true,
        providerClaimCount: 2,
        providerDuplicateCount: 1,
        providerErrorCount: 1,
        lastProviderErrorAt: '2026-04-29T10:00:10.000Z',
        lastProviderErrorMessage: 'provider unavailable',
      },
      peers: [
        expect.objectContaining({
          nodeAddress: 'worker-node',
          idempotency: expect.objectContaining({
            providerEnabled: true,
            providerClaimCount: 2,
            providerDuplicateCount: 1,
            providerErrorCount: 1,
          }),
        }),
      ],
    });
  });
});
