/// <reference types="node" />

import {
  type ActorRef,
  createRuntimeGatewaySource,
  RuntimeGatewayScopeError,
} from '@actor-core/runtime';
import {
  type ServedActorWebHttp,
  type ServedActorWebNode,
  serveActorWebHttp,
  serveActorWebNode,
} from '@actor-core/runtime/node';
import type {
  ProviderSignal,
  RoutePlan,
  ShipmentCommand,
  ShipmentContext,
} from './logistics-contract';
import {
  providerFacilityForShipment,
  providerLoadIdForShipment,
  providerNoteForSignal,
} from './logistics-provider';
import {
  isProviderSignal,
  type LifecycleMode,
  LogisticsProviderQueue,
  shouldReturnShipment,
} from './logistics-provider-hq';
import { logistics } from './logistics-topology';

const shipmentActorDescriptor = logistics.actors.shipment;
const routingActorDescriptor = logistics.actors.routing;
const serverNode = logistics.nodes.server.address;
const workerNode = logistics.nodes.worker.address;

export interface LogisticsRuntimeGatewayServerOptions {
  host?: string;
  port?: number;
  transportPort?: number;
  restPort?: number;
  lifecycleMode?: LifecycleMode;
  lifecycleLabelDelayMs?: number;
  lifecyclePackedDelayMs?: number;
  lifecycleShippedDelayMs?: number;
  lifecycleTerminalDelayMs?: number;
}

export interface LogisticsRuntimeGatewayServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getGatewayUrl(): string | null;
  getTransportUrl(): string | null;
  getRestUrl(): string | null;
}

function createShipmentId(): string {
  return `shipment-${Date.now().toString(36)}`;
}

function bodyRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export function createLogisticsRuntimeGatewayServer(
  options: LogisticsRuntimeGatewayServerOptions = {}
): LogisticsRuntimeGatewayServer {
  let lifecycleMode = options.lifecycleMode ?? 'simulation';
  const lifecycleLabelDelayMs = options.lifecycleLabelDelayMs ?? 2_000;
  const lifecyclePackedDelayMs = options.lifecyclePackedDelayMs ?? 6_000;
  const lifecycleShippedDelayMs = options.lifecycleShippedDelayMs ?? 10_000;
  const lifecycleTerminalDelayMs = options.lifecycleTerminalDelayMs ?? 20_000;
  let servedNode: ServedActorWebNode<typeof logistics> | null = null;
  let shipmentActor: ActorRef<ShipmentContext, ShipmentCommand> | null = null;
  let restServer: ServedActorWebHttp | null = null;
  let restUrl: string | null = null;
  const lifecycleTimers = new Set<ReturnType<typeof setTimeout>>();
  const providerQueue = new LogisticsProviderQueue();

  const system = () => {
    if (!servedNode) {
      throw new Error('Actor-Web server node is not ready.');
    }

    return servedNode.system;
  };

  const transport = () => {
    if (!servedNode) {
      throw new Error('Actor-Web server node is not ready.');
    }

    return servedNode.transport;
  };

  const clearLifecycleTimers = (): void => {
    for (const timer of Array.from(lifecycleTimers)) {
      clearTimeout(timer);
      lifecycleTimers.delete(timer);
    }
  };

  const scheduleLifecycleUpdate = (
    delayMs: number,
    signal: ProviderSignal,
    expectedShipmentId: string
  ): void => {
    const timer = setTimeout(() => {
      lifecycleTimers.delete(timer);
      const activeShipmentId = shipmentActor?.getSnapshot().context.shipmentId;
      if (activeShipmentId !== expectedShipmentId) {
        return;
      }

      void applyProviderSignal({
        shipmentId: expectedShipmentId,
        signal,
        clearLifecycleTimers: false,
      });
    }, delayMs);
    lifecycleTimers.add(timer);
  };

  const scheduleShipmentLifecycle = (shipmentId: string): void => {
    if (lifecycleMode === 'manual') {
      return;
    }

    clearLifecycleTimers();
    scheduleLifecycleUpdate(lifecycleLabelDelayMs, 'LABEL_SCANNED', shipmentId);
    scheduleLifecycleUpdate(lifecyclePackedDelayMs, 'PACKED_INTO_TRUCK', shipmentId);
    scheduleLifecycleUpdate(lifecycleShippedDelayMs, 'OUTBOUND_SCAN', shipmentId);
    scheduleLifecycleUpdate(
      lifecycleTerminalDelayMs,
      shouldReturnShipment(shipmentId) ? 'RETURN_EXCEPTION' : 'DELIVERY_CONFIRMED',
      shipmentId
    );
  };

  const upsertProviderQueue = (context: ShipmentContext): void => {
    providerQueue.upsert(context);
  };

  const selectedProviderShipmentId = (): string | null => providerQueue.selectedShipmentId();

  const providerStatus = () => {
    const snapshot = shipmentActor?.getSnapshot().context ?? null;
    return providerQueue.status(lifecycleMode, snapshot);
  };

  const setLifecycleMode = (nextMode: LifecycleMode): void => {
    lifecycleMode = nextMode;
    clearLifecycleTimers();

    if (nextMode !== 'simulation') {
      return;
    }

    const activeShipmentId = selectedProviderShipmentId();
    if (activeShipmentId) {
      scheduleShipmentLifecycle(activeShipmentId);
    }
  };

  const applyProviderSignal = async (input: {
    shipmentId?: string;
    signal: ProviderSignal;
    facility?: string;
    loadId?: string;
    note?: string;
    clearLifecycleTimers?: boolean;
  }): Promise<ShipmentContext> => {
    if (!shipmentActor) {
      throw new Error('Shipment actor is not ready.');
    }

    if (input.clearLifecycleTimers !== false) {
      clearLifecycleTimers();
    }
    const shipmentId = input.shipmentId ?? shipmentActor.getSnapshot().context.shipmentId;
    if (!shipmentId) {
      throw new Error('No active shipment is available for provider signal.');
    }

    await shipmentActor.send({
      type: 'APPLY_PROVIDER_SIGNAL',
      shipmentId,
      signal: input.signal,
      facility: input.facility ?? providerFacilityForShipment(shipmentId),
      loadId: input.loadId ?? providerLoadIdForShipment(shipmentId),
      note: input.note ?? providerNoteForSignal(input.signal),
      baseContext: providerQueue.contextFor(shipmentId),
    });
    await system().flush();
    upsertProviderQueue(shipmentActor.getSnapshot().context);

    return shipmentActor.getSnapshot().context;
  };

  const planRouteForShipment = async (input: {
    shipmentId: string;
    destination: string;
    reference?: string;
  }): Promise<RoutePlan | null> => {
    try {
      for (let attempt = 0; !transport().isConnected(workerNode) && attempt < 40; attempt += 1) {
        await wait(25);
      }

      if (!transport().isConnected(workerNode)) {
        return null;
      }

      await system().join([workerNode]);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const routingRef = await system().lookup<unknown, ShipmentCommand>(
          routingActorDescriptor.address.path
        );
        if (routingRef) {
          return await routingRef.ask<RoutePlan>(
            {
              type: 'PLAN_ROUTE',
              shipmentId: input.shipmentId,
              destination: input.destination,
              reference: input.reference,
            },
            1000
          );
        }

        await wait(25);
      }

      return null;
    } catch {
      return null;
    }
  };

  const createShipment = async (input: {
    shipmentId?: string;
    destination: string;
    reference?: string;
  }): Promise<{ shipmentId: string; status: ShipmentContext['status'] }> => {
    if (!shipmentActor) {
      throw new Error('Shipment actor is not ready.');
    }

    const shipmentId = input.shipmentId ?? createShipmentId();
    await shipmentActor.send({
      type: 'CREATE_SHIPMENT',
      shipmentId,
      destination: input.destination,
      reference: input.reference,
    });
    await system().flush();
    upsertProviderQueue(shipmentActor.getSnapshot().context);

    const plan = await planRouteForShipment({
      shipmentId,
      destination: input.destination,
      reference: input.reference,
    });
    if (plan) {
      await shipmentActor.send({ type: 'ASSIGN_ROUTE', plan });
      await system().flush();
      upsertProviderQueue(shipmentActor.getSnapshot().context);
      scheduleShipmentLifecycle(shipmentId);
    }

    return { shipmentId, status: plan ? 'route-assigned' : 'route-requested' };
  };

  const serveRest = async (runtime: ServedActorWebNode<typeof logistics>): Promise<void> => {
    restServer = await serveActorWebHttp(runtime)
      .for(shipmentActorDescriptor)
      .post('/shipments', async (request, response) => {
        const body = bodyRecord(request.body);
        const destination = typeof body.destination === 'string' ? body.destination.trim() : '';
        if (destination.length === 0) {
          return response.badRequest({ error: 'destination is required' });
        }

        const result = await createShipment({
          shipmentId: typeof body.shipmentId === 'string' ? body.shipmentId : undefined,
          destination,
          reference: typeof body.reference === 'string' ? body.reference : undefined,
        });
        return response.accepted(result);
      })
      .post('/shipments/:id/reset', async (_request, response) => {
        clearLifecycleTimers();
        providerQueue.clear();
        await shipmentActor?.send({ type: 'RESET_SHIPMENT' });
        return response.accepted({ status: 'idle' });
      })
      .get('/shipments/current', (_request, response) => {
        return response.ok(shipmentActor?.getSnapshot().context ?? null);
      })
      .get('/shipments/count', async (_request, response, actorWeb) => {
        const count = await actorWeb.actor.ask<number>({ type: 'GET_SHIPMENT_COUNT' });
        return response.ok({ count });
      })
      .get('/provider/status', (_request, response) => {
        return response.ok(providerStatus());
      })
      .post('/provider/mode', (request, response) => {
        const body = bodyRecord(request.body);
        if (body.mode !== 'simulation' && body.mode !== 'manual') {
          return response.badRequest({ error: 'provider mode must be simulation or manual' });
        }

        setLifecycleMode(body.mode);
        return response.accepted(providerStatus());
      })
      .post('/provider/signals', async (request, response) => {
        const body = bodyRecord(request.body);
        if (!isProviderSignal(body.signal)) {
          return response.badRequest({ error: 'provider signal is required' });
        }

        const snapshot = await applyProviderSignal({
          shipmentId:
            typeof body.shipmentId === 'string'
              ? body.shipmentId
              : (selectedProviderShipmentId() ?? undefined),
          signal: body.signal,
          facility: typeof body.facility === 'string' ? body.facility : undefined,
          loadId: typeof body.loadId === 'string' ? body.loadId : undefined,
          note: typeof body.note === 'string' ? body.note : undefined,
        });
        upsertProviderQueue(snapshot);
        return response.accepted(providerStatus());
      })
      .get('/runtime/status', (_request, response, actorWeb) => {
        return response.ok({
          gatewayUrl: actorWeb.runtime.getGatewayUrl(),
          transportUrl: actorWeb.runtime.getTransportUrl(),
          lifecycleMode,
          nodes: {
            browserHost: 'thin Ignite host',
            serverRuntime: serverNode,
            workerRuntime: workerNode,
            serviceWorkerRuntime: 'browser-local topology proof',
          },
          actors: {
            shipment: shipmentActorDescriptor.address.path,
            routing: routingActorDescriptor.address.path,
          },
        });
      })
      .listen({
        host: options.host ?? '127.0.0.1',
        port: options.restPort ?? 0,
      });
    restUrl = restServer.url;
  };

  return {
    async start(): Promise<void> {
      if (servedNode) {
        return;
      }

      servedNode = await serveActorWebNode(logistics, {
        node: 'server',
        host: options.host ?? '127.0.0.1',
        transport: {
          listen: {
            host: options.host ?? '127.0.0.1',
            port: options.transportPort ?? 0,
          },
        },
        gateway: {
          host: options.host ?? '127.0.0.1',
          port: options.port ?? 0,
          expose: ['shipment'],
          resolveScope: async (scope) => {
            const shipmentScope = shipmentActorDescriptor.gateway?.scope.kind;
            const routingScope = routingActorDescriptor.gateway?.scope.kind;
            if (scope.kind !== shipmentScope && scope.kind !== routingScope) {
              throw new RuntimeGatewayScopeError(
                'invalid_scope',
                `Unsupported scope ${scope.kind}.`
              );
            }

            const isWorkerScope = scope.kind === routingScope;
            const sourceActor = isWorkerScope ? routingActorDescriptor : shipmentActorDescriptor;
            let actorRef = await system().lookup(sourceActor.address.path);
            for (let attempt = 0; !actorRef && attempt < 20; attempt += 1) {
              await wait(25);
              actorRef = await system().lookup(sourceActor.address.path);
            }
            if (!actorRef) {
              return null;
            }

            return createRuntimeGatewaySource(actorRef, {
              workflowId: isWorkerScope ? 'logistics-routing' : 'logistics-shipment',
              taskId: sourceActor.id,
              taskTitle: isWorkerScope ? 'Logistics routing worker' : 'Logistics shipment tracker',
              sourceActor: sourceActor.address.path,
            });
          },
        },
      });
      shipmentActor =
        (servedNode.getActor('shipment') as
          | ActorRef<ShipmentContext, ShipmentCommand>
          | undefined) ?? null;
      if (!shipmentActor) {
        throw new Error('Shipment actor was not spawned by Actor-Web server node.');
      }

      await serveRest(servedNode);
    },
    async stop(): Promise<void> {
      const activeServedNode = servedNode;
      const activeRestServer = restServer;
      servedNode = null;
      restServer = null;
      restUrl = null;
      shipmentActor = null;
      clearLifecycleTimers();

      if (activeRestServer) {
        await activeRestServer.stop();
      }

      await activeServedNode?.stop();
    },
    getGatewayUrl(): string | null {
      return servedNode?.getGatewayUrl() ?? null;
    },
    getTransportUrl(): string | null {
      return servedNode?.getTransportUrl() ?? null;
    },
    getRestUrl(): string | null {
      return restUrl;
    },
  };
}
