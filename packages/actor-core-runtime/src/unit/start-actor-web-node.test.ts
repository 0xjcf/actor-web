import { describe, expect, it } from 'vitest';
import { startActorWebNode } from '../start-actor-web-node.js';
import { actor, defineActorWebTopology, node, tool } from '../topology.js';
import { defineActor } from '../unified-actor-builder.js';

type CounterCommand =
  | { type: 'INCREMENT' }
  | { type: 'GET_COUNT' }
  | { type: 'RUN_TOOL'; value: string };

function createCounterBehavior() {
  return defineActor<CounterCommand>()
    .withContext({ count: 0 })
    .onMessage(async ({ message, actor, tools }) => {
      const context = actor.getSnapshot().context;
      if (message.type === 'GET_COUNT') {
        return { reply: context.count };
      }
      if (message.type === 'RUN_TOOL') {
        const result = await tools.execute<string>('agent.echo', {
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
          tools: [tool('agent.echo')],
        }),
      },
    });

    const workerNode = await startActorWebNode(topology, {
      node: 'worker',
      transport: {
        heartbeatIntervalMs: 0,
      },
      tools: {
        'agent.echo': (input) => {
          const payload = input as { value: string };
          return `tool:${payload.value}`;
        },
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
      await expect(counter?.ask<string>({ type: 'RUN_TOOL', value: 'fas' })).resolves.toBe(
        'tool:fas'
      );
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

  it('rejects owned actors when required tools are not registered', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        worker: node('worker-node'),
      },
      actors: {
        agent: actor({
          id: 'agent',
          node: 'worker',
          behavior: createCounterBehavior,
          tools: ['agent.echo'],
        }),
      },
    });

    await expect(startActorWebNode(topology, { node: 'worker' })).rejects.toThrow(
      'requires unregistered tool'
    );
  });

  it('rejects unknown topology peer keys', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        worker: node('worker-node'),
      },
      actors: {},
    });

    await expect(
      startActorWebNode(topology, {
        node: 'worker',
        peers: {
          missing: 'ws://127.0.0.1:1',
        } as unknown as Partial<Record<'worker', string>>,
      })
    ).rejects.toThrow('Unknown Actor-Web peer node "missing"');
  });
});
