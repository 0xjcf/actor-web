import { describe, expect, it } from 'vitest';
import { setup } from 'xstate';
import { createActorSystem } from '../actor-system-impl.js';
import { defineActor, defineFSM } from '../unified-actor-builder.js';

type ShipmentCommand =
  | { type: 'CREATE_SHIPMENT'; shipmentId: string }
  | { type: 'MARK_DELIVERED'; shipmentId: string }
  | { type: 'GET_STATUS' };

interface ShipmentContext {
  shipmentId: string | null;
}

const shipmentMachine = setup({
  types: {
    context: {} as ShipmentContext,
    events: {} as ShipmentCommand,
  },
}).createMachine({
  id: 'shipment',
  initial: 'idle',
  context: {
    shipmentId: null,
  },
  states: {
    idle: {
      on: {
        CREATE_SHIPMENT: {
          target: 'created',
        },
      },
    },
    created: {
      on: {
        MARK_DELIVERED: {
          target: 'delivered',
        },
      },
    },
    delivered: {},
  },
});

describe('defineActor().onTransition', () => {
  it('requires a machine or FSM constraint map', () => {
    expect(() =>
      defineActor<ShipmentCommand>().onTransition({
        CREATE_SHIPMENT: () => ({ reply: 'created' }),
      })
    ).toThrow('onTransition(...) requires withMachine(...) or withFSM(...)');
  });

  it('dispatches typed transition handlers through the attached XState machine', async () => {
    const behavior = defineActor<ShipmentCommand>()
      .withMachine(shipmentMachine)
      .onTransition({
        CREATE_SHIPMENT: ({ message, actor }) => {
          expect(message.shipmentId).toBe('shipment-1');
          expect(actor.getSnapshot().matches('created')).toBe(true);
          return {
            reply: {
              shipmentId: message.shipmentId,
              state: actor.getSnapshot().value,
            },
          };
        },
      })
      .build();

    const system = createActorSystem({ nodeAddress: 'test-node' });
    await system.start();
    try {
      const actor = await system.spawn(behavior, { id: 'shipment' });

      await expect(
        actor.ask<{ shipmentId: string; state: string }>({
          type: 'CREATE_SHIPMENT',
          shipmentId: 'shipment-1',
        })
      ).resolves.toEqual({
        shipmentId: 'shipment-1',
        state: 'created',
      });
      expect(actor.getSnapshot().matches('created')).toBe(true);
    } finally {
      await system.stop();
    }
  });

  it('returns invalid transition values before running handler side effects', async () => {
    let handled = false;
    const behavior = defineActor<ShipmentCommand>()
      .withMachine(shipmentMachine)
      .onTransition({
        MARK_DELIVERED: () => {
          handled = true;
          return { reply: 'delivered' };
        },
      })
      .build();

    const system = createActorSystem({ nodeAddress: 'test-node' });
    await system.start();
    try {
      const actor = await system.spawn(behavior, { id: 'shipment' });

      await expect(
        actor.ask({
          type: 'MARK_DELIVERED',
          shipmentId: 'shipment-1',
        })
      ).resolves.toEqual({
        ok: false,
        error: {
          code: 'INVALID_TRANSITION',
          messageType: 'MARK_DELIVERED',
          state: 'idle',
          allowedTransitions: [],
        },
      });
      expect(handled).toBe(false);
    } finally {
      await system.stop();
    }
  });

  it('falls back to onMessage for messages without transition handlers', async () => {
    const behavior = defineActor<ShipmentCommand>()
      .withMachine(shipmentMachine)
      .onMessage(({ message, context, actor }) => {
        if (message.type === 'GET_STATUS') {
          expect(context).toEqual({ shipmentId: null });
          return { reply: actor.getSnapshot().value };
        }

        return undefined;
      })
      .onTransition({
        CREATE_SHIPMENT: () => ({ reply: 'created' }),
      })
      .build();

    const system = createActorSystem({ nodeAddress: 'test-node' });
    await system.start();
    try {
      const actor = await system.spawn(behavior, { id: 'shipment' });

      await expect(
        actor.ask({
          type: 'CREATE_SHIPMENT',
          shipmentId: 'shipment-1',
        })
      ).resolves.toBe('created');
      await expect(actor.ask({ type: 'GET_STATUS' })).resolves.toBe('created');
    } finally {
      await system.stop();
    }
  });

  it('supports lightweight Actor-Web FSM constraint maps', async () => {
    const shipmentFSM = defineFSM<ShipmentCommand, ShipmentContext, 'idle' | 'created'>({
      initial: 'idle',
      states: {
        idle: {
          on: {
            CREATE_SHIPMENT: 'created',
          },
        },
        created: {
          on: {},
        },
      },
    });
    const initialContext: ShipmentContext = { shipmentId: null };
    const behavior = defineActor<ShipmentCommand>()
      .withContext(initialContext)
      .withFSM(shipmentFSM)
      .onTransition({
        CREATE_SHIPMENT: ({ message, context }) => ({
          context: {
            ...context,
            shipmentId: message.shipmentId,
          },
          reply: {
            ok: true,
            shipmentId: message.shipmentId,
          },
        }),
      })
      .build();

    const system = createActorSystem({ nodeAddress: 'test-node' });
    await system.start();
    try {
      const actor = await system.spawn(behavior, { id: 'shipment' });

      await expect(
        actor.ask({
          type: 'CREATE_SHIPMENT',
          shipmentId: 'shipment-1',
        })
      ).resolves.toEqual({
        ok: true,
        shipmentId: 'shipment-1',
      });
      await expect(
        actor.ask({
          type: 'CREATE_SHIPMENT',
          shipmentId: 'shipment-2',
        })
      ).resolves.toEqual({
        ok: false,
        error: {
          code: 'INVALID_TRANSITION',
          messageType: 'CREATE_SHIPMENT',
          state: 'created',
          allowedTransitions: [],
        },
      });
      expect(actor.getSnapshot().context).toEqual({ shipmentId: 'shipment-1' });
    } finally {
      await system.stop();
    }
  });

  it('does not allow XState and FSM constraints on the same actor', () => {
    const shipmentFSM = defineFSM<ShipmentCommand, ShipmentContext, 'idle'>({
      initial: 'idle',
      states: {
        idle: {
          on: {},
        },
      },
    });

    expect(() =>
      defineActor<ShipmentCommand>().withMachine(shipmentMachine).withFSM(shipmentFSM)
    ).toThrow('withMachine(...) and withFSM(...) cannot be used together.');

    expect(() =>
      defineActor<ShipmentCommand>()
        .withContext({ shipmentId: null })
        .withFSM(shipmentFSM)
        .withMachine(shipmentMachine)
    ).toThrow('withMachine(...) and withFSM(...) cannot be used together.');
  });
});

