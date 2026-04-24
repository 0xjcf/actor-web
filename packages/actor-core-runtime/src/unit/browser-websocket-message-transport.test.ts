import { afterEach, describe, expect, it } from 'vitest';
import NodeWebSocket from 'ws';
import type { ActorMessage } from '../actor-system.js';
import { ActorSystemImpl } from '../actor-system-impl.js';
import {
  type BrowserWebSocketMessageTransport,
  createBrowserWebSocketMessageTransport,
} from '../browser-websocket-message-transport.js';
import { createIgniteActorSource } from '../integration/ignite-element-bridge.js';
import {
  createNodeWebSocketMessageTransport,
  type NodeWebSocketMessageTransport,
} from '../node-websocket-message-transport.js';
import { defineActor } from '../unified-actor-builder.js';

type CheckoutMessage =
  | { type: 'SUBMIT'; orderId: string }
  | { type: 'RESET' }
  | { type: 'GET_COUNT' };

type CheckoutEvent = { type: 'CHECKOUT_SUBMITTED'; orderId: string } | { type: 'CHECKOUT_RESET' };

interface CheckoutContext {
  submittedOrders: string[];
  lastSubmittedOrderId: string | null;
}

const transports: Array<BrowserWebSocketMessageTransport | NodeWebSocketMessageTransport> = [];
const systems: ActorSystemImpl[] = [];

function createBrowserSocket(url: string): WebSocket {
  return new NodeWebSocket(url) as unknown as WebSocket;
}

function createCheckoutBehavior() {
  return defineActor<CheckoutMessage>()
    .withContext<CheckoutContext>({
      submittedOrders: [],
      lastSubmittedOrderId: null,
    })
    .onMessage(({ actor, message }) => {
      const context = actor.getSnapshot().context as CheckoutContext;

      if (message.type === 'GET_COUNT') {
        return { reply: context.submittedOrders.length };
      }

      if (message.type === 'SUBMIT') {
        return {
          context: {
            submittedOrders: [...context.submittedOrders, message.orderId],
            lastSubmittedOrderId: message.orderId,
          },
          emit: [{ type: 'CHECKOUT_SUBMITTED', orderId: message.orderId }],
        };
      }

      return {
        context: {
          submittedOrders: [],
          lastSubmittedOrderId: null,
        },
        emit: [{ type: 'CHECKOUT_RESET' }],
      };
    })
    .build();
}

async function createStartedNodeTransport(
  nodeAddress: string,
  options: Omit<Parameters<typeof createNodeWebSocketMessageTransport>[0], 'nodeAddress'> = {}
): Promise<NodeWebSocketMessageTransport> {
  const transport = createNodeWebSocketMessageTransport({
    nodeAddress,
    incarnation: `${nodeAddress}-boot`,
    heartbeatIntervalMs: 0,
    listen: { port: 0 },
    ...options,
  });
  transports.push(transport);
  await transport.start();
  return transport;
}

function createBrowserTransport(
  nodeAddress: string,
  options: Omit<Parameters<typeof createBrowserWebSocketMessageTransport>[0], 'nodeAddress'> = {}
): BrowserWebSocketMessageTransport {
  const transport = createBrowserWebSocketMessageTransport({
    nodeAddress,
    incarnation: `${nodeAddress}-boot`,
    heartbeatIntervalMs: 0,
    webSocketFactory: createBrowserSocket,
    ...options,
  });
  transports.push(transport);
  return transport;
}

async function nextTick(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string
): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await nextTick();
  }

  throw new Error(message);
}

