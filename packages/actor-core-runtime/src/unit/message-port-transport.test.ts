import { describe, expect, it } from 'vitest';
import type { ActorMessage } from '../actor-system.js';
import {
  createMessagePortTransport,
  type MessagePortTransportMessageEvent,
  type MessagePortTransportMessageListener,
  type MessagePortTransportPort,
} from '../message-port-transport.js';

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

describe('createMessagePortTransport', () => {
  it('connects two runtimes through a MessagePort pair', async () => {
    const [localPort, remotePort] = createPairedPorts();
    const local = createMessagePortTransport({
      nodeAddress: 'browser',
      peerAddress: 'worker',
      port: localPort,
    });
    const remote = createMessagePortTransport({
      nodeAddress: 'worker',
      peerAddress: 'browser',
      port: remotePort,
    });

    const remoteEvents: ActorMessage[] = [];
    remote.subscribe((event) => {
      remoteEvents.push(event.message);
    });

    await local.connect();

    expect(local.isConnected('worker')).toBe(true);
    expect(remote.isConnected('browser')).toBe(true);
    expect(remoteEvents.at(-1)).toMatchObject({
      type: '__runtime.transport.connected',
      nodeAddress: 'browser',
    });

    local.destroy();
    remote.destroy();
  });

  it('sends actor messages over the connected port', async () => {
    const [localPort, remotePort] = createPairedPorts();
    const local = createMessagePortTransport({
      nodeAddress: 'browser',
      peerAddress: 'worker',
      port: localPort,
    });
    const remote = createMessagePortTransport({
      nodeAddress: 'worker',
      peerAddress: 'browser',
      port: remotePort,
    });

    const received: Array<{ source: string; message: ActorMessage }> = [];
    remote.subscribe((event) => {
      received.push(event);
    });

    const pingMessage: ActorMessage<{ type: 'PING'; value: number }> = {
      type: 'PING',
      value: 1,
    };

    await local.connect();
    await local.send('worker', pingMessage);

    expect(received.at(-1)).toEqual({
      source: 'browser',
      message: { type: 'PING', value: 1 },
    });

    local.destroy();
    remote.destroy();
  });

  it('disconnects peers through the connected port', async () => {
    const [localPort, remotePort] = createPairedPorts();
    const local = createMessagePortTransport({
      nodeAddress: 'browser',
      peerAddress: 'worker',
      port: localPort,
    });
    const remote = createMessagePortTransport({
      nodeAddress: 'worker',
      peerAddress: 'browser',
      port: remotePort,
    });

    await local.connect();
    await local.disconnect();

    expect(local.isConnected('worker')).toBe(false);
    expect(remote.isConnected('browser')).toBe(false);

    local.destroy();
    remote.destroy();
  });
});
