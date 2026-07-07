import { afterEach, describe, expect, it } from 'vitest';
import type { ActorMessage } from '../actor-system.js';
import { describeTransportConformance } from '../testing/transport-conformance.js';
import {
  createWebRtcMessageTransport,
  type WebRtcDataChannelBootstrap,
  type WebRtcDataChannelLike,
  type WebRtcMessageTransport,
  type WebRtcMessageTransportOptions,
} from '../webrtc-message-transport.js';

const transports: WebRtcMessageTransport[] = [];

class FakeWebRtcDataChannel implements WebRtcDataChannelLike {
  readonly label: string;
  readyState: RTCDataChannelState = 'connecting';
  peer: FakeWebRtcDataChannel | null = null;
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(label: string) {
    this.label = label;
  }

  send(data: string): void {
    if (this.readyState !== 'open' || !this.peer || this.peer.readyState !== 'open') {
      throw new Error(`DataChannel ${this.label} is not open.`);
    }

    const peer = this.peer;
    queueMicrotask(() => {
      if (peer.readyState === 'open') {
        peer.emit('message', { data } as MessageEvent);
      }
    });
  }

  close(): void {
    if (this.readyState === 'closing' || this.readyState === 'closed') {
      return;
    }

    this.readyState = 'closing';
    const peer = this.peer;
    queueMicrotask(() => {
      if (this.readyState === 'closed') {
        return;
      }

      this.readyState = 'closed';
      this.emit('close', new Event('close'));
      peer?.close();
    });
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  open(): void {
    if (this.readyState !== 'connecting') {
      return;
    }

    this.readyState = 'open';
    this.emit('open', new Event('open'));
  }

  private emit(type: string, event: Event): void {
    for (const listener of Array.from(this.listeners.get(type) ?? [])) {
      listener(event);
    }
  }
}

class FakeWebRtcBootstrapHub {
  readonly pairs: Array<{
    readonly local: FakeWebRtcDataChannel;
    readonly remote: FakeWebRtcDataChannel;
  }> = [];
  private readonly listeners = new Map<
    string,
    (event: { dataChannel: WebRtcDataChannelLike }) => void
  >();

