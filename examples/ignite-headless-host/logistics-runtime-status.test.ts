import { describe, expect, it } from 'vitest';
import {
  createInitialLogisticsRuntimeStatusView,
  type LogisticsRuntimeIdempotencyStatus,
  type LogisticsRuntimeStatusResponse,
  reduceLogisticsRuntimeStatusView,
} from './logistics-runtime-status';

function createIdempotencyStatus(
  overrides: Partial<LogisticsRuntimeIdempotencyStatus> = {}
): LogisticsRuntimeIdempotencyStatus {
  return {
    windowSize: 1024,
    duplicateFramesDropped: 0,
    providerEnabled: false,
    providerClaimCount: 0,
    providerDuplicateCount: 0,
    providerErrorCount: 0,
    ...overrides,
  };
}

function createStatusResponse(
  overrides: Partial<LogisticsRuntimeStatusResponse['transport']> = {}
): LogisticsRuntimeStatusResponse {
  return {
    gatewayUrl: 'ws://127.0.0.1:4101',
    transportUrl: 'ws://127.0.0.1:4102',
    lifecycleMode: 'manual',
    provider: {
      runtimeEnabled: false,
      runtimeSource: 'embedded',
      sourceLabel: 'manual UI',
    },
    transport: {
      connectedNodes: ['logistics-worker-runtime'],
      peers: [
        {
          outboundQueueDepth: 1,
          outboundQueueLimit: 7,
          outboundFramesDropped: 0,
          backpressureDropCount: 0,
          handshakeAcceptedCount: 1,
          handshakeRejectedCount: 0,
          reconnectCount: 0,
          nodeAddress: 'logistics-worker-runtime',
          state: 'connected',
          connected: true,
          fresh: true,
          staleAfterMs: 45_000,
          idempotency: createIdempotencyStatus(),
          lastSeenAt: '2026-04-30T15:00:00.000Z',
        },
      ],
      telemetry: {
        outboundQueueDepth: 1,
        outboundQueueLimit: 7,
        outboundFramesDropped: 0,
        backpressureDropCount: 0,
        duplicateFramesDropped: 0,
        handshakeAcceptedCount: 1,
        handshakeRejectedCount: 0,
        reconnectCount: 0,
      },
      idempotency: createIdempotencyStatus(),
      workerConnected: true,
      workerPeerFresh: true,
      workerPeer: {
        outboundQueueDepth: 1,
        outboundQueueLimit: 7,
        outboundFramesDropped: 0,
        backpressureDropCount: 0,
        handshakeAcceptedCount: 1,
        handshakeRejectedCount: 0,
        reconnectCount: 0,
        nodeAddress: 'logistics-worker-runtime',
        state: 'connected',
        connected: true,
        fresh: true,
        staleAfterMs: 45_000,
        idempotency: createIdempotencyStatus(),
        lastSeenAt: '2026-04-30T15:00:00.000Z',
      },
      providerConnected: false,
      providerPeerFresh: false,
      providerPeer: {
        nodeAddress: 'logistics-provider-runtime',
        state: 'disconnected',
        connected: false,
        fresh: false,
        staleAfterMs: 45_000,
        idempotency: createIdempotencyStatus(),
      },
      ...overrides,
    },
    nodes: {
      browserHost: 'thin Ignite host',
      serverRuntime: 'logistics-server-runtime',
      workerRuntime: 'logistics-worker-runtime',
      providerRuntime: 'logistics-provider-runtime',
      serviceWorkerRuntime: 'logistics-service-worker-runtime',
    },
    actors: {
      shipment: 'actor://logistics-server-runtime/actor/logistics-shipment',
      routing: 'actor://logistics-worker-runtime/actor/logistics-routing',
      providerHq: 'actor://logistics-server-runtime/actor/logistics-provider-hq',
      providerRuntime:
        'actor://logistics-provider-runtime/actor/logistics-provider-runtime-manager',
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
      { label: 'Reconnects', value: '0', unavailable: false },
      { label: 'Handshake rejects', value: '0', unavailable: false },
      { label: 'Duplicate drops', value: '0', unavailable: false },
      { label: 'Queue limit', value: '7', unavailable: false },
      { label: 'Backpressure drops', value: '0', unavailable: false },
      { label: 'Provider idempotency errors', value: 'disabled', unavailable: true },
      { label: 'Last provider error at', value: 'unavailable', unavailable: true },
      { label: 'Last provider error message', value: 'unavailable', unavailable: true },
    ]);
    expect(view.nodes.find((node) => node.id === 'worker-runtime')).toMatchObject({
      statusLabel: 'Connected',
      connectedLabel: 'true',
      freshLabel: 'true',
      peerState: 'connected',
    });
    expect(view.nodes.find((node) => node.id === 'provider-runtime')).toMatchObject({
      statusLabel: 'Disabled',
      processLabel: 'provider runtime disabled',
    });
  });

  it('surfaces duplicate drops from the default in-memory transport status', () => {
    const view = reduceLogisticsRuntimeStatusView(
      createInitialLogisticsRuntimeStatusView(),
      createStatusResponse({
        telemetry: {
          outboundQueueDepth: 1,
          outboundQueueLimit: 7,
          outboundFramesDropped: 0,
          backpressureDropCount: 0,
          duplicateFramesDropped: 2,
          handshakeAcceptedCount: 1,
          handshakeRejectedCount: 0,
          reconnectCount: 0,
        },
        idempotency: createIdempotencyStatus({
          duplicateFramesDropped: 2,
        }),
      })
    );

    expect(view.metrics).toEqual([
      { label: 'Connected nodes', value: '1', unavailable: false },
      { label: 'Known peers', value: '1', unavailable: false },
      { label: 'Reconnects', value: '0', unavailable: false },
      { label: 'Handshake rejects', value: '0', unavailable: false },
      { label: 'Duplicate drops', value: '2', unavailable: false },
      { label: 'Queue limit', value: '7', unavailable: false },
      { label: 'Backpressure drops', value: '0', unavailable: false },
      { label: 'Provider idempotency errors', value: 'disabled', unavailable: true },
      { label: 'Last provider error at', value: 'unavailable', unavailable: true },
      { label: 'Last provider error message', value: 'unavailable', unavailable: true },
    ]);
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
            idempotency: createIdempotencyStatus(),
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
          idempotency: createIdempotencyStatus(),
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
            idempotency: createIdempotencyStatus(),
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
          idempotency: createIdempotencyStatus(),
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

  it('maps an enabled provider runtime from /runtime/status', () => {
    const view = reduceLogisticsRuntimeStatusView(createInitialLogisticsRuntimeStatusView(), {
      ...createStatusResponse({
        connectedNodes: ['logistics-worker-runtime', 'logistics-provider-runtime'],
        peers: [
          {
            nodeAddress: 'logistics-worker-runtime',
            state: 'connected',
            connected: true,
            fresh: true,
            staleAfterMs: 45_000,
            idempotency: createIdempotencyStatus(),
            lastSeenAt: '2026-04-30T15:00:00.000Z',
          },
          {
            nodeAddress: 'logistics-provider-runtime',
            state: 'connected',
            connected: true,
            fresh: true,
            staleAfterMs: 45_000,
            idempotency: createIdempotencyStatus(),
            lastSeenAt: '2026-04-30T15:00:01.000Z',
          },
        ],
        providerConnected: true,
        providerPeerFresh: true,
        providerPeer: {
          nodeAddress: 'logistics-provider-runtime',
          state: 'connected',
          connected: true,
          fresh: true,
          staleAfterMs: 45_000,
          idempotency: createIdempotencyStatus(),
          lastSeenAt: '2026-04-30T15:00:01.000Z',
        },
      }),
      provider: {
        runtimeEnabled: true,
        runtimeSource: 'container',
        sourceLabel: 'provider container',
      },
    });

    expect(view.providerSourceLabel).toBe('provider container');
    expect(view.nodes.find((node) => node.id === 'provider-runtime')).toMatchObject({
      statusLabel: 'Connected',
      connectedLabel: 'true',
      freshLabel: 'true',
      processLabel: 'provider-runtime container',
    });
  });

  it('keeps provider runtime identity separate from manual signal source', () => {
    const view = reduceLogisticsRuntimeStatusView(createInitialLogisticsRuntimeStatusView(), {
      ...createStatusResponse({
        connectedNodes: ['logistics-worker-runtime', 'logistics-provider-runtime'],
        providerConnected: true,
        providerPeerFresh: true,
        providerPeer: {
          nodeAddress: 'logistics-provider-runtime',
          state: 'connected',
          connected: true,
          fresh: true,
          staleAfterMs: 45_000,
          idempotency: createIdempotencyStatus(),
          lastSeenAt: '2026-04-30T15:00:01.000Z',
        },
      }),
      lifecycleMode: 'manual',
      provider: {
        runtimeEnabled: true,
        runtimeSource: 'container',
        sourceLabel: 'manual UI',
      },
    });

    expect(view.providerSourceLabel).toBe('manual UI');
    expect(view.nodes.find((node) => node.id === 'provider-runtime')).toMatchObject({
      statusLabel: 'Connected',
      processLabel: 'provider-runtime container',
      detail:
        'Provider shipment workflow boundary hosted by container; signal source is manual UI.',
    });
  });

  it('surfaces transport idempotency metrics when the durable provider is enabled', () => {
    const view = reduceLogisticsRuntimeStatusView(
      createInitialLogisticsRuntimeStatusView(),
      createStatusResponse({
        telemetry: {
          outboundQueueDepth: 2,
          outboundQueueLimit: 9,
          outboundFramesDropped: 0,
          backpressureDropCount: 1,
          duplicateFramesDropped: 3,
          handshakeAcceptedCount: 2,
          handshakeRejectedCount: 1,
          reconnectCount: 4,
        },
        idempotency: createIdempotencyStatus({
          duplicateFramesDropped: 3,
          providerEnabled: true,
          providerDuplicateCount: 3,
          providerErrorCount: 1,
        }),
      })
    );

    expect(view.metrics).toEqual([
      { label: 'Connected nodes', value: '1', unavailable: false },
      { label: 'Known peers', value: '1', unavailable: false },
      { label: 'Reconnects', value: '4', unavailable: false },
      { label: 'Handshake rejects', value: '1', unavailable: false },
      { label: 'Duplicate drops', value: '3', unavailable: false },
      { label: 'Queue limit', value: '9', unavailable: false },
      { label: 'Backpressure drops', value: '1', unavailable: false },
      { label: 'Provider idempotency errors', value: '1', unavailable: false },
      { label: 'Last provider error at', value: 'none', unavailable: false },
      { label: 'Last provider error message', value: 'none', unavailable: false },
    ]);
  });

  it('surfaces the last provider idempotency error details in operator metrics', () => {
    const view = reduceLogisticsRuntimeStatusView(
      createInitialLogisticsRuntimeStatusView(),
      createStatusResponse({
        idempotency: createIdempotencyStatus({
          providerEnabled: true,
          providerErrorCount: 1,
          lastProviderErrorAt: '2026-04-30T15:04:00.000Z',
          lastProviderErrorMessage: 'durable idempotency unavailable',
        }),
      })
    );

    expect(view.metrics).toEqual([
      { label: 'Connected nodes', value: '1', unavailable: false },
      { label: 'Known peers', value: '1', unavailable: false },
      { label: 'Reconnects', value: '0', unavailable: false },
      { label: 'Handshake rejects', value: '0', unavailable: false },
      { label: 'Duplicate drops', value: '0', unavailable: false },
      { label: 'Queue limit', value: '7', unavailable: false },
      { label: 'Backpressure drops', value: '0', unavailable: false },
      { label: 'Provider idempotency errors', value: '1', unavailable: false },
      { label: 'Last provider error at', value: '2026-04-30T15:04:00.000Z', unavailable: false },
      {
        label: 'Last provider error message',
        value: 'durable idempotency unavailable',
        unavailable: false,
      },
    ]);
  });

  it('guards operator-facing transport telemetry from /runtime/status', () => {
    const view = reduceLogisticsRuntimeStatusView(
      createInitialLogisticsRuntimeStatusView(),
      createStatusResponse({
        peers: [
          {
            outboundQueueDepth: 3,
            outboundQueueLimit: 11,
            outboundFramesDropped: 1,
            backpressureDropCount: 2,
            handshakeAcceptedCount: 3,
            handshakeRejectedCount: 1,
            reconnectCount: 5,
            nodeAddress: 'logistics-worker-runtime',
            state: 'connected',
            connected: true,
            fresh: true,
            staleAfterMs: 45_000,
            idempotency: createIdempotencyStatus({ duplicateFramesDropped: 4 }),
            lastSeenAt: '2026-04-30T15:00:00.000Z',
          },
        ],
        telemetry: {
          outboundQueueDepth: 3,
          outboundQueueLimit: 11,
          outboundFramesDropped: 1,
          backpressureDropCount: 2,
          duplicateFramesDropped: 4,
          handshakeAcceptedCount: 3,
          handshakeRejectedCount: 1,
          reconnectCount: 5,
        },
        workerPeer: {
          outboundQueueDepth: 3,
          outboundQueueLimit: 11,
          outboundFramesDropped: 1,
          backpressureDropCount: 2,
          handshakeAcceptedCount: 3,
          handshakeRejectedCount: 1,
          reconnectCount: 5,
          nodeAddress: 'logistics-worker-runtime',
          state: 'connected',
          connected: true,
          fresh: true,
          staleAfterMs: 45_000,
          idempotency: createIdempotencyStatus({ duplicateFramesDropped: 4 }),
          lastSeenAt: '2026-04-30T15:00:00.000Z',
        },
      })
    );

    expect(view.metrics).toEqual([
      { label: 'Connected nodes', value: '1', unavailable: false },
      { label: 'Known peers', value: '1', unavailable: false },
      { label: 'Reconnects', value: '5', unavailable: false },
      { label: 'Handshake rejects', value: '1', unavailable: false },
      { label: 'Duplicate drops', value: '4', unavailable: false },
      { label: 'Queue limit', value: '11', unavailable: false },
      { label: 'Backpressure drops', value: '2', unavailable: false },
      { label: 'Provider idempotency errors', value: 'disabled', unavailable: true },
      { label: 'Last provider error at', value: 'unavailable', unavailable: true },
      { label: 'Last provider error message', value: 'unavailable', unavailable: true },
    ]);
    expect(view.nodes.find((node) => node.id === 'worker-runtime')).toMatchObject({
      statusLabel: 'Connected',
      connectedLabel: 'true',
      peerState: 'connected',
    });
  });

  it('surfaces nested worker and provider peer freshness from /runtime/status', () => {
    const view = reduceLogisticsRuntimeStatusView(createInitialLogisticsRuntimeStatusView(), {
      ...createStatusResponse({
        connectedNodes: [],
        workerConnected: false,
        workerPeerFresh: false,
        workerPeer: {
          nodeAddress: 'logistics-worker-runtime',
          state: 'rejected',
          connected: false,
          fresh: false,
          staleAfterMs: 45_000,
          rejectedReason: 'Shared runtime secret rejected.',
          idempotency: createIdempotencyStatus(),
        },
        providerConnected: false,
        providerPeerFresh: false,
        providerPeer: {
          nodeAddress: 'logistics-provider-runtime',
          state: 'disconnected',
          connected: false,
          fresh: false,
          staleAfterMs: 45_000,
          idempotency: createIdempotencyStatus(),
        },
      }),
      provider: {
        runtimeEnabled: true,
        runtimeSource: 'container',
        sourceLabel: 'provider container',
      },
    });

    expect(view.nodes.find((node) => node.id === 'worker-runtime')).toMatchObject({
      connectedLabel: 'false',
      freshLabel: 'false',
      rejectedReason: 'Shared runtime secret rejected.',
    });
    expect(view.nodes.find((node) => node.id === 'provider-runtime')).toMatchObject({
      connectedLabel: 'false',
      freshLabel: 'false',
      statusLabel: 'Disconnected',
    });
  });
});
