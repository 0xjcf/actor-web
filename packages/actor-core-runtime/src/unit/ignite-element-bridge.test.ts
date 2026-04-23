import { describe, expect, it } from 'vitest';
import { assign, setup } from 'xstate';
import type { ActorRef } from '../actor-ref.js';
import type { ActorMessage } from '../actor-system.js';
import { createActorRef } from '../create-actor-ref.js';
import {
  actorSnapshotToIgniteSourceSnapshot,
  createIgniteActorSource,
} from '../integration/ignite-element-bridge.js';
import type { ActorSnapshot } from '../types.js';

type CounterMessage = ActorMessage<{ type: 'INCREMENT' } | { type: 'RESET' }>;

const counterMachine = setup({
  types: {
    context: {} as { count: number },
    events: {} as CounterMessage,
  },
}).createMachine({
  id: 'counter',
  initial: 'active',
  context: { count: 0 },
  states: {
    active: {
      on: {
        INCREMENT: {
          actions: assign({
            count: ({ context }) => context.count + 1,
          }),
        },
        RESET: {
          actions: assign({
            count: 0,
          }),
        },
      },
    },
  },
});

function createSnapshot<TContext>(
  value: unknown,
  context: TContext,
  status: ActorSnapshot<TContext>['status'] = 'running'
): ActorSnapshot<TContext> {
  return {
    context,
    value,
    status,
    matches: (state: string) => state === value,
    can: () => true,
    hasTag: () => false,
    toJSON: () => ({ value, context, status }),
  };
}

describe('ignite-element bridge', () => {
  it('projects Actor-Web snapshots into host-ready snapshots with address and phase', () => {
    const address = {
      id: 'checkout',
      type: 'unified',
      path: '/actors/checkout',
    };

    const projection = actorSnapshotToIgniteSourceSnapshot(
      address,
      createSnapshot('active', { count: 1 })
    );

    expect(projection.address).toEqual(address);
    expect(projection.phase).toBe('active');
    expect(projection.context).toEqual({ count: 1 });
    expect(projection.toJSON()).toEqual({
      value: 'active',
      context: { count: 1 },
      status: 'running',
      address,
      phase: 'active',
    });
  });

  it('creates an actor source with current snapshots and live updates for createActorRef refs', async () => {
    const actor = createActorRef<{ count: number }, CounterMessage>(counterMachine, {
      id: 'checkout',
    }) as ActorRef<{ count: number }, CounterMessage> & { start(): void };

    actor.start();

    const source = createIgniteActorSource(actor);
    const snapshots: Array<{ count: number; phase: string }> = [];
    const unsubscribe = source.subscribe((snapshot) => {
      snapshots.push({
        count: snapshot.context.count,
        phase: snapshot.phase,
      });
    });

    await source.send({ type: 'INCREMENT' });
    unsubscribe();
    await actor.stop();

    expect(source.address.id).toBe('checkout');
    expect(source.snapshot().context.count).toBe(1);
    expect(snapshots).toEqual([
      { count: 0, phase: 'active' },
      { count: 1, phase: 'active' },
    ]);
  });
});
