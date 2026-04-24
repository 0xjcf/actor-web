/// <reference types="node" />

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  type ActorRef,
  createActorSystem,
  createNodeWebSocketMessageTransport,
  createRuntimeGatewayHub,
  createRuntimeGatewaySource,
  type NodeWebSocketMessageTransport,
  type RuntimeGatewayClientFrame,
  type RuntimeGatewayConnectionAdapter,
  RuntimeGatewayScopeError,
} from '@actor-core/runtime';
import WebSocket, { WebSocketServer } from 'ws';
import {
  createShipmentBehavior,
  type ProviderSignal,
  providerFacilityForShipment,
  providerLoadIdForShipment,
  providerNoteForSignal,
  REMOTE_ACTOR_ID,
  REMOTE_ADDRESS,
  REMOTE_NODE,
  type RoutePlan,
  type ShipmentCommand,
  type ShipmentContext,
  WORKER_ACTOR_ID,
  WORKER_ADDRESS,
  WORKER_NODE,
} from './checkout-contract';

export interface LogisticsRuntimeGatewayServerOptions {
  host?: string;
  port?: number;
  transportPort?: number;
  restPort?: number;
  lifecycleMode?: 'simulation' | 'manual';
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

export type CheckoutRuntimeGatewayServerOptions = LogisticsRuntimeGatewayServerOptions;
export type CheckoutRuntimeGatewayServer = LogisticsRuntimeGatewayServer;

class WebSocketGatewayConnection implements RuntimeGatewayConnectionAdapter {
  readonly authContext = {};

  constructor(private readonly socket: WebSocket) {}

  receive(listener: (frame: RuntimeGatewayClientFrame) => void): () => void {
    const onMessage = (data: WebSocket.RawData): void => {
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.from(data).toString('utf8');
      listener(JSON.parse(text) as RuntimeGatewayClientFrame);
    };

    this.socket.on('message', onMessage);
    return () => {
      this.socket.off('message', onMessage);
    };
  }

  onClose(listener: () => void): () => void {
    this.socket.on('close', listener);
    return () => {
      this.socket.off('close', listener);
    };
  }

