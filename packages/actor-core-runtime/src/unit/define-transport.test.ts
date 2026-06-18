import { describe, expect, it } from 'vitest';
import type { ActorMessage } from '../actor-system.js';
import {
  type RuntimeTransportFrame,
  validateRuntimeTransportFrame,
} from '../runtime-transport-contract.js';
import {
  defineTransport,
  fromDuplex,
  type TransportDuplex,
} from '../transport/define-transport.js';
import type { TransportTimers } from '../transport/transport-core.js';

// defineTransport / fromDuplex authoring specs (engineering brief §1.4, commit 7). The
// composition root wires an author medium -> fromDuplex/PeerLink -> TransportCore into a
// MessageTransport factory. No reliability logic of its own.

// A controllable in-memory duplex pair: postMessage on one end delivers to onmessage on
// the other, so a fromDuplex PeerLink can round-trip frames with no real socket.
function createDuplexPair(): { a: TransportDuplex; b: TransportDuplex } {
  let aHandler: ((event: { data: unknown }) => void) | undefined;
  let bHandler: ((event: { data: unknown }) => void) | undefined;
  const a: TransportDuplex = {
    postMessage(data: unknown): void {
      queueMicrotask(() => bHandler?.({ data }));
    },
    set onmessage(handler: ((event: { data: unknown }) => void) | null) {
      aHandler = handler ?? undefined;
    },
    get onmessage(): ((event: { data: unknown }) => void) | null {
      return aHandler ?? null;
    },
  };
  const b: TransportDuplex = {
    postMessage(data: unknown): void {
      queueMicrotask(() => aHandler?.({ data }));
    },
    set onmessage(handler: ((event: { data: unknown }) => void) | null) {
      bHandler = handler ?? undefined;
    },
    get onmessage(): ((event: { data: unknown }) => void) | null {
      return bHandler ?? null;
    },
  };
  return { a, b };
}

const noopTimers: TransportTimers = {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
  setInterval: () => 0,
  clearInterval: () => undefined,
};

function userMessage(type: string): ActorMessage {
  return { type, _timestamp: 1, _version: '1.0.0' } as ActorMessage;
}

describe('fromDuplex', () => {
  it('adapts a postMessage/onmessage duplex into a working PeerLink', async () => {
    const { a, b } = createDuplexPair();
    const link = fromDuplex(a, 'peer-x');

    expect(link.remoteAddress).toBe('peer-x');
    expect(link.isOpen).toBe(true);

    const inbound: unknown[] = [];
    const unlisten = link.receive({
      onPayload: (payload) => inbound.push(payload),
      onClosed: () => undefined,
    });

    await link.send('hello-wire');
    // b receives verbatim what a posted (send is a passthrough; the core pre-serializes).
    const fromA: unknown[] = [];
    b.onmessage = (event) => fromA.push(event.data);
    a.postMessage('ping');
    await Promise.resolve();
    expect(fromA).toEqual(['ping']);

    // b -> a is delivered to the link's sink as a PARSED object. The core serializes frames
    // to JSON strings, so the link's parse seam turns the inbound string back into an object
    // before handing it to the sink (handleInboundPayload expects parsed frames).
    b.postMessage(JSON.stringify({ wire: 'pong' }));
    await Promise.resolve();
    expect(inbound).toEqual([{ wire: 'pong' }]);

    unlisten();
    link.close();
    expect(link.isOpen).toBe(false);
    expect(() => link.close()).not.toThrow();
  });

  it('parses inbound JSON strings to objects and drops unparseable strings (errors-as-values)', async () => {
    const { a, b } = createDuplexPair();
    const link = fromDuplex(a, 'peer-x');
    const inbound: unknown[] = [];
    link.receive({
      onPayload: (payload) => inbound.push(payload),
      onClosed: () => undefined,
    });

    // The core serializes outbound frames to JSON strings; the duplex transmits the string
    // verbatim, so the far end must surface a PARSED object to the core's sink.
    b.postMessage(JSON.stringify({ hello: 'world' }));
    // An already-parsed object passes through verbatim.
    b.postMessage({ already: 'object' });
    // A non-JSON string is dropped without throwing or disconnecting.
    b.postMessage('not json {');
    await Promise.resolve();

    expect(inbound).toEqual([{ hello: 'world' }, { already: 'object' }]);
  });

  it('buffers inbound payloads that arrive before receive() and drains them FIFO on subscribe (Q4b race)', async () => {
    const { a, b } = createDuplexPair();
    const link = fromDuplex(a, 'peer-x');

    // Payloads land BEFORE the core subscribes (the dial-time hello read happens before
    // the core's authoritative receive()). The native listener is attached eagerly in the
    // factory body, so these are captured into the pending buffer rather than lost.
    b.postMessage(JSON.stringify({ seq: 1 }));
    b.postMessage(JSON.stringify({ seq: 2 }));
    await Promise.resolve();

    const inbound: unknown[] = [];
    link.receive({
      onPayload: (payload) => inbound.push(payload),
      onClosed: () => undefined,
    });

    // Drained in FIFO order on subscribe — nothing lost between pre-subscribe and receive().
    expect(inbound).toEqual([{ seq: 1 }, { seq: 2 }]);

    // Subsequent live payloads continue to flow to the now-set sink.
    b.postMessage(JSON.stringify({ seq: 3 }));
    await Promise.resolve();
    expect(inbound).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
  });
});

describe('defineTransport', () => {
  it('builds a MessageTransport factory that sends a byte-identical frame over the duplex', async () => {
    const { a, b } = createDuplexPair();
    const onB: unknown[] = [];
    b.onmessage = (event) => onB.push(event.data);

    const factory = defineTransport<{ duplex: TransportDuplex }>(({ duplex }) =>
      fromDuplex(duplex, 'peer-b')
    );
    const transport = factory({
      node: 'node-a',
      nodeAddress: 'node-a',
      duplex: a,
      timers: noopTimers,
      heartbeatIntervalMs: 0,
    });

    await transport.start?.();
    await transport.connect('peer-b');
    await transport.send('peer-b', userMessage('GREET'));
    await Promise.resolve();
    await Promise.resolve();

    const wireFrames = onB
      .map((raw) => JSON.parse(raw as string) as RuntimeTransportFrame)
      .filter((frame) => frame.message?.type === 'GREET');
    expect(wireFrames).toHaveLength(1);
    expect(validateRuntimeTransportFrame(wireFrames[0]).ok).toBe(true);
    expect(wireFrames[0]?.source.nodeAddress).toBe('node-a');
    expect(wireFrames[0]?.destination.nodeAddress).toBe('peer-b');
  });

  it('throws a typed runtime error when the required node identity is omitted', () => {
    const { a } = createDuplexPair();
    const factory = defineTransport<{ duplex: TransportDuplex }>(({ duplex }) =>
      fromDuplex(duplex, 'peer-b')
    );

    expect(() =>
      // @ts-expect-error — node/nodeAddress is required by TransportFactoryOptions.
      factory({ duplex: a, timers: noopTimers })
    ).toThrow(/node/i);
  });
});

describe('defineTransport.server', () => {
  it('builds a MessageTransport factory from a listen author', async () => {
    const factory = defineTransport.server<object>(() => ({
      listen: () => undefined,
    }));
    const transport = factory({
      node: 'server-a',
      nodeAddress: 'server-a',
      timers: noopTimers,
      heartbeatIntervalMs: 0,
    });

    await transport.start?.();
    expect(transport.getConnectedNodes()).toEqual([]);
    await transport.stop?.();
  });
});
