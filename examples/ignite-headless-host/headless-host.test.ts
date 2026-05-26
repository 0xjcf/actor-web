import {
  type ClosableActorWebSource,
  createActorWebClient,
  type StartedActorWebNode,
  startActorWebNode,
} from '@actor-core/runtime/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type {
  ProviderHqCommand,
  ProviderHqContext,
  ProviderHqEvent,
  ShipmentCommand,
  ShipmentContext,
  ShipmentEvent,
} from './logistics-contract';
import { isProviderHqEvent, isShipmentEvent } from './logistics-contract';
import {
  createDispatchShipmentCommand,
  createDriverAssignmentCommand,
  createProviderSignalPlan,
  createProviderSyncPlan,
  createRouteAssignmentRecordCommand,
  createRoutePlanCommand,
  createShipmentLifecyclePlan,
  shipmentLifecycleActorId,
} from './logistics-runtime-plans';
import { logistics } from './logistics-topology';
import {
  createLogisticsRuntimeGatewayServer,
  type LogisticsRuntimeGatewayServer,
} from './server-runtime-gateway';

type ShipmentSource = ClosableActorWebSource<ShipmentContext, ShipmentCommand, ShipmentEvent>;
type ProviderHqSource = ClosableActorWebSource<
  ProviderHqContext,
  ProviderHqCommand,
  ProviderHqEvent
>;

interface RuntimeStatusTestShape {
  readonly transport: {
    readonly workerConnected: boolean;
    readonly workerPeer?: {
      readonly state?: string;
      readonly connected?: boolean;
      readonly fresh?: boolean;
      readonly rejectedReason?: string;
    };
  };
}