  send(frame: unknown): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(frame));
    }
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function createShipmentId(): string {
  return `shipment-${Date.now().toString(36)}`;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function shouldReturnShipment(shipmentId: string): boolean {
  let hash = 0;
  for (let index = 0; index < shipmentId.length; index += 1) {
    hash = (hash * 31 + shipmentId.charCodeAt(index)) >>> 0;
  }

  return hash % 5 === 0;
}

function isProviderSignal(value: unknown): value is ProviderSignal {
  return (
    value === 'LABEL_SCANNED' ||
    value === 'PACKED_INTO_TRUCK' ||
    value === 'OUTBOUND_SCAN' ||
    value === 'DELIVERY_CONFIRMED' ||
    value === 'RETURN_EXCEPTION'
  );
}

export function createLogisticsRuntimeGatewayServer(
  options: LogisticsRuntimeGatewayServerOptions = {}
): LogisticsRuntimeGatewayServer {
  const lifecycleMode = options.lifecycleMode ?? 'simulation';
  const lifecycleLabelDelayMs = options.lifecycleLabelDelayMs ?? 2_000;
  const lifecyclePackedDelayMs = options.lifecyclePackedDelayMs ?? 6_000;
  const lifecycleShippedDelayMs = options.lifecycleShippedDelayMs ?? 10_000;
  const lifecycleTerminalDelayMs = options.lifecycleTerminalDelayMs ?? 20_000;
  const transport: NodeWebSocketMessageTransport = createNodeWebSocketMessageTransport({
    nodeAddress: REMOTE_NODE,
    incarnation: `${REMOTE_NODE}-demo`,
    heartbeatIntervalMs: 0,
    listen: {
      host: options.host ?? '127.0.0.1',
      port: options.transportPort ?? 0,
    },
  });
  const system = createActorSystem({ nodeAddress: REMOTE_NODE, transport });
  let shipmentActor: ActorRef<ShipmentContext, ShipmentCommand> | null = null;
  let server: WebSocketServer | null = null;
  let restServer: Server | null = null;
  let gatewayUrl: string | null = null;
  let restUrl: string | null = null;
  const lifecycleTimers = new Set<ReturnType<typeof setTimeout>>();

  const clearLifecycleTimers = (): void => {
    for (const timer of Array.from(lifecycleTimers)) {
      clearTimeout(timer);
      lifecycleTimers.delete(timer);
    }
  };

  const scheduleLifecycleUpdate = (
    delayMs: number,
    command: ShipmentCommand,
    expectedShipmentId: string
  ): void => {
    const timer = setTimeout(() => {
      lifecycleTimers.delete(timer);
      const activeShipmentId = shipmentActor?.getSnapshot().context.shipmentId;
      if (activeShipmentId !== expectedShipmentId) {
        return;
      }

      void shipmentActor?.send(command);
    }, delayMs);
    lifecycleTimers.add(timer);
  };

  const scheduleShipmentLifecycle = (shipmentId: string): void => {
    if (lifecycleMode === 'manual') {
      return;
    }

    clearLifecycleTimers();
    scheduleLifecycleUpdate(
      lifecycleLabelDelayMs,
      { type: 'APPLY_PROVIDER_SIGNAL', shipmentId, signal: 'LABEL_SCANNED' },
      shipmentId
    );
    scheduleLifecycleUpdate(
      lifecyclePackedDelayMs,
      { type: 'APPLY_PROVIDER_SIGNAL', shipmentId, signal: 'PACKED_INTO_TRUCK' },
      shipmentId
    );
    scheduleLifecycleUpdate(
      lifecycleShippedDelayMs,
      { type: 'APPLY_PROVIDER_SIGNAL', shipmentId, signal: 'OUTBOUND_SCAN' },
      shipmentId
    );
    scheduleLifecycleUpdate(
      lifecycleTerminalDelayMs,
      {
        type: 'APPLY_PROVIDER_SIGNAL',
        shipmentId,
        signal: shouldReturnShipment(shipmentId) ? 'RETURN_EXCEPTION' : 'DELIVERY_CONFIRMED',
      },
      shipmentId
    );
  };

  const applyProviderSignal = async (input: {
    shipmentId?: string;
    signal: ProviderSignal;
    facility?: string;
    loadId?: string;
    note?: string;
  }): Promise<ShipmentContext> => {
    if (!shipmentActor) {
      throw new Error('Shipment actor is not ready.');
    }

    clearLifecycleTimers();
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
    });
    await system.flush();

    return shipmentActor.getSnapshot().context;
  };

  const planRouteForShipment = async (input: {
    shipmentId: string;
    destination: string;
    reference?: string;
  }): Promise<RoutePlan | null> => {
    try {
      for (let attempt = 0; !transport.isConnected(WORKER_NODE) && attempt < 40; attempt += 1) {
        await wait(25);
      }

      if (!transport.isConnected(WORKER_NODE)) {
        return null;
      }

      await system.join([WORKER_NODE]);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const routingRef = await system.lookup<unknown, ShipmentCommand>(WORKER_ADDRESS.path);
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

    const plan = await planRouteForShipment({
      shipmentId,
      destination: input.destination,
      reference: input.reference,
    });
    if (plan) {
      await shipmentActor.send({ type: 'ASSIGN_ROUTE', plan });
      scheduleShipmentLifecycle(shipmentId);
    }

    return { shipmentId, status: plan ? 'route-assigned' : 'route-requested' };
  };

  const hub = createRuntimeGatewayHub({
    resolveScope: async (scope) => {
      if (
        scope.kind !== 'ignite-headless-checkout' &&
        scope.kind !== 'logistics-shipment' &&
        scope.kind !== 'ignite-headless-worker-checkout' &&
        scope.kind !== 'logistics-routing'
      ) {
        throw new RuntimeGatewayScopeError('invalid_scope', `Unsupported scope ${scope.kind}.`);
      }

      const isWorkerScope =
        scope.kind === 'ignite-headless-worker-checkout' || scope.kind === 'logistics-routing';
      let actorRef = await system.lookup(isWorkerScope ? WORKER_ADDRESS.path : REMOTE_ADDRESS.path);
      for (let attempt = 0; !actorRef && attempt < 20; attempt += 1) {
        await wait(25);
        actorRef = await system.lookup(isWorkerScope ? WORKER_ADDRESS.path : REMOTE_ADDRESS.path);
      }
      if (!actorRef) {
        return null;
      }

      return createRuntimeGatewaySource(actorRef, {
        workflowId: isWorkerScope ? 'logistics-routing' : 'logistics-shipment',
        taskId: isWorkerScope ? WORKER_ACTOR_ID : REMOTE_ACTOR_ID,
        taskTitle: isWorkerScope ? 'Logistics routing worker' : 'Logistics shipment tracker',
        sourceActor: isWorkerScope ? WORKER_ADDRESS.path : REMOTE_ADDRESS.path,
      });
    },
  });

  const handleRest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (request.method === 'OPTIONS') {
        sendJson(response, 204, {});
        return;
      }

      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'POST' && url.pathname === '/shipments') {
        const body = await readJson(request);
        const destination = typeof body.destination === 'string' ? body.destination.trim() : '';
        if (destination.length === 0) {
          sendJson(response, 400, { error: 'destination is required' });
          return;
        }

        const result = await createShipment({
          shipmentId: typeof body.shipmentId === 'string' ? body.shipmentId : undefined,
          destination,
          reference: typeof body.reference === 'string' ? body.reference : undefined,
        });
        sendJson(response, 202, result);
        return;
      }

      if (request.method === 'POST' && /^\/shipments\/[^/]+\/reset$/.test(url.pathname)) {
        clearLifecycleTimers();
        await shipmentActor?.send({ type: 'RESET_SHIPMENT' });
        sendJson(response, 202, { status: 'idle' });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/shipments/current') {
        sendJson(response, 200, shipmentActor?.getSnapshot().context ?? null);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/shipments/count') {
        const count = await shipmentActor?.ask<number>({ type: 'GET_SHIPMENT_COUNT' });
        sendJson(response, 200, { count: count ?? 0 });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/provider/status') {
        const snapshot = shipmentActor?.getSnapshot().context ?? null;
        sendJson(response, 200, {
          mode: lifecycleMode,
          shipmentId: snapshot?.shipmentId ?? null,
          status: snapshot?.status ?? null,
          facility: snapshot?.providerFacility ?? null,
          signal: snapshot?.providerSignal ?? null,
          loadId: snapshot?.providerLoadId ?? null,
          note: snapshot?.providerNote ?? null,
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/provider/signals') {
        const body = await readJson(request);
        if (!isProviderSignal(body.signal)) {
          sendJson(response, 400, { error: 'provider signal is required' });
          return;
        }

        const snapshot = await applyProviderSignal({
          shipmentId: typeof body.shipmentId === 'string' ? body.shipmentId : undefined,
          signal: body.signal,
          facility: typeof body.facility === 'string' ? body.facility : undefined,
          loadId: typeof body.loadId === 'string' ? body.loadId : undefined,
          note: typeof body.note === 'string' ? body.note : undefined,
        });
        sendJson(response, 202, {
          shipmentId: snapshot.shipmentId,
          status: snapshot.status,
          facility: snapshot.providerFacility,
          signal: snapshot.providerSignal,
          loadId: snapshot.providerLoadId,
          note: snapshot.providerNote,
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/runtime/status') {
        sendJson(response, 200, {
          gatewayUrl,
          transportUrl: transport.getListeningUrl(),
          lifecycleMode,
          nodes: {
            browserHost: 'thin Ignite host',
            serverRuntime: REMOTE_NODE,
            workerRuntime: WORKER_NODE,
            serviceWorkerRuntime: 'browser-local topology proof',
          },
          actors: {
            shipment: REMOTE_ADDRESS.path,
            routing: WORKER_ADDRESS.path,
          },
        });
        return;
      }

      sendJson(response, 404, { error: 'not found' });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };

  return {
    async start(): Promise<void> {
      if (server) {
        return;
      }

      await transport.start();
      await system.start();
      shipmentActor = await system.spawn(createShipmentBehavior(), { id: REMOTE_ACTOR_ID });

      server = new WebSocketServer({
        host: options.host ?? '127.0.0.1',
        port: options.port ?? 0,
      });
      server.on('connection', (socket) => {
        hub.attach(new WebSocketGatewayConnection(socket));
      });

      await new Promise<void>((resolve, reject) => {
        const activeServer = server;
        if (!activeServer) {
          reject(new Error('Gateway WebSocket server was not created.'));
          return;
        }

        activeServer.once('listening', () => {
          const address = activeServer.address();
          if (!address || typeof address === 'string') {
            reject(new Error('Gateway WebSocket server did not expose a TCP address.'));
            return;
          }

          gatewayUrl = `ws://${address.address}:${address.port}`;
          resolve();
        });
        activeServer.once('error', reject);
      });

      restServer = createServer((request, response) => {
        void handleRest(request, response);
      });
      await new Promise<void>((resolve, reject) => {
        const activeServer = restServer;
        if (!activeServer) {
          reject(new Error('REST server was not created.'));
          return;
        }

        activeServer.listen(options.restPort ?? 0, options.host ?? '127.0.0.1');
        activeServer.once('listening', () => {
          const address = activeServer.address();
          if (!address || typeof address === 'string') {
            reject(new Error('REST server did not expose a TCP address.'));
            return;
          }

          restUrl = `http://${address.address}:${address.port}`;
          resolve();
        });
        activeServer.once('error', reject);
      });
    },
    async stop(): Promise<void> {
      const activeServer = server;
      const activeRestServer = restServer;
      server = null;
      restServer = null;
      gatewayUrl = null;
      restUrl = null;
      shipmentActor = null;
      clearLifecycleTimers();

      if (activeServer) {
        await new Promise<void>((resolve, reject) => {
          activeServer.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
      }

      if (activeRestServer) {
        await new Promise<void>((resolve, reject) => {
          activeRestServer.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
      }

      await system.stop();
      await transport.stop();
    },
    getGatewayUrl(): string | null {
      return gatewayUrl;
    },
    getTransportUrl(): string | null {
      return transport.getListeningUrl();
    },
    getRestUrl(): string | null {
      return restUrl;
    },
  };
}

export const createCheckoutRuntimeGatewayServer = createLogisticsRuntimeGatewayServer;
