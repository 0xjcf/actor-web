import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ActorAddress,
  ActorDirectory,
  ActorMessage,
  DirectoryReadinessFact,
  MessageTransport,
} from '../actor-system.js';
import { parseActorPath } from '../actor-system.js';
import { ActorSystemImpl } from '../actor-system-impl.js';
import {
  BROADCAST_CHANNEL_TRANSPORT_PROTOCOL,
  type BroadcastChannelLike,
  type BroadcastChannelMessageTransport,
  type BroadcastChannelMessageTransportOptions,
  type BroadcastChannelTransportEnvelope,
  createBroadcastChannelMessageTransport,
} from '../broadcast-channel-message-transport.js';
import type { DirectoryReadinessFact as BrowserDirectoryReadinessFact } from '../browser.js';
import type { DirectoryReadinessFact as RootDirectoryReadinessFact } from '../index.js';
import { Logger } from '../logger.js';
import {
  createRuntimeNodeIdentity,
  createRuntimeTransportFrame,
  createRuntimeTransportHandshakeAccept,
  RUNTIME_TRANSPORT_PROTOCOL_VERSION,
  type RuntimeNodeIdentity,
} from '../runtime-transport-contract.js';
import type { RuntimeDirectoryEntry } from '../runtime-transport-protocol.js';
import { defineBehavior } from '../unified-actor-builder.js';

const transports: BroadcastChannelMessageTransport[] = [];
const TEST_CHANNEL_NAME = 'actor-web-test';

class FakeBroadcastChannelNetwork {
  private readonly channels = new Set<FakeBroadcastChannel>();
  readonly published: unknown[] = [];

  create = (name: string): BroadcastChannelLike => {
    const channel = new FakeBroadcastChannel(name, this);
    this.channels.add(channel);
    return channel;
  };

  delete(channel: FakeBroadcastChannel): void {
    this.channels.delete(channel);
  }

  publish(sender: FakeBroadcastChannel, data: unknown): void {
    this.published.push(data);
    for (const channel of Array.from(this.channels)) {
      if (channel !== sender && channel.name === sender.name) {
        channel.deliver(data);
      }
    }
  }

  broadcast(channelName: string, data: unknown): void {
    this.published.push(data);
    for (const channel of Array.from(this.channels)) {
      if (channel.name === channelName) {
        channel.deliver(data);
      }
    }
  }
}

function countPublishedRuntimeMessages(
  network: FakeBroadcastChannelNetwork,
  source: string,
  destination: string,
  messageType: string
): number {
  return network.published.filter((value) => {
    const envelope = value as {
      readonly source?: { readonly nodeAddress?: string };
      readonly destination?: string;
      readonly payload?: unknown;
    };
    const payload =
      typeof envelope.payload === 'string'
        ? (JSON.parse(envelope.payload) as { readonly message?: { readonly type?: string } })
        : (envelope.payload as { readonly message?: { readonly type?: string } } | undefined);
    return (
      envelope.source?.nodeAddress === source &&
      envelope.destination === destination &&
      payload?.message?.type === messageType
    );
  }).length;
}

