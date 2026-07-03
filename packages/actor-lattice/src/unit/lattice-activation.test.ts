import { describe, expect, it } from 'vitest';
import {
  createLatticeState,
  evaluateActivationTimeouts,
  reduceLatticeMessage,
} from '../lattice-actor.js';

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
});
