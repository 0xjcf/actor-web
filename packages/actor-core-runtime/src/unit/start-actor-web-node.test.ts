import { describe, expect, it } from 'vitest';
import { startActorWebNode } from '../start-actor-web-node.js';
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

describe('startActorWebNode', () => {
  it('starts a browser-safe topology node and spawns owned actors', async () => {
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

    const workerNode = await startActorWebNode(topology, {
      node: 'worker',
      transport: {
        heartbeatIntervalMs: 0,
      },
    });

    try {
      expect(workerNode.getActor('serverCounter')).toBeUndefined();
      expect(workerNode.getActor('workerCounter')?.address.path).toBe(
        'actor://worker-node/actor/worker-counter'
      );
      expect(workerNode.transport.getStats().startedAt).toBeTruthy();

      const counter = workerNode.getActor('workerCounter');
      await counter?.send({ type: 'INCREMENT' });
      await workerNode.system.flush();
      await expect(counter?.ask<number>({ type: 'GET_COUNT' })).resolves.toBe(1);
    } finally {
      await workerNode.stop();
    }
  });

  it('rejects owned actors without behavior', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        worker: node('worker-node'),
      },
      actors: {
        missing: actor({
          id: 'missing',
          node: 'worker',
        }),
      },
    });

    await expect(startActorWebNode(topology, { node: 'worker' })).rejects.toThrow(
      'does not declare behavior'
    );
  });
});
