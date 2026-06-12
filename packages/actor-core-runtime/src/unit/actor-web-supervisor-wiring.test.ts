/**
 * @file actor-web-supervisor-wiring.test.ts
 * @description Pins for how topology supervisor() declarations reach the
 * runtime: co-location validation and strategy defaulting in
 * defineActorWebTopology, group resolution in
 * resolveOwnedActorWebSupervisorGroups (including the parameterized-child
 * skip/throw matrix), and host registration through serveNode/startActorWebNode.
 */

import { describe, expect, it, vi } from 'vitest';
import { resolveOwnedActorWebSupervisorGroups } from '../actor-web-node-runtime.js';
import { serveNode } from '../serve-actor-web-node.js';
import { startActorWebNode } from '../start-actor-web-node.js';
import { actor, defineActorWebTopology, node, supervisor } from '../topology.js';
import { defineBehavior } from '../unified-actor-builder.js';

type CounterMessage = { type: 'INC' } | { type: 'GET' } | { type: 'BOOM' };

function createCrashableCounter() {
  return defineBehavior<CounterMessage>()
    .withContext({ count: 0 })
    .onMessage(({ message, actor: instance }) => {
      const { count } = instance.getSnapshot().context;
      if (message.type === 'INC') {
        return { context: { count: count + 1 } };
      }
      if (message.type === 'GET') {
        return { reply: count };
      }
      throw new Error('induced wiring failure');
    })
    .build();
}

function buildTopology(strategy?: 'one-for-one' | 'one-for-all' | 'rest-for-one' | 'escalate') {
  return defineActorWebTopology({
    nodes: {
      server: node('wiring-server-node'),
      worker: node('wiring-worker-node'),
    },
    actors: {
      alpha: actor({ id: 'alpha', node: 'server', behavior: createCrashableCounter }),
      beta: actor({ id: 'beta', node: 'server', behavior: createCrashableCounter }),
      offNode: actor({ id: 'off-node', node: 'worker', behavior: createCrashableCounter }),
    },
    supervisors: {
      pair: supervisor({ node: 'server', strategy, children: ['alpha', 'beta'] }),
    },
  });
}

describe('defineActorWebTopology supervisor co-location', () => {
  it('rejects supervisor children on a different node than the supervisor', () => {
    expect(() =>
      defineActorWebTopology({
        nodes: {
          server: node('server-node'),
          worker: node('worker-node'),
        },
        actors: {
          drifter: actor({ id: 'drifter', node: 'worker', behavior: createCrashableCounter }),
        },
        supervisors: {
          lopsided: supervisor({ node: 'server', children: ['drifter'] }),
        },
      })
    ).toThrow(/must run on the supervisor's node/);
  });

  it('defaults supervisor strategy to one-for-one', () => {
    const topology = buildTopology(undefined);
    expect(topology.supervisors.pair.strategy).toBe('one-for-one');
  });
});

describe('resolveOwnedActorWebSupervisorGroups', () => {
  it('returns only groups owned by the node with children as paths in declaration order', () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('owned-server-node'),
        worker: node('owned-worker-node'),
      },
      actors: {
        alpha: actor({ id: 'alpha', node: 'server', behavior: createCrashableCounter }),
        beta: actor({ id: 'beta', node: 'server', behavior: createCrashableCounter }),
        gamma: actor({ id: 'gamma', node: 'worker', behavior: createCrashableCounter }),
      },
      supervisors: {
        serverPair: supervisor({
          node: 'server',
          strategy: 'one-for-all',
          children: ['beta', 'alpha'],
        }),
        workerSolo: supervisor({ node: 'worker', children: ['gamma'] }),
      },
    });

    const groups = resolveOwnedActorWebSupervisorGroups(topology, 'server');
    expect(groups).toEqual([
      {
        key: 'serverPair',
        strategy: 'one-for-all',
        children: [topology.actors.beta.address.path, topology.actors.alpha.address.path],
      },
    ]);
  });

  it('skips parameterized children of one-for-one groups (fas-agent-loop shape)', () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('param-server-node'),
      },
      actors: {
        coordinator: actor({ id: 'coordinator', node: 'server', behavior: createCrashableCounter }),
        taskRun: actor({
          id: (params: { taskId: string }) => `task-run-${params.taskId}`,
          node: 'server',
          behavior: createCrashableCounter,
        }),
      },
      supervisors: {
        workflow: supervisor({
          node: 'server',
          strategy: 'one-for-one',
          children: ['coordinator', 'taskRun'],
        }),
      },
    });

    const groups = resolveOwnedActorWebSupervisorGroups(topology, 'server');
    expect(groups).toEqual([
      {
        key: 'workflow',
        strategy: 'one-for-one',
        children: [topology.actors.coordinator.address.path],
      },
    ]);
  });

  it('throws for parameterized children in one-for-all, rest-for-one, and escalate groups', () => {
    for (const strategy of ['one-for-all', 'rest-for-one', 'escalate'] as const) {
      const topology = defineActorWebTopology({
        nodes: {
          server: node(`throw-${strategy}-node`),
        },
        actors: {
          stable: actor({ id: 'stable', node: 'server', behavior: createCrashableCounter }),
          dynamic: actor({
            id: (params: { runId: string }) => `dynamic-${params.runId}`,
            node: 'server',
            behavior: createCrashableCounter,
          }),
        },
        supervisors: {
          volatile: supervisor({ node: 'server', strategy, children: ['stable', 'dynamic'] }),
        },
      });

      expect(() => resolveOwnedActorWebSupervisorGroups(topology, 'server')).toThrow(
        /Supervisor "volatile" \(.*\) includes parameterized actor "dynamic"/
      );
    }
  });
});