describe('defineActor() default machine/FSM behaviors (no handlers)', () => {
  it('builds a machine-backed actor with no handlers: transitions and resolves ask with the snapshot', async () => {
    const behavior = defineActor<ShipmentCommand>().withMachine(shipmentMachine).build();

    const system = createActorSystem({ nodeAddress: 'test-node' });
    await system.start();
    try {
      const actor = await system.spawn(behavior, { id: 'shipment' });

      await expect(
        actor.ask({ type: 'CREATE_SHIPMENT', shipmentId: 'shipment-1' })
      ).resolves.toEqual({ value: 'created', context: { shipmentId: null } });
      expect(actor.getSnapshot().matches('created')).toBe(true);
    } finally {
      await system.stop();
    }
  });

  it('rejects illegal transitions for a no-handler machine actor', async () => {
    const behavior = defineActor<ShipmentCommand>().withMachine(shipmentMachine).build();

    const system = createActorSystem({ nodeAddress: 'test-node' });
    await system.start();
    try {
      const actor = await system.spawn(behavior, { id: 'shipment' });

      await expect(
        actor.ask({ type: 'MARK_DELIVERED', shipmentId: 'shipment-1' })
      ).resolves.toEqual({
        ok: false,
        error: {
          code: 'INVALID_TRANSITION',
          messageType: 'MARK_DELIVERED',
          state: 'idle',
          allowedTransitions: [],
        },
      });
    } finally {
      await system.stop();
    }
  });

  it('builds an FSM-backed actor with no handlers: transitions and resolves ask with the snapshot', async () => {
    const shipmentFSM = defineFSM<ShipmentCommand, ShipmentContext, 'idle' | 'created'>({
      initial: 'idle',
      states: {
        idle: { on: { CREATE_SHIPMENT: 'created' } },
        created: { on: {} },
      },
    });
    const behavior = defineActor<ShipmentCommand>()
      .withContext({ shipmentId: null })
      .withFSM(shipmentFSM)
      .build();

    const system = createActorSystem({ nodeAddress: 'test-node' });
    await system.start();
    try {
      const actor = await system.spawn(behavior, { id: 'shipment' });

      await expect(
        actor.ask({ type: 'CREATE_SHIPMENT', shipmentId: 'shipment-1' })
      ).resolves.toEqual({ value: 'created', context: { shipmentId: null } });

      await expect(
        actor.ask({ type: 'CREATE_SHIPMENT', shipmentId: 'shipment-2' })
      ).resolves.toEqual({
        ok: false,
        error: {
          code: 'INVALID_TRANSITION',
          messageType: 'CREATE_SHIPMENT',
          state: 'created',
          allowedTransitions: [],
        },
      });
    } finally {
      await system.stop();
    }
  });

  it('applies the default for events without an explicit onTransition handler', async () => {
    const behavior = defineActor<ShipmentCommand>()
      .withMachine(shipmentMachine)
      .onTransition({
        MARK_DELIVERED: ({ actor }) => ({
          reply: { delivered: true, state: actor.getSnapshot().value },
        }),
      })
      .build();

    const system = createActorSystem({ nodeAddress: 'test-node' });
    await system.start();
    try {
      const actor = await system.spawn(behavior, { id: 'shipment' });

      // CREATE_SHIPMENT has no explicit handler -> default transition + snapshot reply.
      await expect(
        actor.ask({ type: 'CREATE_SHIPMENT', shipmentId: 'shipment-1' })
      ).resolves.toEqual({ value: 'created', context: { shipmentId: null } });

      // MARK_DELIVERED has an explicit handler.
      await expect(
        actor.ask({ type: 'MARK_DELIVERED', shipmentId: 'shipment-1' })
      ).resolves.toEqual({ delivered: true, state: 'delivered' });
    } finally {
      await system.stop();
    }
  });

  it('still requires a handler when no machine/FSM is attached', () => {
    expect(() => defineActor<ShipmentCommand>().build()).toThrow('A handler is required');
  });
});