describe('BrowserWebSocketMessageTransport', () => {
  afterEach(async () => {
    await Promise.allSettled(systems.splice(0).map((system) => system.stop()));
    await Promise.allSettled(transports.splice(0).map((transport) => transport.stop()));
  });

  it('opens an outbound browser-style WebSocket and handshakes with a Node peer', async () => {
    const node = await createStartedNodeTransport('node-b');
    const nodeUrl = node.getListeningUrl();
    if (!nodeUrl) {
      throw new Error('Expected node listening URL');
    }

    const browser = createBrowserTransport('worker-a', {
      peers: { 'node-b': nodeUrl },
    });

    await browser.connect('node-b');

    expect(browser.isConnected('node-b')).toBe(true);
    expect(browser.getConnectedNodes()).toEqual(['node-b']);
    expect(node.isConnected('worker-a')).toBe(true);
  });

  it('sends and receives validated runtime frames through a Node peer', async () => {
    const node = await createStartedNodeTransport('node-b');
    const nodeUrl = node.getListeningUrl();
    if (!nodeUrl) {
      throw new Error('Expected node listening URL');
    }
    const browser = createBrowserTransport('worker-a', {
      peers: { 'node-b': nodeUrl },
    });
    const receivedByNode: string[] = [];
    const receivedByBrowser: string[] = [];
    const unsubscribeNode = node.subscribe((event) => {
      receivedByNode.push(event.message.type);
    });
    const unsubscribeBrowser = browser.subscribe((event) => {
      receivedByBrowser.push(event.message.type);
    });

    await browser.connect('node-b');
    await browser.send('node-b', { type: 'FROM_BROWSER' } as ActorMessage);
    await node.send('worker-a', { type: 'FROM_NODE' } as ActorMessage);

    await waitFor(() => receivedByNode.includes('FROM_BROWSER'), 'Expected Node frame');
    await waitFor(() => receivedByBrowser.includes('FROM_NODE'), 'Expected browser frame');

    unsubscribeBrowser();
    unsubscribeNode();
  });

  it('uses app-level heartbeat frames against Node WebSocket peers', async () => {
    const node = await createStartedNodeTransport('node-b');
    const nodeUrl = node.getListeningUrl();
    if (!nodeUrl) {
      throw new Error('Expected node listening URL');
    }
    const browser = createBrowserTransport('worker-a', {
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 40,
      peers: { 'node-b': nodeUrl },
    });

    await browser.connect('node-b');
    await new Promise((resolve) => {
      setTimeout(resolve, 30);
    });

    expect(browser.isConnected('node-b')).toBe(true);
    expect(node.isConnected('worker-a')).toBe(true);
  });

  it('supports runtime directory sync, send, ask, and projections from a browser worker peer', async () => {
    const nodeTransport = await createStartedNodeTransport('node-b');
    const nodeUrl = nodeTransport.getListeningUrl();
    if (!nodeUrl) {
      throw new Error('Expected node listening URL');
    }
    const browserTransport = createBrowserTransport('worker-a', {
      peers: { 'node-b': nodeUrl },
    });

    const browserSystem = new ActorSystemImpl({
      nodeAddress: 'worker-a',
      transport: browserTransport,
    });
    const nodeSystem = new ActorSystemImpl({
      nodeAddress: 'node-b',
      transport: nodeTransport,
    });
    systems.push(browserSystem, nodeSystem);
    await Promise.all([browserSystem.start(), nodeSystem.start()]);

    const remoteActor = await nodeSystem.spawn(createCheckoutBehavior(), {
      id: 'worker-websocket-checkout',
    });

    await browserSystem.join(['node-b']);
    let remoteRef = await browserSystem.lookup<CheckoutContext, CheckoutMessage>(
      remoteActor.address.path
    );
    await waitFor(async () => {
      remoteRef = await browserSystem.lookup<CheckoutContext, CheckoutMessage>(
        remoteActor.address.path
      );
      return Boolean(remoteRef);
    }, 'Expected remote ref after browser WebSocket directory sync');
    if (!remoteRef) {
      throw new Error('Expected remote ref after browser WebSocket directory sync');
    }

    const source = createIgniteActorSource<CheckoutContext, CheckoutMessage, CheckoutEvent>(
      remoteRef
    );
    const snapshots: number[] = [];
    const events: string[] = [];
    const unsubscribeSnapshot = source.subscribe((snapshot) => {
      snapshots.push(snapshot.context.submittedOrders.length);
    });
    const unsubscribeEvent = source.subscribeEvent((event) => {
      events.push(event.type);
    });

    await source.send({ type: 'SUBMIT', orderId: 'order-browser-ws' });
    await nodeSystem.flush();
    await browserSystem.flush();

    await waitFor(() => snapshots.includes(1), 'Expected browser WebSocket snapshot update');
    await waitFor(
      () => events.includes('CHECKOUT_SUBMITTED'),
      'Expected browser WebSocket event update'
    );
    await expect(source.ask<number>({ type: 'GET_COUNT' })).resolves.toBe(1);

    unsubscribeEvent();
    unsubscribeSnapshot();
  });
});
