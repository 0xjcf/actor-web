import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ActorMessage } from '../actor-system.js';
import {
  createNodeWebSocketMessageTransport,
  type NodeWebSocketMessageTransport,
} from '../node-websocket-message-transport.js';
import {
  createRuntimeNodeIdentity,
  createRuntimeTransportFrame,
  RUNTIME_TRANSPORT_PROTOCOL_VERSION,
} from '../runtime-transport-contract.js';

const transports: NodeWebSocketMessageTransport[] = [];

async function createStartedTransport(
  nodeAddress: string,
  options: Omit<Parameters<typeof createNodeWebSocketMessageTransport>[0], 'nodeAddress'> = {}
): Promise<NodeWebSocketMessageTransport> {
  const transport = createNodeWebSocketMessageTransport({
    nodeAddress,
    incarnation: `${nodeAddress}-boot`,
    listen: { port: 0 },
    ...options,
  });
  transports.push(transport);
  await transport.start();
  return transport;
}

function waitForMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => {
      resolve(JSON.parse(data.toString()));
    });
    socket.once('error', reject);
  });
}

function waitFor(predicate: () => boolean, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts += 1;
      if (predicate()) {
        clearInterval(interval);
        resolve();
        return;
      }
      if (attempts > 40) {
        clearInterval(interval);
        reject(new Error(message));
      }
    }, 5);
  });
}

describe('NodeWebSocketMessageTransport', () => {
  afterEach(async () => {
    await Promise.allSettled(transports.splice(0).map((transport) => transport.stop()));
  });

  it('starts and stops a localhost listener on an ephemeral port', async () => {
    const transport = await createStartedTransport('node-a');
    expect(transport.getListeningUrl()).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);

    await transport.stop();
    expect(transport.getListeningUrl()).toBeNull();
  });

  it('performs a handshake and records connected peer nodes', async () => {
    const remote = await createStartedTransport('node-b');
    const remoteUrl = remote.getListeningUrl();
    if (!remoteUrl) {
      throw new Error('Expected remote listening URL');
    }
    const local = await createStartedTransport('node-a', {
      peers: { 'node-b': remoteUrl },
    });

    await local.connect('node-b');

    expect(local.isConnected('node-b')).toBe(true);
    expect(remote.isConnected('node-a')).toBe(true);
    expect(local.getConnectedNodes()).toEqual(['node-b']);
  });

  it('rejects unknown peer URLs', async () => {
    const local = await createStartedTransport('node-a');

    await expect(local.connect('node-missing')).rejects.toThrow('No WebSocket peer URL configured');
  });

  it('rejects malformed handshake frames', async () => {
    const remote = await createStartedTransport('node-b');
    const remoteUrl = remote.getListeningUrl();
    if (!remoteUrl) {
      throw new Error('Expected remote listening URL');
    }
    const socket = new WebSocket(remoteUrl);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });

    socket.send(
      JSON.stringify({
        type: 'runtime.handshake.hello',
        protocolVersion: 'actor-web-runtime/999',
        sentAt: '2026-04-24T14:00:00.000Z',
      })
    );

    await expect(waitForMessage(socket)).resolves.toMatchObject({
      type: 'runtime.handshake.reject',
      code: 'incompatible_protocol',
    });
    socket.close();
  });

  it('sends and receives validated runtime frames', async () => {
    const remote = await createStartedTransport('node-b');
    const remoteUrl = remote.getListeningUrl();
    if (!remoteUrl) {
      throw new Error('Expected remote listening URL');
    }
    const local = await createStartedTransport('node-a', {
      peers: { 'node-b': remoteUrl },
    });
    const received: Array<ActorMessage<{ type: 'WORK'; payload: string }>> = [];
    const unsubscribe = remote.subscribe((event) => {
      if (event.message.type === 'WORK') {
        received.push(event.message as ActorMessage<{ type: 'WORK'; payload: string }>);
      }
    });

    await local.connect('node-b');
    await local.send('node-b', {
      type: 'WORK',
      payload: 'ok',
    } as ActorMessage<{ type: 'WORK'; payload: string }>);
    await waitFor(() => received.length === 1, 'Expected remote message');

    unsubscribe();
    expect(received).toEqual([{ type: 'WORK', payload: 'ok' }]);
  });

  it('drops malformed runtime frames and emits disconnect', async () => {
    const remote = await createStartedTransport('node-b');
    const remoteUrl = remote.getListeningUrl();
    if (!remoteUrl) {
      throw new Error('Expected remote listening URL');
    }
    const local = await createStartedTransport('node-a', {
      peers: { 'node-b': remoteUrl },
    });
    const receivedTypes: string[] = [];
    const unsubscribe = remote.subscribe((event) => {
      receivedTypes.push(event.message.type);
    });

    await local.connect('node-b');
    const socket = new WebSocket(remoteUrl);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    const source = createRuntimeNodeIdentity({
      nodeAddress: 'node-a',
      nodeId: 'node-a',
      incarnation: 'node-a-boot',
    });
    const destination = createRuntimeNodeIdentity({
      nodeAddress: 'node-b',
      nodeId: 'node-b',
      incarnation: 'node-b-boot',
    });
    socket.send(
      JSON.stringify({
        ...createRuntimeTransportFrame({
          source,
          destination,
          sequence: 1,
          message: { type: 'INVALID' },
        }),
        protocolVersion: RUNTIME_TRANSPORT_PROTOCOL_VERSION,
        sequence: -1,
      })
    );

    await local.disconnect('node-b');
    await waitFor(
      () => receivedTypes.includes('__runtime.transport.disconnected'),
      'Expected disconnect message'
    );

    socket.close();
    unsubscribe();
  });
});
