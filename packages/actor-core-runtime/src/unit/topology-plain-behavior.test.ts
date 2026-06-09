import { describe, expect, it } from 'vitest';
import { startRuntime } from '../actor-web-client.js';
import { actor, defineActorWebTopology, node } from '../topology.js';
import { defineBehavior } from '../unified-actor-builder.js';

type CounterMsg = { type: 'INCREMENT' };

// A built behavior VALUE (not a `(defineBehavior) => spec` factory).
const counterBehavior = defineBehavior<CounterMsg>()
  .withContext({ count: 0 })
  .onMessage(({ context }) => ({ context: { count: context.count + 1 } }))
  .build();

describe('actor() accepts a plain built behavior value (no factory)', () => {
  it('runs a topology actor defined with a behavior value', async () => {
    const topology = defineActorWebTopology({
      nodes: { local: node('local') },
      actors: {
        counter: actor({ id: 'counter', node: 'local', behavior: counterBehavior }),
      },
    });

    const runtime = await startRuntime(topology);
    try {
      const counter = runtime.requireActor('counter');
      await counter.send({ type: 'INCREMENT' });
      await counter.send({ type: 'INCREMENT' });
      await runtime.nodes.local?.system.flush();
      expect(counter.getSnapshot().context).toEqual({ count: 2 });
    } finally {
      await runtime.stop();
    }
  });

  it('runs a topology actor defined with an un-built behavior builder (.build() optional)', async () => {
    // No trailing `.build()` — the runtime materializes the builder under the hood.
    const topology = defineActorWebTopology({
      nodes: { local: node('local') },
      actors: {
        counter: actor({
          id: 'counter',
          node: 'local',
          behavior: defineBehavior<CounterMsg>()
            .withContext({ count: 0 })
            .onMessage(({ context }) => ({ context: { count: context.count + 1 } })),
        }),
      },
    });

    const runtime = await startRuntime(topology);
    try {
      const counter = runtime.requireActor('counter');
      await counter.send({ type: 'INCREMENT' });
      await counter.send({ type: 'INCREMENT' });
      await counter.send({ type: 'INCREMENT' });
      await runtime.nodes.local?.system.flush();
      expect(counter.getSnapshot().context).toEqual({ count: 3 });
    } finally {
      await runtime.stop();
    }
  });
});
