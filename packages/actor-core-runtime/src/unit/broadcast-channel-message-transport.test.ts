import { afterEach, describe, expect, it } from 'vitest';
import type { ActorMessage } from '../actor-system.js';
import {
  BROADCAST_CHANNEL_TRANSPORT_PROTOCOL,
  type BroadcastChannelLike,
  type BroadcastChannelMessageTransport,
  type BroadcastChannelMessageTransportOptions,
  type BroadcastChannelTransportEnvelope,
  createBroadcastChannelMessageTransport,
} from '../broadcast-channel-message-transport.js';
import {
  createRuntimeNodeIdentity,
  createRuntimeTransportHandshakeAccept,
  RUNTIME_TRANSPORT_PROTOCOL_VERSION,
  type RuntimeNodeIdentity,
} from '../runtime-transport-contract.js';

const transports: BroadcastChannelMessageTransport[] = [];
const TEST_CHANNEL_NAME = 'actor-web-test';

class FakeBroadcastChannelNetwork {
  private readonly channels = new Set<FakeBroadcastChannel>();

  create = (name: string): BroadcastChannelLike => {
    const channel = new FakeBroadcastChannel(name, this);
    this.channels.add(channel);
    return channel;
  };

  delete(channel: FakeBroadcastChannel): void {
    this.channels.delete(channel);
  }

  publish(sender: FakeBroadcastChannel, data: unknown): void {
    for (const channel of Array.from(this.channels)) {
      if (channel !== sender && channel.name === sender.name) {
        channel.deliver(data);
      }
    }
  }

  broadcast(channelName: string, data: unknown): void {
    for (const channel of Array.from(this.channels)) {
      if (channel.name === channelName) {
        channel.deliver(data);
      }
    }
  }
}

class FakeBroadcastChannel implements BroadcastChannelLike {
  private readonly listeners = new Set<EventListener>();
  private closed = false;

  constructor(
    readonly name: string,
    private readonly network: FakeBroadcastChannelNetwork
  ) {}

  postMessage(data: unknown): void {
    if (this.closed) {
      throw new Error(`BroadcastChannel ${this.name} is closed.`);
    }
    this.network.publish(this, data);
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.listeners.delete(listener);
    }
  }

  deliver(data: unknown): void {
    const event = { data } as MessageEvent;
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.listeners.clear();
    this.network.delete(this);
  }
}

function createTransport(
  network: FakeBroadcastChannelNetwork,
  nodeAddress: string,
  options: Omit<
    Partial<BroadcastChannelMessageTransportOptions>,
    'broadcastChannelFactory' | 'channelName' | 'nodeAddress'
  > = {}
): BroadcastChannelMessageTransport {
  const transport = createBroadcastChannelMessageTransport({
    nodeAddress,
    channelName: TEST_CHANNEL_NAME,
    incarnation: `${nodeAddress}-boot`,
    heartbeatIntervalMs: 0,
    broadcastChannelFactory: network.create,
    ...options,
  });
  transports.push(transport);
  return transport;
}

function testIdentity(
  nodeAddress: string,
  incarnation = `${nodeAddress}-boot`
): RuntimeNodeIdentity {
  return createRuntimeNodeIdentity({
    nodeAddress,
    nodeId: nodeAddress,
    incarnation,
  });
}

