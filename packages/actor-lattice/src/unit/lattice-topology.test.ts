import { defineBehavior } from '@actor-web/runtime';
import { defineActorWebTopology, node } from '@actor-web/runtime/topology';
import { describe, expect, it, vi } from 'vitest';
import { deriveDependencyId } from '../dependency.js';
import type { DependencyDefinition, LatticeMessage } from '../protocol.js';
import {
  collectLatticeRegistrations,
  collectLatticeSubscriptions,
  wireLatticeRuntime,
} from '../runtime.js';
import { dependsOn, lattice } from '../topology.js';

describe('lattice topology helpers', () => {
  it('bakes runtime actor metadata into the preferred dependsOn API', () => {
    const plannerBehavior = defineBehavior<{ type: 'PLAN' }>()
      .withContext({ planned: false })
      .onMessage(() => ({ context: { planned: true } }))
      .build();
    const topology = defineActorWebTopology({
      nodes: { local: node('local') },
      actors: {
        workspace: lattice({ id: 'workflow-lattice', node: 'local' }),
        planner: dependsOn({
          id: 'planner',
          node: 'local',
          behavior: plannerBehavior,
          dependencies: [
            {
              lattice: 'workspace',
              requires: [{ type: 'research.summary', key: 'task-1781273347589' }],
            },
          ],
        }),
      },
    });

    expect(topology.actors.planner.id).toBe('planner');
    expect(topology.actors.planner.node).toBe('local');
    expect(topology.actors.planner.behavior).toBe(plannerBehavior);
    expect(collectLatticeRegistrations(topology)).toEqual([
      {
        actorKey: 'planner',
        dependencyId: deriveDependencyId('workspace', 'planner', [
          { type: 'research.summary', key: 'task-1781273347589' },
        ]),
        lattice: 'workspace',
        mode: 'once',
        requires: [{ type: 'research.summary', key: 'task-1781273347589' }],
      },
    ]);
    expect(collectLatticeSubscriptions(topology)).toEqual([
      {
        from: 'workspace',
        to: 'planner',
        events: ['DEPENDENCY_SATISFIED', 'ACTIVATION_TIMED_OUT'],
      },
    ]);
  });

  it('keeps fallback dependency ids stable when declarations are reordered', () => {
    const plannerBehavior = defineBehavior<{ type: 'PLAN' }>()
      .withContext({})
      .onMessage(() => ({ context: {} }))
      .build();
    const summaryDependency: DependencyDefinition = {
      lattice: 'workspace',
      requires: [{ type: 'research.summary', key: 'task-1781273347589' }],
    };
    const reviewDependency: DependencyDefinition = {
      lattice: 'workspace',
      requires: [{ type: 'review.finding', key: 'task-1781273347589' }],
      mode: 'everyVersion' as const,
    };
    const buildTopology = (dependencies: readonly DependencyDefinition[]) =>
      defineActorWebTopology({
        nodes: { local: node('local') },
        actors: {
          workspace: lattice({ id: 'workflow-lattice', node: 'local' }),
          planner: dependsOn({
            id: 'planner',
            node: 'local',
            behavior: plannerBehavior,
            dependencies,
          }),
        },
      });

    const first = collectLatticeRegistrations(buildTopology([summaryDependency, reviewDependency]));
    const reordered = collectLatticeRegistrations(
      buildTopology([reviewDependency, summaryDependency])
    );
    const idsByType = (registrations: ReturnType<typeof collectLatticeRegistrations>) =>
      Object.fromEntries(
        registrations.map((registration) => [
          registration.requires[0]?.type ?? 'missing',
          registration.dependencyId,
        ])
      );

    expect(idsByType(reordered)).toEqual(idsByType(first));
  });

  it('schedules activation timeout checks through runtime wiring and cleans them up', async () => {
    const plannerBehavior = defineBehavior<{ type: 'PLAN' }>()
      .withContext({})
      .onMessage(() => ({ context: {} }))
      .build();
    const topology = defineActorWebTopology({
      nodes: { local: node('local') },
      actors: {
        workspace: lattice({ id: 'workflow-lattice', node: 'local' }),
        planner: dependsOn({
          id: 'planner',
          node: 'local',
          behavior: plannerBehavior,
          dependencies: [
            {
              lattice: 'workspace',
              requires: [{ type: 'research.summary', key: 'task-1781273347589' }],
            },
          ],
        }),
      },
    });
    const sentMessages: LatticeMessage[] = [];
    const workspaceRef = {
      send: vi.fn(async (message: LatticeMessage) => {
        sentMessages.push(message);
      }),
    };
    const plannerRef = {};
    const unsubscribe = vi.fn(async () => undefined);
    const subscribe = vi.fn(async () => unsubscribe);
    const runtime = {
      topology,
      nodes: {
        local: {
          getActor: (key: string) =>
            key === 'workspace' ? workspaceRef : key === 'planner' ? plannerRef : undefined,
          system: { subscribe },
        },
      },
      requireActor: (key: string) => {
        if (key === 'workspace') {
          return workspaceRef;
        }
        if (key === 'planner') {
          return plannerRef;
        }
        throw new Error(`Unexpected actor ${key}`);
      },
    };
    let scheduledTask: (() => Promise<void> | void) | undefined;
    const stopSchedule = vi.fn();
    const scheduler = {
      now: () => 30_100,
      scheduleEvery: vi.fn((intervalMs: number, task: () => Promise<void> | void) => {
        expect(intervalMs).toBe(5);
        scheduledTask = task;
        return stopSchedule;
      }),
    };

    const wiring = await wireLatticeRuntime(runtime as never, {
      scheduler,
      timeoutCheckIntervalMs: 5,
    });
    sentMessages.length = 0;
    await scheduledTask?.();

    expect(wiring.latticeActors).toEqual(['workspace']);
    expect(sentMessages).toEqual([{ type: 'CHECK_ACTIVATION_TIMEOUTS', now: 30_100 }]);

    await wiring.stop();

    expect(stopSchedule).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
