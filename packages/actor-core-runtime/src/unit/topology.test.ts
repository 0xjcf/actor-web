import { describe, expect, it } from 'vitest';
import { createActorWebSource } from '../actor-web-source.js';
import type { IgniteActorSource } from '../integration/ignite-element-bridge.js';
import {
  type ActorWebActorContext,
  type ActorWebActorEvent,
  type ActorWebActorMessage,
  actor,
  defineActorWebTopology,
  node,
  supervisor,
} from '../topology.js';
import { defineActor } from '../unified-actor-builder.js';

type ShipmentCommand = { type: 'CREATE_SHIPMENT'; shipmentId: string } | { type: 'RESET' };

interface ShipmentContext {
  shipmentId: string | null;
  status: 'idle' | 'created';
}

function createShipmentBehavior() {
  return defineActor<ShipmentCommand>()
    .withContext<ShipmentContext>({ shipmentId: null, status: 'idle' })
    .onMessage(({ message, actor }) => {
      const context = actor.getSnapshot().context;
      if (message.type === 'CREATE_SHIPMENT') {
        return {
          context: {
            ...context,
            shipmentId: message.shipmentId,
            status: 'created' as const,
          },
          emit: [{ type: 'SHIPMENT_CREATED' as const, shipmentId: message.shipmentId }],
        };
      }

      return {
        context: { shipmentId: null, status: 'idle' as const },
      };
    })
    .build();
}

describe('Actor-Web topology helpers', () => {
  it('builds actor addresses, node descriptors, and supervisor metadata', () => {
    const logistics = defineActorWebTopology({
      contractVersion: '1.0.0',
      nodes: {
        browser: node('logistics-browser-host'),
        server: node('logistics-server-runtime'),
      },
      actors: {
        shipment: actor({
          id: 'logistics-shipment',
          node: 'server',
          behavior: createShipmentBehavior,
          supervision: {
            strategy: 'restart',
            maxRestarts: 3,
            withinMs: 60_000,
          },
          gateway: {
            scope: { kind: 'logistics-shipment' },
          },
        }),
      },
      supervisors: {
        logistics: supervisor({
          node: 'server',
          strategy: 'one-for-one',
          children: ['shipment'],
        }),
      },
    });

    expect(logistics.nodes.server.address).toBe('logistics-server-runtime');
    expect(logistics.actors.shipment.address).toEqual({
      id: 'logistics-shipment',
      type: 'actor',
      node: 'logistics-server-runtime',
      path: 'actor://logistics-server-runtime/actor/logistics-shipment',
    });
    expect(logistics.actors.shipment.nodeAddress).toBe('logistics-server-runtime');
    expect(logistics.supervisors.logistics).toMatchObject({
      key: 'logistics',
      nodeAddress: 'logistics-server-runtime',
      children: ['shipment'],
    });

    type InferredContext = ActorWebActorContext<typeof logistics.actors.shipment>;
    type InferredCommand = ActorWebActorMessage<typeof logistics.actors.shipment>;
    type InferredEvent = ActorWebActorEvent<typeof logistics.actors.shipment>;

    const source = createActorWebSource(logistics.actors.shipment, {
      gateway: { url: 'ws://example.invalid/gateway' },
      createSocket: () => ({
        readyState: 1,
        send: () => {},
        close: () => {},
        addEventListener: () => {},
      }),
    });
    const typedSource: IgniteActorSource<InferredContext, InferredCommand, InferredEvent> = source;
    const context: InferredContext = { shipmentId: null, status: 'idle' };
    const command: InferredCommand = { type: 'CREATE_SHIPMENT', shipmentId: 'shipment-1' };
    const event: InferredEvent = { type: 'SHIPMENT_CREATED' };

    expect(typedSource.address.path).toBe(logistics.actors.shipment.address.path);
    expect(context.status).toBe('idle');
    expect(command.type).toBe('CREATE_SHIPMENT');
    expect(event.type).toBe('SHIPMENT_CREATED');
    source.close();
  });

  it('rejects actors and supervisors that reference unknown nodes', () => {
    expect(() =>
      defineActorWebTopology({
        nodes: {
          server: node('server-node'),
        },
        actors: {
          missing: actor({ id: 'missing', node: 'worker' }),
        },
      })
    ).toThrow('references unknown node "worker"');

    expect(() =>
      defineActorWebTopology({
        nodes: {
          server: node('server-node'),
        },
        actors: {},
        supervisors: {
          missing: supervisor({ node: 'worker', children: [] }),
        },
      })
    ).toThrow('references unknown node "worker"');
  });
});
