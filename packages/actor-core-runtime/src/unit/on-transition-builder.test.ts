import { describe, expect, it } from 'vitest';
import { setup } from 'xstate';
import { createActorSystem } from '../actor-system-impl.js';
import { defineActor } from '../unified-actor-builder.js';

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

  it('rejects invalid transitions before running handler side effects', async () => {
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
      ).rejects.toThrow('cannot apply transition "MARK_DELIVERED" from state "idle"');
      expect(handled).toBe(false);
    } finally {
      await system.stop();
    }
  });

  it('falls back to onMessage for messages without transition handlers', async () => {
    const behavior = defineActor<ShipmentCommand>()
      .withMachine(shipmentMachine)
      .onMessage(({ message, actor }) => {
        if (message.type === 'GET_STATUS') {
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
});