  createBootstrap(nodeAddress: string): WebRtcDataChannelBootstrap {
    return {
      openDataChannel: async ({ remoteAddress }) => {
        const listener = this.listeners.get(remoteAddress);
        if (!listener) {
          throw new Error(`No WebRTC listener for ${remoteAddress}.`);
        }

        const local = new FakeWebRtcDataChannel(`${nodeAddress}->${remoteAddress}`);
        const remote = new FakeWebRtcDataChannel(`${remoteAddress}<-${nodeAddress}`);
        local.peer = remote;
        remote.peer = local;
        this.pairs.push({ local, remote });

        listener({ dataChannel: remote });
        queueMicrotask(() => {
          local.open();
          remote.open();
        });

        return local;
      },
      listen: (listener) => {
        this.listeners.set(nodeAddress, listener);
        return () => {
          this.listeners.delete(nodeAddress);
        };
      },
    };
  }
}

function createTransport(
  hub: FakeWebRtcBootstrapHub,
  nodeAddress: string,
  options: Omit<Partial<WebRtcMessageTransportOptions>, 'bootstrap' | 'nodeAddress'> = {}
): WebRtcMessageTransport {
  const transport = createWebRtcMessageTransport({
    nodeAddress,
    incarnation: `${nodeAddress}-boot`,
    heartbeatIntervalMs: 0,
    bootstrap: hub.createBootstrap(nodeAddress),
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

describe('WebRtcMessageTransport', () => {
  afterEach(async () => {
    await Promise.allSettled(transports.splice(0).map((transport) => transport.stop()));
  });

  it('connects peers over an injected RTCDataChannel bootstrap and dispatches runtime messages', async () => {
    const hub = new FakeWebRtcBootstrapHub();
    const browserA = createTransport(hub, 'browser-a');
    const browserB = createTransport(hub, 'browser-b');
    const received: Array<{ source: string; message: ActorMessage }> = [];
    browserB.subscribe((event) => received.push(event));

    await Promise.all([browserA.start(), browserB.start()]);
    await browserA.connect('browser-b');
    await browserA.send('browser-b', { type: 'PING' });

    await waitFor(
      () => received.some((event) => event.source === 'browser-a' && event.message.type === 'PING'),
      `browser-b should receive browser-a message; received=${JSON.stringify(received)}`
    );
    expect(browserA.isConnected('browser-b')).toBe(true);
    expect(browserB.isConnected('browser-a')).toBe(true);
  });

  it('rejects a dial when the bootstrap cannot provide a data channel', async () => {
    const hub = new FakeWebRtcBootstrapHub();
    const browserA = createTransport(hub, 'browser-a');

    await browserA.start();

    await expect(browserA.connect('missing-browser')).rejects.toThrow(
      /No WebRTC listener for missing-browser/
    );
    expect(browserA.isConnected('missing-browser')).toBe(false);
  });

  it('times out bootstrap channel creation and closes a late data channel', async () => {
    let resolveLateChannel:
      | ((dataChannel: WebRtcDataChannelLike | PromiseLike<WebRtcDataChannelLike>) => void)
      | null = null;
    const browserA = createWebRtcMessageTransport({
      nodeAddress: 'browser-a',
      incarnation: 'browser-a-boot',
      heartbeatIntervalMs: 0,
      connectTimeoutMs: 1,
      bootstrap: {
        openDataChannel: () =>
          new Promise<WebRtcDataChannelLike>((resolve) => {
            resolveLateChannel = resolve;
          }),
      },
    });
    transports.push(browserA);
    await browserA.start();

    await expect(browserA.connect('browser-b')).rejects.toThrow(
      /Timed out waiting for WebRTC bootstrap to open browser-b/
    );

    const lateChannel = new FakeWebRtcDataChannel('late-channel');
    resolveLateChannel?.(lateChannel);
    await nextTick();

    expect(lateChannel.readyState).toBe('closed');
  });

  it('closes both data-channel ends when inbound auth rejects the runtime handshake', async () => {
    const hub = new FakeWebRtcBootstrapHub();
    const browserA = createTransport(hub, 'browser-a');
    const browserB = createTransport(hub, 'browser-b', {
      auth: {
        verify: () => ({ ok: false, reason: 'test auth rejected' }),
      },
    });

    await Promise.all([browserA.start(), browserB.start()]);

    await expect(browserA.connect('browser-b')).rejects.toThrow(/test auth rejected/);

    const pair = hub.pairs.at(-1);
    await waitFor(
      () => pair?.local.readyState === 'closed' && pair.remote.readyState === 'closed',
      'auth rejection should close both WebRTC data channel ends'
    );
    expect(pair?.local.readyState).toBe('closed');
    expect(pair?.remote.readyState).toBe('closed');
    expect(browserA.isConnected('browser-b')).toBe(false);
    expect(browserB.isConnected('browser-a')).toBe(false);
  });

  it('closes opened data channels when outbound auth token creation fails', async () => {
    const hub = new FakeWebRtcBootstrapHub();
    const browserA = createTransport(hub, 'browser-a', {
      auth: {
        token: () => {
          throw new Error('token provider failed');
        },
      },
    });
    const browserB = createTransport(hub, 'browser-b');

    await Promise.all([browserA.start(), browserB.start()]);

    await expect(browserA.connect('browser-b')).rejects.toThrow(/token provider failed/);

    const pair = hub.pairs.at(-1);
    await waitFor(
      () => pair?.local.readyState === 'closed' && pair.remote.readyState === 'closed',
      'outbound auth token failure should close both WebRTC data channel ends'
    );
    expect(pair?.local.readyState).toBe('closed');
    expect(pair?.remote.readyState).toBe('closed');
    expect(browserA.isConnected('browser-b')).toBe(false);
    expect(browserB.isConnected('browser-a')).toBe(false);
  });

  it('rejects and closes both data-channel ends when inbound auth verification throws', async () => {
    const hub = new FakeWebRtcBootstrapHub();
    const listenerErrors: unknown[] = [];
    const browserA = createTransport(hub, 'browser-a');
    const browserB = createTransport(hub, 'browser-b', {
      auth: {
        verify: () => {
          throw new Error('auth verifier failed');
        },
      },
      onListenerError: (error) => {
        listenerErrors.push(error);
      },
    });

    await Promise.all([browserA.start(), browserB.start()]);

    await expect(browserA.connect('browser-b')).rejects.toThrow(/auth verifier failed/);

    const pair = hub.pairs.at(-1);
    await waitFor(
      () => pair?.local.readyState === 'closed' && pair.remote.readyState === 'closed',
      'thrown inbound auth verifier should close both WebRTC data channel ends'
    );
    expect(pair?.local.readyState).toBe('closed');
    expect(pair?.remote.readyState).toBe('closed');
    expect(listenerErrors).toHaveLength(1);
    expect(listenerErrors[0]).toBeInstanceOf(Error);
    expect((listenerErrors[0] as Error).message).toBe('auth verifier failed');
    expect(browserA.isConnected('browser-b')).toBe(false);
    expect(browserB.isConnected('browser-a')).toBe(false);
  });

  it('fails fast when the data channel closes during the outbound runtime handshake', async () => {
    const local = new FakeWebRtcDataChannel('browser-a->browser-b');
    const remote = new FakeWebRtcDataChannel('browser-b<-browser-a');
    local.peer = remote;
    remote.peer = local;
    remote.addEventListener('message', () => {
      remote.close();
    });
    const browserA = createWebRtcMessageTransport({
      nodeAddress: 'browser-a',
      incarnation: 'browser-a-boot',
      heartbeatIntervalMs: 0,
      connectTimeoutMs: 1000,
      bootstrap: {
        openDataChannel: async () => {
          queueMicrotask(() => {
            local.open();
            remote.open();
          });
          return local;
        },
      },
    });
    transports.push(browserA);
    await browserA.start();

    await expect(browserA.connect('browser-b')).rejects.toThrow(/closed during handshake/);
    await waitFor(
      () => local.readyState === 'closed' && remote.readyState === 'closed',
      'handshake close should close both WebRTC data channel ends'
    );
  });
});

describeTransportConformance({
  name: 'webrtc',
  capabilities: {
    ordering: true,
    safeDispatch: true,
  },
  async createPair() {
    const hub = new FakeWebRtcBootstrapHub();
    const addrA = 'browser-a';
    const addrB = 'browser-b';
    const a = createTransport(hub, addrA);
    const b = createTransport(hub, addrB);
    await Promise.all([a.start(), b.start()]);
    await a.connect(addrB);

    return {
      a,
      b,
      addrA,
      addrB,
      async teardown() {
        await Promise.allSettled([a.disconnect(addrB), b.disconnect(addrA), a.stop(), b.stop()]);
      },
    };
  },
});
