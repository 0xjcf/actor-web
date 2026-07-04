import { defineActorWebTopology, node } from '@actor-web/runtime/topology';
import { describe, expect, it, vi } from 'vitest';
import {
  createLatticeState,
  evaluateActivationTimeouts,
  reduceLatticeMessage,
} from '../lattice-actor.js';
import type { LatticeMessage } from '../protocol.js';
import { wireLatticeRuntime } from '../runtime.js';
import { lattice } from '../topology.js';

describe('lattice activation lifecycle', () => {
  it('moves an activation from delivered to acknowledged and ignores replayed acks', () => {
    let next = reduceLatticeMessage(createLatticeState('workspace'), {
      type: 'REGISTER_DEPENDENCY',
      dependency: {
        dependencyId: 'workspace:planner:0',
        lattice: 'workspace',
        actorKey: 'planner',
        requires: [{ type: 'research.summary', key: 'task-1781273347589' }],
        mode: 'once',
      },
    }).state;

    next = reduceLatticeMessage(next, {
      type: 'PUBLISH_ARTIFACT',
      artifact: {
        type: 'research.summary',
        key: 'task-1781273347589',
        payload: { ready: true },
        producer: 'researcher',
        publishedAt: 100,
      },
    }).state;

    const activationId = next.activations[0]?.activationId;

    const acknowledged = reduceLatticeMessage(next, {
      type: 'ACK_ACTIVATION',
      activationId: activationId ?? 'missing',
      acknowledgedAt: 110,
    }).state;
    const replayed = reduceLatticeMessage(acknowledged, {
      type: 'ACK_ACTIVATION',
      activationId: activationId ?? 'missing',
      acknowledgedAt: 120,
    }).state;

    expect(acknowledged.activations[0]?.status).toBe('acknowledged');
    expect(replayed.activations[0]?.status).toBe('acknowledged');
  });

  it('emits timeout facts and re-delivers timed-out activations deterministically', () => {
    const next = reduceLatticeMessage(createLatticeState('workspace'), {
      type: 'REGISTER_DEPENDENCY',
      dependency: {
        dependencyId: 'workspace:planner:0',
        lattice: 'workspace',
        actorKey: 'planner',
        requires: [{ type: 'research.summary', key: 'task-1781273347589' }],
        mode: 'once',
      },
    }).state;

    const published = reduceLatticeMessage(next, {
      type: 'PUBLISH_ARTIFACT',
      artifact: {
        type: 'research.summary',
        key: 'task-1781273347589',
        payload: { ready: true },
        producer: 'researcher',
        publishedAt: 100,
      },
    });

    const timedOut = evaluateActivationTimeouts(published.state, 30_100);

    expect(timedOut.emit.some((event) => event.type === 'ACTIVATION_TIMED_OUT')).toBe(true);
    expect(timedOut.state.activations[0]?.status).toBe('delivered');
  });

  it('defaults missing registration time deterministically inside the reducer', () => {
    const published = reduceLatticeMessage(createLatticeState('workspace'), {
      type: 'PUBLISH_ARTIFACT',
      artifact: {
        type: 'research.summary',
        key: 'task-1781273347589',
        payload: { ready: true },
        producer: 'researcher',
        publishedAt: 100,
      },
    }).state;

    const registered = reduceLatticeMessage(published, {
      type: 'REGISTER_DEPENDENCY',
      dependency: {
        dependencyId: 'workspace:planner:0',
        lattice: 'workspace',
        actorKey: 'planner',
        requires: [{ type: 'research.summary', key: 'task-1781273347589' }],
        mode: 'once',
      },
    });

    expect(registered.state.activations[0]?.createdAt).toBe(0);
    expect(registered.state.activations[0]?.deliveredAt).toBe(0);
  });

  it('reports failed timeout-check sends and keeps subsequent scheduled ticks running', async () => {
    const sentMessages: LatticeMessage[] = [];
    const workspaceRef = {
      send: vi
        .fn<(message: LatticeMessage) => Promise<void>>()
        .mockImplementationOnce(async (message) => {
          sentMessages.push(message);
          throw new Error('scheduler send failed');
        })
        .mockImplementation(async (message) => {
          sentMessages.push(message);
        }),
    };
    const topology = defineActorWebTopology({
      nodes: { local: node('local') },
      actors: {
        workspace: lattice({ id: 'workspace-lattice', node: 'local' }),
      },
    });
    const runtime = {
      topology,
      nodes: {
        local: {
          getActor: (key: string) => (key === 'workspace' ? workspaceRef : undefined),
          system: {
            subscribe: vi.fn(),
          },
        },
      },
      requireActor: (key: string) => {
        if (key === 'workspace') {
          return workspaceRef;
        }
        throw new Error(`Unexpected actor ${key}`);
      },
    };
    let scheduledTask: (() => Promise<void> | void) | undefined;
    const scheduler = {
      now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(200),
      scheduleEvery: vi.fn((intervalMs: number, task: () => Promise<void> | void) => {
        expect(intervalMs).toBe(5);
        scheduledTask = task;
        return vi.fn();
      }),
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wiring = await wireLatticeRuntime(runtime as never, {
      scheduler,
      timeoutCheckIntervalMs: 5,
    });

    try {
      await scheduledTask?.();
      await scheduledTask?.();

      expect(workspaceRef.send).toHaveBeenCalledTimes(2);
      expect(sentMessages).toEqual([
        { type: 'CHECK_ACTIVATION_TIMEOUTS', now: 100 },
        { type: 'CHECK_ACTIVATION_TIMEOUTS', now: 200 },
      ]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
      await wiring.stop();
    }
  });
});