function getBusSubscriberCount(transport: BroadcastChannelMessageTransport): number {
  return (
    transport as unknown as {
      readonly bus: { readonly listeners: Set<unknown> };
    }
  ).bus.listeners.size;
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
  private readonly releaseSyncs: Array<() => void> = [];
  private readonly nextSyncEntries: RuntimeDirectoryEntry[][] = [];
  private readonly peerIdentities = new Map<string, RuntimeNodeIdentity>();
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
      this.releaseSyncs.push(() => {
        this.listener?.({
          source: destination,
          message: {
            type: '__runtime.remote.ask.response',
            requestId,
          },
        });
      });
      return;
    }
    const entries = this.nextSyncEntries.shift() ?? [];
    this.releaseSyncs.push(() => {
      this.listener?.({
        source: destination,
        message: {
          type: '__runtime.directory.sync.response',
          requestId,
          entries,
        },
      });
    });
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
    if (!this.peerIdentities.has(address)) {
      this.peerIdentities.set(address, testIdentity(address));
    }
    if (this.emitConnected) {
      this.emitTransportConnected(address);
    }
  }

  async disconnect(address: string): Promise<void> {
    this.connectedNodes.delete(address);
    this.listener?.({
      source: address,
      message: { type: '__runtime.transport.disconnected', nodeAddress: address },
    });
  }

  getConnectedNodes(): string[] {
    return Array.from(this.connectedNodes);
  }

  isConnected(address: string): boolean {
    return this.connectedNodes.has(address);
  }

  getPeerStats(address: string): { readonly identity?: RuntimeNodeIdentity } | undefined {
    const identity = this.peerIdentities.get(address);
    return identity ? { identity } : undefined;
  }

  setPeerIdentity(address: string, incarnation: string): void {
    this.peerIdentities.set(address, testIdentity(address, incarnation));
  }

  emitTransportConnected(address: string): void {
    this.connectedNodes.add(address);
    this.listener?.({
      source: address,
      message: { type: '__runtime.transport.connected', nodeAddress: address },
    });
  }

  queueDirectoryEntries(entries: RuntimeDirectoryEntry[]): void {
    this.nextSyncEntries.push(entries);
  }

  releaseDirectorySync(index = 0): void {
    const [release] = this.releaseSyncs.splice(index, 1);
    release?.();
  }

  releaseAllDirectorySyncs(): void {
    for (const release of this.releaseSyncs.splice(0)) {
      release();
    }
  }

  failNextDirectorySync(): void {
    this.rejectNextSync = true;
  }
}

class RecordingActorDirectory implements ActorDirectory {
  readonly appliedRemoteEntries: RuntimeDirectoryEntry[] = [];
  private readonly entries = new Map<string, string>();

  async register(address: ActorAddress, location: string): Promise<void> {
    this.entries.set(address, location);
  }

  async unregister(address: ActorAddress): Promise<void> {
    this.entries.delete(address);
  }

  async lookup(address: ActorAddress): Promise<string | undefined> {
    return this.entries.get(address);
  }

  async find(): Promise<ActorAddress[]> {
    return [];
  }

  async getAll(): Promise<Map<string, string>> {
    return new Map(this.entries);
  }

  subscribeToChanges(): () => void {
    return () => undefined;
  }

  applyRemoteEntry(entry: RuntimeDirectoryEntry): void {
    this.appliedRemoteEntries.push(entry);
    this.entries.set(entry.address, entry.location);
  }

  removeRemoteEntry(address: ActorAddress): void {
    this.entries.delete(address);
  }

