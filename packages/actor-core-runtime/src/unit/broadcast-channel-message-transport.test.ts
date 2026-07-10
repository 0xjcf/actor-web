import { afterEach, describe, expect, it } from 'vitest';
import type { ActorMessage, MessageTransport } from '../actor-system.js';
import { ActorSystemImpl } from '../actor-system-impl.js';
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
  createRuntimeTransportFrame,
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

class ControlledDirectoryTransport implements MessageTransport {
  private listener: ((event: { source: string; message: ActorMessage }) => void) | null = null;
  private readonly connectedNodes = new Set<string>();
  private releaseSync: (() => void) | null = null;
  private rejectNextSync = false;
  directorySyncRequests = 0;

  constructor(private readonly emitConnected = true) {}

  async send(destination: string, message: ActorMessage): Promise<void> {
    if (message.type !== '__runtime.directory.sync.request') {
      return;
    }

    this.directorySyncRequests += 1;
    const requestId = (message as ActorMessage & { requestId: string }).requestId;
    if (this.rejectNextSync) {
      this.rejectNextSync = false;
      this.releaseSync = () => {
        this.listener?.({
          source: destination,
          message: {
            type: '__runtime.remote.ask.response',
            requestId,
          },
        });
      };
      return;
    }
    this.releaseSync = () => {
      this.listener?.({
        source: destination,
        message: {
          type: '__runtime.directory.sync.response',
          requestId,
          entries: [],
        },
      });
    };
  }

  subscribe(listener: (event: { source: string; message: ActorMessage }) => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }

  async connect(address: string): Promise<void> {
    this.connectedNodes.add(address);
    if (this.emitConnected) {
      this.listener?.({
        source: address,
        message: { type: '__runtime.transport.connected', nodeAddress: address },
      });
    }
  }

  async disconnect(address: string): Promise<void> {
    this.connectedNodes.delete(address);
  }

  getConnectedNodes(): string[] {
    return Array.from(this.connectedNodes);
  }

  isConnected(address: string): boolean {
    return this.connectedNodes.has(address);
  }

  releaseDirectorySync(): void {
    const release = this.releaseSync;
    this.releaseSync = null;
    release?.();
  }

  failNextDirectorySync(): void {
    this.rejectNextSync = true;
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

  it('preserves directory frames sent before the dialing peer installs its receive sink', async () => {
    const network = new FakeBroadcastChannelNetwork();
    const tabA = createTransport(network, 'tab-a');
    const received: ActorMessage[] = [];
    tabA.subscribe((event) => received.push(event.message));

    await tabA.start();
    const connect = tabA.connect('tab-b');
    await nextTick();

    const tabAIdentity = testIdentity('tab-a');
    const tabBIdentity = testIdentity('tab-b');
    network.broadcast(
      TEST_CHANNEL_NAME,
      testEnvelope(
        tabBIdentity,
        'tab-a',
        createRuntimeTransportFrame({
          source: tabBIdentity,
          destination: tabAIdentity,
          sequence: 1,
          message: {
            type: '__runtime.directory.sync.response',
            requestId: 'early-directory-sync',
            entries: [],
          },
        })
      )
    );
    network.broadcast(
      TEST_CHANNEL_NAME,
      testEnvelope(
        tabBIdentity,
        'tab-a',
        createRuntimeTransportHandshakeAccept(tabBIdentity, tabAIdentity)
      )
    );

    await connect;
    await nextTick();

    expect(received).toContainEqual(
      expect.objectContaining({
        type: '__runtime.directory.sync.response',
        requestId: 'early-directory-sync',
      })
    );
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

describe('ActorSystem BroadcastChannel directory readiness', () => {
  it('keeps join pending until the deduplicated remote directory sync completes', async () => {
    const transport = new ControlledDirectoryTransport();
    const system = new ActorSystemImpl({
      nodeAddress: 'tab-a',
      transport,
    });
    await system.start();

    try {
      let joined = false;
      const join = system.join(['tab-b']).then(() => {
        joined = true;
      });

      await nextTick();

      expect(joined).toBe(false);
      expect(transport.directorySyncRequests).toBe(1);

      transport.releaseDirectorySync();
      await join;

      expect(joined).toBe(true);
      expect(transport.directorySyncRequests).toBe(1);

      await system.leave();
      let rejoined = false;
      const rejoin = system.join(['tab-b']).then(() => {
        rejoined = true;
      });

      await nextTick();

      expect(rejoined).toBe(false);
      expect(transport.directorySyncRequests).toBe(2);

      transport.releaseDirectorySync();
      await rejoin;

      expect(rejoined).toBe(true);
    } finally {
      await system.stop();
    }
  });

  it('evicts rejected directory readiness so an explicit join can retry', async () => {
    const transport = new ControlledDirectoryTransport(false);
    const system = new ActorSystemImpl({
      nodeAddress: 'tab-a',
      transport,
    });
    await system.start();

    try {
      transport.failNextDirectorySync();
      const failedJoin = system.join(['tab-b']);
      await nextTick();
      transport.releaseDirectorySync();
      await expect(failedJoin).rejects.toThrow('Unexpected directory sync response');

      let joined = false;
      const retry = system.join(['tab-b']).then(() => {
        joined = true;
      });
      await nextTick();

      expect(joined).toBe(false);
      expect(transport.directorySyncRequests).toBe(2);

      transport.releaseDirectorySync();
      await retry;
      expect(joined).toBe(true);
    } finally {
      await system.stop();
    }
  });
});
