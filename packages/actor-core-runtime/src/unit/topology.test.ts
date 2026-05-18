import { describe, expect, it } from 'vitest';
import { createActorWebClient, createActorWebReadModelClient } from '../actor-web-client.js';
import { type ActorWebGatewaySocket, createActorWebSource } from '../actor-web-source.js';
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
      tools: [tool('route.plan', { description: 'Plan shipment routes.' })],
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
          gateway: true,
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
    expect(logistics.actors.shipment.gateway?.scope).toEqual({ kind: 'shipment' });
    expect(logistics.supervisors.logistics).toMatchObject({
      key: 'logistics',
      nodeAddress: 'logistics-server-runtime',
      children: ['shipment'],
    });

    type InferredContext = ActorWebActorContext<typeof logistics.actors.shipment>;
    type InferredCommand = ActorWebActorMessage<typeof logistics.actors.shipment>;
    type InferredEvent = ActorWebActorEvent<typeof logistics.actors.shipment>;

    const source = logistics.actors.shipment.source({
      gateway: { url: 'ws://example.invalid/gateway' },
      createSocket: () => ({
        readyState: 1,
        send: () => {},
        close: () => {},
        addEventListener: () => {},
      }),
    });
    const explicitSource = createActorWebSource({
      actor: logistics.actors.shipment,
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
    expect(explicitSource.address.path).toBe(source.address.path);
    expect(context.status).toBe('idle');
    expect(command.type).toBe('CREATE_SHIPMENT');
    expect(event.type).toBe('SHIPMENT_CREATED');
    source.close();
    explicitSource.close();
  });

  it('binds topology actors to a gateway client without explicit generics', () => {
    const logistics = defineActorWebTopology({
      contractVersion: '1.0.0',
      nodes: {
        server: node('logistics-server-runtime'),
        serviceWorker: node('logistics-service-worker-runtime'),
      },
      actors: {
        shipment: actor({
          id: 'logistics-shipment',
          node: 'server',
          behavior: createShipmentBehavior,
          gateway: true,
        }),
        serviceWorkerProof: actor({
          id: 'logistics-service-worker-proof',
          node: 'serviceWorker',
          behavior: createShipmentBehavior,
        }),
      },
    });
    let socketsCreated = 0;

    const client = createActorWebClient(logistics, {
      gateway: { url: 'ws://example.invalid/gateway' },
      createSocket: () => {
        socketsCreated += 1;
        return {
          readyState: 1,
          send: () => {},
          close: () => {},
          addEventListener: () => {},
        };
      },
    });

    expect(socketsCreated).toBe(0);

    type InferredContext = ActorWebActorContext<typeof logistics.actors.shipment>;
    type InferredCommand = ActorWebActorMessage<typeof logistics.actors.shipment>;
    type InferredEvent = ActorWebActorEvent<typeof logistics.actors.shipment>;

    const typedSource: IgniteActorSource<InferredContext, InferredCommand, InferredEvent> =
      client.actors.shipment;
    const sameSource = client.actors.shipment;

    expect(typedSource).toBe(sameSource);
    expect(typedSource.address.path).toBe(logistics.actors.shipment.address.path);
    expect(socketsCreated).toBe(1);
    client.close();
  });

  it('defaults topology read-model helpers to projection-only sources', () => {
    const logistics = defineActorWebTopology({
      contractVersion: '1.0.0',
      nodes: {
        server: node('logistics-server-runtime'),
      },
      actors: {
        shipment: actor({
          id: 'logistics-shipment',
          node: 'server',
          behavior: createShipmentBehavior,
          gateway: true,
        }),
      },
    });

    const source = logistics.actors.shipment.readModel({
      gateway: { url: 'ws://example.invalid/gateway' },
      createSocket: () => ({
        readyState: 1,
        send: () => {},
        close: () => {},
        addEventListener: () => {},
      }),
    });
    const commandSource = logistics.actors.shipment.commandSource({
      gateway: { url: 'ws://example.invalid/gateway' },
      createSocket: () => ({
        readyState: 1,
        send: () => {},
        close: () => {},
        addEventListener: () => {},
      }),
    });

    expect('send' in source).toBe(false);
    expect('ask' in source).toBe(false);
    expect(typeof commandSource.send).toBe('function');
    expect(typeof commandSource.ask).toBe('function');

    source.close();
    commandSource.close();
  });

  it('does not open unused topology client sources', () => {
    const logistics = defineActorWebTopology({
      contractVersion: '1.0.0',
      nodes: {
        server: node('logistics-server-runtime'),
        serviceWorker: node('logistics-service-worker-runtime'),
      },
      actors: {
        shipment: actor({
          id: 'logistics-shipment',
          node: 'server',
          behavior: createShipmentBehavior,
          gateway: true,
        }),
        serviceWorkerProof: actor({
          id: 'logistics-service-worker-proof',
          node: 'serviceWorker',
          behavior: createShipmentBehavior,
        }),
      },
    });
    let socketsCreated = 0;

    const client = createActorWebClient(logistics, {
      gateway: { url: 'ws://example.invalid/gateway' },
      createSocket: () => {
        socketsCreated += 1;
        return {
          readyState: 1,
          send: () => {},
          close: () => {},
          addEventListener: () => {},
        };
      },
    });

    expect(Object.keys(client.actors)).toEqual(['shipment', 'serviceWorkerProof']);
    expect(socketsCreated).toBe(0);
    expect(client.actors.serviceWorkerProof.address.path).toBe(
      logistics.actors.serviceWorkerProof.address.path
    );
    expect(socketsCreated).toBe(1);
    client.close();
  });

  it('offers a read-model client for browser projection consumers', () => {
    const logistics = defineActorWebTopology({
      contractVersion: '1.0.0',
      nodes: {
        server: node('logistics-server-runtime'),
      },
      actors: {
        shipment: actor({
          id: 'logistics-shipment',
          node: 'server',
          behavior: createShipmentBehavior,
          gateway: true,
        }),
      },
    });

    const client = createActorWebReadModelClient(logistics, {
      gateway: { url: 'ws://example.invalid/gateway' },
      createSocket: () => ({
        readyState: 1,
        send: () => {},
        close: () => {},
        addEventListener: () => {},
      }),
    });

    expect('send' in client.actors.shipment).toBe(false);
    expect('ask' in client.actors.shipment).toBe(false);
    client.close();
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

  it('rejects supervisors that reference unknown child actors', () => {
    expect(() =>
      defineActorWebTopology({
        nodes: {
          server: node('server-node'),
        },
        actors: {
          shipment: actor({ id: 'shipment', node: 'server' }),
        },
        supervisors: {
          logistics: supervisor({ node: 'server', children: ['missing'] }),
        },
      })
    ).toThrow('references unknown child actor "missing"');
  });

  it('rejects actors that reference unknown topology tools when a catalog is declared', () => {
    expect(() =>
      defineActorWebTopology({
        tools: [tool('route.plan')],
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

  it('keeps object-shaped topology tools supported for generated clients', () => {
    const topology = defineActorWebTopology({
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
          tools: ['route.plan'],
        }),
      },
    });

    expect(topology.tools['route.plan'].name).toBe('route.plan');
  });

  it('allows explicit gateway scopes for public routing overrides', () => {
    const topology = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
      },
      actors: {
        internalShipmentProjection: actor({
          id: 'shipment',
          node: 'server',
          gateway: {
            scope: {
              kind: 'shipment',
              params: {
                tenant: 'acme',
              },
            },
          },
        }),
      },
    });

    expect(topology.actors.internalShipmentProjection.gateway?.scope).toEqual({
      kind: 'shipment',
      params: {
        tenant: 'acme',
      },
    });
  });

  it('merges topology actor source params into the actor gateway scope', () => {
    const logistics = defineActorWebTopology({
      nodes: {
        server: node('server-node'),
      },
      actors: {
        vehicleInspections: actor({
          id: 'vehicle-inspections',
          node: 'server',
          behavior: createShipmentBehavior,
          gateway: true,
        }),
      },
    });
    const sourceFrames: unknown[] = [];
    const commandFrames: unknown[] = [];
    let openListener = (): void => {};
    let commandOpenListener = (): void => {};
    let messageListener = (_event: MessageEvent<string>): void => {};
    let commandMessageListener = (_event: MessageEvent<string>): void => {};
    const socket: ActorWebGatewaySocket = {
      readyState: 1,
      send: (data: string) => {
        sourceFrames.push(JSON.parse(data) as unknown);
      },
      close: () => {},
      addEventListener(
        type: 'open' | 'close' | 'error' | 'message',
        listener: (() => void) | ((event: Event) => void) | ((event: MessageEvent<string>) => void)
      ) {
        if (type === 'open') {
          openListener = listener as () => void;
        } else if (type === 'message') {
          messageListener = listener as (event: MessageEvent<string>) => void;
        }
      },
    };
    const commandSocket: ActorWebGatewaySocket = {
      readyState: 1,
      send: (data: string) => {
        commandFrames.push(JSON.parse(data) as unknown);
      },
      close: () => {},
      addEventListener(
        type: 'open' | 'close' | 'error' | 'message',
        listener: (() => void) | ((event: Event) => void) | ((event: MessageEvent<string>) => void)
      ) {
        if (type === 'open') {
          commandOpenListener = listener as () => void;
        } else if (type === 'message') {
          commandMessageListener = listener as (event: MessageEvent<string>) => void;
        }
      },
    };
    const source = logistics.actors.vehicleInspections.source({
      gateway: {
        url: 'ws://example.invalid/gateway',
        scope: {
          params: {
            fleetId: 'fleet-42',
            vehicleId: 'truck-17',
          },
        },
      },
      streamId: 'vehicle-inspections-stream',
      createSocket: () => socket,
    });
    const commandSource = logistics.actors.vehicleInspections.commandSource({
      gateway: {
        url: 'ws://example.invalid/gateway',
        scope: {
          params: {
            fleetId: 'fleet-42',
            vehicleId: 'truck-17',
          },
        },
      },
      streamId: 'vehicle-inspections-command-stream',
      createSocket: () => commandSocket,
    });
    openListener();
    messageListener({
      data: JSON.stringify({
        type: 'ready',
        connectionId: 'connection-1',
        heartbeatMs: 15000,
        serverTime: '2026-04-25T18:00:00.000Z',
      }),
    } as MessageEvent<string>);
    commandOpenListener();
    commandMessageListener({
      data: JSON.stringify({
        type: 'ready',
        connectionId: 'connection-2',
        heartbeatMs: 15000,
        serverTime: '2026-04-25T18:00:00.000Z',
      }),
    } as MessageEvent<string>);

    expect(sourceFrames).toContainEqual({
      type: 'subscribe',
      streamId: 'vehicle-inspections-stream',
      scope: {
        kind: 'vehicleInspections',
        params: {
          fleetId: 'fleet-42',
          vehicleId: 'truck-17',
        },
      },
    });
    expect(commandFrames).toContainEqual({
      type: 'subscribe',
      streamId: 'vehicle-inspections-command-stream',
      scope: {
        kind: 'vehicleInspections',
        params: {
          fleetId: 'fleet-42',
          vehicleId: 'truck-17',
        },
      },
      mode: 'command-only',
    });
    source.close();
    commandSource.close();
  });
});
