import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { MessageTransport } from '../actor-system.js';
import type { RuntimeGatewayServerFrame } from '../runtime-gateway.js';
import { createInMemoryRuntimePeerDiscoveryProvider } from '../runtime-peer-discovery.js';
import { createInMemoryRuntimeTransportIdempotencyProvider } from '../runtime-transport-idempotency.js';
import {
  createInMemoryRuntimeTransportTelemetrySink,
  createRuntimeTransportTelemetryExporter,
} from '../runtime-transport-telemetry.js';
import { serveActorWebNode } from '../serve-actor-web-node.js';
import { actor, defineActorWebTopology, node, tool } from '../topology.js';
import { defineActor } from '../unified-actor-builder.js';

type CounterCommand =
  | { type: 'INCREMENT' }
  | { type: 'GET_COUNT' }
  | { type: 'RUN_TOOL'; toolName?: string; value: string };

function createCounterBehavior() {
  return defineActor<CounterCommand>()
    .withContext({ count: 0 })
    .onMessage(async ({ message, actor, tools }) => {
      const context = actor.getSnapshot().context;
      if (message.type === 'GET_COUNT') {
        return { reply: context.count };
      }
      if (message.type === 'RUN_TOOL') {
        const result = await tools.execute<string>(message.toolName ?? 'agent.echo', {
          value: message.value,
        });
        return { reply: result };
      }

      return {
        context: {
          count: context.count + 1,
        },
        emit: [{ type: 'COUNT_CHANGED' as const, count: context.count + 1 }],
      };
    })
    .build();
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function waitForSocketClose(socket: WebSocket): Promise<{ code: number; reason: Buffer }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => {
      resolve({ code, reason: Buffer.from(reason) });
    });
  });
}

