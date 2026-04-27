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
  tool,
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
      tools: {
        'route.plan': tool('route.plan', { description: 'Plan shipment routes.' }),
      },
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
          tools: ['route.plan'],
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
    expect(logistics.tools['route.plan']).toEqual({
      name: 'route.plan',
      description: 'Plan shipment routes.',
    });
    expect(logistics.actors.shipment.tools).toEqual(['route.plan']);
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

  it('rejects actors that reference unknown topology tools when a catalog is declared', () => {
    expect(() =>
      defineActorWebTopology({
        tools: {
          'route.plan': tool('route.plan'),
        },
        nodes: {
          server: node('server-node'),
        },
        actors: {
          shipment: actor({
            id: 'shipment',
            node: 'server',
            tools: ['missing.tool'],
          }),
        },
      })
    ).toThrow('references unknown tool "missing.tool"');
  });
});
