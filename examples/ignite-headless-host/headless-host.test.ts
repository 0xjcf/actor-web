import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  createLogisticsHost,
  createLogisticsHostFromSource,
  type LogisticsHost,
} from './headless-host';
import { logistics } from './logistics-topology';
import {
  createLogisticsRuntimeHarness,
  createLogisticsTopologySources,
  createServerWorkerDemoRuntimeHarness,
} from './runtime-harness';
import { createLogisticsServerGatewayRuntimeHarness } from './server-gateway-client';
import {
  createLogisticsRuntimeGatewayServer,
  type LogisticsRuntimeGatewayServer,
} from './server-runtime-gateway';

describe('ignite-headless-host logistics example', () => {
  let host: LogisticsHost | undefined;
  let workerHost: LogisticsHost | undefined;
  let gatewayServer: LogisticsRuntimeGatewayServer | undefined;

  afterEach(async () => {
    if (workerHost) {
      await workerHost.destroy();
      workerHost = undefined;
    }
    if (host) {
      await host.destroy();
      host = undefined;
    }
    if (gatewayServer) {
      await gatewayServer.stop();
      gatewayServer = undefined;
    }
  });

  it('exposes topology-owned actors for the shipment source', async () => {
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
      children: ['shipment'],
    });

    const sourceHandle = createLogisticsTopologySources();
    host = createLogisticsHostFromSource(sourceHandle.source, {
      destroy: sourceHandle.destroy,
    });

    await host.createShipment({
      shipmentId: 'shipment-topology-source',
      destination: 'Topology depot',
    });

    expect(host.getState()).toMatchObject({
      shipmentId: 'shipment-topology-source',
      destination: 'Topology depot',
      transportState: 'connected',
    });
  });

  it('projects shipment snapshots and emitted events through the public bridge', async () => {
    host = createLogisticsHost();
    const observedStatuses: string[] = [];
    const unsubscribe = host.subscribe((state) => {
      observedStatuses.push(state.status);
    });

    await host.createShipment({
      shipmentId: 'shipment-1001',
      destination: 'Chicago warehouse',
      reference: 'REF-1001',
    });

    expect(host.getState()).toMatchObject({
      status: 'route-requested',
      shipmentId: 'shipment-1001',
      destination: 'Chicago warehouse',
      reference: 'REF-1001',
      shipmentCount: 1,
      transportState: 'connected',
      transportReason: null,
    });
    expect(host.getState().eventLog.map((event) => event.type)).toEqual([
      'ROUTE_REQUESTED',
      'SHIPMENT_CREATED',
    ]);

    await host.reset();

    expect(host.getState()).toMatchObject({
      status: 'idle',
      shipmentId: null,
      destination: null,
      shipmentCount: 1,
      transportState: 'connected',
      transportReason: null,
    });

    unsubscribe();
    expect(observedStatuses[0]).toBe('idle');
    expect(observedStatuses).toContain('route-requested');
    expect(observedStatuses[observedStatuses.length - 1]).toBe('idle');
  });

  it('can consume a separately owned runtime harness through the same host bridge', async () => {
    const runtimeHarness = createLogisticsRuntimeHarness();
    host = createLogisticsHostFromSource(runtimeHarness.source, {
      destroy: runtimeHarness.destroy,
    });

    await host.createShipment({
      shipmentId: 'shipment-2002',
      destination: 'Dallas cross-dock',
    });

    expect(host.getState()).toMatchObject({
      status: 'route-requested',
      shipmentId: 'shipment-2002',
      destination: 'Dallas cross-dock',
      shipmentCount: 1,
      transportState: 'connected',
      transportReason: null,
    });
  });

  it('can consume a server-owned runtime through the runtime gateway source', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer();
    await gatewayServer.start();
    const gatewayUrl = gatewayServer.getGatewayUrl();
    if (!gatewayUrl) {
      throw new Error('Expected logistics gateway URL');
    }

    const runtimeHarness = createLogisticsServerGatewayRuntimeHarness({
      url: gatewayUrl,
      createSocket: (url) => new WebSocket(url) as never,
    });
    host = createLogisticsHostFromSource(runtimeHarness.source, {
      destroy: runtimeHarness.destroy,
    });

    await host.createShipment({
      shipmentId: 'shipment-gateway-3003',
      destination: 'Seattle depot',
    });
    await waitForHostState(
      host,
      (state) => state.shipmentId === 'shipment-gateway-3003',
      'Expected gateway shipment projection'
    );
    expect(host.getState()).toMatchObject({
      status: 'route-requested',
      shipmentId: 'shipment-gateway-3003',
      destination: 'Seattle depot',
      transportState: 'connected',
      transportReason: null,
    });
  });

  it('accepts REST shipment ingress and streams live gateway updates', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer();
    await gatewayServer.start();
    const gatewayUrl = gatewayServer.getGatewayUrl();
    const restUrl = gatewayServer.getRestUrl();
    if (!gatewayUrl || !restUrl) {
      throw new Error('Expected logistics gateway and REST URLs');
    }

    const runtimeHarness = createLogisticsServerGatewayRuntimeHarness({
      url: gatewayUrl,
      createSocket: (url) => new WebSocket(url) as never,
    });
    host = createLogisticsHostFromSource(runtimeHarness.source, {
      destroy: runtimeHarness.destroy,
    });
    await waitForHostState(
      host,
      (state) => state.transportState === 'connected',
      'Expected gateway source to connect before REST shipment ingress'
    );

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

    await waitForHostState(
      host,
      (state) => state.shipmentId === 'shipment-rest-4004',
      'Expected REST shipment to stream through gateway'
    );
    expect(host.getState()).toMatchObject({
      shipmentId: 'shipment-rest-4004',
      destination: 'Portland terminal',
      reference: 'REST-4004',
      status: 'route-requested',
    });

    await expect(
      fetch(`${restUrl}/shipments/count`).then((result) => result.json())
    ).resolves.toEqual({
      count: 1,
    });
  });

  it('routes REST-created shipments through the worker runtime over real WebSocket transport', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer({
      lifecycleLabelDelayMs: 10,
      lifecyclePackedDelayMs: 20,
      lifecycleShippedDelayMs: 25,
      lifecycleTerminalDelayMs: 70,
    });
    await gatewayServer.start();
    const gatewayUrl = gatewayServer.getGatewayUrl();
    const transportUrl = gatewayServer.getTransportUrl();
    const restUrl = gatewayServer.getRestUrl();
    if (!gatewayUrl || !transportUrl || !restUrl) {
      throw new Error('Expected logistics gateway, transport, and REST URLs');
    }

    const runtimeHarness = createServerWorkerDemoRuntimeHarness({
      gatewayUrl,
      transportUrl,
      createGatewaySocket: (url) => new WebSocket(url) as never,
      createWorkerSocket: (url) => new WebSocket(url) as never,
    });
    expect(runtimeHarness.routingSource?.address.path).toBe(
      'actor://logistics-worker-runtime/actor/logistics-routing'
    );
    host = createLogisticsHostFromSource(runtimeHarness.source, {
      destroy: runtimeHarness.destroy,
    });
    await waitForHostState(
      host,
      (state) => state.transportState === 'connected',
      'Expected gateway source to connect before worker-backed REST shipment ingress'
    );
    workerHost = await createWorkerGatewayHost(gatewayUrl);
    expect(workerHost.address).toBe('actor://logistics-worker-runtime/actor/logistics-routing');

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

    await waitForHostState(
      host,
      (state) => state.status === 'route-assigned' && state.carrier === 'Atlas Freight',
      'Expected worker route plan to update server shipment actor'
    );
    expect(host.getState()).toMatchObject({
      shipmentId: 'shipment-worker-5005',
      destination: 'International hub',
      carrier: 'Atlas Freight',
      eta: '72h',
      routeNotes: 'Route shipment-worker-5005 through International hub',
    });
    await waitFor(
      () => runtimeHarness.routingSource?.snapshot().context.shipmentId === 'shipment-worker-5005',
      'Expected worker routing source to project the worker-owned actor'
    );
    expect(runtimeHarness.routingSource?.snapshot().context).toMatchObject({
      shipmentId: 'shipment-worker-5005',
      carrier: 'Atlas Freight',
      eta: '72h',
    });

    await waitForHostState(
      host,
      (state) =>
        state.status === 'delivered' &&
        state.eventLog.some((event) => event.type === 'SHIPMENT_IN_TRANSIT') &&
        state.eventLog.some((event) => event.type === 'SHIPMENT_DELIVERED'),
      'Expected server-owned lifecycle updates to stream through gateway'
    );
    expect(host.getState().timeline.map((entry) => entry.label)).toEqual(
      expect.arrayContaining([
        'Delivered',
        'Shipped',
        'Packed into truck',
        'Provider label scan',
        'Route assigned',
        'Shipment accepted',
      ])
    );
    expect(host.getState()).toMatchObject({
      providerSignal: 'DELIVERY_CONFIRMED',
      providerFacility: expect.any(String),
      providerLoadId: expect.stringMatching(/^LOAD-/),
    });
    await expect(
      fetch(`${restUrl}/provider/status`).then((result) => result.json())
    ).resolves.toMatchObject({
      shipmentId: 'shipment-worker-5005',
      status: 'delivered',
      signal: 'DELIVERY_CONFIRMED',
      queue: [
        expect.objectContaining({
          shipmentId: 'shipment-worker-5005',
          status: 'delivered',
          signal: 'DELIVERY_CONFIRMED',
        }),
      ],
    });
  });

  it('supports manual provider HQ signals over REST while streaming gateway updates', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer({ lifecycleMode: 'manual' });
    await gatewayServer.start();
    const gatewayUrl = gatewayServer.getGatewayUrl();
    const transportUrl = gatewayServer.getTransportUrl();
    const restUrl = gatewayServer.getRestUrl();
    if (!gatewayUrl || !transportUrl || !restUrl) {
      throw new Error('Expected logistics gateway, transport, and REST URLs');
    }

    const runtimeHarness = createServerWorkerDemoRuntimeHarness({
      gatewayUrl,
      transportUrl,
      createGatewaySocket: (url) => new WebSocket(url) as never,
      createWorkerSocket: (url) => new WebSocket(url) as never,
    });
    host = createLogisticsHostFromSource(runtimeHarness.source, {
      destroy: runtimeHarness.destroy,
    });
    await waitForHostState(
      host,
      (state) => state.transportState === 'connected',
      'Expected gateway source to connect before manual provider signal test'
    );
    workerHost = await createWorkerGatewayHost(gatewayUrl);

    await fetch(`${restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-manual-6006',
        destination: 'Chicago warehouse',
        reference: 'MANUAL-6006',
      }),
    });
    await waitForHostState(
      host,
      (state) => state.status === 'route-assigned',
      'Expected manual mode shipment to stop after route assignment'
    );

    await expect(
      fetch(`${restUrl}/provider/status`).then((result) => result.json())
    ).resolves.toMatchObject({
      mode: 'manual',
      shipmentId: 'shipment-manual-6006',
      signal: null,
      queue: [
        expect.objectContaining({
          shipmentId: 'shipment-manual-6006',
          destination: 'Chicago warehouse',
          status: 'route-assigned',
        }),
      ],
    });

    const modeResponse = await fetch(`${restUrl}/provider/mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'manual' }),
    });
    expect(modeResponse.status).toBe(202);
    await expect(modeResponse.json()).resolves.toMatchObject({
      mode: 'manual',
      queue: [expect.objectContaining({ shipmentId: 'shipment-manual-6006' })],
    });

    const providerResponse = await fetch(`${restUrl}/provider/signals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shipmentId: 'shipment-manual-6006', signal: 'OUTBOUND_SCAN' }),
    });
    expect(providerResponse.status).toBe(202);
    await expect(providerResponse.json()).resolves.toMatchObject({
      shipmentId: 'shipment-manual-6006',
      status: 'in-transit',
      signal: 'OUTBOUND_SCAN',
      queue: [
        expect.objectContaining({
          shipmentId: 'shipment-manual-6006',
          signal: 'OUTBOUND_SCAN',
        }),
      ],
    });

    await waitForHostState(
      host,
      (state) =>
        state.status === 'in-transit' &&
        state.providerSignal === 'OUTBOUND_SCAN' &&
        state.eventLog.some((event) => event.type === 'PROVIDER_SIGNAL_RECORDED'),
      'Expected provider HQ signal to stream through gateway'
    );

    await fetch(`${restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-manual-7007',
        destination: 'Dallas cross-dock',
        reference: 'MANUAL-7007',
      }),
    });
    await waitForHostState(
      host,
      (state) => state.shipmentId === 'shipment-manual-7007' && state.status === 'route-assigned',
      'Expected newer manual mode shipment to become the live projection'
    );

    const deliveryResponse = await fetch(`${restUrl}/provider/signals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shipmentId: 'shipment-manual-6006', signal: 'DELIVERY_CONFIRMED' }),
    });
    expect(deliveryResponse.status).toBe(202);
    await expect(deliveryResponse.json()).resolves.toMatchObject({
      queue: expect.arrayContaining([
        expect.objectContaining({ shipmentId: 'shipment-manual-7007' }),
        expect.objectContaining({
          shipmentId: 'shipment-manual-6006',
          signal: 'DELIVERY_CONFIRMED',
          status: 'delivered',
        }),
      ]),
    });

    await waitForHostState(
      host,
      (state) =>
        state.shipmentId === 'shipment-manual-6006' &&
        state.destination === 'Chicago warehouse' &&
        state.status === 'delivered' &&
        state.eventLog.some(
          (event) =>
            event.type === 'SHIPMENT_DELIVERED' && event.shipmentId === 'shipment-manual-6006'
        ),
      'Expected selected older provider shipment to complete after a newer order arrived'
    );
  });

  it('exposes runtime status for REST and websocket boundary discovery', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer();
    await gatewayServer.start();
    const restUrl = gatewayServer.getRestUrl();
    if (!restUrl) {
      throw new Error('Expected logistics REST URL');
    }

    await expect(
      fetch(`${restUrl}/runtime/status`).then((result) => result.json())
    ).resolves.toMatchObject({
      nodes: {
        serverRuntime: 'logistics-server-runtime',
        workerRuntime: 'logistics-worker-runtime',
      },
      actors: {
        shipment: 'actor://logistics-server-runtime/actor/logistics-shipment',
        routing: 'actor://logistics-worker-runtime/actor/logistics-routing',
      },
    });
  });
});

async function waitForHostState(
  target: LogisticsHost,
  predicate: (state: ReturnType<LogisticsHost['getState']>) => boolean,
  message: string
): Promise<void> {
  await waitFor(
    () => predicate(target.getState()),
    () => `${message}: ${JSON.stringify(target.getState())}`
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

async function createWorkerGatewayHost(gatewayUrl: string): Promise<LogisticsHost> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const runtimeHarness = createLogisticsServerGatewayRuntimeHarness({
      url: gatewayUrl,
      streamId: `routing-${attempt}`,
      scope: { kind: 'logistics-routing' },
      createSocket: (url) => new WebSocket(url) as never,
    });
    const candidate = createLogisticsHostFromSource(runtimeHarness.source, {
      destroy: runtimeHarness.destroy,
    });

    try {
      await candidate.reset();
      return candidate;
    } catch (error) {
      lastError = error;
      await candidate.destroy();
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