  exportEntries(): RuntimeDirectoryEntry[] {
    return [];
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

  it('bounds activation frames without reusing rejected handshake payloads on reconnect', async () => {
    const network = new FakeBroadcastChannelNetwork();
    const tabA = createTransport(network, 'tab-a');
    const received: ActorMessage[] = [];
    tabA.subscribe((event) => received.push(event.message));
    const activationFrames = (): ActorMessage[] =>
      received.filter((message) => /^(BOUNDED|OVERFLOW|FRESH)_/.test(message.type));

    await tabA.start();
    const tabAIdentity = testIdentity('tab-a');
    const broadcastFrames = (source: RuntimeNodeIdentity, count: number, prefix: string): void => {
      for (let sequence = 1; sequence <= count; sequence += 1) {
        network.broadcast(
          TEST_CHANNEL_NAME,
          testEnvelope(
            source,
            'tab-a',
            createRuntimeTransportFrame({
              source,
              destination: tabAIdentity,
              sequence,
              message: { type: `${prefix}_${sequence}` },
            })
          )
        );
      }
    };

    const boundedIdentity = testIdentity('tab-b', 'tab-b-bounded');
    const boundedConnect = tabA.connect('tab-b');
    await nextTick();
    broadcastFrames(boundedIdentity, 64, 'BOUNDED');
    network.broadcast(
      TEST_CHANNEL_NAME,
      testEnvelope(
        boundedIdentity,
        'tab-a',
        createRuntimeTransportHandshakeAccept(boundedIdentity, tabAIdentity)
      )
    );
    await boundedConnect;
    await waitFor(
      () => activationFrames().length === 64,
      `Expected all bounded activation frames; received=${activationFrames().length}`
    );
    expect(activationFrames().map((message) => message.type)).toEqual(
      Array.from({ length: 64 }, (_, index) => `BOUNDED_${index + 1}`)
    );
    await tabA.disconnect('tab-b');

    const overflowIdentity = testIdentity('tab-b', 'tab-b-overflow');
    const overflowConnect = tabA.connect('tab-b');
    await nextTick();
    broadcastFrames(overflowIdentity, 65, 'OVERFLOW');
    await expect(overflowConnect).rejects.toThrow(
      'BroadcastChannel handshake from tab-b exceeded the pending frame limit (64).'
    );
    expect(tabA.isConnected('tab-b')).toBe(false);
    expect(tabA.getPeerStats('tab-b')).toMatchObject({ state: 'rejected' });
    expect(activationFrames()).toHaveLength(64);

    const freshIdentity = testIdentity('tab-b', 'tab-b-fresh');
    const freshConnect = tabA.connect('tab-b');
    await nextTick();
    broadcastFrames(freshIdentity, 1, 'FRESH');
    network.broadcast(
      TEST_CHANNEL_NAME,
      testEnvelope(
        freshIdentity,
        'tab-a',
        createRuntimeTransportHandshakeAccept(freshIdentity, tabAIdentity)
      )
    );
    await freshConnect;
    await waitFor(
      () => activationFrames().length === 65,
      `Expected one clean reconnect frame; received=${activationFrames().length}`
    );
    expect(activationFrames().at(-1)?.type).toBe('FRESH_1');
    expect(activationFrames().some((message) => message.type.startsWith('OVERFLOW_'))).toBe(false);
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

  it('does not activate a peer when delayed auth succeeds after handshake timeout', async () => {
    vi.useFakeTimers();
    try {
      const network = new FakeBroadcastChannelNetwork();
      const telemetry: Array<{ type: string; peerNodeAddress?: string }> = [];
      let verifyCalls = 0;
      let resolveFirstAuth!: (result: { ok: true }) => void;
      const firstAuth = new Promise<{ ok: true }>((resolve) => {
        resolveFirstAuth = resolve;
      });
      const tabA = createTransport(network, 'tab-a', {
        connectTimeoutMs: 25,
        telemetry: (event) => telemetry.push(event),
        auth: {
          verify: () => {
            verifyCalls += 1;
            return verifyCalls === 1 ? firstAuth : { ok: true };
          },
        },
      });
      await tabA.start();

      const tabAIdentity = testIdentity('tab-a');
      const delayedIdentity = testIdentity('tab-b', 'tab-b-delayed-auth');
      const delayedConnect = tabA.connect('tab-b');
      await Promise.resolve();
      await Promise.resolve();
      network.broadcast(
        TEST_CHANNEL_NAME,
        testEnvelope(
          delayedIdentity,
          'tab-a',
          createRuntimeTransportHandshakeAccept(delayedIdentity, tabAIdentity)
        )
      );
      await Promise.resolve();
      expect(verifyCalls).toBe(1);

      const timeoutAssertion = expect(delayedConnect).rejects.toThrow(
        'Timed out waiting for BroadcastChannel runtime handshake from tab-b'
      );
      await vi.advanceTimersByTimeAsync(25);
      await timeoutAssertion;
      expect(getBusSubscriberCount(tabA)).toBe(1);

      resolveFirstAuth({ ok: true });
      await Promise.resolve();
      await Promise.resolve();

      expect(telemetry.filter((event) => event.type === 'auth.accepted')).toHaveLength(0);
      expect(getBusSubscriberCount(tabA)).toBe(1);
      expect(tabA.isConnected('tab-b')).toBe(false);

      const freshIdentity = testIdentity('tab-b', 'tab-b-fresh-auth');
      const freshConnect = tabA.connect('tab-b');
      await Promise.resolve();
      await Promise.resolve();
      network.broadcast(
        TEST_CHANNEL_NAME,
        testEnvelope(
          freshIdentity,
          'tab-a',
          createRuntimeTransportHandshakeAccept(freshIdentity, tabAIdentity)
        )
      );
      await freshConnect;

      expect(verifyCalls).toBe(2);
      expect(telemetry.filter((event) => event.type === 'auth.accepted')).toHaveLength(1);
      expect(getBusSubscriberCount(tabA)).toBe(2);
      expect(tabA.isConnected('tab-b')).toBe(true);

      await tabA.disconnect('tab-b');
      expect(getBusSubscriberCount(tabA)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ActorSystem BroadcastChannel directory readiness', () => {
  it('publishes syncing then ready facts through defensive public snapshots', async () => {
    const transport = new ControlledDirectoryTransport();
    const system = new ActorSystemImpl({
      nodeAddress: 'tab-a',
      transport,
    });
    await system.start();

    try {
      expect(system.getClusterState().directoryReadiness).toEqual([]);

      await transport.connect('tab-b');
      await waitFor(
        () => system.getClusterState().directoryReadiness?.[0]?.status === 'syncing',
        'tab-b should publish directory syncing while the response is pending'
      );

      const syncing: DirectoryReadinessFact = {
        nodeAddress: 'tab-b',
        nodeId: 'tab-b',
        incarnation: 'tab-b-boot',
        status: 'syncing',
      };
      const rootExport: RootDirectoryReadinessFact = syncing;
      const browserExport: BrowserDirectoryReadinessFact = syncing;
      expect(system.getClusterState().directoryReadiness).toEqual([rootExport]);
      expect(browserExport.status).toBe('syncing');
      expect(system.getClusterState().nodes).toContain('tab-b');

      transport.releaseDirectorySync();
      await waitFor(
        () => system.getClusterState().directoryReadiness?.[0]?.status === 'ready',
        'tab-b should publish directory ready after accepting the response'
      );

      const clusterSnapshot = system.getClusterState();
      const statsSnapshot = await system.getSystemStats();
      expect(statsSnapshot.clusterState).toEqual(clusterSnapshot);

      (clusterSnapshot.nodes as string[]).push('mutated-node');
      (clusterSnapshot.directoryReadiness as DirectoryReadinessFact[]).splice(0);
      expect(system.getClusterState().nodes).not.toContain('mutated-node');
      expect(system.getClusterState().directoryReadiness).toMatchObject([
        { nodeAddress: 'tab-b', status: 'ready' },
      ]);
    } finally {
      transport.releaseAllDirectorySyncs();
      await system.stop();
    }
  });

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

      const degraded = system.getClusterState().directoryReadiness?.[0];
      expect(degraded).toMatchObject({
        nodeAddress: 'tab-b',
        nodeId: 'tab-b',
        incarnation: 'tab-b-boot',
        status: 'degraded',
        failure: {
          code: 'directory_sync_failed',
          message: 'Unexpected directory sync response: __runtime.remote.ask.response',
        },
      });
      if (degraded?.status === 'degraded') {
        (degraded.failure as { message: string }).message = 'mutated failure';
      }
      expect(system.getClusterState().directoryReadiness?.[0]).toMatchObject({
        status: 'degraded',
        failure: {
          message: 'Unexpected directory sync response: __runtime.remote.ask.response',
        },
      });

      let joined = false;
      const retry = system.join(['tab-b']).then(() => {
        joined = true;
      });
      await nextTick();

      expect(joined).toBe(false);
      expect(transport.directorySyncRequests).toBe(2);
      expect(system.getClusterState().directoryReadiness).toMatchObject([
        { nodeAddress: 'tab-b', status: 'syncing' },
      ]);

      transport.releaseDirectorySync();
      await retry;
      expect(joined).toBe(true);
      expect(system.getClusterState().directoryReadiness).toMatchObject([
        { nodeAddress: 'tab-b', status: 'ready' },
      ]);
    } finally {
      transport.releaseAllDirectorySyncs();
      await system.stop();
    }
  });

  it('shares one readiness attempt between automatic connect and lookup miss recovery', async () => {
    const transport = new ControlledDirectoryTransport();
    const system = new ActorSystemImpl({ nodeAddress: 'tab-a', transport });
    await system.start();

    try {
      await transport.connect('tab-b');
      const lookup = system.lookup('actor://tab-b/missing');
      await nextTick();

      expect(transport.directorySyncRequests).toBe(1);
      transport.releaseDirectorySync();
      await expect(lookup).resolves.toBeUndefined();
      expect(system.getClusterState().directoryReadiness).toMatchObject([
        { nodeAddress: 'tab-b', status: 'ready' },
      ]);
    } finally {
      transport.releaseAllDirectorySyncs();
      await system.stop();
    }
  });

  it('refreshes a ready directory once for concurrent lookup misses', async () => {
    const transport = new ControlledDirectoryTransport();
    const directory = new RecordingActorDirectory();
    const system = new ActorSystemImpl({
      nodeAddress: 'tab-a',
      transport,
      directory: { implementation: directory },
    });
    const remoteEntry: RuntimeDirectoryEntry = {
      address: parseActorPath('actor://tab-b/registered-after-ready'),
      location: 'tab-b',
      timestamp: 2,
      ttl: Number.POSITIVE_INFINITY,
    };
    await system.start();

    try {
      await transport.connect('tab-b');
      transport.releaseDirectorySync();
      await waitFor(
        () => system.getClusterState().directoryReadiness?.[0]?.status === 'ready',
        'the initial directory sync should become ready'
      );
      expect(transport.directorySyncRequests).toBe(1);

      vi.spyOn(
        system as unknown as {
          primeRemoteProjectionWatcher(address: ActorAddress): Promise<void>;
        },
        'primeRemoteProjectionWatcher'
      ).mockResolvedValue(undefined);
      transport.queueDirectoryEntries([remoteEntry]);

      const firstLookup = system.lookup(remoteEntry.address);
      const secondLookup = system.lookup(remoteEntry.address);
      await waitFor(
        () => transport.directorySyncRequests === 2,
        'concurrent misses should start exactly one refresh after ready'
      );
      expect(system.getClusterState().directoryReadiness).toMatchObject([
        { nodeAddress: 'tab-b', status: 'syncing' },
      ]);

      transport.releaseDirectorySync();
      const [firstRef, secondRef] = await Promise.all([firstLookup, secondLookup]);
      expect(firstRef?.address).toBe(remoteEntry.address);
      expect(secondRef?.address).toBe(remoteEntry.address);
      expect(transport.directorySyncRequests).toBe(2);
      expect(system.getClusterState().directoryReadiness).toMatchObject([
        { nodeAddress: 'tab-b', status: 'ready' },
      ]);
    } finally {
      transport.releaseAllDirectorySyncs();
      await system.stop();
    }
  });

  it('removes readiness facts when the peer disconnects', async () => {
    const transport = new ControlledDirectoryTransport();
    const system = new ActorSystemImpl({ nodeAddress: 'tab-a', transport });
    await system.start();

    try {
      await transport.connect('tab-b');
      transport.releaseDirectorySync();
      await waitFor(
        () => system.getClusterState().directoryReadiness?.[0]?.status === 'ready',
        'tab-b should become ready before disconnect'
      );

      await transport.disconnect('tab-b');
      await waitFor(
        () => system.getClusterState().directoryReadiness?.length === 0,
        'tab-b readiness should be removed after disconnect'
      );
      expect(system.getClusterState().nodes).not.toContain('tab-b');
    } finally {
      transport.releaseAllDirectorySyncs();
      await system.stop();
    }
  });

  it('does not apply a late directory snapshot from a replaced incarnation', async () => {
    const transport = new ControlledDirectoryTransport();
    const directory = new RecordingActorDirectory();
    const oldEntry: RuntimeDirectoryEntry = {
      address: parseActorPath('actor://tab-b/old-incarnation'),
      location: 'tab-b',
      timestamp: 1,
      ttl: Number.POSITIVE_INFINITY,
    };
    const replacementEntry: RuntimeDirectoryEntry = {
      address: parseActorPath('actor://tab-b/replacement-incarnation'),
      location: 'tab-b',
      timestamp: 2,
      ttl: Number.POSITIVE_INFINITY,
    };
    const system = new ActorSystemImpl({
      nodeAddress: 'tab-a',
      transport,
      directory: { implementation: directory },
    });
    await system.start();

    try {
      transport.queueDirectoryEntries([oldEntry]);
      await transport.connect('tab-b');
      await waitFor(
        () => transport.directorySyncRequests === 1,
        'the first incarnation should start a sync'
      );

      transport.setPeerIdentity('tab-b', 'tab-b-replacement');
      transport.queueDirectoryEntries([replacementEntry]);
      transport.emitTransportConnected('tab-b');
      await waitFor(
        () => transport.directorySyncRequests === 2,
        'the replacement incarnation should start a separate sync'
      );

      transport.releaseDirectorySync(1);
      await waitFor(
        () => system.getClusterState().directoryReadiness?.[0]?.status === 'ready',
        'the replacement incarnation should become ready first'
      );
      transport.releaseDirectorySync(0);
      await nextTick();

      expect(directory.appliedRemoteEntries).toEqual([replacementEntry]);
      expect(system.getClusterState().directoryReadiness).toMatchObject([
        {
          nodeAddress: 'tab-b',
          nodeId: 'tab-b',
          incarnation: 'tab-b-replacement',
          status: 'ready',
        },
      ]);
    } finally {
      transport.releaseAllDirectorySyncs();
      await system.stop();
    }
  });

  it('does not let a stale failure degrade a replacement incarnation', async () => {
    const transport = new ControlledDirectoryTransport();
    const system = new ActorSystemImpl({ nodeAddress: 'tab-a', transport });
    await system.start();

    try {
      transport.failNextDirectorySync();
      await transport.connect('tab-b');
      await waitFor(
        () => transport.directorySyncRequests === 1,
        'the first incarnation should start a sync'
      );

      transport.setPeerIdentity('tab-b', 'tab-b-replacement');
      transport.emitTransportConnected('tab-b');
      await waitFor(
        () => transport.directorySyncRequests === 2,
        'the replacement incarnation should start a sync'
      );

      transport.releaseDirectorySync(1);
      await waitFor(
        () => system.getClusterState().directoryReadiness?.[0]?.status === 'ready',
        'the replacement incarnation should become ready first'
      );
      transport.releaseDirectorySync(0);
      await nextTick();

      expect(system.getClusterState().directoryReadiness).toMatchObject([
        {
          nodeAddress: 'tab-b',
          incarnation: 'tab-b-replacement',
          status: 'ready',
        },
      ]);
    } finally {
      transport.releaseAllDirectorySyncs();
      await system.stop();
    }
  });

  it('does not warn when a superseded directory sync completes stale', async () => {
    const transport = new ControlledDirectoryTransport();
    const system = new ActorSystemImpl({ nodeAddress: 'tab-a', transport });
    const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    await system.start();

    try {
      await transport.connect('tab-b');
      await waitFor(
        () => transport.directorySyncRequests === 1,
        'the first incarnation should start a sync'
      );

      transport.setPeerIdentity('tab-b', 'tab-b-replacement');
      transport.emitTransportConnected('tab-b');
      await waitFor(
        () => transport.directorySyncRequests === 2,
        'the replacement incarnation should start a sync'
      );

      transport.releaseDirectorySync(1);
      await waitFor(
        () => system.getClusterState().directoryReadiness?.[0]?.status === 'ready',
        'the replacement incarnation should become ready first'
      );
      warnSpy.mockClear();
      transport.releaseDirectorySync(0);
      await nextTick();

      expect(warnSpy).not.toHaveBeenCalledWith(
        'ACTOR_SYSTEM',
        'Failed to sync remote directory on transport connect',
        expect.anything()
      );
    } finally {
      warnSpy.mockRestore();
      transport.releaseAllDirectorySyncs();
      await system.stop();
    }
  });

  it('still warns and publishes degraded when a current directory sync fails', async () => {
    const transport = new ControlledDirectoryTransport();
    const system = new ActorSystemImpl({ nodeAddress: 'tab-a', transport });
    const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    await system.start();

    try {
      transport.failNextDirectorySync();
      await transport.connect('tab-b');
      await waitFor(
        () => transport.directorySyncRequests === 1,
        'the current incarnation should start a sync'
      );
      transport.releaseDirectorySync();
      await waitFor(
        () => system.getClusterState().directoryReadiness?.[0]?.status === 'degraded',
        'a current sync failure should publish degraded'
      );

      expect(warnSpy).toHaveBeenCalledWith(
        'ACTOR_SYSTEM',
        'Failed to sync remote directory on transport connect',
        expect.objectContaining({
          nodeAddress: 'tab-b',
          error: 'Unexpected directory sync response: __runtime.remote.ask.response',
        })
      );
    } finally {
      warnSpy.mockRestore();
      transport.releaseAllDirectorySyncs();
      await system.stop();
    }
  });

  it('syncs the directory again when a same-address peer connects with a new incarnation', async () => {
    const network = new FakeBroadcastChannelNetwork();
    const tabATransport = createTransport(network, 'tab-a');
    const originalTabBTransport = createTransport(network, 'tab-b');
    const tabASystem = new ActorSystemImpl({ nodeAddress: 'tab-a', transport: tabATransport });
    const originalTabBSystem = new ActorSystemImpl({
      nodeAddress: 'tab-b',
      transport: originalTabBTransport,
    });
    await Promise.all([tabATransport.start(), originalTabBTransport.start()]);
    await Promise.all([tabASystem.start(), originalTabBSystem.start()]);

    let replacementTabBSystem: ActorSystemImpl | null = null;
    try {
      await tabASystem.join(['tab-b']);
      expect(
        countPublishedRuntimeMessages(network, 'tab-a', 'tab-b', '__runtime.directory.sync.request')
      ).toBe(1);

      const replacementTabBTransport = createTransport(network, 'tab-b', {
        incarnation: 'tab-b-replacement',
      });
      replacementTabBSystem = new ActorSystemImpl({
        nodeAddress: 'tab-b',
        transport: replacementTabBTransport,
      });
      await replacementTabBTransport.start();
      await replacementTabBSystem.start();
      const replacementActor = await replacementTabBSystem.spawn(
        defineBehavior<{ type: 'GET_INCARNATION' }>()
          .withContext({ incarnation: 'replacement' })
          .onMessage(({ actor }) => ({ reply: actor.getSnapshot().context.incarnation }))
          .build(),
        { id: 'replacement-proof' }
      );
      await replacementTabBTransport.connect('tab-a');
      await tabASystem.join(['tab-b']);

      expect(tabATransport.getPeerStats('tab-b')?.identity?.incarnation).toBe('tab-b-replacement');
      expect(
        countPublishedRuntimeMessages(network, 'tab-a', 'tab-b', '__runtime.directory.sync.request')
      ).toBe(2);
      const replacementRef = await tabASystem.lookup<
        { incarnation: string },
        { type: 'GET_INCARNATION' }
      >(replacementActor.address);
      expect(replacementRef).toBeDefined();
      if (!replacementRef) {
        throw new Error('Expected replacement actor after the second directory sync.');
      }
      await expect(replacementRef.ask<string>({ type: 'GET_INCARNATION' })).resolves.toBe(
        'replacement'
      );
    } finally {
      await Promise.allSettled([
        tabASystem.stop(),
        originalTabBSystem.stop(),
        replacementTabBSystem?.stop(),
      ]);
    }
  });
});