describe('serveNode supervisor wiring', () => {
  it(
    'registers owned supervisor groups and drives a group restart end to end',
    { timeout: 30_000 },
    async () => {
      const topology = defineActorWebTopology({
        nodes: {
          server: node('serve-supervised-node'),
        },
        actors: {
          alpha: actor({ id: 'alpha', node: 'server', behavior: createCrashableCounter }),
          beta: actor({ id: 'beta', node: 'server', behavior: createCrashableCounter }),
        },
        supervisors: {
          pair: supervisor({
            node: 'server',
            strategy: 'one-for-all',
            children: ['alpha', 'beta'],
          }),
        },
      });

      const served = await serveNode(topology, {
        node: 'server',
        transport: true,
        gateway: true,
      });

      try {
        // biome-ignore lint/suspicious/noExplicitAny: Testing private state requires any
        const groups = (served.system as any).supervisorGroups as Map<string, unknown>;
        expect(groups.get('pair')).toEqual({
          key: 'pair',
          strategy: 'one-for-all',
          children: [topology.actors.alpha.address.path, topology.actors.beta.address.path],
        });

        // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
        const spy = vi.spyOn(served.system as any, 'emitSystemEvent');
        const alpha = served.requireActor('alpha');
        await alpha.send({ type: 'BOOM' });

        const deadline = Date.now() + 15_000;
        const wanted = new Set([
          topology.actors.alpha.address.path,
          topology.actors.beta.address.path,
        ]);
        let groupStopSeen = false;
        for (;;) {
          const events = spy.mock.calls.map(
            (call) =>
              call[0] as {
                eventType: string;
                data?: { address?: string; reason?: string };
              }
          );
          groupStopSeen = events.some(
            (event) =>
              event.eventType === 'actorStopped' &&
              event.data?.reason === 'supervisor-group-restart' &&
              event.data?.address === topology.actors.beta.address.path
          );
          const restarted = new Set(
            events
              .filter((event) => event.eventType === 'actorRestarted')
              .map((event) => event.data?.address)
          );
          if (groupStopSeen && [...wanted].every((path) => restarted.has(path))) {
            break;
          }
          if (Date.now() > deadline) {
            throw new Error('Timed out waiting for the serveNode group restart');
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        expect(groupStopSeen).toBe(true);
      } finally {
        await served.stop();
      }
    }
  );

  it('startActorWebNode registers owned supervisor groups', async () => {
    const topology = defineActorWebTopology({
      nodes: {
        worker: node('start-supervised-node'),
      },
      actors: {
        gamma: actor({ id: 'gamma', node: 'worker', behavior: createCrashableCounter }),
      },
      supervisors: {
        solo: supervisor({ node: 'worker', children: ['gamma'] }),
      },
    });

    const started = await startActorWebNode(topology, {
      node: 'worker',
      transport: { heartbeatIntervalMs: 0 },
    });

    try {
      // biome-ignore lint/suspicious/noExplicitAny: Testing private state requires any
      const groups = (started.system as any).supervisorGroups as Map<string, unknown>;
      expect(groups.get('solo')).toEqual({
        key: 'solo',
        strategy: 'one-for-one',
        children: [topology.actors.gamma.address.path],
      });
    } finally {
      await started.stop();
    }
  });
});