function collectFrames(socket: WebSocket): { nextFrame(): Promise<RuntimeGatewayServerFrame> } {
  const frames: RuntimeGatewayServerFrame[] = [];
  const waiters: Array<(frame: RuntimeGatewayServerFrame) => void> = [];
  socket.on('message', (data) => {
    const frame = JSON.parse(
      Buffer.from(data as Buffer).toString('utf8')
    ) as RuntimeGatewayServerFrame;
    const waiter = waiters.shift();
    if (waiter) {
      waiter(frame);
      return;
    }

    frames.push(frame);
  });

  return {
    nextFrame(): Promise<RuntimeGatewayServerFrame> {
      const frame = frames.shift();
      if (frame) {
        return Promise.resolve(frame);
      }

      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
  };
}

async function waitFor<T>(
  read: () => T | undefined | Promise<T | undefined>,
  message: string,
  timeoutMs = 2_000
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await read();
    if (value !== undefined) {
      return value;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error(message);
}

describe('serveActorWebNode', () => {
  it('starts a topology node, spawns owned actors, and exposes a gateway source', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
        worker: node('worker-node'),
      },
      actors: {
        counter: actor({
          id: 'counter',
          node: 'server',
          behavior: createCounterBehavior,
          gateway: true,
        }),
        workerCounter: actor({
          id: 'worker-counter',
          node: 'worker',
          behavior: createCounterBehavior,
        }),
      },
    });

    const served = await serveActorWebNode(topology, {
      node: 'server',
      transport: true,
      gateway: true,
    });

    try {
      expect(served.getTransportUrl()).toMatch(/^ws:\/\/127\.0\.0\.1:/);
      expect(served.getGatewayUrl()).toMatch(/^ws:\/\/127\.0\.0\.1:/);
      expect(served.getActor('counter')?.address.path).toBe('actor://server-node/actor/counter');
      expect(served.getActor('workerCounter')).toBeUndefined();
      expect(() => served.requireActor('workerCounter')).toThrow(
        'Actor-Web node did not spawn actor "workerCounter".'
      );

      const counter = served.requireActor('counter');
      await counter.send({ type: 'INCREMENT' });
      await served.system.flush();
      await expect(counter.ask<number>({ type: 'GET_COUNT' })).resolves.toBe(1);

      const socket = new WebSocket(served.getGatewayUrl() ?? '');
      const gatewayFrames = collectFrames(socket);
      await waitForSocketOpen(socket);
      socket.send(JSON.stringify({ type: 'hello', clientVersion: 'test' }));
      const ready = await gatewayFrames.nextFrame();
      expect(ready.type).toBe('ready');

      socket.send(
        JSON.stringify({
          type: 'subscribe',
          streamId: 'counter-stream',
          scope: { kind: 'counter' },
        })
      );
      const status = await gatewayFrames.nextFrame();
      const snapshot = await gatewayFrames.nextFrame();
      expect(status.type).toBe('status');
      expect(snapshot).toMatchObject({
        type: 'snapshot',
        streamId: 'counter-stream',
        projection: {
          address: {
            path: 'actor://server-node/actor/counter',
          },
          context: {
            count: 1,
          },
        },
      });
      const closePromise = waitForSocketClose(socket);
      socket.close();
      await closePromise;
    } finally {
      await served.stop();
    }
  });

  it('applies gateway auth configured on the served topology node', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
      },
      actors: {
        counter: actor({
          id: 'counter',
          node: 'server',
          behavior: createCounterBehavior,
          gateway: true,
        }),
      },
    });

    const served = await serveActorWebNode(topology, {
      node: 'server',
      gateway: {
        auth: {
          verifyToken: ({ token }) => token === 'gateway-secret',
        },
      },
    });

    try {
      const rejected = new WebSocket(served.getGatewayUrl() ?? '');
      const rejectedFrames = collectFrames(rejected);
      await waitForSocketOpen(rejected);
      rejected.send(
        JSON.stringify({
          type: 'hello',
          auth: { scheme: 'token', token: 'wrong-gateway-secret' },
        })
      );
      await expect(rejectedFrames.nextFrame()).resolves.toMatchObject({
        type: 'error',
        code: 'unauthorized',
      });
      const rejectedClose = waitForSocketClose(rejected);
      rejected.close();
      await rejectedClose;

      const accepted = new WebSocket(served.getGatewayUrl() ?? '');
      const acceptedFrames = collectFrames(accepted);
      await waitForSocketOpen(accepted);
      accepted.send(
        JSON.stringify({
          type: 'hello',
          auth: { scheme: 'token', token: 'gateway-secret' },
        })
      );
      await expect(acceptedFrames.nextFrame()).resolves.toMatchObject({
        type: 'ready',
      });
      const acceptedClose = waitForSocketClose(accepted);
      accepted.close();
      await acceptedClose;
    } finally {
      await served.stop();
    }
  });

  it('fails closed on malformed raw gateway JSON without throwing from the WebSocket callback', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
      },
      actors: {
        counter: actor({
          id: 'counter',
          node: 'server',
          behavior: createCounterBehavior,
          gateway: true,
        }),
      },
    });

    const served = await serveActorWebNode(topology, {
      node: 'server',
      gateway: true,
    });

    try {
      const socket = new WebSocket(served.getGatewayUrl() ?? '');
      const gatewayFrames = collectFrames(socket);
      const closePromise = waitForSocketClose(socket);
      await waitForSocketOpen(socket);

      socket.send('{"type":"hello"');

      await expect(gatewayFrames.nextFrame()).resolves.toMatchObject({
        type: 'error',
        code: 'invalid_frame',
        message: 'Gateway frame must be valid JSON.',
        recoverable: false,
      });
      await expect(closePromise).resolves.toMatchObject({
        code: expect.any(Number),
      });
    } finally {
      await served.stop();
    }
  });

  it('normalizes invalid gateway inbound queue limits to the default safe bound', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
      },
      actors: {
        counter: actor({
          id: 'counter',
          node: 'server',
          behavior: createCounterBehavior,
          gateway: true,
        }),
      },
    });

    const served = await serveActorWebNode(topology, {
      node: 'server',
      gateway: {
        inboundQueueLimit: 0,
      },
    });

    try {
      const socket = new WebSocket(served.getGatewayUrl() ?? '');
      const gatewayFrames = collectFrames(socket);
      await waitForSocketOpen(socket);
      socket.send(JSON.stringify({ type: 'hello', clientVersion: 'test' }));
      await expect(gatewayFrames.nextFrame()).resolves.toMatchObject({
        type: 'ready',
      });

      socket.send(
        JSON.stringify({
          type: 'subscribe',
          streamId: 'counter-stream',
          scope: { kind: 'counter' },
        })
      );
      await expect(gatewayFrames.nextFrame()).resolves.toMatchObject({
        type: 'status',
        streamId: 'counter-stream',
      });
      await expect(gatewayFrames.nextFrame()).resolves.toMatchObject({
        type: 'snapshot',
        streamId: 'counter-stream',
      });

      for (let index = 0; index < 3; index += 1) {
        socket.send(
          JSON.stringify({
            type: 'ping',
            sentAt: `2026-04-23T15:00:0${index}.000Z`,
          })
        );
      }

      await expect(gatewayFrames.nextFrame()).resolves.toMatchObject({
        type: 'pong',
        sentAt: '2026-04-23T15:00:00.000Z',
      });
      await expect(gatewayFrames.nextFrame()).resolves.toMatchObject({
        type: 'pong',
        sentAt: '2026-04-23T15:00:01.000Z',
      });
      await expect(gatewayFrames.nextFrame()).resolves.toMatchObject({
        type: 'pong',
        sentAt: '2026-04-23T15:00:02.000Z',
      });

      const closePromise = waitForSocketClose(socket);
      socket.close();
      await closePromise;
    } finally {
      await served.stop();
    }
  });

  it('exposes configured remote topology actors through the node gateway', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
        worker: node('worker-node'),
      },
      actors: {
        serverCounter: actor({
          id: 'server-counter',
          node: 'server',
          behavior: createCounterBehavior,
        }),
        workerCounter: actor({
          id: 'worker-counter',
          node: 'worker',
          behavior: createCounterBehavior,
          gateway: true,
        }),
      },
    });

    const worker = await serveActorWebNode(topology, {
      node: 'worker',
      transport: true,
    });
    const served = await serveActorWebNode(topology, {
      node: 'server',
      transport: true,
      peers: {
        worker: worker.getTransportUrl() ?? '',
      },
      connect: ['worker'],
      gateway: {
        expose: ['workerCounter'],
      },
    });

    try {
      const workerCounter = worker.getActor('workerCounter');
      await workerCounter?.send({ type: 'INCREMENT' });
      await worker.system.flush();

      const socket = new WebSocket(served.getGatewayUrl() ?? '');
      const gatewayFrames = collectFrames(socket);
      await waitForSocketOpen(socket);
      socket.send(JSON.stringify({ type: 'hello', clientVersion: 'test' }));
      const ready = await gatewayFrames.nextFrame();
      expect(ready.type).toBe('ready');

      socket.send(
        JSON.stringify({
          type: 'subscribe',
          streamId: 'worker-counter-stream',
          scope: { kind: 'workerCounter' },
        })
      );
      const status = await gatewayFrames.nextFrame();
      const snapshot = await gatewayFrames.nextFrame();
      expect(status.type).toBe('status');
      expect(snapshot).toMatchObject({
        type: 'snapshot',
        streamId: 'worker-counter-stream',
        projection: {
          address: {
            path: 'actor://worker-node/actor/worker-counter',
          },
          context: {
            count: 1,
          },
        },
      });
      const closePromise = waitForSocketClose(socket);
      socket.close();
      await closePromise;
    } finally {
      await served.stop();
      await worker.stop();
    }
  });

  it('rejects actors without behavior when they are owned by the served node', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
      },
      actors: {
        missing: actor({
          id: 'missing',
          node: 'server',
        }),
      },
    });

    await expect(serveActorWebNode(topology, { node: 'server' })).rejects.toThrow(
      'does not declare behavior'
    );
  });

  it('rolls back a partial startup failure before discovery publish and preserves the original error', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
      },
      actors: {
        counter: actor({
          id: 'counter',
          node: 'server',
          behavior: createCounterBehavior,
          gateway: true,
        }),
      },
    });
    const registerSelf = vi.fn(async () => undefined);
    const unregisterSelf = vi.fn(async () => undefined);

    await expect(
      serveActorWebNode(topology, {
        node: 'server',
        transport: true,
        gateway: true,
        discovery: {
          getPeers: async () => [],
          subscribe: () => {
            throw new Error('subscribe failed');
          },
          registerSelf,
          unregisterSelf,
        },
      })
    ).rejects.toThrow('subscribe failed');

    expect(registerSelf).not.toHaveBeenCalled();
    expect(unregisterSelf).not.toHaveBeenCalled();
  });

  it('injects registered tools into topology-owned node actors', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
      },
      actors: {
        agent: actor({
          id: 'agent',
          node: 'server',
          behavior: createCounterBehavior,
          tools: [tool('agent.echo')],
        }),
      },
    });

    const served = await serveActorWebNode(topology, {
      node: 'server',
      tools: {
        'agent.echo': (input) => {
          const payload = input as { value: string };
          return `node-tool:${payload.value}`;
        },
        'agent.secret': () => 'hidden',
      },
    });

    try {
      await expect(
        served.getActor('agent')?.ask<string>({ type: 'RUN_TOOL', value: 'fas' })
      ).resolves.toBe('node-tool:fas');
      await expect(
        served
          .getActor('agent')
          ?.ask<string>({ type: 'RUN_TOOL', toolName: 'agent.secret', value: 'fas' })
      ).rejects.toThrow('Actor tool "agent.secret" is not registered.');
    } finally {
      await served.stop();
    }
  });

  it('creates parameterized actor instances from topology actor ids', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
      },
      actors: {
        shipment: actor({
          id: ({ shipmentId }: { shipmentId: string }) => `shipment-${shipmentId}`,
          node: 'server',
          behavior: createCounterBehavior,
          supervision: {
            strategy: 'restart',
            maxRestarts: 3,
            withinMs: 60_000,
          },
        }),
      },
    });

    const served = await serveActorWebNode(topology, { node: 'server' });

    try {
      expect(served.getActor('shipment')).toBeUndefined();
      expect(topology.actors.shipment.resolveAddress({ shipmentId: '1001' })).toMatchObject({
        id: 'shipment-1001',
        path: 'actor://server-node/actor/shipment-1001',
      });

      const first = await served.actors.shipment.instance({ shipmentId: '1001' });
      const second = await served.actors.shipment.instance({ shipmentId: '1001' });
      expect(second).toBe(first);
      expect(first.address.path).toBe('actor://server-node/actor/shipment-1001');

      await first.send({ type: 'INCREMENT' });
      await served.system.flush();
      await expect(first.ask<number>({ type: 'GET_COUNT' })).resolves.toBe(1);
    } finally {
      await served.stop();
    }
  });

  it('deduplicates concurrent parameterized actor spawns and clears failed in-flight state', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
      },
      actors: {
        shipment: actor({
          id: ({ shipmentId }: { shipmentId: string }) => `shipment-${shipmentId}`,
          node: 'server',
          behavior: createCounterBehavior,
        }),
      },
    });
    const served = await serveActorWebNode(topology, { node: 'server' });

    await served.start();
    try {
      const originalSpawn = served.system.spawn.bind(served.system);
      const spawnSpy = vi.spyOn(served.system, 'spawn');
      spawnSpy.mockImplementationOnce(async () => {
        throw new Error('spawn failed');
      });
      spawnSpy.mockImplementation(originalSpawn);

      const [firstFailure, secondFailure] = await Promise.allSettled([
        served.actors.shipment.instance({ shipmentId: '1001' }),
        served.actors.shipment.instance({ shipmentId: '1001' }),
      ]);
      expect(firstFailure).toMatchObject({
        status: 'rejected',
        reason: new Error('spawn failed'),
      });
      expect(secondFailure).toMatchObject({
        status: 'rejected',
        reason: new Error('spawn failed'),
      });
      expect(spawnSpy).toHaveBeenCalledTimes(1);

      const actorRef = await served.actors.shipment.instance({ shipmentId: '1001' });
      const cachedRef = await served.actors.shipment.instance({ shipmentId: '1001' });
      expect(actorRef).toBe(cachedRef);
      expect(spawnSpy).toHaveBeenCalledTimes(2);
    } finally {
      await served.stop();
    }
  });

  it('clears spawned actor caches only after system and transport shutdown complete', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
      },
      actors: {
        counter: actor({
          id: 'counter',
          node: 'server',
          behavior: createCounterBehavior,
        }),
      },
    });
    const served = await serveActorWebNode(topology, {
      node: 'server',
      transport: true,
    });

    await served.start();
    const stopOrder: string[] = [];
    const originalSystemStop = served.system.stop.bind(served.system);
    const transportWithStop = served.transport as MessageTransport & {
      stop: () => Promise<void>;
    };
    const originalTransportStop = transportWithStop.stop.bind(transportWithStop);
    vi.spyOn(served.system, 'stop').mockImplementation(async () => {
      stopOrder.push(`system:${Boolean(served.getActor('counter'))}`);
      await originalSystemStop();
    });
    vi.spyOn(transportWithStop, 'stop').mockImplementation(async () => {
      stopOrder.push(`transport:${Boolean(served.getActor('counter'))}`);
      await originalTransportStop();
    });

    await served.stop();

    expect(stopOrder).toEqual(['system:true', 'transport:true']);
    expect(served.getActor('counter')).toBeUndefined();
  });

  it('registers and unregisters listening nodes through discovery', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
      },
      actors: {
        serverCounter: actor({
          id: 'server-counter',
          node: 'server',
          behavior: createCounterBehavior,
        }),
      },
    });
    const discovery = createInMemoryRuntimePeerDiscoveryProvider();
    const served = await serveActorWebNode(topology, {
      node: 'server',
      transport: true,
      discovery,
    });

    try {
      const discoveredPeers = await discovery.getPeers();
      expect(discoveredPeers).toEqual([
        {
          nodeAddress: 'server-node',
          url: served.getTransportUrl(),
        },
      ]);
    } finally {
      await served.stop();
    }

    expect(await discovery.getPeers()).toEqual([]);
  });

  it('exposes normalized transport and peer status with heartbeat defaults', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
        worker: node('worker-node'),
      },
      actors: {
        serverCounter: actor({
          id: 'server-counter',
          node: 'server',
          behavior: createCounterBehavior,
        }),
        workerCounter: actor({
          id: 'worker-counter',
          node: 'worker',
          behavior: createCounterBehavior,
        }),
      },
    });
    const worker = await serveActorWebNode(topology, {
      node: 'worker',
      transport: true,
    });
    const served = await serveActorWebNode(topology, {
      node: 'server',
      transport: true,
      peers: {
        worker: worker.getTransportUrl() ?? '',
      },
      connect: ['worker'],
    });

    try {
      const peerStatus = await waitFor(() => {
        const status = served.getPeerStatus('worker-node');
        return status.connected && status.fresh ? status : undefined;
      }, 'Expected worker peer to become connected and fresh');

      expect(peerStatus).toMatchObject({
        nodeAddress: 'worker-node',
        state: 'connected',
        connected: true,
        fresh: true,
        staleAfterMs: 45_000,
      });
      expect(served.getTransportStatus()).toMatchObject({
        connectedNodes: ['worker-node'],
        peers: [expect.objectContaining({ nodeAddress: 'worker-node', connected: true })],
      });
    } finally {
      await served.stop();
      await worker.stop();
    }
  });

  it('forwards node transport idempotency options into runtime status', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
      },
      actors: {
        counter: actor({
          id: 'counter',
          node: 'server',
          behavior: createCounterBehavior,
        }),
      },
    });
    const idempotencyProvider = createInMemoryRuntimeTransportIdempotencyProvider();
    const served = await serveActorWebNode(topology, {
      node: 'server',
      transport: {
        listen: true,
        heartbeatIntervalMs: 0,
        idempotencyWindowSize: 32,
        idempotencyProvider,
      },
    });

    try {
      expect(served.getTransportStatus()).toMatchObject({
        idempotency: {
          windowSize: 32,
          providerEnabled: true,
          providerClaimCount: 0,
          providerDuplicateCount: 0,
          providerErrorCount: 0,
        },
      });
    } finally {
      await served.stop();
    }
  });

  it('marks stopped peers disconnected through the runtime status API', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
        worker: node('worker-node'),
      },
      actors: {
        serverCounter: actor({
          id: 'server-counter',
          node: 'server',
          behavior: createCounterBehavior,
        }),
        workerCounter: actor({
          id: 'worker-counter',
          node: 'worker',
          behavior: createCounterBehavior,
        }),
      },
    });
    const worker = await serveActorWebNode(topology, {
      node: 'worker',
      transport: true,
    });
    const served = await serveActorWebNode(topology, {
      node: 'server',
      transport: true,
      peers: {
        worker: worker.getTransportUrl() ?? '',
      },
      connect: ['worker'],
    });
    let workerStopped = false;

    try {
      await waitFor(
        () => (served.getPeerStatus('worker-node').connected ? true : undefined),
        'Expected worker peer to connect before stopping it'
      );
      await waitFor(
        () => served.system.lookup('actor://worker-node/actor/worker-counter'),
        'Expected server node to finish syncing the worker directory before stopping the peer'
      );
      await waitFor(
        () => worker.system.lookup('actor://server-node/actor/server-counter'),
        'Expected worker node to finish syncing the server directory before stopping the peer'
      );

      await worker.stop();
      workerStopped = true;

      await waitFor(() => {
        const status = served.getPeerStatus('worker-node');
        return !status.connected && !status.fresh ? status : undefined;
      }, 'Expected stopped worker peer to become disconnected or not fresh');
      expect(served.getTransportStatus().connectedNodes).not.toContain('worker-node');
    } finally {
      await served.stop();
      if (!workerStopped) {
        await worker.stop();
      }
    }
  });

  it('preserves explicit heartbeat opt-out in topology runner status', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
        worker: node('worker-node'),
      },
      actors: {
        serverCounter: actor({
          id: 'server-counter',
          node: 'server',
          behavior: createCounterBehavior,
        }),
        workerCounter: actor({
          id: 'worker-counter',
          node: 'worker',
          behavior: createCounterBehavior,
        }),
      },
    });
    const worker = await serveActorWebNode(topology, {
      node: 'worker',
      transport: {
        listen: true,
        heartbeatIntervalMs: 0,
      },
    });
    const served = await serveActorWebNode(topology, {
      node: 'server',
      transport: {
        listen: true,
        heartbeatIntervalMs: 0,
      },
      peers: {
        worker: worker.getTransportUrl() ?? '',
      },
      connect: ['worker'],
    });

    try {
      const peerStatus = await waitFor(() => {
        const status = served.getPeerStatus('worker-node');
        return status.connected ? status : undefined;
      }, 'Expected worker peer to connect with heartbeat disabled');

      expect(peerStatus.staleAfterMs).toBe(0);
      expect(peerStatus.fresh).toBe(true);
    } finally {
      await served.stop();
      await worker.stop();
    }
  });

  it('passes topology runner transport telemetry to configured exporters', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
      },
      actors: {
        serverCounter: actor({
          id: 'server-counter',
          node: 'server',
          behavior: createCounterBehavior,
        }),
      },
    });
    const sink = createInMemoryRuntimeTransportTelemetrySink();
    const exporter = createRuntimeTransportTelemetryExporter({ sink });
    const served = await serveActorWebNode(topology, {
      node: 'server',
      transport: {
        listen: true,
        telemetry: exporter.observe,
      },
    });

    try {
      await exporter.flush();
      expect(sink.getEvents()).toContainEqual(
        expect.objectContaining({
          type: 'transport.started',
          nodeAddress: 'server-node',
        })
      );
    } finally {
      await served.stop();
      await exporter.close();
    }
  });
});