function testEnvelope(
  source: RuntimeNodeIdentity,
  destination: string,
  payload: unknown
): BroadcastChannelTransportEnvelope {
  return {
    protocol: BROADCAST_CHANNEL_TRANSPORT_PROTOCOL,
    source,
    destination,
    payload,
  };
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

describe('BroadcastChannelMessageTransport', () => {
  afterEach(async () => {
    await Promise.allSettled(transports.splice(0).map((transport) => transport.stop()));
  });

  it('connects peers over one same-origin channel and dispatches runtime messages', async () => {
    const network = new FakeBroadcastChannelNetwork();
    const tabA = createTransport(network, 'tab-a');
    const tabB = createTransport(network, 'tab-b');
    const received: Array<{ source: string; message: ActorMessage }> = [];
    tabB.subscribe((event) => received.push(event));

    await Promise.all([tabA.start(), tabB.start()]);
    await tabA.connect('tab-b');
    await tabA.send('tab-b', { type: 'PING' });

    await waitFor(
      () => received.some((event) => event.source === 'tab-a' && event.message.type === 'PING'),
      `tab-b should receive tab-a message; stats=${JSON.stringify(tabB.getPeerStats('tab-a'))}; connected=${tabB.isConnected('tab-a')}; received=${JSON.stringify(received)}`
    );
    expect(tabA.isConnected('tab-b')).toBe(true);
    expect(tabB.isConnected('tab-a')).toBe(true);
  });

  it('ignores bus frames addressed to another peer without disconnecting the bystander', async () => {
    const network = new FakeBroadcastChannelNetwork();
    const tabA = createTransport(network, 'tab-a');
    const tabB = createTransport(network, 'tab-b');
    const tabC = createTransport(network, 'tab-c');
    const receivedByB: ActorMessage[] = [];
    const receivedByC: ActorMessage[] = [];
    tabB.subscribe((event) => receivedByB.push(event.message));
    tabC.subscribe((event) => receivedByC.push(event.message));

    await Promise.all([tabA.start(), tabB.start(), tabC.start()]);
    await tabA.connect('tab-b');
    await tabC.connect('tab-a');

    await tabA.send('tab-b', { type: 'FOR_TAB_B' });

    await waitFor(
      () => receivedByB.some((message) => message.type === 'FOR_TAB_B'),
      `tab-b should receive the message addressed to tab-b; stats=${JSON.stringify(tabB.getPeerStats('tab-a'))}; connected=${tabB.isConnected('tab-a')}; received=${JSON.stringify(receivedByB)}`
    );
    await nextTick();

    expect(receivedByC.some((message) => message.type === 'FOR_TAB_B')).toBe(false);
    expect(tabC.isConnected('tab-a')).toBe(true);
    expect(tabA.isConnected('tab-c')).toBe(true);
  });

  it('rejects accept frames whose envelope source does not match the payload source', async () => {
    const network = new FakeBroadcastChannelNetwork();
    const tabA = createTransport(network, 'tab-a');

    await tabA.start();
    const connect = tabA.connect('tab-b');
    await nextTick();

    network.broadcast(
      TEST_CHANNEL_NAME,
      testEnvelope(
        testIdentity('tab-b', 'tab-b-spoof'),
        'tab-a',
        createRuntimeTransportHandshakeAccept(testIdentity('tab-b'), testIdentity('tab-a'))
      )
    );

    await expect(connect).rejects.toThrow(
      /BroadcastChannel handshake envelope source does not match payload source/
    );
    expect(tabA.isConnected('tab-b')).toBe(false);
  });

  it('ignores stale same-address frames without disconnecting the negotiated peer', async () => {
    const network = new FakeBroadcastChannelNetwork();
    const tabA = createTransport(network, 'tab-a');
    const tabB = createTransport(network, 'tab-b');
    const received: ActorMessage[] = [];
    tabB.subscribe((event) => received.push(event.message));

    await Promise.all([tabA.start(), tabB.start()]);
    await tabA.connect('tab-b');

    const staleSource = testIdentity('tab-a', 'tab-a-stale');
    network.broadcast(
      TEST_CHANNEL_NAME,
      testEnvelope(staleSource, 'tab-b', {
        protocolVersion: RUNTIME_TRANSPORT_PROTOCOL_VERSION,
        source: staleSource,
        destination: testIdentity('tab-b'),
        messageId: 'stale-frame-1',
        sequence: 0,
        sentAt: new Date().toISOString(),
        message: { type: 'STALE_FRAME' },
      })
    );
    await nextTick();

    expect(received.some((message) => message.type === 'STALE_FRAME')).toBe(false);
    expect(tabB.isConnected('tab-a')).toBe(true);
  });

  it('contains telemetry observer failures during the handshake', async () => {
    const network = new FakeBroadcastChannelNetwork();
    const listenerErrors: unknown[] = [];
    const tabA = createTransport(network, 'tab-a', {
      telemetry: (event) => {
        if (event.type === 'auth.accepted') {
          throw new Error('telemetry failed');
        }
      },
      onListenerError: (error) => listenerErrors.push(error),
    });
    const tabB = createTransport(network, 'tab-b');

    await Promise.all([tabA.start(), tabB.start()]);
    await tabA.connect('tab-b');

    expect(tabA.isConnected('tab-b')).toBe(true);
    expect(
      listenerErrors.some((error) => error instanceof Error && error.message === 'telemetry failed')
    ).toBe(true);
  });
});
