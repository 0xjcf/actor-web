import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { RuntimeGatewayServerFrame } from '../runtime-gateway.js';
import { serveActorWebNode } from '../serve-actor-web-node.js';
import { actor, defineActorWebTopology, node } from '../topology.js';
import { defineActor } from '../unified-actor-builder.js';

type CounterCommand = { type: 'INCREMENT' } | { type: 'GET_COUNT' };

function createCounterBehavior() {
  return defineActor<CounterCommand>()
    .withContext({ count: 0 })
    .onMessage(({ message, actor }) => {
      const context = actor.getSnapshot().context;
      if (message.type === 'GET_COUNT') {
        return { reply: context.count };
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
          gateway: {
            scope: { kind: 'counter' },
          },
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
      transport: { listen: true },
      gateway: { expose: ['counter'] },
    });

    try {
      expect(served.getTransportUrl()).toMatch(/^ws:\/\/127\.0\.0\.1:/);
      expect(served.getGatewayUrl()).toMatch(/^ws:\/\/127\.0\.0\.1:/);
      expect(served.getActor('counter')?.address.path).toBe('actor://server-node/actor/counter');
      expect(served.getActor('workerCounter')).toBeUndefined();

      const counter = served.getActor('counter');
      await counter?.send({ type: 'INCREMENT' });
      await served.system.flush();
      await expect(counter?.ask<number>({ type: 'GET_COUNT' })).resolves.toBe(1);

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
});
