import { describe, expect, it, vi } from 'vitest';
import type { ActorMessage, MessageTransport } from '../actor-system.js';
import { createInMemoryRuntimePeerDiscoveryProvider } from '../runtime-peer-discovery.js';
import { createInMemoryRuntimeTransportIdempotencyProvider } from '../runtime-transport-idempotency.js';
import { startActorWebNode } from '../start-actor-web-node.js';
import { actor, defineActorWebTopology, node, tool } from '../topology.js';
import { defineActor } from '../unified-actor-builder.js';

type CounterCommand =
  | { type: 'INCREMENT' }
  | { type: 'GET_COUNT' }
  | { type: 'RUN_TOOL'; value: string };

class TestMessageTransport implements MessageTransport {
  started = false;
  stopped = false;
  connected = new Set<string>();
  disconnected: string[] = [];

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  async send(): Promise<void> {}

  subscribe(): () => void {
    return () => {};
  }

  async connect(address: string): Promise<void> {
    this.connected.add(address);
  }

  async disconnect(address: string): Promise<void> {
    this.connected.delete(address);
    this.disconnected.push(address);
  }

  getConnectedNodes(): string[] {
    return Array.from(this.connected);
  }

  isConnected(address: string): boolean {
    return this.connected.has(address);
  }
}

