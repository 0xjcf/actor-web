import { afterEach, describe, expect, it } from 'vitest';
import {
  createHeadlessCheckoutHost,
  createHeadlessCheckoutHostFromSource,
  type HeadlessCheckoutHost,
} from './headless-host';
import { createCheckoutRuntimeHarness } from './runtime-harness';

describe('ignite-headless-host example', () => {
  let host: HeadlessCheckoutHost | undefined;

  afterEach(async () => {
    if (host) {
      await host.destroy();
      host = undefined;
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
});
