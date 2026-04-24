import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  createHeadlessCheckoutHost,
  createHeadlessCheckoutHostFromSource,
  type HeadlessCheckoutHost,
} from './headless-host';
import {
  createCheckoutRuntimeHarness,
  createServerWorkerDemoRuntimeHarness,
} from './runtime-harness';
import { createCheckoutServerGatewayRuntimeHarness } from './server-gateway-client';
import {
  type CheckoutRuntimeGatewayServer,
  createCheckoutRuntimeGatewayServer,
} from './server-runtime-gateway';

describe('ignite-headless-host example', () => {
  let host: HeadlessCheckoutHost | undefined;
  let workerHost: HeadlessCheckoutHost | undefined;
  let gatewayServer: CheckoutRuntimeGatewayServer | undefined;

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

  it('projects snapshots and emitted events through the public bridge', async () => {
    host = createHeadlessCheckoutHost();
    const observedPhases: string[] = [];
    const unsubscribe = host.subscribe((state) => {
      observedPhases.push(state.phase);
    });

    await host.submit('order-1001');

    expect(host.getState()).toEqual({
      phase: 'submitted',
      submittedOrders: ['order-1001'],
      lastSubmittedOrderId: 'order-1001',
      eventLog: [
        {
          type: 'CHECKOUT_SUBMITTED',
          orderId: 'order-1001',
          actorId: 'ignite-headless-host',
        },
      ],
      transportState: 'connected',
      transportReason: null,
    });

    await host.reset();

    expect(host.getState()).toEqual({
      phase: 'ready',
      submittedOrders: [],
      lastSubmittedOrderId: null,
      eventLog: [
        {
          type: 'CHECKOUT_RESET',
          orderId: null,
          actorId: 'ignite-headless-host',
        },
        {
          type: 'CHECKOUT_SUBMITTED',
          orderId: 'order-1001',
          actorId: 'ignite-headless-host',
        },
      ],
      transportState: 'connected',
      transportReason: null,
    });

    unsubscribe();
    expect(observedPhases[0]).toBe('ready');
    expect(observedPhases).toContain('submitted');
    expect(observedPhases[observedPhases.length - 1]).toBe('ready');
  });

  it('can consume a separately owned runtime harness through the same host bridge', async () => {
    const runtimeHarness = createCheckoutRuntimeHarness();
    host = createHeadlessCheckoutHostFromSource(runtimeHarness.source, {
      destroy: runtimeHarness.destroy,
    });

    await host.submit('order-2002');

    expect(host.getState()).toEqual({
      phase: 'submitted',
      submittedOrders: ['order-2002'],
      lastSubmittedOrderId: 'order-2002',
      eventLog: [
        {
          type: 'CHECKOUT_SUBMITTED',
          orderId: 'order-2002',
          actorId: 'ignite-headless-host',
        },
      ],
      transportState: 'connected',
      transportReason: null,
    });
  });

  it('can consume a server-owned runtime through the runtime gateway source', async () => {
    gatewayServer = createCheckoutRuntimeGatewayServer();
    await gatewayServer.start();
    const gatewayUrl = gatewayServer.getGatewayUrl();
    if (!gatewayUrl) {
      throw new Error('Expected checkout gateway URL');
    }

    const runtimeHarness = createCheckoutServerGatewayRuntimeHarness({
      url: gatewayUrl,
      createSocket: (url) => new WebSocket(url) as never,
    });
    host = createHeadlessCheckoutHostFromSource(runtimeHarness.source, {
      destroy: runtimeHarness.destroy,
    });

    await host.submit('order-server-3003');
    expect(host.getState()).toMatchObject({
      phase: 'submitted',
      submittedOrders: ['order-server-3003'],
      lastSubmittedOrderId: 'order-server-3003',
      transportState: 'connected',
      transportReason: null,
    });

    await host.reset();
    expect(host.getState()).toMatchObject({
      phase: 'ready',
      submittedOrders: [],
      lastSubmittedOrderId: null,
      transportState: 'connected',
      transportReason: null,
    });
  });

  it('can demo a server runtime and worker runtime over real WebSocket transport through the gateway', async () => {
    gatewayServer = createCheckoutRuntimeGatewayServer();
    await gatewayServer.start();
    const gatewayUrl = gatewayServer.getGatewayUrl();
    const transportUrl = gatewayServer.getTransportUrl();
    if (!gatewayUrl || !transportUrl) {
      throw new Error('Expected checkout gateway and transport URLs');
    }

    const runtimeHarness = createServerWorkerDemoRuntimeHarness({
      gatewayUrl,
      transportUrl,
      createGatewaySocket: (url) => new WebSocket(url) as never,
      createWorkerSocket: (url) => new WebSocket(url) as never,
    });
    host = createHeadlessCheckoutHostFromSource(runtimeHarness.source, {
      destroy: runtimeHarness.destroy,
    });

    await host.submit('order-server-runtime');
    await waitForHostState(
      host,
      (state) => state.submittedOrders.includes('order-server-runtime'),
      'Expected server runtime checkout submission'
    );
    expect(host.getState()).toMatchObject({
      phase: 'submitted',
      submittedOrders: ['order-server-runtime'],
      transportState: 'connected',
    });

    workerHost = await createWorkerGatewayHost(gatewayUrl);
    await workerHost.submit('order-worker-runtime');
    await waitForHostState(
      workerHost,
      (state) => state.submittedOrders.includes('order-worker-runtime'),
      'Expected worker runtime checkout submission'
    );
    expect(workerHost.getState()).toMatchObject({
      phase: 'submitted',
      submittedOrders: ['order-worker-runtime'],
      transportState: 'connected',
    });
    expect(workerHost.address).toBe('actor://ignite-worker-runtime/actor/ignite-worker-checkout');
  });
});

async function waitForHostState(
  target: HeadlessCheckoutHost,
  predicate: (state: ReturnType<HeadlessCheckoutHost['getState']>) => boolean,
  message: string
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate(target.getState())) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error(message);
}

async function createWorkerGatewayHost(gatewayUrl: string): Promise<HeadlessCheckoutHost> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const runtimeHarness = createCheckoutServerGatewayRuntimeHarness({
      url: gatewayUrl,
      streamId: `worker-checkout-${attempt}`,
      scope: { kind: 'ignite-headless-worker-checkout' },
      createSocket: (url) => new WebSocket(url) as never,
    });
    const candidate = createHeadlessCheckoutHostFromSource(runtimeHarness.source, {
      destroy: runtimeHarness.destroy,
    });

    try {
      await candidate.submit(`probe-worker-${attempt}`);
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
