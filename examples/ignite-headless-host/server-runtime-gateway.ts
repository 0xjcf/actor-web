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

export function createLogisticsRuntimeGatewayServer(
  options: LogisticsRuntimeGatewayServerOptions = {}
): LogisticsRuntimeGatewayServer {
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

      if (request.method === 'GET' && url.pathname === '/runtime/status') {
        sendJson(response, 200, {
          gatewayUrl,
          transportUrl: transport.getListeningUrl(),
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
