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
import { createInMemoryRuntimeTransportIdempotencyProvider } from '../runtime-transport-idempotency.js';
import type { RuntimeTransportTelemetryEvent } from '../runtime-transport-telemetry.js';

const transports: NodeWebSocketMessageTransport[] = [];

async function createStartedTransport(
  nodeAddress: string,
  options: Omit<Parameters<typeof createNodeWebSocketMessageTransport>[0], 'nodeAddress'> = {}
): Promise<NodeWebSocketMessageTransport> {
  const transport = createNodeWebSocketMessageTransport({
    nodeAddress,
    incarnation: `${nodeAddress}-boot`,
    heartbeatIntervalMs: 0,
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
    const telemetry: RuntimeTransportTelemetryEvent[] = [];
    const local = await createStartedTransport('node-a', {
      telemetry: (event) => telemetry.push(event),
      peers: { 'node-b': remoteUrl },
    });

    await local.connect('node-b');

    expect(local.isConnected('node-b')).toBe(true);
    expect(remote.isConnected('node-a')).toBe(true);
    expect(local.getConnectedNodes()).toEqual(['node-b']);
    expect(local.getPeerState('node-b')).toBe('connected');
    expect(local.getPeerSnapshot('node-b')).toMatchObject({
      nodeAddress: 'node-b',
      state: 'connected',
      identity: {
        nodeAddress: 'node-b',
        nodeId: 'node-b',
        incarnation: 'node-b-boot',
      },
    });
    expect(telemetry.map((event) => event.type)).toEqual(
      expect.arrayContaining(['peer.connecting', 'handshake.accepted', 'peer.connected'])
    );
    expect(local.getStats()).toMatchObject({
      nodeAddress: 'node-a',
      connectedPeerCount: 1,
      handshakeAcceptedCount: 1,
      peers: {
        'node-b': expect.objectContaining({
          state: 'connected',
          handshakeAcceptedCount: 1,
        }),
      },
    });
  });

  it('accepts peers with valid handshake auth and emits auth telemetry', async () => {
    const telemetry: RuntimeTransportTelemetryEvent[] = [];
    const remote = await createStartedTransport('node-b', {
      telemetry: (event) => telemetry.push(event),
      auth: {
        verifyToken: ({ token }) => token === 'runtime-secret',
      },
    });
    const remoteUrl = remote.getListeningUrl();
    if (!remoteUrl) {
      throw new Error('Expected remote listening URL');
    }
    const local = await createStartedTransport('node-a', {
      peers: { 'node-b': remoteUrl },
      auth: {
        token: () => 'runtime-secret',
      },
    });

    await local.connect('node-b');

    expect(remote.isConnected('node-a')).toBe(true);
    expect(telemetry).toContainEqual(
      expect.objectContaining({
        type: 'auth.accepted',
        nodeAddress: 'node-b',
        peerNodeAddress: 'node-a',
      })
    );
  });

  it('rejects missing or invalid peer auth before registration without leaking tokens', async () => {
    const telemetry: RuntimeTransportTelemetryEvent[] = [];
    const remote = await createStartedTransport('node-b', {
      telemetry: (event) => telemetry.push(event),
      auth: {
        verifyToken: ({ token }) => token === 'expected-secret',
      },
    });
    const remoteUrl = remote.getListeningUrl();
    if (!remoteUrl) {
      throw new Error('Expected remote listening URL');
    }
    const local = await createStartedTransport('node-a', {
      peers: { 'node-b': remoteUrl },
      auth: {
        token: () => 'wrong-secret',
      },
    });

    await expect(local.connect('node-b')).rejects.toThrow('Runtime handshake rejected');

    expect(remote.isConnected('node-a')).toBe(false);
    expect(remote.getPeerState('node-a')).toBe('rejected');
    expect(telemetry).toContainEqual(
      expect.objectContaining({
        type: 'auth.rejected',
        nodeAddress: 'node-b',
        peerNodeAddress: 'node-a',
        reason: 'Authentication rejected.',
      })
    );
    expect(JSON.stringify(telemetry)).not.toContain('wrong-secret');
  });

  it('tracks peer state transitions from connecting to connected to disconnected', async () => {
    const remote = await createStartedTransport('node-b');
    const remoteUrl = remote.getListeningUrl();
    if (!remoteUrl) {
      throw new Error('Expected remote listening URL');
    }
    const local = await createStartedTransport('node-a', {
      peers: { 'node-b': remoteUrl },
    });

    const connectPromise = local.connect('node-b');
    expect(local.getPeerState('node-b')).toBe('connecting');
    await connectPromise;

    expect(local.getPeerState('node-b')).toBe('connected');
    expect(local.getPeerIdentity('node-b')).toMatchObject({
      nodeAddress: 'node-b',
      nodeId: 'node-b',
      incarnation: 'node-b-boot',
    });

    await local.disconnect('node-b');
    expect(local.getPeerState('node-b')).toBe('disconnected');
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

  it('drops duplicate runtime frames before subscriber delivery', async () => {
    const telemetry: RuntimeTransportTelemetryEvent[] = [];
    const remote = await createStartedTransport('node-b', {
      telemetry: (event) => telemetry.push(event),
    });
    const remoteUrl = remote.getListeningUrl();
    if (!remoteUrl) {
      throw new Error('Expected remote listening URL');
    }
    const local = await createStartedTransport('node-a', {
      peers: { 'node-b': remoteUrl },
    });
    const received: string[] = [];
    const unsubscribe = remote.subscribe((event) => {
      received.push(event.message.type);
    });

    await local.connect('node-b');
    const remotePeer = (
      remote as unknown as {
        peers: Map<string, { socket: WebSocket }>;
      }
    ).peers.get('node-a');
    if (!remotePeer) {
      throw new Error('Expected remote peer');
    }

    const frame = createRuntimeTransportFrame({
      source: createRuntimeNodeIdentity({
        nodeAddress: 'node-a',
        nodeId: 'node-a',
        incarnation: 'node-a-boot',
      }),
      destination: createRuntimeNodeIdentity({
        nodeAddress: 'node-b',
        nodeId: 'node-b',
        incarnation: 'node-b-boot',
      }),
      messageId: 'node-a:node-a-boot:node-b:duplicate-1',
      sequence: 1,
      message: { type: 'DUPLICATE_WORK' },
    });

    const data = Buffer.from(JSON.stringify(frame));
    (
      remote as unknown as {
        handleRuntimeFrame: (
          sourceNodeAddress: string,
          socket: WebSocket,
          data: Buffer
        ) => Promise<void>;
      }
    ).handleRuntimeFrame('node-a', remotePeer.socket, data);
    (
      remote as unknown as {
        handleRuntimeFrame: (
          sourceNodeAddress: string,
          socket: WebSocket,
          data: Buffer
        ) => Promise<void>;
      }
    ).handleRuntimeFrame('node-a', remotePeer.socket, data);

    await waitFor(() => received.includes('DUPLICATE_WORK'), 'Expected first frame');
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(received.filter((type) => type === 'DUPLICATE_WORK')).toHaveLength(1);
    expect(remote.getPeerStats('node-a')).toMatchObject({
      framesReceived: 1,
      duplicateFramesDropped: 1,
    });
    expect(remote.getStats()).toMatchObject({
      framesReceived: 1,
      duplicateFramesDropped: 1,
    });
    expect(telemetry).toContainEqual(
      expect.objectContaining({
        type: 'frame.duplicate',
        peerNodeAddress: 'node-a',
        messageId: 'node-a:node-a-boot:node-b:duplicate-1',
      })
    );

    unsubscribe();
  });

  it('drops duplicate runtime frames across transport restarts when a provider is configured', async () => {
    const idempotencyProvider = createInMemoryRuntimeTransportIdempotencyProvider();
    const firstRemote = await createStartedTransport('node-b', {
      idempotencyProvider,
      incarnation: 'node-b-boot',
    });
    const firstRemoteUrl = firstRemote.getListeningUrl();
    if (!firstRemoteUrl) {
      throw new Error('Expected remote listening URL');
    }
    const local = await createStartedTransport('node-a', {
      peers: { 'node-b': firstRemoteUrl },
    });
    const firstReceived: string[] = [];
    const firstUnsubscribe = firstRemote.subscribe((event) => {
      firstReceived.push(event.message.type);
    });

    await local.connect('node-b');
    const firstRemotePeer = (
      firstRemote as unknown as {
        peers: Map<string, { socket: WebSocket }>;
      }
    ).peers.get('node-a');
    if (!firstRemotePeer) {
      throw new Error('Expected first remote peer');
    }

    const firstFrame = createRuntimeTransportFrame({
      source: createRuntimeNodeIdentity({
        nodeAddress: 'node-a',
        nodeId: 'node-a',
        incarnation: 'node-a-boot',
      }),
      destination: createRuntimeNodeIdentity({
        nodeAddress: 'node-b',
        nodeId: 'node-b',
        incarnation: 'node-b-boot',
      }),
      messageId: 'node-a:node-a-boot:node-b:duplicate-restart-1',
      sequence: 1,
      message: { type: 'DUPLICATE_AFTER_RESTART' },
    });

    await (
      firstRemote as unknown as {
        handleRuntimeFrame: (
          sourceNodeAddress: string,
          socket: WebSocket,
          data: Buffer
        ) => Promise<void>;
      }
    ).handleRuntimeFrame('node-a', firstRemotePeer.socket, Buffer.from(JSON.stringify(firstFrame)));
    await waitFor(
      () => firstReceived.includes('DUPLICATE_AFTER_RESTART'),
      'Expected first restart frame'
    );
    firstUnsubscribe();
    await firstRemote.stop();

    const restartedRemote = await createStartedTransport('node-b', {
      idempotencyProvider,
      incarnation: 'node-b-restart',
    });
    const restartedRemoteUrl = restartedRemote.getListeningUrl();
    if (!restartedRemoteUrl) {
      throw new Error('Expected restarted remote listening URL');
    }
    const restartedReceived: string[] = [];
    const restartedUnsubscribe = restartedRemote.subscribe((event) => {
      restartedReceived.push(event.message.type);
    });

    await local.disconnect('node-b');
    (
      local as unknown as {
        options: { peers?: Record<string, string> };
      }
    ).options.peers = { 'node-b': restartedRemoteUrl };
    await local.connect('node-b');
    const restartedRemotePeer = (
      restartedRemote as unknown as {
        peers: Map<string, { socket: WebSocket }>;
      }
    ).peers.get('node-a');
    if (!restartedRemotePeer) {
      throw new Error('Expected restarted remote peer');
    }

    const duplicateAfterRestart = createRuntimeTransportFrame({
      source: createRuntimeNodeIdentity({
        nodeAddress: 'node-a',
        nodeId: 'node-a',
        incarnation: 'node-a-boot',
      }),
      destination: createRuntimeNodeIdentity({
        nodeAddress: 'node-b',
        nodeId: 'node-b',
        incarnation: 'node-b-restart',
      }),
      messageId: 'node-a:node-a-boot:node-b:duplicate-restart-1',
      sequence: 1,
      message: { type: 'DUPLICATE_AFTER_RESTART' },
    });

    await (
      restartedRemote as unknown as {
        handleRuntimeFrame: (
          sourceNodeAddress: string,
          socket: WebSocket,
          data: Buffer
        ) => Promise<void>;
      }
    ).handleRuntimeFrame(
      'node-a',
      restartedRemotePeer.socket,
      Buffer.from(JSON.stringify(duplicateAfterRestart))
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(restartedReceived).not.toContain('DUPLICATE_AFTER_RESTART');
    expect(restartedRemote.getStats()).toMatchObject({
      duplicateFramesDropped: 1,
      idempotencyProviderEnabled: true,
      idempotencyProviderDuplicateCount: 1,
    });
    restartedUnsubscribe();
  });

  it('surfaces idempotency provider failures without accepting the frame', async () => {
    const telemetry: RuntimeTransportTelemetryEvent[] = [];
    const remote = await createStartedTransport('node-b', {
      telemetry: (event) => telemetry.push(event),
      idempotencyProvider: {
        claim() {
          throw new Error('durable idempotency unavailable');
        },
      },
    });
    const remoteUrl = remote.getListeningUrl();
    if (!remoteUrl) {
      throw new Error('Expected remote listening URL');
    }
    const local = await createStartedTransport('node-a', {
      peers: { 'node-b': remoteUrl },
    });
    const received: string[] = [];
    const unsubscribe = remote.subscribe((event) => {
      received.push(event.message.type);
    });

    await local.connect('node-b');
    const remotePeer = (
      remote as unknown as {
        peers: Map<string, { socket: WebSocket }>;
      }
    ).peers.get('node-a');
    if (!remotePeer) {
      throw new Error('Expected remote peer');
    }

    const frame = createRuntimeTransportFrame({
      source: createRuntimeNodeIdentity({
        nodeAddress: 'node-a',
        nodeId: 'node-a',
        incarnation: 'node-a-boot',
      }),
      destination: createRuntimeNodeIdentity({
        nodeAddress: 'node-b',
        nodeId: 'node-b',
        incarnation: 'node-b-boot',
      }),
      messageId: 'node-a:node-a-boot:node-b:provider-error-1',
      sequence: 1,
      message: { type: 'PROVIDER_ERROR_FRAME' },
    });

    await (
      remote as unknown as {
        handleRuntimeFrame: (
          sourceNodeAddress: string,
          socket: WebSocket,
          data: Buffer
        ) => Promise<void>;
      }
    ).handleRuntimeFrame('node-a', remotePeer.socket, Buffer.from(JSON.stringify(frame)));
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(received).not.toContain('PROVIDER_ERROR_FRAME');
    expect(remote.getStats()).toMatchObject({
      idempotencyProviderEnabled: true,
      idempotencyProviderErrorCount: 1,
      lastIdempotencyProviderErrorMessage: 'durable idempotency unavailable',
      malformedFramesDropped: 0,
      validationFramesDropped: 0,
    });
    expect(remote.getPeerStats('node-a')).toMatchObject({
      idempotencyProviderErrorCount: 1,
      malformedFramesDropped: 0,
      validationFramesDropped: 0,
    });
    expect(remote.isConnected('node-a')).toBe(false);
    expect(telemetry).toContainEqual(
      expect.objectContaining({
        type: 'idempotency.provider.error',
        peerNodeAddress: 'node-a',
        reason: 'durable idempotency unavailable',
      })
    );
    expect(telemetry).toContainEqual(
      expect.objectContaining({
        type: 'frame.dropped',
        peerNodeAddress: 'node-a',
        reason: 'Runtime idempotency provider claim failed.',
        dropCode: 'idempotency_provider_error',
      })
    );
    unsubscribe();
  });

  it('acks retryable runtime control frames', async () => {
    const localTelemetry: RuntimeTransportTelemetryEvent[] = [];
    const remote = await createStartedTransport('node-b');
    const remoteUrl = remote.getListeningUrl();
    if (!remoteUrl) {
      throw new Error('Expected remote listening URL');
    }
    const local = await createStartedTransport('node-a', {
      telemetry: (event) => localTelemetry.push(event),
      peers: { 'node-b': remoteUrl },
    });

    await local.connect('node-b');
    await local.send('node-b', {
      type: '__runtime.test.control',
    } as ActorMessage<{ type: '__runtime.test.control' }>);

    await waitFor(
      () => local.getPeerStats('node-b')?.framesAcked === 1,
      'Expected runtime control ack'
    );
    expect(local.getStats()).toMatchObject({
      framesAcked: 1,
      framesRetried: 0,
      retryExhaustedCount: 0,
    });
    expect(localTelemetry).toContainEqual(
      expect.objectContaining({
        type: 'frame.ack.received',
        peerNodeAddress: 'node-b',
        messageType: '__runtime.test.control',
      })
    );
  });

  it('retries retryable runtime control frames and exhausts when no ack arrives', async () => {
    const localTelemetry: RuntimeTransportTelemetryEvent[] = [];
    const remote = await createStartedTransport('node-b');
    (
      remote as unknown as {
        sendAck: (sourceNodeAddress: string, peer: unknown, frame: unknown) => Promise<void>;
      }
    ).sendAck = async () => {};
    const remoteUrl = remote.getListeningUrl();
    if (!remoteUrl) {
      throw new Error('Expected remote listening URL');
    }
    const local = await createStartedTransport('node-a', {
      ackTimeoutMs: 5,
      maxAckRetries: 1,
      telemetry: (event) => localTelemetry.push(event),
      peers: { 'node-b': remoteUrl },
    });

    await local.connect('node-b');
    await local.send('node-b', {
      type: '__runtime.test.control',
    } as ActorMessage<{ type: '__runtime.test.control' }>);

    await waitFor(
      () => local.getPeerStats('node-b')?.retryExhaustedCount === 1,
      'Expected retry exhaustion'
    );
    expect(local.getPeerStats('node-b')).toMatchObject({
      framesSent: 2,
      framesRetried: 1,
      retryExhaustedCount: 1,
    });
    expect(remote.getPeerStats('node-a')).toMatchObject({
      framesReceived: 1,
      duplicateFramesDropped: 1,
    });
    expect(localTelemetry.map((event) => event.type)).toEqual(
      expect.arrayContaining(['frame.retry.scheduled', 'frame.retry.exhausted'])
    );
  });

  it('rejects sends when the outbound queue is full', async () => {
    const telemetry: RuntimeTransportTelemetryEvent[] = [];
    const remote = await createStartedTransport('node-b');
    const remoteUrl = remote.getListeningUrl();
    if (!remoteUrl) {
      throw new Error('Expected remote listening URL');
    }
    const local = await createStartedTransport('node-a', {
      outboundQueueLimit: 1,
      telemetry: (event) => telemetry.push(event),
      peers: { 'node-b': remoteUrl },
    });

    await local.connect('node-b');
    let releaseSend: (() => void) | undefined;
    (
      local as unknown as {
        sendJson: (socket: WebSocket, frame: unknown) => Promise<void>;
      }
    ).sendJson = async () =>
      new Promise<void>((resolve) => {
        releaseSend = resolve;
      });

    const first = local.send('node-b', { type: 'QUEUE_ONE' } as ActorMessage);
    const second = local.send('node-b', { type: 'QUEUE_TWO' } as ActorMessage);
    await expect(local.send('node-b', { type: 'QUEUE_THREE' } as ActorMessage)).rejects.toThrow(
      'outbound queue to node-b is full'
    );

    expect(local.getPeerStats('node-b')).toMatchObject({
      outboundQueueDepth: 1,
      outboundFramesDropped: 1,
      backpressureDropCount: 1,
    });
    expect(telemetry.map((event) => event.type)).toEqual(
      expect.arrayContaining(['outbound.queue.dropped', 'backpressure.applied'])
    );

    releaseSend?.();
    await first;
    releaseSend?.();
    await second;
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
    const remotePeer = (
      remote as unknown as {
        peers: Map<string, { socket: WebSocket }>;
      }
    ).peers.get('node-a');
    if (!remotePeer) {
      throw new Error('Expected remote peer');
    }
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
    (
      remote as unknown as {
        handleRuntimeFrame: (sourceNodeAddress: string, socket: WebSocket, data: Buffer) => void;
      }
    ).handleRuntimeFrame(
      'node-a',
      remotePeer.socket,
      Buffer.from(
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
      )
    );

    await waitFor(
      () => receivedTypes.includes('__runtime.transport.disconnected'),
      'Expected disconnect message'
    );

    expect(remote.getStats()).toMatchObject({
      malformedFramesDropped: 1,
      peers: {
        'node-a': expect.objectContaining({
          malformedFramesDropped: 1,
        }),
      },
    });

    unsubscribe();
  });

  it('tracks frame telemetry and sequence gaps without changing delivery', async () => {
    const telemetry: RuntimeTransportTelemetryEvent[] = [];
    const remote = await createStartedTransport('node-b', {
      telemetry: (event) => telemetry.push(event),
    });
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
    const remotePeer = (
      remote as unknown as {
        peers: Map<string, { socket: WebSocket }>;
      }
    ).peers.get('node-a');
    if (!remotePeer) {
      throw new Error('Expected remote peer');
    }

    (
      remote as unknown as {
        handleRuntimeFrame: (sourceNodeAddress: string, socket: WebSocket, data: Buffer) => void;
      }
    ).handleRuntimeFrame(
      'node-a',
      remotePeer.socket,
      Buffer.from(
        JSON.stringify(
          createRuntimeTransportFrame({
            source: createRuntimeNodeIdentity({
              nodeAddress: 'node-a',
              nodeId: 'node-a',
              incarnation: 'node-a-boot',
            }),
            destination: createRuntimeNodeIdentity({
              nodeAddress: 'node-b',
              nodeId: 'node-b',
              incarnation: 'node-b-boot',
            }),
            sequence: 3,
            message: { type: 'GAP_FRAME' },
          })
        )
      )
    );

    await waitFor(() => receivedTypes.includes('GAP_FRAME'), 'Expected gap frame delivery');

    expect(remote.getPeerStats('node-a')).toMatchObject({
      framesReceived: 1,
      lastReceivedSequence: 3,
      sequenceGapCount: 1,
    });
    expect(remote.getStats()).toMatchObject({
      framesReceived: 1,
      sequenceGapCount: 1,
    });
    expect(telemetry.map((event) => event.type)).toEqual(
      expect.arrayContaining(['frame.received', 'sequence.gap'])
    );

    unsubscribe();
  });

  it('closes stale sockets when heartbeat times out and emits disconnected', async () => {
    const remote = await createStartedTransport('node-b');
    const remoteUrl = remote.getListeningUrl();
    if (!remoteUrl) {
      throw new Error('Expected remote listening URL');
    }
    const local = await createStartedTransport('node-a', {
      heartbeatIntervalMs: 1000,
      heartbeatTimeoutMs: 1,
      peers: { 'node-b': remoteUrl },
    });
    const receivedTypes: string[] = [];
    const unsubscribe = local.subscribe((event) => {
      receivedTypes.push(event.message.type);
    });

    await local.connect('node-b');
    const peer = (
      local as unknown as {
        peers: Map<string, unknown>;
      }
    ).peers.get('node-b');
    (
      local as unknown as {
        armHeartbeatTimeout: (nodeAddress: string, peer: unknown) => void;
      }
    ).armHeartbeatTimeout('node-b', peer);

    await waitFor(() => local.getPeerState('node-b') === 'disconnected', 'Expected timeout');

    expect(receivedTypes).toContain('__runtime.transport.disconnected');
    unsubscribe();
  });

  it('replaces a peer with the same node id and a new incarnation', async () => {
    const local = await createStartedTransport('node-a');
    const remoteOne = await createStartedTransport('node-b', {
      nodeId: 'stable-node-b',
      incarnation: 'node-b-boot-1',
      peers: { 'node-a': local.getListeningUrl() ?? '' },
    });

    await remoteOne.connect('node-a');
    expect(local.getPeerSnapshot('node-b')).toMatchObject({
      state: 'connected',
      identity: { nodeId: 'stable-node-b', incarnation: 'node-b-boot-1' },
    });

    const remoteTwo = await createStartedTransport('node-b', {
      nodeId: 'stable-node-b',
      incarnation: 'node-b-boot-2',
      peers: { 'node-a': local.getListeningUrl() ?? '' },
    });
    await remoteTwo.connect('node-a');

    await waitFor(
      () => local.getPeerSnapshot('node-b')?.identity?.incarnation === 'node-b-boot-2',
      'Expected replacement peer identity'
    );
    await waitFor(
      () => remoteOne.getPeerState('node-a') === 'disconnected',
      'Expected replaced peer socket to close'
    );
    expect(local.getPeerSnapshot('node-b')).toMatchObject({
      state: 'connected',
      identity: { nodeId: 'stable-node-b', incarnation: 'node-b-boot-2' },
    });
  });

  it('rejects a connection with the same node address and a different node id', async () => {
    const local = await createStartedTransport('node-a');
    const remoteOne = await createStartedTransport('node-b', {
      nodeId: 'stable-node-b',
      peers: { 'node-a': local.getListeningUrl() ?? '' },
    });
    await remoteOne.connect('node-a');

    const remoteTwo = await createStartedTransport('node-b', {
      nodeId: 'different-node-b',
      incarnation: 'node-b-boot-conflict',
      peers: { 'node-a': local.getListeningUrl() ?? '' },
    });

    await expect(remoteTwo.connect('node-a')).rejects.toThrow('identity conflict');
    expect(local.getPeerSnapshot('node-b')).toMatchObject({
      state: 'connected',
      identity: { nodeId: 'stable-node-b' },
    });
    expect(remoteTwo.getPeerState('node-a')).toBe('rejected');
    expect(local.getPeerIdentity('node-b')).toMatchObject({ nodeId: 'stable-node-b' });
  });

  it('ignores frames from sockets replaced by a newer incarnation', async () => {
    const local = await createStartedTransport('node-a');
    const localUrl = local.getListeningUrl();
    if (!localUrl) {
      throw new Error('Expected local listening URL');
    }
    const remoteOne = await createStartedTransport('node-b', {
      nodeId: 'stable-node-b',
      incarnation: 'node-b-boot-1',
      peers: { 'node-a': localUrl },
    });
    const receivedTypes: string[] = [];
    const unsubscribe = local.subscribe((event) => {
      receivedTypes.push(event.message.type);
    });

    await remoteOne.connect('node-a');
    const remoteOneSocket = (
      remoteOne as unknown as {
        peers: Map<
          string,
          { socket: WebSocket; identity: ReturnType<typeof createRuntimeNodeIdentity> }
        >;
      }
    ).peers.get('node-a')?.socket;
    if (!remoteOneSocket) {
      throw new Error('Expected first remote socket');
    }

    const remoteTwo = await createStartedTransport('node-b', {
      nodeId: 'stable-node-b',
      incarnation: 'node-b-boot-2',
      peers: { 'node-a': localUrl },
    });
    await remoteTwo.connect('node-a');
    await waitFor(
      () => local.getPeerSnapshot('node-b')?.identity?.incarnation === 'node-b-boot-2',
      'Expected replacement peer'
    );

    (
      local as unknown as {
        handleRuntimeFrame: (sourceNodeAddress: string, socket: WebSocket, data: Buffer) => void;
      }
    ).handleRuntimeFrame(
      'node-b',
      remoteOneSocket,
      Buffer.from(
        JSON.stringify(
          createRuntimeTransportFrame({
            source: createRuntimeNodeIdentity({
              nodeAddress: 'node-b',
              nodeId: 'stable-node-b',
              incarnation: 'node-b-boot-1',
            }),
            destination: createRuntimeNodeIdentity({
              nodeAddress: 'node-a',
              nodeId: 'node-a',
              incarnation: 'node-a-boot',
            }),
            sequence: 1,
            message: { type: 'STALE_SOCKET' },
          })
        )
      )
    );

    await remoteTwo.send('node-a', {
      type: 'CURRENT_SOCKET',
    } as ActorMessage<{ type: 'CURRENT_SOCKET' }>);

    await waitFor(() => receivedTypes.includes('CURRENT_SOCKET'), 'Expected current frame');
    expect(receivedTypes).not.toContain('STALE_SOCKET');
    unsubscribe();
  });
});
