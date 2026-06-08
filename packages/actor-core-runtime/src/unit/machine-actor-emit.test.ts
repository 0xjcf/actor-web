import { describe, expect, it } from 'vitest';
import { emit, setup } from 'xstate';
import { createActorSystem } from '../actor-system-impl.js';
import { defineActor } from '../unified-actor-builder.js';

type PingEvent = { type: 'PING' };
type PongEmitted = { type: 'PONG'; seq: number };

// A machine whose only behavior is to emit a domain event via XState v5 emit(...).
const emittingMachine = setup({
  types: {
    context: {} as { seq: number },
    events: {} as PingEvent,
    emitted: {} as PongEmitted,
  },
}).createMachine({
  id: 'emitter',
  initial: 'idle',
  context: { seq: 1 },
  states: {
    idle: {
      on: {
        PING: {
          actions: emit(({ context }) => ({ type: 'PONG', seq: context.seq })),
        },
      },
    },
  },
});

describe('MachineActor XState emit bridge', () => {
  it('forwards machine emit(...) domain events to subscribeEvent listeners', async () => {
    const behavior = defineActor<PingEvent, PongEmitted>().withMachine(emittingMachine).build();

    const system = createActorSystem({ nodeAddress: 'test-node' });
    await system.start();
    try {
      const actor = await system.spawn(behavior, { id: 'emitter' });
      const received: Array<{ type: string; seq?: number }> = [];
      expect(actor.subscribeEvent).toBeDefined();
      const unsubscribe = actor.subscribeEvent?.((event) => {
        const typed = event as { type?: string; seq?: number };
        if (typed.type === 'PONG') {
          received.push({ type: typed.type, seq: typed.seq });
        }
      });

      await actor.send({ type: 'PING' });
      await system.flush();

      expect(received).toEqual([{ type: 'PONG', seq: 1 }]);
      unsubscribe?.();
    } finally {
      await system.stop();
    }
  });

  it('delivers machine emit(...) events to a subscribed actor via system.subscribe', async () => {
    const publisher = defineActor<PingEvent, PongEmitted>().withMachine(emittingMachine).build();

    type CollectorMsg = PongEmitted;
    const collector = defineActor<CollectorMsg>()
      .withContext({ pongs: [] as number[] })
      .onMessage(({ message, context }) =>
        message.type === 'PONG' ? { context: { pongs: [...context.pongs, message.seq] } } : {}
      )
      .build();

    const system = createActorSystem({ nodeAddress: 'test-node' });
    await system.start();
    try {
      const publisherRef = await system.spawn(publisher, { id: 'emitter' });
      const collectorRef = await system.spawn(collector, { id: 'collector' });

      await system.subscribe(publisherRef, { subscriber: collectorRef, events: ['PONG'] });

      await publisherRef.send({ type: 'PING' });
      await system.flush();

      expect(collectorRef.getSnapshot().context).toEqual({ pongs: [1] });
    } finally {
      await system.stop();
    }
  });
});
