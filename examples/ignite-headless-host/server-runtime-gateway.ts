/// <reference types="node" />

import {
  createActorSystem,
  createRuntimeGatewayHub,
  createRuntimeGatewaySource,
  type RuntimeGatewayClientFrame,
  type RuntimeGatewayConnectionAdapter,
  RuntimeGatewayScopeError,
} from '@actor-core/runtime';
import WebSocket, { WebSocketServer } from 'ws';
import { createCheckoutBehavior, REMOTE_ACTOR_ID, REMOTE_NODE } from './checkout-contract';

export interface CheckoutRuntimeGatewayServerOptions {
  host?: string;
  port?: number;
}

export interface CheckoutRuntimeGatewayServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getGatewayUrl(): string | null;
}

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

export function createCheckoutRuntimeGatewayServer(
  options: CheckoutRuntimeGatewayServerOptions = {}
): CheckoutRuntimeGatewayServer {
  const system = createActorSystem({ nodeAddress: REMOTE_NODE });
  const hub = createRuntimeGatewayHub({
    resolveScope: async (scope) => {
      if (scope.kind !== 'ignite-headless-checkout') {
        throw new RuntimeGatewayScopeError('invalid_scope', `Unsupported scope ${scope.kind}.`);
      }

      const actorRef = await system.lookup(`actor://${REMOTE_NODE}/actor/${REMOTE_ACTOR_ID}`);
      if (!actorRef) {
        return null;
      }

      return createRuntimeGatewaySource(actorRef, {
        workflowId: 'ignite-headless-checkout',
        taskId: REMOTE_ACTOR_ID,
        taskTitle: 'Ignite headless checkout',
        sourceActor: `actor://${REMOTE_NODE}/actor/${REMOTE_ACTOR_ID}`,
      });
    },
  });
  let server: WebSocketServer | null = null;
  let gatewayUrl: string | null = null;

  return {
    async start(): Promise<void> {
      if (server) {
        return;
      }

      await system.start();
      await system.spawn(createCheckoutBehavior(), { id: REMOTE_ACTOR_ID });

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
    },
    async stop(): Promise<void> {
      const activeServer = server;
      server = null;
      gatewayUrl = null;

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

      await system.stop();
    },
    getGatewayUrl(): string | null {
      return gatewayUrl;
    },
  };
}
