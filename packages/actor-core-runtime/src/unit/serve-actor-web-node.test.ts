import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { RuntimeGatewayServerFrame } from '../runtime-gateway.js';
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
      socket.close();
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
      socket.close();
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
});
