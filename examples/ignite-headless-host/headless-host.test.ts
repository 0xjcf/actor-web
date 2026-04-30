import {
  type ClosableActorWebSource,
  createActorWebClient,
  type StartedActorWebNode,
  startActorWebNode,
} from '@actor-core/runtime/browser';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type {
  ProviderHqCommand,
  ProviderHqContext,
  ProviderHqEvent,
  ShipmentCommand,
  ShipmentContext,
  ShipmentEvent,
} from './logistics-contract';
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

    await expect(
      fetch(`${requiredRestUrl(gatewayServer)}/runtime/status`).then((result) => result.json())
    ).resolves.toMatchObject({
      provider: {
        runtimeEnabled: false,
        sourceLabel: 'simulator process',
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

async function startTestWorkerNode(
  transportUrl: string
): Promise<StartedActorWebNode<typeof logistics>> {
  return startActorWebNode(logistics, {
    node: 'worker',
    peers: {
      server: transportUrl,
    },
    transport: {
      incarnation: `test-worker-${Date.now()}`,
      heartbeatIntervalMs: 0,
      webSocketFactory: (url) => new WebSocket(url) as never,
    },
  });
}

async function startTestProviderNode(
  transportUrl: string
): Promise<StartedActorWebNode<typeof logistics>> {
  return startActorWebNode(logistics, {
    node: 'provider',
    peers: {
      server: transportUrl,
    },
    transport: {
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

async function waitFor(predicate: () => boolean, message: string | (() => string)): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error(typeof message === 'function' ? message() : message);
}
