/**
 * @file actor-web-supervisor-wiring.test.ts
 * @description Pins for how topology supervisor() declarations reach the
 * runtime: co-location validation and strategy defaulting in
 * defineActorWebTopology, group resolution in
 * resolveOwnedActorWebSupervisorGroups (including the parameterized-child
 * skip/throw matrix), and host registration through serveNode/startActorWebNode.
 */

import { describe, expect, it } from 'vitest';
import { resolveOwnedActorWebSupervisorGroups } from '../actor-web-node-runtime.js';
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
