import { describe, expect, it } from 'vitest';
import {
  type ActorWebLocalRuntimeSourceOptions,
  type StartedActorWebLocalRuntime,
  startActorWebLocalRuntime,
} from '../actor-web-client.js';
import type {
  ClosableActorWebReadModelSource,
  ClosableActorWebSource,
} from '../actor-web-source.js';
import type {
  ActorWebActorContext,
  ActorWebActorEvent,
  ActorWebActorMessage,
} from '../topology.js';
import { actor, defineActorWebTopology, node } from '../topology.js';
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

function createLogisticsTopology() {
  return defineActorWebTopology({
    nodes: {
      dashboard: node('logistics-dashboard-runtime'),
      worker: node('logistics-worker-runtime'),
    },
    actors: {
      dashboard: actor({
        id: 'dashboard',
        node: 'dashboard',
        behavior: createShipmentBehavior,
      }),
      worker: actor({
        id: 'worker',
        node: 'worker',
        behavior: createShipmentBehavior,
      }),
    },
  });
}

describe('startActorWebLocalRuntime', () => {
  it('starts a local topology and exposes top-level Ignite read-model and command sources', async () => {
    const logistics = createLogisticsTopology();
    const runtime = await startActorWebLocalRuntime(logistics);

    try {
      const readModel = runtime.dashboard.readModel({ host: new EventTarget() });
      const commandSource = runtime.dashboard.commandSource();
      const snapshots: ShipmentContext[] = [];

      readModel.subscribe((snapshot) => {
        snapshots.push(snapshot.context);
      });

      expect('send' in readModel).toBe(false);
      expect('ask' in readModel).toBe(false);
      expect(typeof commandSource.send).toBe('function');
      expect(typeof commandSource.ask).toBe('function');
      expect(readModel.snapshot().context.status).toBe('idle');

      await commandSource.send({ type: 'CREATE_SHIPMENT', shipmentId: 'shipment-1' });
      await runtime.nodes.dashboard?.system.flush();

      expect(readModel.snapshot().context).toEqual({
        shipmentId: 'shipment-1',
        status: 'created',
      });
      expect(snapshots.at(-1)).toEqual({
        shipmentId: 'shipment-1',
        status: 'created',
      });
    } finally {
      await runtime.stop();
    }
  });

  it('cleans local source subscriptions and stops all started nodes', async () => {
    const logistics = createLogisticsTopology();
    const runtime = await startActorWebLocalRuntime(logistics);
    const readModel = runtime.dashboard.readModel();
    const commandSource = runtime.dashboard.commandSource();
    const snapshots: ShipmentContext[] = [];

    readModel.subscribe((snapshot) => {
      snapshots.push(snapshot.context);
    });
    expect(snapshots).toHaveLength(1);

    readModel.close();
    await commandSource.send({ type: 'CREATE_SHIPMENT', shipmentId: 'shipment-2' });
    await runtime.nodes.dashboard?.system.flush();

    expect(snapshots).toHaveLength(1);

    await runtime.stop();

    expect(runtime.getActor('dashboard')).toBeUndefined();
    expect(runtime.getActor('worker')).toBeUndefined();
  });

  it('supports AbortSignal cleanup and preserves actor source inference', async () => {
    const logistics = createLogisticsTopology();
    const runtime: StartedActorWebLocalRuntime<typeof logistics> =
      await startActorWebLocalRuntime(logistics);
    const controller = new AbortController();
    const options: ActorWebLocalRuntimeSourceOptions = { signal: controller.signal };

    type DashboardContext = ActorWebActorContext<typeof logistics.actors.dashboard>;
    type DashboardCommand = ActorWebActorMessage<typeof logistics.actors.dashboard>;
    type DashboardEvent = ActorWebActorEvent<typeof logistics.actors.dashboard>;

    const readModel: ClosableActorWebReadModelSource<DashboardContext, DashboardEvent> =
      runtime.dashboard.readModel(options);
    const commandSource: ClosableActorWebSource<
      DashboardContext,
      DashboardCommand,
      DashboardEvent
    > = runtime.dashboard.commandSource();
    const command: DashboardCommand = { type: 'CREATE_SHIPMENT', shipmentId: 'typed' };
    const snapshots: DashboardContext[] = [];

    readModel.subscribe((snapshot) => {
      snapshots.push(snapshot.context);
    });
    controller.abort();
    await commandSource.send(command);
    await runtime.nodes.dashboard?.system.flush();

    expect(snapshots).toHaveLength(1);

    await runtime.stop();
  });
});