describe('ignite-headless-host logistics example', () => {
  let gatewayServer: LogisticsRuntimeGatewayServer | undefined;
  let workerNode: StartedActorWebNode<typeof logistics> | undefined;
  let providerNode: StartedActorWebNode<typeof logistics> | undefined;
  let closeClient: (() => void) | undefined;

  afterEach(async () => {
    closeClient?.();
    closeClient = undefined;
    if (workerNode) {
      await workerNode.stop();
      workerNode = undefined;
    }
    if (providerNode) {
      await providerNode.stop();
      providerNode = undefined;
    }
    if (gatewayServer) {
      await gatewayServer.stop();
      gatewayServer = undefined;
    }
  });

  it('declares topology-owned actors and supervision metadata', () => {
    expect(logistics.actors.shipment.address.path).toBe(
      'actor://logistics-server-runtime/actor/logistics-shipment'
    );
    expect(logistics.actors.shipment.supervision).toMatchObject({
      strategy: 'restart',
      maxRestarts: 3,
      withinMs: 60_000,
    });
    expect(logistics.supervisors.serverLogistics).toMatchObject({
      nodeAddress: 'logistics-server-runtime',
      strategy: 'one-for-one',
      children: [
        'logisticsSupervisor',
        'dispatcher',
        'driverDirectory',
        'shipment',
        'shipmentLifecycle',
        'providerHq',
        'providerShipment',
      ],
    });
    expect(logistics.actors.providerHq.address.path).toBe(
      'actor://logistics-server-runtime/actor/logistics-provider-hq'
    );
    expect(logistics.actors.dispatcher.address.path).toBe(
      'actor://logistics-server-runtime/actor/logistics-dispatcher'
    );
    expect(logistics.actors.driverDirectory.address.path).toBe(
      'actor://logistics-server-runtime/actor/logistics-driver-directory'
    );
  });

  it('uses Actor-Web client sources for gateway command and projection flow', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer();
    await gatewayServer.start();
    const client = createTestClient(requiredGatewayUrl(gatewayServer));
    const events: ShipmentEvent[] = [];
    client.actors.shipment.subscribeEvent((event) => {
      events.unshift(event);
    });

    await waitForSource(client.actors.shipment, (context) => context.status === 'idle');
    await client.actors.shipment.send({
      type: 'CREATE_SHIPMENT',
      shipmentId: 'shipment-client-1001',
      destination: 'Chicago warehouse',
      reference: 'REF-1001',
    });

    await waitForSource(
      client.actors.shipment,
      (context) => context.shipmentId === 'shipment-client-1001',
      'Expected gateway command to update shipment source'
    );

    expect(client.actors.shipment.snapshot().context).toMatchObject({
      status: 'route-requested',
      shipmentId: 'shipment-client-1001',
      destination: 'Chicago warehouse',
      reference: 'REF-1001',
    });
    await waitForProviderSource(
      client.actors.providerHq,
      (context) => context.status.queue.some((item) => item.shipmentId === 'shipment-client-1001'),
      'Expected gateway-created shipment to appear in Provider HQ queue'
    );
    expect(client.actors.providerHq.snapshot().context.status.queue[0]).toMatchObject({
      shipmentId: 'shipment-client-1001',
      destination: 'Chicago warehouse',
      reference: 'REF-1001',
      status: 'route-requested',
    });
    expect(events.map((event) => event.type)).toEqual(['ROUTE_REQUESTED', 'SHIPMENT_CREATED']);
  });

  it('accepts REST shipment ingress and streams live gateway updates', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer();
    await gatewayServer.start();
    const client = createTestClient(requiredGatewayUrl(gatewayServer));
    const restUrl = requiredRestUrl(gatewayServer);

    await waitForSource(client.actors.shipment, (context) => context.status === 'idle');
    const response = await fetch(`${restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-rest-4004',
        destination: 'Portland terminal',
        reference: 'REST-4004',
      }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      shipmentId: 'shipment-rest-4004',
      status: 'route-requested',
    });
    await waitForSource(
      client.actors.shipment,
      (context) => context.shipmentId === 'shipment-rest-4004',
      'Expected REST shipment to stream through gateway'
    );
    expect(client.actors.shipment.snapshot().context).toMatchObject({
      shipmentId: 'shipment-rest-4004',
      destination: 'Portland terminal',
      reference: 'REST-4004',
      status: 'route-requested',
    });
    await waitForProviderSource(
      client.actors.providerHq,
      (context) => context.status.queue.some((item) => item.shipmentId === 'shipment-rest-4004'),
      'Expected REST shipment to appear in Provider HQ queue'
    );
  });

  it('routes REST-created shipments through a worker node over real WebSocket transport', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer({
      lifecycleLabelDelayMs: 10,
      lifecyclePackedDelayMs: 20,
      lifecycleShippedDelayMs: 25,
      lifecycleTerminalDelayMs: 70,
    });
    await gatewayServer.start();
    workerNode = await startTestWorkerNode(requiredTransportUrl(gatewayServer));
    const client = createTestClient(requiredGatewayUrl(gatewayServer));
    const restUrl = requiredRestUrl(gatewayServer);

    await waitForSource(client.actors.shipment, (context) => context.status === 'idle');
    const response = await fetch(`${restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-worker-5005',
        destination: 'International hub',
        reference: 'WORKER-5005',
      }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      shipmentId: 'shipment-worker-5005',
      status: 'route-assigned',
    });
    await waitForSource(
      client.actors.shipment,
      (context) => context.status === 'route-assigned' && context.carrier === 'Atlas Freight',
      'Expected worker route plan to update server shipment actor'
    );
    await waitForSource(
      client.actors.routing,
      (context) => context.shipmentId === 'shipment-worker-5005',
      'Expected worker routing source to project the worker-owned actor'
    );

    expect(client.actors.shipment.snapshot().context).toMatchObject({
      shipmentId: 'shipment-worker-5005',
      destination: 'International hub',
      carrier: 'Atlas Freight',
      eta: '72h',
      routeNotes: 'Route shipment-worker-5005 through International hub',
    });
    expect(client.actors.routing.snapshot().context).toMatchObject({
      shipmentId: 'shipment-worker-5005',
      carrier: 'Atlas Freight',
      eta: '72h',
    });
  });

  it('supports manual provider HQ signals while streaming gateway updates', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer({ lifecycleMode: 'manual' });
    await gatewayServer.start();
    workerNode = await startTestWorkerNode(requiredTransportUrl(gatewayServer));
    const client = createTestClient(requiredGatewayUrl(gatewayServer));
    const restUrl = requiredRestUrl(gatewayServer);
    const events: ShipmentEvent[] = [];
    client.actors.shipment.subscribeEvent((event) => {
      events.unshift(event);
    });

    await fetch(`${restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-manual-6006',
        destination: 'Chicago warehouse',
        reference: 'MANUAL-6006',
      }),
    });
    await waitForSource(
      client.actors.shipment,
      (context) => context.status === 'route-assigned',
      'Expected manual mode shipment to stop after route assignment'
    );
    await waitForProviderSource(
      client.actors.providerHq,
      (context) =>
        context.status.queue.some((item) => item.shipmentId === 'shipment-manual-6006') &&
        context.selectedShipmentId === null,
      'Expected Provider HQ queue to require explicit shipment selection'
    );

    const labelResponse = await fetch(`${restUrl}/provider/signals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shipmentId: 'shipment-manual-6006', signal: 'LABEL_SCANNED' }),
    });
    expect(labelResponse.status).toBe(202);
    const packedResponse = await fetch(`${restUrl}/provider/signals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shipmentId: 'shipment-manual-6006', signal: 'PACKED_INTO_TRUCK' }),
    });
    expect(packedResponse.status).toBe(202);
    const providerResponse = await fetch(`${restUrl}/provider/signals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shipmentId: 'shipment-manual-6006', signal: 'OUTBOUND_SCAN' }),
    });
    expect(providerResponse.status).toBe(202);
    await waitForSource(
      client.actors.shipment,
      (context) => context.status === 'in-transit' && context.providerSignal === 'OUTBOUND_SCAN',
      'Expected provider HQ signal to stream through gateway'
    );
    expect(events.map((event) => event.type)).toContain('PROVIDER_SIGNAL_RECORDED');
  });

  it('routes provider simulation through a separate provider runtime node when enabled', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer({
      lifecycleMode: 'simulation',
      lifecycleLabelDelayMs: 10,
      lifecyclePackedDelayMs: 20,
      lifecycleShippedDelayMs: 30,
      lifecycleTerminalDelayMs: 120,
      providerRuntimeEnabled: true,
      providerRuntimeSource: 'process',
    });
    await gatewayServer.start();
    workerNode = await startTestWorkerNode(requiredTransportUrl(gatewayServer));
    providerNode = await startTestProviderNode(requiredTransportUrl(gatewayServer));
    const client = createTestClient(requiredGatewayUrl(gatewayServer));
    const restUrl = requiredRestUrl(gatewayServer);

    const response = await fetch(`${restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-provider-9101',
        destination: 'Nashville hub',
        reference: 'PROVIDER-9101',
      }),
    });

    expect(response.status).toBe(202);
    await waitForSource(
      client.actors.shipment,
      (context) =>
        context.shipmentId === 'shipment-provider-9101' &&
        context.providerSignal !== null &&
        context.timeline.some((entry) => entry.source === 'simulator process'),
      'Expected provider runtime node to apply provider-owned simulation signals'
    );

    await expect(
      fetch(`${restUrl}/runtime/status`).then((result) => result.json())
    ).resolves.toMatchObject({
      provider: {
        runtimeEnabled: true,
        sourceLabel: 'simulator process',
      },
      transport: {
        providerConnected: true,
        providerPeerFresh: true,
      },
    });
  });

  it('fails closed when provider runtime is enabled but unavailable', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer({
      lifecycleMode: 'manual',
      providerRuntimeEnabled: true,
      providerRuntimeSource: 'process',
    });
    await gatewayServer.start();
    const client = createTestClient(requiredGatewayUrl(gatewayServer));
    const restUrl = requiredRestUrl(gatewayServer);

    const response = await fetch(`${restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-provider-down-9102',
        destination: 'Nashville hub',
        reference: 'PROVIDER-DOWN-9102',
      }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Provider runtime boundary is enabled but unavailable.',
    });
    await waitForProviderSource(
      client.actors.providerHq,
      (context) => context.status.queue.length === 0,
      'Expected Provider HQ queue to remain empty when provider runtime sync fails'
    );
  });

  it('preserves the provider source label when shipment reset clears Provider HQ', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer({
      providerRuntimeEnabled: true,
      providerRuntimeSource: 'container',
    });
    await gatewayServer.start();
    workerNode = await startTestWorkerNode(requiredTransportUrl(gatewayServer));
    providerNode = await startTestProviderNode(requiredTransportUrl(gatewayServer));
    const client = createTestClient(requiredGatewayUrl(gatewayServer));
    const restUrl = requiredRestUrl(gatewayServer);

    const response = await fetch(`${restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-provider-reset-9103',
        destination: 'Phoenix cross-dock',
        reference: 'PROVIDER-RESET-9103',
      }),
    });
    expect(response.status).toBe(202);
    await waitForProviderSource(
      client.actors.providerHq,
      (context) =>
        context.status.sourceLabel === 'provider container' &&
        context.status.queue.some((item) => item.shipmentId === 'shipment-provider-reset-9103'),
      'Expected Provider HQ to use provider container source before reset'
    );

    const resetResponse = await fetch(`${restUrl}/shipments/current/reset`, {
      method: 'POST',
    });

    expect(resetResponse.status).toBe(202);
    await waitForProviderSource(
      client.actors.providerHq,
      (context) =>
        context.status.sourceLabel === 'provider container' && context.status.queue.length === 0,
      'Expected Provider HQ reset to preserve the active provider source label'
    );
    await expect(
      fetch(`${restUrl}/provider/status`).then((result) => result.json())
    ).resolves.toMatchObject({
      sourceLabel: 'provider container',
      queue: [],
    });
  });

  it('reports provider runtime signal loss through Provider HQ rejection events', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer({
      lifecycleMode: 'manual',
      providerRuntimeEnabled: true,
      providerRuntimeSource: 'process',
    });
    await gatewayServer.start();
    workerNode = await startTestWorkerNode(requiredTransportUrl(gatewayServer));
    providerNode = await startTestProviderNode(requiredTransportUrl(gatewayServer));
    const client = createTestClient(requiredGatewayUrl(gatewayServer));
    const restUrl = requiredRestUrl(gatewayServer);
    const providerEvents: ProviderHqEvent[] = [];
    client.actors.providerHq.subscribeEvent((event) => {
      providerEvents.unshift(event);
    });

    const response = await fetch(`${restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-provider-loss-9104',
        destination: 'Atlanta hub',
        reference: 'PROVIDER-LOSS-9104',
      }),
    });
    expect(response.status).toBe(202);
    await waitForProviderSource(
      client.actors.providerHq,
      (context) =>
        context.status.queue.some((item) => item.shipmentId === 'shipment-provider-loss-9104'),
      'Expected Provider HQ queue before provider runtime loss'
    );

    const stoppedProviderNode = providerNode;
    providerNode = undefined;
    await stoppedProviderNode.stop();

    const signalResponse = await fetch(`${restUrl}/provider/signals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-provider-loss-9104',
        signal: 'LABEL_SCANNED',
      }),
    });

    expect(signalResponse.status).toBe(202);
    await waitForProviderSource(
      client.actors.providerHq,
      (context) =>
        context.message.includes('Provider runtime boundary is enabled but unavailable') &&
        context.status.queue.some(
          (item) => item.shipmentId === 'shipment-provider-loss-9104' && item.signal === null
        ),
      'Expected Provider HQ to report provider runtime signal loss as a rejection'
    );
    expect(providerEvents).toContainEqual(
      expect.objectContaining({
        type: 'PROVIDER_SIGNAL_REJECTED',
        shipmentId: 'shipment-provider-loss-9104',
        signal: 'LABEL_SCANNED',
      })
    );
  });

  it('rejects out-of-order provider signals through the provider runtime boundary', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer({
      lifecycleMode: 'manual',
      providerRuntimeEnabled: true,
      providerRuntimeSource: 'process',
    });
    await gatewayServer.start();
    workerNode = await startTestWorkerNode(requiredTransportUrl(gatewayServer));
    providerNode = await startTestProviderNode(requiredTransportUrl(gatewayServer));
    const client = createTestClient(requiredGatewayUrl(gatewayServer));
    const restUrl = requiredRestUrl(gatewayServer);
    const providerEvents: ProviderHqEvent[] = [];
    client.actors.providerHq.subscribeEvent((event) => {
      providerEvents.unshift(event);
    });

    const response = await fetch(`${restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-provider-order-9105',
        destination: 'Memphis hub',
        reference: 'PROVIDER-ORDER-9105',
      }),
    });
    expect(response.status).toBe(202);
    await waitForProviderSource(
      client.actors.providerHq,
      (context) =>
        context.status.queue.some((item) => item.shipmentId === 'shipment-provider-order-9105'),
      'Expected Provider HQ queue before provider runtime order test'
    );

    const signalResponse = await fetch(`${restUrl}/provider/signals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-provider-order-9105',
        signal: 'PACKED_INTO_TRUCK',
      }),
    });

    expect(signalResponse.status).toBe(202);
    await waitForProviderSource(
      client.actors.providerHq,
      (context) =>
        context.message.includes(
          'PACKED_INTO_TRUCK rejected. Next required provider signal is LABEL_SCANNED.'
        ) &&
        context.status.queue.some(
          (item) => item.shipmentId === 'shipment-provider-order-9105' && item.signal === null
        ),
      'Expected provider runtime to reject out-of-order provider signal'
    );
    await waitForSource(
      client.actors.shipment,
      (context) =>
        context.shipmentId === 'shipment-provider-order-9105' && context.providerSignal === null,
      'Expected shipment projection not to advance after rejected provider runtime signal'
    );
    expect(providerEvents).toContainEqual(
      expect.objectContaining({
        type: 'PROVIDER_SIGNAL_REJECTED',
        shipmentId: 'shipment-provider-order-9105',
        signal: 'PACKED_INTO_TRUCK',
      })
    );
  });

  it('honors gateway-selected manual provider mode and does not auto-select new queue items', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer({
      lifecycleLabelDelayMs: 10,
      lifecyclePackedDelayMs: 20,
      lifecycleShippedDelayMs: 30,
      lifecycleTerminalDelayMs: 40,
    });
    await gatewayServer.start();
    workerNode = await startTestWorkerNode(requiredTransportUrl(gatewayServer));
    const client = createTestClient(requiredGatewayUrl(gatewayServer));
    const restUrl = requiredRestUrl(gatewayServer);

    await client.actors.providerHq.send({ type: 'SET_PROVIDER_MODE', mode: 'manual' });
    await waitForProviderSource(
      client.actors.providerHq,
      (context) => context.status.mode === 'manual',
      'Expected Provider HQ source to reflect manual mode'
    );

    const response = await fetch(`${restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-gateway-manual-7007',
        destination: 'Dallas cross-dock',
        reference: 'MANUAL-7007',
      }),
    });
    expect(response.status).toBe(202);

    await waitForSource(
      client.actors.shipment,
      (context) =>
        context.shipmentId === 'shipment-gateway-manual-7007' &&
        context.status === 'route-assigned',
      'Expected shipment to route but wait for manual provider processing'
    );
    await waitForProviderSource(
      client.actors.providerHq,
      (context) =>
        context.status.queue.some((item) => item.shipmentId === 'shipment-gateway-manual-7007') &&
        context.selectedShipmentId === null,
      'Expected new Provider HQ queue item to remain unselected'
    );

    await new Promise((resolve) => {
      setTimeout(resolve, 90);
    });
    expect(client.actors.shipment.snapshot().context).toMatchObject({
      shipmentId: 'shipment-gateway-manual-7007',
      status: 'route-assigned',
      providerSignal: null,
    });

    await client.actors.providerHq.send({
      type: 'SELECT_PROVIDER_SHIPMENT',
      shipmentId: 'shipment-gateway-manual-7007',
    });
    await waitForProviderSource(
      client.actors.providerHq,
      (context) => context.selectedShipmentId === 'shipment-gateway-manual-7007',
      'Expected explicit Provider HQ selection to stick'
    );
  });

  it('rejects out-of-order provider signals through the Provider HQ FSM', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer({ lifecycleMode: 'manual' });
    await gatewayServer.start();
    workerNode = await startTestWorkerNode(requiredTransportUrl(gatewayServer));
    const client = createTestClient(requiredGatewayUrl(gatewayServer));
    const restUrl = requiredRestUrl(gatewayServer);
    const providerEvents: ProviderHqEvent[] = [];
    client.actors.providerHq.subscribeEvent((event) => {
      providerEvents.unshift(event);
    });

    await fetch(`${restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-fsm-8008',
        destination: 'Austin terminal',
        reference: 'FSM-8008',
      }),
    });
    await waitForProviderSource(
      client.actors.providerHq,
      (context) => context.status.queue.some((item) => item.shipmentId === 'shipment-fsm-8008'),
      'Expected Provider HQ queue to include FSM test shipment'
    );
    await client.actors.providerHq.send({
      type: 'SELECT_PROVIDER_SHIPMENT',
      shipmentId: 'shipment-fsm-8008',
    });
    await client.actors.providerHq.send({
      type: 'PACKED_INTO_TRUCK',
      note: 'Attempted pack before label scan.',
    });

    await waitForProviderSource(
      client.actors.providerHq,
      (context) =>
        context.message.includes('PACKED_INTO_TRUCK rejected') &&
        context.status.queue.some(
          (item) => item.shipmentId === 'shipment-fsm-8008' && item.signal === null
        ),
      'Expected out-of-order provider signal to be rejected'
    );
    expect(providerEvents).toContainEqual(
      expect.objectContaining({
        type: 'PROVIDER_SIGNAL_REJECTED',
        shipmentId: 'shipment-fsm-8008',
        signal: 'PACKED_INTO_TRUCK',
      })
    );

    await client.actors.providerHq.send({
      type: 'LABEL_SCANNED',
      note: 'Label barcode matched shipment manifest.',
    });
    await waitForProviderSource(
      client.actors.providerHq,
      (context) =>
        context.status.queue.some(
          (item) => item.shipmentId === 'shipment-fsm-8008' && item.signal === 'LABEL_SCANNED'
        ),
      'Expected first valid provider signal to be accepted'
    );
  });

  it('keeps provider shipment FSM state isolated per queued shipment', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer({ lifecycleMode: 'manual' });
    await gatewayServer.start();
    workerNode = await startTestWorkerNode(requiredTransportUrl(gatewayServer));
    const client = createTestClient(requiredGatewayUrl(gatewayServer));
    const restUrl = requiredRestUrl(gatewayServer);

    for (const shipment of [
      {
        shipmentId: 'shipment-isolated-9001',
        destination: 'Chicago warehouse',
        reference: 'ISO-9001',
      },
      {
        shipmentId: 'shipment-isolated-9002',
        destination: 'Dallas cross-dock',
        reference: 'ISO-9002',
      },
    ]) {
      await fetch(`${restUrl}/shipments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(shipment),
      });
    }

    await waitForProviderSource(
      client.actors.providerHq,
      (context) =>
        context.status.queue.some((item) => item.shipmentId === 'shipment-isolated-9001') &&
        context.status.queue.some((item) => item.shipmentId === 'shipment-isolated-9002'),
      'Expected both shipments to be queued at Provider HQ'
    );

    await fetch(`${restUrl}/provider/signals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shipmentId: 'shipment-isolated-9001', signal: 'LABEL_SCANNED' }),
    });
    await waitForProviderSource(
      client.actors.providerHq,
      (context) =>
        context.status.queue.some(
          (item) => item.shipmentId === 'shipment-isolated-9001' && item.signal === 'LABEL_SCANNED'
        ),
      'Expected first shipment provider actor to accept label scan'
    );

    await fetch(`${restUrl}/provider/signals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shipmentId: 'shipment-isolated-9002', signal: 'PACKED_INTO_TRUCK' }),
    });
    await waitForProviderSource(
      client.actors.providerHq,
      (context) =>
        context.message.includes('PACKED_INTO_TRUCK rejected') &&
        context.status.queue.some(
          (item) => item.shipmentId === 'shipment-isolated-9002' && item.signal === null
        ),
      'Expected second shipment provider actor to reject pack before label'
    );

    await fetch(`${restUrl}/provider/signals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shipmentId: 'shipment-isolated-9001', signal: 'PACKED_INTO_TRUCK' }),
    });
    await waitForProviderSource(
      client.actors.providerHq,
      (context) =>
        context.status.queue.some(
          (item) =>
            item.shipmentId === 'shipment-isolated-9001' && item.signal === 'PACKED_INTO_TRUCK'
        ),
      'Expected first shipment provider actor to progress independently'
    );
  });

  it('exposes runtime status for REST and websocket boundary discovery', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer();
    await gatewayServer.start();

    const status = await fetch(`${requiredRestUrl(gatewayServer)}/runtime/status`).then((result) =>
      result.json()
    );

    expect(status).toMatchObject({
      provider: {
        runtimeEnabled: false,
        sourceLabel: 'simulator process',
      },
      transport: {
        idempotency: {
          windowSize: 1024,
          duplicateFramesDropped: 0,
          providerEnabled: false,
          providerClaimCount: 0,
          providerDuplicateCount: 0,
          providerErrorCount: 0,
        },
        workerPeer: {
          nodeAddress: 'logistics-worker-runtime',
          fresh: false,
          idempotency: {
            windowSize: 0,
            duplicateFramesDropped: 0,
            providerEnabled: false,
            providerClaimCount: 0,
            providerDuplicateCount: 0,
            providerErrorCount: 0,
          },
        },
        providerPeer: {
          nodeAddress: 'logistics-provider-runtime',
          fresh: false,
          idempotency: {
            windowSize: 0,
            duplicateFramesDropped: 0,
            providerEnabled: false,
            providerClaimCount: 0,
            providerDuplicateCount: 0,
            providerErrorCount: 0,
          },
        },
      },
      nodes: {
        serverRuntime: 'logistics-server-runtime',
        workerRuntime: 'logistics-worker-runtime',
        providerRuntime: 'logistics-provider-runtime',
      },
      actors: {
        shipment: 'actor://logistics-server-runtime/actor/logistics-shipment',
        routing: 'actor://logistics-worker-runtime/actor/logistics-routing',
        providerRuntime:
          'actor://logistics-provider-runtime/actor/logistics-provider-runtime-manager',
      },
    });

    expect(status.transport.peers).toEqual(expect.any(Array));
  });

  it('rejects missing or length-mismatched shared secrets for gateway and runtime auth', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer({
      runtimeAuthToken: 'runtime-secret',
      gatewayAuthToken: 'gateway-secret',
    });
    await gatewayServer.start();

    await expect(sendGatewayHello(requiredGatewayUrl(gatewayServer))).resolves.toMatchObject({
      type: 'error',
      code: 'unauthorized',
      message: 'Gateway authentication rejected.',
      recoverable: false,
    });
    await expect(
      sendGatewayHello(requiredGatewayUrl(gatewayServer), 'short')
    ).resolves.toMatchObject({
      type: 'error',
      code: 'unauthorized',
      message: 'Gateway authentication rejected.',
      recoverable: false,
    });

    await expect(
      startTestWorkerNode(requiredTransportUrl(gatewayServer), {
        authToken: 'short',
      })
    ).rejects.toThrow('Runtime handshake rejected: Shared runtime secret rejected.');
    const rejectedStatus = await waitForRuntimeStatus<RuntimeStatusTestShape>(
      requiredRestUrl(gatewayServer),
      (status) =>
        status.transport.workerConnected === false &&
        status.transport.workerPeer?.state === 'rejected' &&
        status.transport.workerPeer?.rejectedReason === 'Shared runtime secret rejected.',
      'Expected server runtime to reject a worker with a length-mismatched shared secret'
    );
    expect(rejectedStatus.transport.workerPeer?.fresh).toBe(false);

    workerNode = await startTestWorkerNode(requiredTransportUrl(gatewayServer), {
      authToken: 'runtime-secret',
    });
    const acceptedStatus = await waitForRuntimeStatus<RuntimeStatusTestShape>(
      requiredRestUrl(gatewayServer),
      (status) =>
        status.transport.workerConnected === true &&
        status.transport.workerPeer?.connected === true,
      'Expected server runtime to accept a worker with the correct shared secret'
    );
    expect(acceptedStatus.transport.workerPeer?.fresh).toBe(true);
  });

  it('validates shipment and provider HQ events by variant-specific required fields', () => {
    expect(
      isShipmentEvent({
        type: 'ROUTE_ASSIGNED',
        shipmentId: 'shipment-1001',
        carrier: 'Atlas Freight',
        eta: '72h',
      })
    ).toBe(true);
    expect(
      isShipmentEvent({
        type: 'ROUTE_ASSIGNED',
        shipmentId: 'shipment-1001',
        carrier: 'Atlas Freight',
      })
    ).toBe(false);
    expect(
      isShipmentEvent({
        type: 'PROVIDER_SIGNAL_RECORDED',
        shipmentId: 'shipment-1001',
        signal: 'LABEL_SCANNED',
        facility: 'Dock 4',
        loadId: 'load-44',
      })
    ).toBe(true);
    expect(
      isShipmentEvent({
        type: 'PROVIDER_SIGNAL_RECORDED',
        shipmentId: 'shipment-1001',
        signal: 'LABEL_SCANNED',
        loadId: 'load-44',
      })
    ).toBe(false);

    expect(
      isProviderHqEvent({
        type: 'PROVIDER_SOURCE_LABEL_CHANGED',
        sourceLabel: 'provider container',
      })
    ).toBe(true);
    expect(
      isProviderHqEvent({
        type: 'PROVIDER_SOURCE_LABEL_CHANGED',
        sourceLabel: 'unknown runtime',
      })
    ).toBe(false);
    expect(
      isProviderHqEvent({
        type: 'PROVIDER_SIGNAL_REJECTED',
        shipmentId: 'shipment-1001',
        signal: 'RETURN_EXCEPTION',
        expected: 'connected provider runtime',
        reason: 'Provider runtime boundary is enabled but unavailable.',
      })
    ).toBe(true);
    expect(
      isProviderHqEvent({
        type: 'PROVIDER_SIGNAL_REJECTED',
        shipmentId: 'shipment-1001',
        signal: 'RETURN_EXCEPTION',
        expected: 'connected provider runtime',
      })
    ).toBe(false);
  });

  function createTestClient(gatewayUrl: string) {
    const client = createActorWebClient(logistics, {
      gateway: { url: gatewayUrl },
      createSocket: (url) => new WebSocket(url) as never,
      clientVersion: 'ignite-headless-host-test',
    });
    closeClient = () => {
      client.close();
    };

    return client;
  }
});

describe('logistics runtime planning functions', () => {
  it('creates pure actor ids and provider sync commands without performing effects', () => {
    const shipment: ShipmentContext = {
      shipmentId: 'shipment/a b',
      destination: 'Chicago warehouse',
      reference: 'REF-1001',
      status: 'route-assigned',
      carrier: 'Northline Express',
      eta: '24h',
      routeNotes: 'Route through Chicago warehouse',
      providerFacility: null,
      providerSignal: null,
      providerLoadId: null,
      providerNote: null,
      shipmentCount: 1,
      timeline: [],
    };

    expect(
      logistics.actors.shipmentLifecycle.resolveAddress({ shipmentId: 'shipment/a b' })
    ).toMatchObject({
      id: 'logistics-shipment-shipment-a-b',
      path: 'actor://logistics-server-runtime/actor/logistics-shipment-shipment-a-b',
    });
    expect(shipmentLifecycleActorId({ shipmentId: 'shipment/a b' })).toBe(
      'logistics-shipment-shipment-a-b'
    );
    expect(createProviderSyncPlan(shipment)).toEqual({
      ensureProviderShipmentActor: true,
      providerHqCommand: {
        type: 'UPSERT_PROVIDER_SHIPMENT',
        shipment,
      },
    });
  });

  it('creates lifecycle and provider signal plans as plain values', () => {
    expect(
      createShipmentLifecyclePlan({
        mode: 'simulation',
        shipmentId: 'shipment-1001',
        delays: {
          labelMs: 1,
          packedMs: 2,
          shippedMs: 3,
          terminalMs: 4,
        },
        terminalSignal: 'DELIVERY_CONFIRMED',
      })
    ).toEqual([
      { delayMs: 1, signal: 'LABEL_SCANNED', shipmentId: 'shipment-1001' },
      { delayMs: 2, signal: 'PACKED_INTO_TRUCK', shipmentId: 'shipment-1001' },
      { delayMs: 3, signal: 'OUTBOUND_SCAN', shipmentId: 'shipment-1001' },
      { delayMs: 4, signal: 'DELIVERY_CONFIRMED', shipmentId: 'shipment-1001' },
    ]);

    expect(
      createShipmentLifecyclePlan({
        mode: 'manual',
        shipmentId: 'shipment-1001',
        delays: {
          labelMs: 1,
          packedMs: 2,
          shippedMs: 3,
          terminalMs: 4,
        },
        terminalSignal: 'RETURN_EXCEPTION',
      })
    ).toEqual([]);

    expect(
      createProviderSignalPlan({
        signal: 'OUTBOUND_SCAN',
        selectedShipmentId: 'shipment-1001',
        facility: 'DFW Fulfillment Hub',
      })
    ).toEqual({
      ok: true,
      shipmentId: 'shipment-1001',
      command: {
        type: 'OUTBOUND_SCAN',
        shipmentId: 'shipment-1001',
        facility: 'DFW Fulfillment Hub',
        loadId: undefined,
        note: undefined,
      },
    });
  });

  it('creates cross-actor orchestration commands as plain values', () => {
    const plan = {
      shipmentId: 'shipment-1001',
      carrier: 'Northline Express',
      eta: '24h',
      routeNotes: 'Route shipment-1001 through Chicago warehouse',
    };

    expect(
      createDispatchShipmentCommand({
        shipmentId: 'shipment-1001',
        destination: 'Chicago warehouse',
        reference: 'REF-1001',
      })
    ).toEqual({
      type: 'DISPATCH_SHIPMENT',
      shipmentId: 'shipment-1001',
      destination: 'Chicago warehouse',
      reference: 'REF-1001',
    });
    expect(
      createRoutePlanCommand({
        shipmentId: 'shipment-1001',
        destination: 'Chicago warehouse',
      })
    ).toEqual({
      type: 'PLAN_ROUTE',
      shipmentId: 'shipment-1001',
      destination: 'Chicago warehouse',
      reference: undefined,
    });
    expect(
      createDriverAssignmentCommand({
        shipmentId: 'shipment-1001',
        plan,
        destination: 'Chicago warehouse',
      })
    ).toEqual({
      type: 'ASSIGN_DRIVER',
      shipmentId: 'shipment-1001',
      carrier: 'Northline Express',
      destination: 'Chicago warehouse',
    });
    expect(createRouteAssignmentRecordCommand({ plan, driverId: 'driver-101' })).toEqual({
      type: 'RECORD_ROUTE_ASSIGNMENT',
      plan,
      driverId: 'driver-101',
    });
  });
});

describe('service worker transport lifecycle', () => {
  let restoreBrowserTransportEnv: (() => void) | undefined;

  afterEach(() => {
    restoreBrowserTransportEnv?.();
    restoreBrowserTransportEnv = undefined;
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('uses the observed activated worker for bind and shutdown', async () => {
    const candidateWorker = new FakeServiceWorkerHandle('installing');
    const fallbackActiveWorker = new FakeServiceWorkerHandle('activated');
    const registration: {
      active: ServiceWorker | null;
      installing: ServiceWorker | null;
      waiting: ServiceWorker | null;
    } = {
      active: null,
      installing: candidateWorker as unknown as ServiceWorker,
      waiting: null,
    };

    restoreBrowserTransportEnv = installBrowserTransportTestEnvironment(
      registration as unknown as ServiceWorkerRegistration
    );
    candidateWorker.postMessage.mockImplementation(
      (message: unknown, transfer?: Transferable[]) => {
        if ((message as { kind?: string }).kind === 'bind') {
          const bindPort = transfer?.[0] as unknown as FakeChannelPort | undefined;
          expect(bindPort?.counterpart?.started).toBe(true);
          bindPort?.postMessage({
            __actorWebServiceWorkerTransport: true,
            kind: 'bind-ack',
            source: logistics.nodes.serviceWorker.address,
          });
        }
      }
    );

    const { createBrowserServiceWorkerTransport } = await import('./browser-transport');
    const transport = createBrowserServiceWorkerTransport();

    const ready = transport.ready();
    await Promise.resolve();
    candidateWorker.setState('activated');
    registration.active = fallbackActiveWorker as unknown as ServiceWorker;
    await ready;
    transport.destroy();

    expect(candidateWorker.postMessage).toHaveBeenCalledTimes(2);
    expect(candidateWorker.postMessage.mock.calls[0]?.[0]).toMatchObject({ kind: 'bind' });
    expect(candidateWorker.postMessage.mock.calls[1]?.[0]).toMatchObject({ kind: 'shutdown' });
    expect(fallbackActiveWorker.postMessage).not.toHaveBeenCalled();
    expect(candidateWorker.listenerCount()).toBe(0);
  });

  it('buffers subscriptions before ready and honors unsubscribe-before-ready', async () => {
    const activeWorker = new FakeServiceWorkerHandle('activated');
    let boundPort: FakeChannelPort | undefined;
    const registration: {
      active: ServiceWorker | null;
      installing: ServiceWorker | null;
      waiting: ServiceWorker | null;
    } = {
      active: activeWorker as unknown as ServiceWorker,
      installing: null,
      waiting: null,
    };

    restoreBrowserTransportEnv = installBrowserTransportTestEnvironment(
      registration as unknown as ServiceWorkerRegistration
    );
    activeWorker.postMessage.mockImplementation((message: unknown, transfer?: Transferable[]) => {
      if ((message as { kind?: string }).kind !== 'bind') {
        return;
      }

      boundPort = transfer?.[0] as unknown as FakeChannelPort | undefined;
      boundPort?.postMessage({
        __actorWebServiceWorkerTransport: true,
        kind: 'bind-ack',
        source: logistics.nodes.serviceWorker.address,
      });
    });

    const { createBrowserServiceWorkerTransport } = await import('./browser-transport');
    const transport = createBrowserServiceWorkerTransport();
    const unsubscribedListener = vi.fn();
    const liveListener = vi.fn();

    const unsubscribeBeforeReady = transport.subscribe(unsubscribedListener);
    const unsubscribeAfterReady = transport.subscribe(liveListener);
    unsubscribeBeforeReady();

    await transport.ready();
    expect(boundPort).toBeDefined();

    boundPort?.postMessage({
      __actorWebMessagePortTransport: true,
      kind: 'frame',
      source: logistics.nodes.serviceWorker.address,
      destination: logistics.nodes.browser.address,
      message: {
        type: 'SERVICE_WORKER_TEST',
        _timestamp: Date.now(),
        _version: '1.0.0',
      },
    });

    expect(unsubscribedListener).not.toHaveBeenCalled();
    expect(liveListener).toHaveBeenCalledTimes(1);

    unsubscribeAfterReady();
    boundPort?.postMessage({
      __actorWebMessagePortTransport: true,
      kind: 'frame',
      source: logistics.nodes.serviceWorker.address,
      destination: logistics.nodes.browser.address,
      message: {
        type: 'SERVICE_WORKER_TEST_2',
        _timestamp: Date.now(),
        _version: '1.0.0',
      },
    });

    expect(liveListener).toHaveBeenCalledTimes(1);
  });

  it('rejects ready and suppresses late bind-ack when destroy wins the race', async () => {
    const activeWorker = new FakeServiceWorkerHandle('activated');
    let bindPort: FakeChannelPort | undefined;
    const registration: {
      active: ServiceWorker | null;
      installing: ServiceWorker | null;
      waiting: ServiceWorker | null;
    } = {
      active: activeWorker as unknown as ServiceWorker,
      installing: null,
      waiting: null,
    };

    restoreBrowserTransportEnv = installBrowserTransportTestEnvironment(
      registration as unknown as ServiceWorkerRegistration
    );
    activeWorker.postMessage.mockImplementation((message: unknown, transfer?: Transferable[]) => {
      if ((message as { kind?: string }).kind === 'bind') {
        bindPort = transfer?.[0] as unknown as FakeChannelPort | undefined;
      }
    });

    const { createBrowserServiceWorkerTransport } = await import('./browser-transport');
    const transport = createBrowserServiceWorkerTransport();
    const listener = vi.fn();

    transport.subscribe(listener);
    const ready = transport.ready();
    await waitFor(() => bindPort !== undefined, 'Expected bind message before destroy');
    transport.destroy();

    await expect(ready).rejects.toThrow('destroyed');
    bindPort?.postMessage({
      __actorWebServiceWorkerTransport: true,
      kind: 'bind-ack',
      source: logistics.nodes.serviceWorker.address,
    });
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
    expect(transport.getConnectedNodes()).toEqual([]);
    expect(
      activeWorker.postMessage.mock.calls.map(([payload]) => (payload as { kind: string }).kind)
    ).toEqual(['bind', 'shutdown']);
  });

  it('rebuilds the runtime node and transport on rebind and keeps shutdown idempotent', async () => {
    const createdTransports = [createMockMessagePortTransport(), createMockMessagePortTransport()];
    const createMessagePortTransportMock = vi
      .fn()
      .mockImplementationOnce(() => createdTransports[0])
      .mockImplementationOnce(() => createdTransports[1]);
    const firstNodeStop = vi.fn(async () => {});
    const secondNodeStop = vi.fn(async () => {});
    const firstStartup = createDeferred<{ stop(): Promise<void> }>();
    const secondStartup = createDeferred<{ stop(): Promise<void> }>();
    const startActorWebNodeMock = vi
      .fn()
      .mockImplementationOnce(() => firstStartup.promise)
      .mockImplementationOnce(() => secondStartup.promise);
    const serviceWorkerGlobal = createFakeServiceWorkerGlobalScope();

    vi.doMock('@actor-core/runtime/browser', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@actor-core/runtime/browser')>();
      return {
        ...actual,
        createMessagePortTransport: createMessagePortTransportMock,
        startActorWebNode: startActorWebNodeMock,
      };
    });
    vi.stubGlobal('self', serviceWorkerGlobal);

    const { startLogisticsServiceWorkerRuntime } = await import('./worker-runtime');
    startLogisticsServiceWorkerRuntime();

    const handleMessage = serviceWorkerGlobal.messageHandler();
    const firstPort = { postMessage: vi.fn() };
    const secondPort = { postMessage: vi.fn() };
    const firstMessagePort = firstPort as unknown as MessagePort;
    const secondMessagePort = secondPort as unknown as MessagePort;

    const firstBind = dispatchServiceWorkerMessage(
      handleMessage,
      {
        __actorWebServiceWorkerTransport: true,
        kind: 'bind',
        source: logistics.nodes.browser.address,
      },
      [firstMessagePort]
    );
    expect(firstPort.postMessage).not.toHaveBeenCalled();
    firstStartup.resolve({ stop: firstNodeStop });
    await firstBind;
    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'bind-ack' })
    );

    const secondBind = dispatchServiceWorkerMessage(
      handleMessage,
      {
        __actorWebServiceWorkerTransport: true,
        kind: 'bind',
        source: logistics.nodes.browser.address,
      },
      [secondMessagePort]
    );
    expect(firstNodeStop).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(createdTransports[0].destroy).toHaveBeenCalledTimes(1);
    expect(secondPort.postMessage).not.toHaveBeenCalled();
    secondStartup.resolve({ stop: secondNodeStop });
    await secondBind;
    expect(startActorWebNodeMock).toHaveBeenCalledTimes(2);
    expect(createMessagePortTransportMock).toHaveBeenCalledTimes(2);
    expect(secondPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'bind-ack' })
    );

    await dispatchServiceWorkerMessage(handleMessage, {
      __actorWebServiceWorkerTransport: true,
      kind: 'shutdown',
      source: logistics.nodes.browser.address,
    });
    await dispatchServiceWorkerMessage(handleMessage, {
      __actorWebServiceWorkerTransport: true,
      kind: 'shutdown',
      source: logistics.nodes.browser.address,
    });

    expect(secondNodeStop).toHaveBeenCalledTimes(1);
    expect(createdTransports[1].destroy).toHaveBeenCalledTimes(1);
  });

  it('suppresses bind-ack and cleans up when shutdown wins during pending startup', async () => {
    const transport = createMockMessagePortTransport();
    const createMessagePortTransportMock = vi.fn(() => transport);
    const startup = createDeferred<{ stop(): Promise<void> }>();
    const startedNodeStop = vi.fn(async () => {});
    const startActorWebNodeMock = vi.fn(() => startup.promise);
    const serviceWorkerGlobal = createFakeServiceWorkerGlobalScope();

    vi.doMock('@actor-core/runtime/browser', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@actor-core/runtime/browser')>();
      return {
        ...actual,
        createMessagePortTransport: createMessagePortTransportMock,
        startActorWebNode: startActorWebNodeMock,
      };
    });
    vi.stubGlobal('self', serviceWorkerGlobal);

    const { startLogisticsServiceWorkerRuntime } = await import('./worker-runtime');
    startLogisticsServiceWorkerRuntime();

    const handleMessage = serviceWorkerGlobal.messageHandler();
    const firstPort = { postMessage: vi.fn() };
    const firstMessagePort = firstPort as unknown as MessagePort;

    const pendingBind = dispatchServiceWorkerMessage(
      handleMessage,
      {
        __actorWebServiceWorkerTransport: true,
        kind: 'bind',
        source: logistics.nodes.browser.address,
      },
      [firstMessagePort]
    );

    await waitFor(
      () => startActorWebNodeMock.mock.calls.length === 1,
      'Expected service worker startup to begin before shutdown'
    );
    await dispatchServiceWorkerMessage(handleMessage, {
      __actorWebServiceWorkerTransport: true,
      kind: 'shutdown',
      source: logistics.nodes.browser.address,
    });

    expect(transport.destroy).toHaveBeenCalledTimes(1);
    expect(firstPort.postMessage).not.toHaveBeenCalled();

    startup.resolve({ stop: startedNodeStop });
    await pendingBind;

    expect(firstPort.postMessage).not.toHaveBeenCalled();
    expect(startedNodeStop).toHaveBeenCalledTimes(1);
    expect(transport.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed transport envelopes', async () => {
    const { isServiceWorkerTransportEnvelope } = await import(
      './service-worker-transport-protocol'
    );

    expect(
      isServiceWorkerTransportEnvelope({
        __actorWebServiceWorkerTransport: true,
        kind: 'bind',
      })
    ).toBe(false);
    expect(
      isServiceWorkerTransportEnvelope({
        __actorWebServiceWorkerTransport: true,
        kind: 'unexpected',
        source: logistics.nodes.browser.address,
      })
    ).toBe(false);
    expect(
      isServiceWorkerTransportEnvelope({
        __actorWebServiceWorkerTransport: true,
        kind: 'shutdown',
        source: logistics.nodes.browser.address,
      })
    ).toBe(true);
  });
});

async function startTestWorkerNode(
  transportUrl: string,
  options: { readonly authToken?: string } = {}
): Promise<StartedActorWebNode<typeof logistics>> {
  return startActorWebNode(logistics, {
    node: 'worker',
    peers: {
      server: transportUrl,
    },
    transport: {
      ...(options.authToken ? { auth: { token: options.authToken } } : {}),
      incarnation: `test-worker-${Date.now()}`,
      heartbeatIntervalMs: 0,
      webSocketFactory: (url) => new WebSocket(url) as never,
    },
  });
}

async function startTestProviderNode(
  transportUrl: string,
  options: { readonly authToken?: string } = {}
): Promise<StartedActorWebNode<typeof logistics>> {
  return startActorWebNode(logistics, {
    node: 'provider',
    peers: {
      server: transportUrl,
    },
    transport: {
      ...(options.authToken ? { auth: { token: options.authToken } } : {}),
      incarnation: `test-provider-${Date.now()}`,
      heartbeatIntervalMs: 0,
      webSocketFactory: (url) => new WebSocket(url) as never,
    },
  });
}

function requiredGatewayUrl(server: LogisticsRuntimeGatewayServer): string {
  const gatewayUrl = server.getGatewayUrl();
  if (!gatewayUrl) {
    throw new Error('Expected logistics gateway URL');
  }

  return gatewayUrl;
}

function requiredTransportUrl(server: LogisticsRuntimeGatewayServer): string {
  const transportUrl = server.getTransportUrl();
  if (!transportUrl) {
    throw new Error('Expected logistics transport URL');
  }

  return transportUrl;
}

function requiredRestUrl(server: LogisticsRuntimeGatewayServer): string {
  const restUrl = server.getRestUrl();
  if (!restUrl) {
    throw new Error('Expected logistics REST URL');
  }

  return restUrl;
}

async function waitForSource(
  source: ShipmentSource,
  predicate: (context: ShipmentContext) => boolean,
  message = 'Expected source predicate to pass'
): Promise<void> {
  await waitFor(
    () => {
      const context = source.snapshot().context;
      return Boolean(context && predicate(context));
    },
    () => `${message}: ${JSON.stringify(source.snapshot().context)}`
  );
}

async function waitForProviderSource(
  source: ProviderHqSource,
  predicate: (context: ProviderHqContext) => boolean,
  message = 'Expected provider source predicate to pass'
): Promise<void> {
  await waitFor(
    () => {
      const context = source.snapshot().context;
      return Boolean(context && predicate(context));
    },
    () => `${message}: ${JSON.stringify(source.snapshot().context)}`
  );
}

async function waitForRuntimeStatus<TStatus>(
  restUrl: string,
  predicate: (status: TStatus) => boolean,
  message: string
): Promise<TStatus> {
  let lastStatus: TStatus | undefined;
  await waitFor(
    async () => {
      lastStatus = (await fetch(`${restUrl}/runtime/status`).then((result) =>
        result.json()
      )) as TStatus;
      return predicate(lastStatus);
    },
    () => `${message}: ${JSON.stringify(lastStatus)}`
  );

  if (lastStatus === undefined) {
    throw new Error(`Expected runtime status from ${restUrl}`);
  }

  return lastStatus;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string | (() => string)
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error(typeof message === 'function' ? message() : message);
}

async function sendGatewayHello(
  gatewayUrl: string,
  authToken?: string
): Promise<Record<string, unknown>> {
  const socket = new WebSocket(gatewayUrl);

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });

    const framePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.once('message', (data) => {
        try {
          resolve(JSON.parse(String(data)) as Record<string, unknown>);
        } catch (error) {
          reject(error);
        }
      });
      socket.once('error', reject);
    });

    socket.send(
      JSON.stringify({
        type: 'hello',
        clientVersion: 'ignite-headless-host-test',
        ...(authToken ? { auth: { scheme: 'token', token: authToken } } : {}),
      })
    );

    return await framePromise;
  } finally {
    socket.close();
  }
}

class FakeChannelPort {
  counterpart: FakeChannelPort | null = null;
  started = false;
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

  postMessage(message: unknown): void {
    this.counterpart?.dispatch(message);
  }

  start(): void {
    this.started = true;
  }

  close(): void {}

  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    if (type === 'message') {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    if (type === 'message') {
      this.listeners.delete(listener);
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  private dispatch(message: unknown): void {
    for (const listener of this.listeners) {
      listener({ data: message } as MessageEvent<unknown>);
    }
  }
}

class FakeServiceWorkerHandle {
  readonly postMessage = vi.fn<(message: unknown, transfer?: Transferable[]) => void>();
  private readonly listeners = new Set<() => void>();

  constructor(public state: ServiceWorkerState) {}

  addEventListener(type: 'statechange', listener: () => void): void {
    if (type === 'statechange') {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: 'statechange', listener: () => void): void {
    if (type === 'statechange') {
      this.listeners.delete(listener);
    }
  }

  setState(state: ServiceWorkerState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener();
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

function installBrowserTransportTestEnvironment(
  registration: ServiceWorkerRegistration
): () => void {
  const originalMessageChannel = globalThis.MessageChannel;
  const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

  Object.defineProperty(globalThis, 'MessageChannel', {
    configurable: true,
    value: class TestMessageChannel {
      port1: FakeChannelPort;
      port2: FakeChannelPort;

      constructor() {
        this.port1 = new FakeChannelPort();
        this.port2 = new FakeChannelPort();
        this.port1.counterpart = this.port2;
        this.port2.counterpart = this.port1;
      }
    },
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: vi.fn(async () => registration),
    },
  });

  return () => {
    if (originalMessageChannel) {
      Object.defineProperty(globalThis, 'MessageChannel', {
        configurable: true,
        value: originalMessageChannel,
      });
    } else {
      Reflect.deleteProperty(globalThis, 'MessageChannel');
    }

    if (originalServiceWorker) {
      Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
    } else {
      Reflect.deleteProperty(navigator, 'serviceWorker');
    }
  };
}

function createMockMessagePortTransport() {
  return {
    connect: vi.fn(async () => {}),
    destroy: vi.fn(() => {}),
    disconnect: vi.fn(async () => {}),
    getConnectedNodes: vi.fn(() => []),
    isConnected: vi.fn(() => false),
    send: vi.fn(async () => {}),
    subscribe: vi.fn(() => () => {}),
  };
}

function createFakeServiceWorkerGlobalScope() {
  let handler: ((event: ExtendableMessageEvent) => void) | undefined;

  return {
    addEventListener: vi.fn((type: string, listener: (event: ExtendableMessageEvent) => void) => {
      if (type === 'message') {
        handler = listener;
      }
    }),
    messageHandler(): (event: ExtendableMessageEvent) => void {
      if (!handler) {
        throw new Error('Expected message handler to be registered.');
      }

      return handler;
    },
  };
}

async function dispatchServiceWorkerMessage(
  handler: (event: ExtendableMessageEvent) => void,
  data: unknown,
  ports: MessagePort[] = []
): Promise<void> {
  let pending: Promise<unknown> | undefined;

  handler({
    data,
    ports,
    waitUntil(value: Promise<unknown>) {
      pending = Promise.resolve(value);
    },
  } as unknown as ExtendableMessageEvent);

  await pending;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}
