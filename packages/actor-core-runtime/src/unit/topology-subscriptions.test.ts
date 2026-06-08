import { describe, expect, it } from 'vitest';
import { emit, setup } from 'xstate';
import { startActorWebLocalRuntime } from '../actor-web-client.js';
import { actor, defineActorWebTopology, node } from '../topology.js';
import { defineActor } from '../unified-actor-builder.js';

type PingEvent = { type: 'PING' };
type PongEmitted = { type: 'PONG'; seq: number };

// A machine whose only behavior is to emit a domain event via XState v5 emit(...).
const emitterMachine = setup({
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
      on: { PING: { actions: emit(({ context }) => ({ type: 'PONG', seq: context.seq })) } },
    },
  },
});

function createEmitter() {
  return defineActor<PingEvent, PongEmitted>().withMachine(emitterMachine).build();
}

function createCollector() {
  return defineActor<PongEmitted>()
    .withContext({ pongs: [] as number[] })
    .onMessage(({ message, context }) =>
      message.type === 'PONG' ? { context: { pongs: [...context.pongs, message.seq] } } : {}
    )
    .build();
}

describe('topology declarative subscriptions', () => {
  it('wires a declared subscription on start so a publisher emit reaches the subscriber', async () => {
    const topology = defineActorWebTopology({
      nodes: { local: node('local') },
      actors: {
        emitter: actor({ id: 'emitter', node: 'local', behavior: createEmitter }),
        collector: actor({ id: 'collector', node: 'local', behavior: createCollector }),
      },
      subscriptions: [{ from: 'emitter', to: 'collector', events: ['PONG'] }],
    });

    const runtime = await startActorWebLocalRuntime(topology);
    try {
      await runtime.requireActor('emitter').send({ type: 'PING' });
      await runtime.nodes.local?.system.flush();

      expect(runtime.requireActor('collector').getSnapshot().context).toEqual({ pongs: [1] });
    } finally {
      await runtime.stop();
    }
  });

  it('fans out to multiple subscribers via to: [...]', async () => {
    const topology = defineActorWebTopology({
      nodes: { local: node('local') },
      actors: {
        emitter: actor({ id: 'emitter', node: 'local', behavior: createEmitter }),
        collectorA: actor({ id: 'collectorA', node: 'local', behavior: createCollector }),
        collectorB: actor({ id: 'collectorB', node: 'local', behavior: createCollector }),
      },
      subscriptions: [{ from: 'emitter', to: ['collectorA', 'collectorB'], events: ['PONG'] }],
    });

    const runtime = await startActorWebLocalRuntime(topology);
    try {
      await runtime.requireActor('emitter').send({ type: 'PING' });
      await runtime.nodes.local?.system.flush();

      expect(runtime.requireActor('collectorA').getSnapshot().context).toEqual({ pongs: [1] });
      expect(runtime.requireActor('collectorB').getSnapshot().context).toEqual({ pongs: [1] });
    } finally {
      await runtime.stop();
    }
  });
});
