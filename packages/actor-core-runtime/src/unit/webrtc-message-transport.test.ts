import { afterEach, describe, expect, it } from 'vitest';
import type { ActorMessage } from '../actor-system.js';
import {
  type WebRtcDataChannelBootstrap,
  type WebRtcDataChannelLike,
  type WebRtcMessageTransport,
  createWebRtcMessageTransport,
} from '../webrtc-message-transport.js';
import { describeTransportConformance } from '../testing/transport-conformance.js';

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

    this.peer.emit('message', { data } as MessageEvent);
  }

  close(): void {
    if (this.readyState === 'closed') {
      return;
    }

    this.readyState = 'closed';
    this.emit('close', new Event('close'));
    this.peer?.emit('close', new Event('close'));
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

function createTransport(hub: FakeWebRtcBootstrapHub, nodeAddress: string): WebRtcMessageTransport {
  const transport = createWebRtcMessageTransport({
    nodeAddress,
    incarnation: `${nodeAddress}-boot`,
    heartbeatIntervalMs: 0,
    bootstrap: hub.createBootstrap(nodeAddress),
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
