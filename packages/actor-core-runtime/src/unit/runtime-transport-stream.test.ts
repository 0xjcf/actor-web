import { describe, expect, it, vi } from 'vitest';
import type { ActorMessage, MessageTransport } from '../actor-system.js';
import {
  createRuntimeTransportStreamChunkMessage,
  createRuntimeTransportStreamHost,
} from '../runtime-transport-stream.js';

class Deferred<T = void> {
  readonly promise: Promise<T>;
  private resolvePromise?: (value: T | PromiseLike<T>) => void;
  private rejectPromise?: (error: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  resolve(value: T): void {
    this.resolvePromise?.(value);
  }

  reject(error: unknown): void {
    this.rejectPromise?.(error);
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
    await vi.waitFor(() => expect(received).toHaveLength(1));

    expect(received).toEqual([{ token: 'hello' }]);
    expect(secondResolved).toBe(false);
    expect(closeResolved).toBe(false);
    expect(streamClosed).toBe(false);

    firstChunkDrain.resolve();
    await secondWrite;
    await closePromise;
    await streamClosedDrain.promise;

    expect(received).toEqual([{ token: 'hello' }, { token: 'world' }]);
    expect(secondResolved).toBe(true);
    expect(closeResolved).toBe(true);
    expect(streamClosed).toBe(true);

    await hostA.stop();
    await hostB.stop();
  });

  it('fails the peer stream when the receiver consumer rejects a chunk', async () => {
    const network = new LinkedTransportNetwork();
    const transportA = network.create('node-a');
    const transportB = network.create('node-b');
    await transportA.connect('node-b');
    await transportB.connect('node-a');

    const hostA = createRuntimeTransportStreamHost({
      transport: transportA,
      nodeAddress: 'node-a',
      initialCredit: 1,
      streamIdFactory: () => 'agent-output-stream-2',
    });
    const hostB = createRuntimeTransportStreamHost({
      transport: transportB,
      nodeAddress: 'node-b',
      initialCredit: 1,
    });
    const chunkFailure = new Deferred<void>();
    const receiverErrors: string[] = [];

    hostB.subscribe(() => ({
      async onChunk() {
        await chunkFailure.promise;
      },
      onError(error) {
        receiverErrors.push(error.code);
      },
    }));

    const stream = await hostA.open('node-b');
    await stream.write({ token: 'bad' });
    const blockedWrite = stream.write({ token: 'after' });

    chunkFailure.reject(new Error('chunk boom'));

    await expect(blockedWrite).rejects.toThrow('chunk boom');
    await vi.waitFor(() => expect(receiverErrors).toEqual(['consumer_failed']));

    expect(receiverErrors).toEqual(['consumer_failed']);

    await hostA.stop();
    await hostB.stop();
  });

  it('notifies the local consumer when an incoming stream sequence is invalid', async () => {
    const network = new LinkedTransportNetwork();
    const transportA = network.create('node-a');
    const transportB = network.create('node-b');
    await transportA.connect('node-b');
    await transportB.connect('node-a');

    const hostA = createRuntimeTransportStreamHost({
      transport: transportA,
      nodeAddress: 'node-a',
      initialCredit: 1,
      streamIdFactory: () => 'agent-output-stream-3',
    });
    const hostB = createRuntimeTransportStreamHost({
      transport: transportB,
      nodeAddress: 'node-b',
      initialCredit: 1,
    });
    const receiverError = new Deferred<string>();

    hostB.subscribe(() => ({
      onChunk() {
        throw new Error('unexpected chunk delivery');
      },
      onError(error) {
        receiverError.resolve(error.code);
      },
    }));

    await hostA.open('node-b');
    await transportA.send(
      'node-b',
      createRuntimeTransportStreamChunkMessage({
        streamId: 'agent-output-stream-3',
        sequence: 2,
        payload: { token: 'out-of-order' },
      })
    );

    await expect(receiverError.promise).resolves.toBe('sequence_mismatch');

    await hostA.stop();
    await hostB.stop();
  });

  it('notifies incoming consumers when the stream host stops', async () => {
    const network = new LinkedTransportNetwork();
    const transportA = network.create('node-a');
    const transportB = network.create('node-b');
    await transportA.connect('node-b');
    await transportB.connect('node-a');

    const hostA = createRuntimeTransportStreamHost({
      transport: transportA,
      nodeAddress: 'node-a',
      initialCredit: 1,
      streamIdFactory: () => 'agent-output-stream-4',
    });
    const hostB = createRuntimeTransportStreamHost({
      transport: transportB,
      nodeAddress: 'node-b',
      initialCredit: 1,
    });
    const opened = new Deferred<void>();
    const receiverError = new Deferred<string>();

    hostB.subscribe(() => {
      opened.resolve(undefined);
      return {
        onChunk() {
          throw new Error('unexpected chunk delivery');
        },
        onError(error) {
          receiverError.resolve(error.code);
        },
      };
    });

    await hostA.open('node-b');
    await opened.promise;
    await vi.waitFor(() =>
      expect(transportB.send).toHaveBeenCalledWith(
        'node-a',
        expect.objectContaining({ type: '__runtime.stream.credit' })
      )
    );
    await hostB.stop();

    await expect(receiverError.promise).resolves.toBe('stream_host_stopped');

    await hostA.stop();
  });
});
