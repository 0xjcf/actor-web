import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  createHeadlessCheckoutHost,
  createHeadlessCheckoutHostFromSource,
  type HeadlessCheckoutHost,
} from './headless-host';
import { createCheckoutRuntimeHarness } from './runtime-harness';
import { createCheckoutServerGatewayRuntimeHarness } from './server-gateway-client';
import {
  type CheckoutRuntimeGatewayServer,
  createCheckoutRuntimeGatewayServer,
} from './server-runtime-gateway';

describe('ignite-headless-host example', () => {
  let host: HeadlessCheckoutHost | undefined;
  let gatewayServer: CheckoutRuntimeGatewayServer | undefined;

  afterEach(async () => {
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
});
