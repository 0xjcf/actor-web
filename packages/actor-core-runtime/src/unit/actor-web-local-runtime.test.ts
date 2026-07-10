import { describe, expect, it } from 'vitest';
import type { ActorMessage, MessageTransport } from '../actor-system.js';
import {
  type ActorWebLocalRuntimeSourceOptions,
  type StartedActorWebLocalRuntime,
  startRuntime,
} from '../actor-web-client.js';
import type {
  ClosableActorWebReadModelSource,
  ClosableActorWebSource,
} from '../actor-web-source.js';
import {
  createInMemoryMessageTransportNetwork,
  type InMemoryMessageTransportNetwork,
  type InMemoryTransportFrame,
} from '../testing/in-memory-message-transport.js';
import type {
  ActorWebActorContext,
  ActorWebActorEvent,
  ActorWebActorMessage,
} from '../topology.js';
import { actor, defineActorWebTopology, node } from '../topology.js';
import { defineBehavior } from '../unified-actor-builder.js';

type ShipmentCommand =
  | { type: 'CREATE_SHIPMENT'; shipmentId: string }
  | { type: 'GET_STATUS' }
  | { type: 'RESET' };

interface ShipmentContext {
  shipmentId: string | null;
  status: 'idle' | 'created';
}

function createShipmentBehavior() {
  return defineBehavior<ShipmentCommand>()
    .withContext<ShipmentContext>({ shipmentId: null, status: 'idle' })
    .onMessage(({ message, actor }) => {
      const context = actor.getSnapshot().context;
      if (message.type === 'GET_STATUS') {
        return { reply: context };
      }
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

class JoinFailureNetwork implements InMemoryMessageTransportNetwork {
  private readonly delegate = createInMemoryMessageTransportNetwork();
  private failed = false;
  readonly disconnects: Array<{ source: string; destination: string }> = [];
  readonly stops: string[] = [];

  createTransport(nodeAddress: string): MessageTransport {
    const transport = this.delegate.createTransport(nodeAddress);
    const wrapped: MessageTransport & { stop(): Promise<void> } = {
      send: (destination: string, message: ActorMessage) => transport.send(destination, message),
      subscribe: (listener) => transport.subscribe(listener),
      connect: async (destination: string) => {
        await transport.connect(destination);
        if (!this.failed && nodeAddress === 'logistics-dashboard-runtime') {
          this.failed = true;
          throw new Error('local join failed');
        }
      },
      disconnect: async (destination: string) => {
        this.disconnects.push({ source: nodeAddress, destination });
        await transport.disconnect(destination);
      },
      getConnectedNodes: () => transport.getConnectedNodes(),
      isConnected: (destination: string) => transport.isConnected(destination),
      stop: async () => {
        this.stops.push(nodeAddress);
        for (const destination of transport.getConnectedNodes()) {
          this.disconnects.push({ source: nodeAddress, destination });
          await transport.disconnect(destination);
        }
      },
    };
    return wrapped;
  }

  dropNextMessage(predicate: (frame: InMemoryTransportFrame) => boolean): void {
    this.delegate.dropNextMessage(predicate);
  }
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

describe('startRuntime', () => {
  it('resolves and asks a cross-node actor immediately after two-phase startup', async () => {
    const logistics = createLogisticsTopology();
    const runtime = await startRuntime(logistics);

    try {
      const worker = runtime.worker.actor();
      const remoteWorker = await runtime.nodes.dashboard?.system.lookup<
        ShipmentContext,
        ShipmentCommand
      >(worker.address);

      expect(remoteWorker).toBeDefined();
      if (!remoteWorker) {
        throw new Error('Expected the dashboard node to resolve the worker actor after startup.');
      }
      await expect(remoteWorker.ask<ShipmentContext>({ type: 'GET_STATUS' })).resolves.toEqual({
        shipmentId: null,
        status: 'idle',
      });
    } finally {
      await runtime.stop();
    }
  });

  it('stops started nodes in reverse order when the deferred join phase fails', async () => {
    const network = new JoinFailureNetwork();

    await expect(startRuntime(createLogisticsTopology(), { network })).rejects.toThrow(
      'local join failed'
    );

    expect(network.stops).toEqual(['logistics-worker-runtime', 'logistics-dashboard-runtime']);
    expect(network.disconnects).toContainEqual({
      source: 'logistics-worker-runtime',
      destination: 'logistics-dashboard-runtime',
    });
  });

  it('starts a local topology and exposes top-level read-model and command sources', async () => {
    const logistics = createLogisticsTopology();
    const runtime = await startRuntime(logistics);

    try {
      const session = runtime.dashboard.session({ host: new EventTarget() });
      const readModel = session.readModel;
      const commandSource = session.commands;
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
      await session.close();
    } finally {
      await runtime.stop();
    }
  });

  it('cleans local source subscriptions and stops all started nodes', async () => {
    const logistics = createLogisticsTopology();
    const runtime = await startRuntime(logistics);
    const readModel = runtime.dashboard.readModel();
    const commandSource = runtime.dashboard.commands();
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
    const runtime: StartedActorWebLocalRuntime<typeof logistics> = await startRuntime(logistics);
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
    > = runtime.dashboard.commands();
    const session = runtime.dashboard.session(options);
    const command: DashboardCommand = { type: 'CREATE_SHIPMENT', shipmentId: 'typed' };
    const snapshots: DashboardContext[] = [];

    const sessionReadModel: ClosableActorWebReadModelSource<DashboardContext, DashboardEvent> =
      session.readModel;
    const sessionCommands: ClosableActorWebSource<
      DashboardContext,
      DashboardCommand,
      DashboardEvent
    > = session.commands;

    readModel.subscribe((snapshot) => {
      snapshots.push(snapshot.context);
    });
    controller.abort();
    await commandSource.send(command);
    await runtime.nodes.dashboard?.system.flush();

    expect(snapshots).toHaveLength(1);
    expect(sessionReadModel.snapshot().context.status).toBe('created');
    expect(sessionCommands).toBeDefined();

    await runtime.stop();
  });

  it('routes runtime topology source factories through the new local source vocabulary', async () => {
    const logistics = createLogisticsTopology();
    const runtime = await startRuntime(logistics);

    try {
      type RuntimeSourceFactoryInput = Parameters<typeof runtime.topology.source>[1];
      const localSourceOptions: RuntimeSourceFactoryInput = { host: new EventTarget() };
      const source = runtime.topology.source('dashboard', localSourceOptions);
      const session = runtime.topology.session('dashboard', localSourceOptions);
      const snapshots: ShipmentContext[] = [];

      source.subscribe((snapshot) => {
        snapshots.push(snapshot.context);
      });

      expect(typeof source.send).toBe('function');
      expect(typeof session.commands.send).toBe('function');
      expect(snapshots).toHaveLength(1);

      await source.send({
        type: 'CREATE_SHIPMENT',
        shipmentId: 'before-stop',
      });
      await runtime.nodes.dashboard?.system.flush();

      expect(snapshots.at(-1)).toEqual({
        shipmentId: 'before-stop',
        status: 'created',
      });

      await session.close();
      source.close();

      await runtime.dashboard.commands().send({
        type: 'CREATE_SHIPMENT',
        shipmentId: 'after-stop',
      });
      await runtime.nodes.dashboard?.system.flush();

      expect(snapshots).toHaveLength(2);
    } finally {
      await runtime.stop();
    }
  });
});
