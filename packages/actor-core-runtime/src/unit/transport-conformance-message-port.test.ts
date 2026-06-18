import {
  createMessagePortTransport,
  type MessagePortTransportMessageEvent,
  type MessagePortTransportMessageListener,
  type MessagePortTransportPort,
} from '../message-port-transport.js';
import { describeTransportConformance } from '../testing/transport-conformance.js';

// Paired in-process MessagePorts, mirroring the white-box helper in
// message-port-transport.test.ts: postMessage on one port emits a 'message'
// event on its peer, so two transports exchange envelopes synchronously.
class PairedPort implements MessagePortTransportPort {
  private readonly listeners = new Set<MessagePortTransportMessageListener>();
  private closed = false;
  peer: PairedPort | null = null;

  postMessage(message: unknown): void {
    if (this.closed || !this.peer) {
      return;
    }

    this.peer.emit({ data: message });
  }

  start(): void {}

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }

  addEventListener(type: 'message', listener: MessagePortTransportMessageListener): void {
    if (type === 'message') {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: 'message', listener: MessagePortTransportMessageListener): void {
    if (type === 'message') {
      this.listeners.delete(listener);
    }
  }

  private emit(event: MessagePortTransportMessageEvent): void {
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }
}

function createPairedPorts(): [MessagePortTransportPort, MessagePortTransportPort] {
  const a = new PairedPort();
  const b = new PairedPort();
  a.peer = b;
  b.peer = a;

  return [a, b];
}

// MessagePort transport: synchronous in-process delivery over a paired-port pair.
// It preserves send order. safeDispatch is true: deliver() routes each listener
// through the shared safeDispatchListener (PR 4), so a throwing or async-rejecting
// subscriber no longer escapes or starves siblings.
describeTransportConformance({
  name: 'message-port',
  capabilities: {
    ordering: true,
    safeDispatch: true,
  },
  async createPair() {
    const addrA = 'conformance-a';
    const addrB = 'conformance-b';
    const [portA, portB] = createPairedPorts();

    const a = createMessagePortTransport({
      nodeAddress: addrA,
      peerAddress: addrB,
      port: portA,
    });
    const b = createMessagePortTransport({
      nodeAddress: addrB,
      peerAddress: addrA,
      port: portB,
    });

    await a.connect();

    return {
      a,
      b,
      addrA,
      addrB,
      async teardown() {
        a.destroy();
        b.destroy();
      },
    };
  },
});
