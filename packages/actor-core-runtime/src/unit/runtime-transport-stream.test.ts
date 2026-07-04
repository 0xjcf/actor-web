import { describe, expect, it, vi } from 'vitest';
import type { ActorMessage, MessageTransport } from '../actor-system.js';
import { createRuntimeTransportStreamHost } from '../runtime-transport-stream.js';

class Deferred<T = void> {
  readonly promise: Promise<T>;
  private resolvePromise?: (value: T | PromiseLike<T>) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  resolve(value: T): void {
    this.resolvePromise?.(value);
  }
}

class LinkedTransportNetwork {
  private readonly transports = new Map<string, LinkedTransport>();

  create(nodeAddress: string): LinkedTransport {
    const transport = new LinkedTransport(nodeAddress, this);
    this.transports.set(nodeAddress, transport);
    return transport;
  }

  deliver(source: string, destination: string, message: ActorMessage): void {
    this.transports.get(destination)?.deliver({ source, message });
  }
}

class LinkedTransport implements MessageTransport {
  private readonly listeners = new Set<
    (event: { source: string; message: ActorMessage }) => void
  >();
  private readonly connected = new Set<string>();
  readonly send = vi.fn(async (destination: string, message: ActorMessage) => {
    if (!this.connected.has(destination)) {
      throw new Error(`Transport ${this.nodeAddress} is not connected to ${destination}`);
    }
    this.network.deliver(this.nodeAddress, destination, message);
  });

  constructor(
    private readonly nodeAddress: string,
    private readonly network: LinkedTransportNetwork
  ) {}

  subscribe(listener: (event: { source: string; message: ActorMessage }) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async connect(address: string): Promise<void> {
    this.connected.add(address);
  }

  async disconnect(address: string): Promise<void> {
    this.connected.delete(address);
  }

  getConnectedNodes(): string[] {
    return Array.from(this.connected);
  }

  isConnected(address: string): boolean {
    return this.connected.has(address);
  }

  deliver(event: { source: string; message: ActorMessage }): void {
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('runtime transport streams', () => {
  it('holds later chunks until the receiver returns stream credit', async () => {
    const network = new LinkedTransportNetwork();
    const transportA = network.create('node-a');
    const transportB = network.create('node-b');
    await transportA.connect('node-b');
    await transportB.connect('node-a');

    const hostA = createRuntimeTransportStreamHost({
      transport: transportA,
      nodeAddress: 'node-a',
      initialCredit: 1,
      streamIdFactory: () => 'agent-output-stream-1',
    });
    const hostB = createRuntimeTransportStreamHost({
      transport: transportB,
      nodeAddress: 'node-b',
      initialCredit: 1,
    });
    const firstChunkDrain = new Deferred<void>();
    const streamClosedDrain = new Deferred<void>();
    const received: unknown[] = [];
    let streamClosed = false;

    hostB.subscribe(() => ({
      async onChunk(chunk) {
        received.push(chunk.payload);
        if (chunk.sequence === 1) {
          await firstChunkDrain.promise;
        }
      },
      onClose() {
        streamClosed = true;
        streamClosedDrain.resolve(undefined);
      },
    }));

    const stream = await hostA.open('node-b', {
      metadata: { kind: 'agent-output' },
    });

    await stream.write({ token: 'hello' });
    const secondWrite = stream.write({ token: 'world' });
    let secondResolved = false;
    secondWrite.then(() => {
      secondResolved = true;
    });
    const closePromise = stream.close();
    let closeResolved = false;
    closePromise.then(() => {
      closeResolved = true;
    });
    await flushMicrotasks();

    expect(received).toEqual([{ token: 'hello' }]);
    expect(secondResolved).toBe(false);
    expect(closeResolved).toBe(false);
    expect(streamClosed).toBe(false);

    firstChunkDrain.resolve();
    await secondWrite;
    await closePromise;
    await streamClosedDrain.promise;
    await flushMicrotasks();

    expect(received).toEqual([{ token: 'hello' }, { token: 'world' }]);
    expect(secondResolved).toBe(true);
    expect(closeResolved).toBe(true);
    expect(streamClosed).toBe(true);

    await hostA.stop();
    await hostB.stop();
  });
});
