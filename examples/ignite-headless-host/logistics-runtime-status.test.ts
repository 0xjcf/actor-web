import { describe, expect, it } from 'vitest';
import {
  createInitialLogisticsRuntimeStatusView,
  type LogisticsRuntimeStatusResponse,
  reduceLogisticsRuntimeStatusView,
} from './logistics-runtime-status';

function createStatusResponse(
  overrides: Partial<LogisticsRuntimeStatusResponse['transport']> = {}
): LogisticsRuntimeStatusResponse {
  return {
    gatewayUrl: 'ws://127.0.0.1:4101',
    transportUrl: 'ws://127.0.0.1:4102',
    lifecycleMode: 'manual',
    transport: {
      connectedNodes: ['logistics-worker-runtime'],
      peers: [
        {
          nodeAddress: 'logistics-worker-runtime',
          state: 'connected',
          connected: true,
          fresh: true,
          staleAfterMs: 45_000,
          lastSeenAt: '2026-04-30T15:00:00.000Z',
        },
      ],
      workerConnected: true,
      workerPeerFresh: true,
      workerPeer: {
        nodeAddress: 'logistics-worker-runtime',
        state: 'connected',
        connected: true,
        fresh: true,
        staleAfterMs: 45_000,
        lastSeenAt: '2026-04-30T15:00:00.000Z',
      },
      ...overrides,
    },
    nodes: {
      browserHost: 'thin Ignite host',
      serverRuntime: 'logistics-server-runtime',
      workerRuntime: 'logistics-worker-runtime',
      serviceWorkerRuntime: 'logistics-service-worker-runtime',
    },
    actors: {
      shipment: 'actor://logistics-server-runtime/actor/logistics-shipment',
      routing: 'actor://logistics-worker-runtime/actor/logistics-routing',
      providerHq: 'actor://logistics-server-runtime/actor/logistics-provider-hq',
      logisticsSupervisor: 'actor://logistics-server-runtime/actor/logistics-supervisor',
      dispatcher: 'actor://logistics-server-runtime/actor/logistics-dispatcher',
      driverDirectory: 'actor://logistics-server-runtime/actor/logistics-driver-directory',
      serviceWorkerProof: 'actor://logistics-service-worker-runtime/actor/service-worker-proof',
    },
  };
}

describe('logistics runtime status adapter', () => {
  it('maps a connected worker runtime from /runtime/status', () => {
    const view = reduceLogisticsRuntimeStatusView(
      createInitialLogisticsRuntimeStatusView(),
      createStatusResponse()
    );

    expect(view.workerSummaryLabel).toBe('worker connected');
    expect(view.metrics).toEqual([
      { label: 'Connected nodes', value: '1', unavailable: false },
      { label: 'Known peers', value: '1', unavailable: false },
      { label: 'Frames sent', value: 'unavailable', unavailable: true },
      { label: 'Frames received', value: 'unavailable', unavailable: true },
    ]);
    expect(view.nodes.find((node) => node.id === 'worker-runtime')).toMatchObject({
      statusLabel: 'Connected',
      connectedLabel: 'true',
      freshLabel: 'true',
      peerState: 'connected',
    });
  });

  it('maps a disconnected worker runtime from /runtime/status', () => {
    const view = reduceLogisticsRuntimeStatusView(
      createInitialLogisticsRuntimeStatusView(),
      createStatusResponse({
        connectedNodes: [],
        peers: [
          {
            nodeAddress: 'logistics-worker-runtime',
            state: 'disconnected',
            connected: false,
            fresh: false,
            staleAfterMs: 45_000,
            disconnectedAt: '2026-04-30T15:03:00.000Z',
            staleReason: 'heartbeat timed out',
          },
        ],
        workerConnected: false,
        workerPeerFresh: false,
        workerPeer: {
          nodeAddress: 'logistics-worker-runtime',
          state: 'disconnected',
          connected: false,
          fresh: false,
          staleAfterMs: 45_000,
          disconnectedAt: '2026-04-30T15:03:00.000Z',
          staleReason: 'heartbeat timed out',
        },
      })
    );

    expect(view.workerSummaryLabel).toBe('worker disconnected');
    expect(view.nodes.find((node) => node.id === 'worker-runtime')).toMatchObject({
      statusLabel: 'Disconnected',
      connectedLabel: 'false',
      freshLabel: 'false',
      disconnectedAt: '2026-04-30T15:03:00.000Z',
      staleReason: 'heartbeat timed out',
    });
  });

  it('marks the worker as recovered after a disconnected snapshot', () => {
    const disconnected = reduceLogisticsRuntimeStatusView(
      createInitialLogisticsRuntimeStatusView(),
      createStatusResponse({
        connectedNodes: [],
        peers: [
          {
            nodeAddress: 'logistics-worker-runtime',
            state: 'disconnected',
            connected: false,
            fresh: false,
            staleAfterMs: 45_000,
            disconnectedAt: '2026-04-30T15:03:00.000Z',
          },
        ],
        workerConnected: false,
        workerPeerFresh: false,
        workerPeer: {
          nodeAddress: 'logistics-worker-runtime',
          state: 'disconnected',
          connected: false,
          fresh: false,
          staleAfterMs: 45_000,
          disconnectedAt: '2026-04-30T15:03:00.000Z',
        },
      })
    );

    const recovered = reduceLogisticsRuntimeStatusView(disconnected, createStatusResponse());

    expect(recovered.workerSummaryLabel).toBe('worker recovered');
    expect(recovered.nodes.find((node) => node.id === 'worker-runtime')).toMatchObject({
      statusLabel: 'Recovered',
      connectedLabel: 'true',
      freshLabel: 'true',
    });
  });
});