async function flushDiscovery(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

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
      expect(() => workerNode.requireActor('serverCounter')).toThrow(
        'Actor-Web node did not spawn actor "serverCounter".'
      );
      expect(workerNode.getActor('workerCounter')?.address.path).toBe(
        'actor://worker-node/actor/worker-counter'
      );
      expect(workerNode.transport.getConnectedNodes()).toEqual([]);

      const counter = workerNode.requireActor('workerCounter');
      await counter.send({ type: 'INCREMENT' });
      await workerNode.system.flush();
      await expect(counter.ask<number>({ type: 'GET_COUNT' })).resolves.toBe(1);
      await expect(counter.ask<string>({ type: 'RUN_TOOL', value: 'fas' })).resolves.toBe(
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

  it('starts a topology node with a supplied MessageTransport', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        serviceWorker: node('service-worker-node'),
      },
      actors: {
        proof: actor({
          id: 'proof',
          node: 'serviceWorker',
          behavior: createCounterBehavior,
        }),
      },
    });
    const transport = new TestMessageTransport();
    const serviceWorkerNode = await startActorWebNode(topology, {
      node: 'serviceWorker',
      transport,
    });

    try {
      expect(serviceWorkerNode.transport).toBe(transport);
      expect(transport.started).toBe(true);
      const proof = serviceWorkerNode.getActor('proof');
      await proof?.send({ type: 'INCREMENT' } satisfies ActorMessage);
      await serviceWorkerNode.system.flush();
      await expect(proof?.ask<number>({ type: 'GET_COUNT' })).resolves.toBe(1);
    } finally {
      await serviceWorkerNode.stop();
    }

    expect(transport.stopped).toBe(true);
  });

  it('exposes runtime status for supplied browser-safe transports', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
        serviceWorker: node('service-worker-node'),
      },
      actors: {
        proof: actor({
          id: 'proof',
          node: 'serviceWorker',
          behavior: createCounterBehavior,
        }),
      },
    });
    const transport = new TestMessageTransport();
    transport.connected.add('server-node');
    const serviceWorkerNode = await startActorWebNode(topology, {
      node: 'serviceWorker',
      transport,
    });

    try {
      expect(serviceWorkerNode.getPeerStatus('server-node')).toMatchObject({
        nodeAddress: 'server-node',
        state: 'connected',
        connected: true,
        fresh: true,
        staleAfterMs: 45_000,
      });
      expect(serviceWorkerNode.getTransportStatus()).toMatchObject({
        connectedNodes: ['server-node'],
      });
    } finally {
      await serviceWorkerNode.stop();
    }
  });

  it('forwards browser transport idempotency options into runtime status', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        worker: node('worker-node'),
      },
      actors: {
        proof: actor({
          id: 'proof',
          node: 'worker',
          behavior: createCounterBehavior,
        }),
      },
    });
    const idempotencyProvider = createInMemoryRuntimeTransportIdempotencyProvider();
    const workerNode = await startActorWebNode(topology, {
      node: 'worker',
      transport: {
        heartbeatIntervalMs: 0,
        idempotencyWindowSize: 16,
        idempotencyProvider,
      },
    });

    try {
      expect(workerNode.getTransportStatus()).toMatchObject({
        idempotency: {
          windowSize: 16,
          providerEnabled: true,
          providerClaimCount: 0,
          providerDuplicateCount: 0,
          providerErrorCount: 0,
        },
      });
    } finally {
      await workerNode.stop();
    }
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

  it('rolls back browser-safe startup failures and unsubscribes discovery state', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
        worker: node('worker-node'),
      },
      actors: {
        proof: actor({
          id: 'proof',
          node: 'worker',
          behavior: createCounterBehavior,
        }),
      },
    });
    const unsubscribe = vi.fn();
    const transport = new TestMessageTransport();
    transport.connect = vi.fn(async (address: string) => {
      if (address === 'server-node') {
        throw new Error('connect failed');
      }
      transport.connected.add(address);
    });

    await expect(
      startActorWebNode(topology, {
        node: 'worker',
        connect: ['server'],
        transport,
        discovery: {
          getPeers: async () => [],
          subscribe: () => unsubscribe,
        },
      })
    ).rejects.toThrow('connect failed');

    expect(transport.started).toBe(true);
    expect(transport.stopped).toBe(true);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
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

  it('creates parameterized actor instances from browser-safe topology nodes', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        worker: node('worker-node'),
      },
      actors: {
        task: actor({
          id: ({ taskId }: { taskId: string }) => `task-${taskId}`,
          node: 'worker',
          behavior: createCounterBehavior,
        }),
      },
    });
    const transport = new TestMessageTransport();
    const workerNode = await startActorWebNode(topology, {
      node: 'worker',
      transport,
    });

    try {
      expect(workerNode.getActor('task')).toBeUndefined();

      const task = await workerNode.actors.task.instance({ taskId: 'route-1001' });
      expect(task.address.path).toBe('actor://worker-node/actor/task-route-1001');
      await task.send({ type: 'INCREMENT' });
      await workerNode.system.flush();
      await expect(task.ask<number>({ type: 'GET_COUNT' })).resolves.toBe(1);
    } finally {
      await workerNode.stop();
    }
  });

  it('connects and disconnects peers from a runtime discovery provider', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
        worker: node('worker-node'),
      },
      actors: {
        proof: actor({
          id: 'proof',
          node: 'worker',
          behavior: createCounterBehavior,
        }),
      },
    });
    const discovery = createInMemoryRuntimePeerDiscoveryProvider([
      {
        nodeAddress: 'server-node',
        url: 'ws://127.0.0.1:4101',
      },
    ]);
    const transport = new TestMessageTransport();
    const workerNode = await startActorWebNode(topology, {
      node: 'worker',
      transport,
      discovery,
    });

    try {
      expect(transport.getConnectedNodes()).toEqual(['server-node']);

      discovery.upsertPeer({
        nodeAddress: 'server-node',
        url: 'ws://127.0.0.1:4102',
      });
      await flushDiscovery();
      expect(transport.getConnectedNodes()).toEqual(['server-node']);

      discovery.removePeer('server-node', 'server stopped');
      await flushDiscovery();
      expect(transport.getConnectedNodes()).toEqual([]);
      expect(transport.disconnected).toContain('server-node');
    } finally {
      await workerNode.stop();
    }
  });

  it('clears actor caches only after browser-safe system and transport shutdown complete', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        worker: node('worker-node'),
      },
      actors: {
        proof: actor({
          id: 'proof',
          node: 'worker',
          behavior: createCounterBehavior,
        }),
      },
    });
    const transport = new TestMessageTransport();
    const workerNode = await startActorWebNode(topology, {
      node: 'worker',
      transport,
    });
    const stopOrder: string[] = [];
    const originalSystemStop = workerNode.system.stop.bind(workerNode.system);
    const originalTransportStop = transport.stop.bind(transport);
    vi.spyOn(workerNode.system, 'stop').mockImplementation(async () => {
      stopOrder.push(`system:${Boolean(workerNode.getActor('proof'))}`);
      await originalSystemStop();
    });
    vi.spyOn(transport, 'stop').mockImplementation(async () => {
      stopOrder.push(`transport:${Boolean(workerNode.getActor('proof'))}`);
      await originalTransportStop();
    });

    await workerNode.stop();

    expect(stopOrder).toEqual(['system:true', 'transport:true']);
    expect(workerNode.getActor('proof')).toBeUndefined();
  });
});
