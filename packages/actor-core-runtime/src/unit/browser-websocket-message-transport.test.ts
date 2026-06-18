import { afterEach, describe, expect, it } from 'vitest';
import NodeWebSocket from 'ws';
import type { ActorMessage } from '../actor-system.js';
import { ActorSystemImpl } from '../actor-system-impl.js';
import {
  type BrowserWebSocketMessageTransport,
  createBrowserWebSocketMessageTransport,
} from '../browser-websocket-message-transport.js';
import { createActorSource } from '../integration/actor-source.js';
import {
  createNodeWebSocketMessageTransport,
  type NodeWebSocketMessageTransport,
} from '../node-websocket-message-transport.js';
import {
  createRuntimeNodeIdentity,
  createRuntimeTransportFrame,
} from '../runtime-transport-contract.js';
import { createInMemoryRuntimeTransportIdempotencyProvider } from '../runtime-transport-idempotency.js';
import type { RuntimeTransportTelemetryEvent } from '../runtime-transport-telemetry.js';
import { defineBehavior } from '../unified-actor-builder.js';

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
  return defineBehavior<CheckoutMessage>()
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
    const telemetry: RuntimeTransportTelemetryEvent[] = [];

    const browser = createBrowserTransport('worker-a', {
      telemetry: (event) => telemetry.push(event),
      peers: { 'node-b': nodeUrl },
    });

    await browser.connect('node-b');

    expect(browser.isConnected('node-b')).toBe(true);
    expect(browser.getConnectedNodes()).toEqual(['node-b']);
    expect(node.isConnected('worker-a')).toBe(true);
    expect(telemetry.map((event) => event.type)).toEqual(
      expect.arrayContaining(['peer.connecting', 'handshake.accepted', 'peer.connected'])
    );
    const stats = browser.getStats();
    stats.peers['node-b'].framesSent = 999;
    expect(browser.getPeerStats('node-b')).toMatchObject({
      state: 'connected',
      handshakeAcceptedCount: 1,
      framesSent: 0,
    });
  });

  it('sends browser transport auth during handshake and rejects invalid tokens', async () => {
    const nodeTelemetry: RuntimeTransportTelemetryEvent[] = [];
    const node = await createStartedNodeTransport('node-b', {
      telemetry: (event) => nodeTelemetry.push(event),
      auth: {
        verifyToken: ({ token }) => token === 'browser-secret',
      },
    });
    const nodeUrl = node.getListeningUrl();
    if (!nodeUrl) {
      throw new Error('Expected node listening URL');
    }
    const browser = createBrowserTransport('worker-a', {
      peers: { 'node-b': nodeUrl },
      auth: {
        token: () => ({
          scheme: 'bearer',
          token: 'browser-secret',
          metadata: {
            subject: 'browser-worker',
            apiKey: 'do-not-log',
            authorization: 'Bearer browser-secret',
          },
        }),
      },
    });

    await browser.connect('node-b');

    expect(browser.isConnected('node-b')).toBe(true);
    expect(nodeTelemetry).toContainEqual(
      expect.objectContaining({
        type: 'auth.accepted',
        nodeAddress: 'node-b',
        peerNodeAddress: 'worker-a',
      })
    );
    expect(JSON.stringify(nodeTelemetry)).not.toContain('browser-secret');
    expect(JSON.stringify(nodeTelemetry)).not.toContain('apiKey');

    await browser.disconnect('node-b');
    const rejectedBrowser = createBrowserTransport('worker-c', {
      peers: { 'node-b': nodeUrl },
      auth: {
        token: () => ({
          scheme: 'bearer',
          token: 'invalid-browser-secret',
          metadata: {
            subject: 'browser-worker',
            sessionToken: 'do-not-log',
            authorization: 'Bearer invalid-browser-secret',
          },
        }),
      },
    });

    await expect(rejectedBrowser.connect('node-b')).rejects.toThrow('Runtime handshake rejected');
    expect(nodeTelemetry).toContainEqual(
      expect.objectContaining({
        type: 'auth.rejected',
        nodeAddress: 'node-b',
        peerNodeAddress: 'worker-c',
      })
    );
    expect(JSON.stringify(nodeTelemetry)).not.toContain('invalid-browser-secret');
    expect(JSON.stringify(nodeTelemetry)).not.toContain('sessionToken');
    expect(JSON.stringify(nodeTelemetry)).not.toContain('authorization');
  });

  it('sends and receives validated runtime frames through a Node peer', async () => {
    const node = await createStartedNodeTransport('node-b');
    const nodeUrl = node.getListeningUrl();
    if (!nodeUrl) {
      throw new Error('Expected node listening URL');
    }
    const telemetry: RuntimeTransportTelemetryEvent[] = [];
    const browser = createBrowserTransport('worker-a', {
      telemetry: (event) => telemetry.push(event),
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

    expect(browser.getStats()).toMatchObject({
      framesSent: 1,
      framesReceived: 1,
      peers: {
        'node-b': expect.objectContaining({
          framesSent: 1,
          framesReceived: 1,
          lastSentSequence: 1,
          lastReceivedSequence: 1,
        }),
      },
    });
    expect(telemetry.map((event) => event.type)).toEqual(
      expect.arrayContaining(['frame.sent', 'frame.received'])
    );

    unsubscribeBrowser();
    unsubscribeNode();
  });

  it('drops duplicate runtime frames from a Node peer', async () => {
    const node = await createStartedNodeTransport('node-b');
    const nodeUrl = node.getListeningUrl();
    if (!nodeUrl) {
      throw new Error('Expected node listening URL');
    }
    const telemetry: RuntimeTransportTelemetryEvent[] = [];
    const browser = createBrowserTransport('worker-a', {
      telemetry: (event) => telemetry.push(event),
      peers: { 'node-b': nodeUrl },
    });
    const receivedByBrowser: string[] = [];
    const unsubscribeBrowser = browser.subscribe((event) => {
      receivedByBrowser.push(event.message.type);
    });

    await browser.connect('node-b');
    const nodePeer = (
      node as unknown as {
        // PR 2 moved the node transport's peer registry into TransportCore; each ws socket
        // is now wrapped in a per-peer PeerLink (peer.link.socket). The browser↔node interop
        // assertions still drive raw frames from the node side through that socket.
        core: { peers: Map<string, { link: { socket: NodeWebSocket } }> };
      }
    ).core.peers.get('worker-a');
    if (!nodePeer) {
      throw new Error('Expected Node peer socket');
    }

    const frame = createRuntimeTransportFrame({
      source: createRuntimeNodeIdentity({
        nodeAddress: 'node-b',
        nodeId: 'node-b',
        incarnation: 'node-b-boot',
      }),
      destination: createRuntimeNodeIdentity({
        nodeAddress: 'worker-a',
        nodeId: 'worker-a',
        incarnation: 'worker-a-boot',
      }),
      messageId: 'node-b:node-b-boot:worker-a:duplicate-1',
      sequence: 1,
      message: { type: 'DUPLICATE_NODE_FRAME' },
    });

    nodePeer.link.socket.send(JSON.stringify(frame));
    nodePeer.link.socket.send(JSON.stringify(frame));

    await waitFor(
      () => receivedByBrowser.includes('DUPLICATE_NODE_FRAME'),
      'Expected first duplicate test frame'
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(receivedByBrowser.filter((type) => type === 'DUPLICATE_NODE_FRAME')).toHaveLength(1);
    expect(browser.getPeerStats('node-b')).toMatchObject({
      framesReceived: 1,
      duplicateFramesDropped: 1,
    });
    expect(telemetry).toContainEqual(
      expect.objectContaining({
        type: 'frame.duplicate',
        peerNodeAddress: 'node-b',
        messageId: 'node-b:node-b-boot:worker-a:duplicate-1',
      })
    );

    unsubscribeBrowser();
  });

  it('drops duplicate runtime frames across browser transport restarts when a provider is configured', async () => {
    const node = await createStartedNodeTransport('node-b');
    const nodeUrl = node.getListeningUrl();
    if (!nodeUrl) {
      throw new Error('Expected node listening URL');
    }
    const idempotencyProvider = createInMemoryRuntimeTransportIdempotencyProvider();
    const firstBrowser = createBrowserTransport('worker-a', {
      incarnation: 'worker-a-boot',
      idempotencyProvider,
      peers: { 'node-b': nodeUrl },
    });
    const firstReceived: string[] = [];
    const firstUnsubscribe = firstBrowser.subscribe((event) => {
      firstReceived.push(event.message.type);
    });

    await firstBrowser.connect('node-b');
    const firstNodePeer = (
      node as unknown as {
        // PR 2 moved the node transport's peer registry into TransportCore; each ws socket
        // is now wrapped in a per-peer PeerLink (peer.link.socket). The browser↔node interop
        // assertions still drive raw frames from the node side through that socket.
        core: { peers: Map<string, { link: { socket: NodeWebSocket } }> };
      }
    ).core.peers.get('worker-a');
    if (!firstNodePeer) {
      throw new Error('Expected first browser node peer socket');
    }

    const firstFrame = createRuntimeTransportFrame({
      source: createRuntimeNodeIdentity({
        nodeAddress: 'node-b',
        nodeId: 'node-b',
        incarnation: 'node-b-boot',
      }),
      destination: createRuntimeNodeIdentity({
        nodeAddress: 'worker-a',
        nodeId: 'worker-a',
        incarnation: 'worker-a-boot',
      }),
      messageId: 'node-b:node-b-boot:worker-a:duplicate-restart-1',
      sequence: 1,
      message: { type: 'BROWSER_RESTART_DUPLICATE' },
    });

    firstNodePeer.link.socket.send(JSON.stringify(firstFrame));
    await waitFor(
      () => firstReceived.includes('BROWSER_RESTART_DUPLICATE'),
      'Expected first browser restart frame'
    );
    firstUnsubscribe();
    await firstBrowser.stop();

    const restartedBrowser = createBrowserTransport('worker-a', {
      incarnation: 'worker-a-restart',
      idempotencyProvider,
      peers: { 'node-b': nodeUrl },
    });
    const restartedReceived: string[] = [];
    const restartedUnsubscribe = restartedBrowser.subscribe((event) => {
      restartedReceived.push(event.message.type);
    });

    await restartedBrowser.connect('node-b');
    const restartedNodePeer = (
      node as unknown as {
        // PR 2 moved the node transport's peer registry into TransportCore; each ws socket
        // is now wrapped in a per-peer PeerLink (peer.link.socket). The browser↔node interop
        // assertions still drive raw frames from the node side through that socket.
        core: { peers: Map<string, { link: { socket: NodeWebSocket } }> };
      }
    ).core.peers.get('worker-a');
    if (!restartedNodePeer) {
      throw new Error('Expected restarted browser node peer socket');
    }

    const duplicateAfterRestart = createRuntimeTransportFrame({
      source: createRuntimeNodeIdentity({
        nodeAddress: 'node-b',
        nodeId: 'node-b',
        incarnation: 'node-b-boot',
      }),
      destination: createRuntimeNodeIdentity({
        nodeAddress: 'worker-a',
        nodeId: 'worker-a',
        incarnation: 'worker-a-restart',
      }),
      messageId: 'node-b:node-b-boot:worker-a:duplicate-restart-1',
      sequence: 1,
      message: { type: 'BROWSER_RESTART_DUPLICATE' },
    });

    restartedNodePeer.link.socket.send(JSON.stringify(duplicateAfterRestart));
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(restartedReceived).not.toContain('BROWSER_RESTART_DUPLICATE');
    expect(restartedBrowser.getStats()).toMatchObject({
      duplicateFramesDropped: 1,
      idempotencyProviderEnabled: true,
      idempotencyProviderDuplicateCount: 1,
    });
    restartedUnsubscribe();
  });

  it('surfaces browser idempotency provider failures without accepting the frame', async () => {
    const node = await createStartedNodeTransport('node-b');
    const nodeUrl = node.getListeningUrl();
    if (!nodeUrl) {
      throw new Error('Expected node listening URL');
    }
    const telemetry: RuntimeTransportTelemetryEvent[] = [];
    const browser = createBrowserTransport('worker-a', {
      telemetry: (event) => telemetry.push(event),
      idempotencyProvider: {
        claim() {
          throw new Error('durable idempotency unavailable');
        },
      },
      peers: { 'node-b': nodeUrl },
    });
    const receivedByBrowser: string[] = [];
    const unsubscribeBrowser = browser.subscribe((event) => {
      receivedByBrowser.push(event.message.type);
    });

    await browser.connect('node-b');
    const nodePeer = (
      node as unknown as {
        // PR 2 moved the node transport's peer registry into TransportCore; each ws socket
        // is now wrapped in a per-peer PeerLink (peer.link.socket). The browser↔node interop
        // assertions still drive raw frames from the node side through that socket.
        core: { peers: Map<string, { link: { socket: NodeWebSocket } }> };
      }
    ).core.peers.get('worker-a');
    if (!nodePeer) {
      throw new Error('Expected Node peer socket');
    }

    const frame = createRuntimeTransportFrame({
      source: createRuntimeNodeIdentity({
        nodeAddress: 'node-b',
        nodeId: 'node-b',
        incarnation: 'node-b-boot',
      }),
      destination: createRuntimeNodeIdentity({
        nodeAddress: 'worker-a',
        nodeId: 'worker-a',
        incarnation: 'worker-a-boot',
      }),
      messageId: 'node-b:node-b-boot:worker-a:provider-error-1',
      sequence: 1,
      message: { type: 'BROWSER_PROVIDER_ERROR_FRAME' },
    });

    nodePeer.link.socket.send(JSON.stringify(frame));
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(receivedByBrowser).not.toContain('BROWSER_PROVIDER_ERROR_FRAME');
    expect(browser.getStats()).toMatchObject({
      idempotencyProviderEnabled: true,
      idempotencyProviderErrorCount: 1,
      lastIdempotencyProviderErrorMessage: 'durable idempotency unavailable',
      malformedFramesDropped: 0,
      validationFramesDropped: 0,
    });
    expect(browser.getPeerStats('node-b')).toMatchObject({
      idempotencyProviderErrorCount: 1,
      malformedFramesDropped: 0,
      validationFramesDropped: 0,
    });
    expect(browser.isConnected('node-b')).toBe(false);
    expect(telemetry).toContainEqual(
      expect.objectContaining({
        type: 'idempotency.provider.error',
        peerNodeAddress: 'node-b',
        reason: 'durable idempotency unavailable',
      })
    );
    expect(telemetry).toContainEqual(
      expect.objectContaining({
        type: 'frame.dropped',
        peerNodeAddress: 'node-b',
        reason: 'Runtime idempotency provider claim failed.',
        dropCode: 'idempotency_provider_error',
      })
    );
    unsubscribeBrowser();
  });

  it('acks retryable runtime control frames from a Node peer', async () => {
    const nodeTelemetry: RuntimeTransportTelemetryEvent[] = [];
    const node = await createStartedNodeTransport('node-b', {
      telemetry: (event) => nodeTelemetry.push(event),
    });
    const nodeUrl = node.getListeningUrl();
    if (!nodeUrl) {
      throw new Error('Expected node listening URL');
    }
    const browser = createBrowserTransport('worker-a', {
      peers: { 'node-b': nodeUrl },
    });

    await browser.connect('node-b');
    await node.send('worker-a', {
      type: '__runtime.test.control',
    } as ActorMessage<{ type: '__runtime.test.control' }>);

    await waitFor(
      () => node.getPeerStats('worker-a')?.framesAcked === 1,
      'Expected browser runtime control ack'
    );
    expect(node.getPeerStats('worker-a')).toMatchObject({
      framesAcked: 1,
      framesRetried: 0,
    });
    expect(nodeTelemetry).toContainEqual(
      expect.objectContaining({
        type: 'frame.ack.received',
        peerNodeAddress: 'worker-a',
        messageType: '__runtime.test.control',
      })
    );
  });

  it('rejects browser sends when the outbound queue is full', async () => {
    const node = await createStartedNodeTransport('node-b');
    const nodeUrl = node.getListeningUrl();
    if (!nodeUrl) {
      throw new Error('Expected node listening URL');
    }
    const telemetry: RuntimeTransportTelemetryEvent[] = [];
    const browser = createBrowserTransport('worker-a', {
      outboundQueueLimit: 1,
      telemetry: (event) => telemetry.push(event),
      peers: { 'node-b': nodeUrl },
    });

    await browser.connect('node-b');
    const peer = (
      browser as unknown as {
        peers: Map<string, { outboundFlushing: boolean }>;
      }
    ).peers.get('node-b');
    if (!peer) {
      throw new Error('Expected browser peer');
    }
    peer.outboundFlushing = true;

    const first = browser.send('node-b', { type: 'QUEUE_ONE' } as ActorMessage);
    await expect(browser.send('node-b', { type: 'QUEUE_TWO' } as ActorMessage)).rejects.toThrow(
      'outbound queue to node-b is full'
    );

    expect(browser.getPeerStats('node-b')).toMatchObject({
      outboundQueueDepth: 1,
      outboundFramesDropped: 1,
      backpressureDropCount: 1,
    });
    expect(telemetry.map((event) => event.type)).toEqual(
      expect.arrayContaining(['outbound.queue.dropped', 'backpressure.applied'])
    );

    peer.outboundFlushing = false;
    (
      browser as unknown as {
        flushOutboundQueue: (nodeAddress: string, peer: unknown) => void;
      }
    ).flushOutboundQueue('node-b', peer);
    await first;
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

    const source = createActorSource<CheckoutContext, CheckoutMessage, CheckoutEvent>(remoteRef);
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
