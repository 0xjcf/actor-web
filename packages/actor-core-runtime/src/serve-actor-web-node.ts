import type { ActorRef } from './actor-ref.js';
import type { ActorMessage, ActorSystem } from './actor-system.js';
import { createActorSystem } from './actor-system-impl.js';
import {
  getActorWebNodeDefinition,
  getOwnedActorWebActors,
  spawnOwnedActorWebActors,
} from './actor-web-node-runtime.js';
import {
  createNodeWebSocketMessageTransport,
  type NodeWebSocketMessageTransport,
} from './node-websocket-message-transport.js';
import {
  createRuntimeGatewayHub,
  createRuntimeGatewaySource,
  type RuntimeGatewayClientFrame,
  type RuntimeGatewayConnectionAdapter,
  RuntimeGatewayScopeError,
  type RuntimeGatewayScopeResolver,
} from './runtime-gateway.js';
import type { ActorWebTopology, ActorWebTopologyInput } from './topology.js';

export interface ActorWebNodeGatewayOptions<TActorKey extends string = string> {
  readonly host?: string;
  readonly port?: number;
  readonly expose?: readonly TActorKey[];
  readonly resolveScope?: RuntimeGatewayScopeResolver<Record<string, never>>;
}

export interface ActorWebNodeTransportOptions {
  readonly listen?:
    | boolean
    | {
        readonly host?: string;
        readonly port?: number;
      };
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
}

export interface ServeActorWebNodeOptions<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
> {
  readonly node: keyof TTopology['nodes'] & string;
  readonly host?: string;
  readonly gateway?: ActorWebNodeGatewayOptions<keyof TTopology['actors'] & string>;
  readonly transport?: ActorWebNodeTransportOptions;
}

export interface ServedActorWebNode<TTopology extends ActorWebTopology<ActorWebTopologyInput>> {
  readonly system: ActorSystem;
  readonly transport: NodeWebSocketMessageTransport;
  start(): Promise<void>;
  stop(): Promise<void>;
  getGatewayUrl(): string | null;
  getTransportUrl(): string | null;
  getActor<TKey extends keyof TTopology['actors'] & string>(
    key: TKey
  ): ActorRef<unknown, ActorMessage> | undefined;
}

interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  on(event: 'message', listener: (data: unknown) => void): void;
  on(event: 'close', listener: () => void): void;
  off(event: 'message', listener: (data: unknown) => void): void;
  off(event: 'close', listener: () => void): void;
}

interface WebSocketServerLike {
  on(event: 'connection', listener: (socket: WebSocketLike) => void): void;
  once(event: 'listening', listener: () => void): void;
  once(event: 'error', listener: (error: Error) => void): void;
  address(): string | { address: string; port: number } | null;
  close(callback: (error?: Error) => void): void;
}

type WebSocketServerConstructor = new (options: {
  host: string;
  port: number;
}) => WebSocketServerLike;

const WEB_SOCKET_OPEN = 1;

class ActorWebNodeGatewayConnection implements RuntimeGatewayConnectionAdapter {
  readonly authContext = {};

  constructor(private readonly socket: WebSocketLike) {}

  receive(listener: (frame: RuntimeGatewayClientFrame) => void): () => void {
    const onMessage = (data: unknown): void => {
      const text =
        typeof data === 'string'
          ? data
          : data instanceof Buffer
            ? data.toString('utf8')
            : Array.isArray(data)
              ? Buffer.concat(data).toString('utf8')
              : Buffer.from(data as ArrayBuffer).toString('utf8');
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
    if (this.socket.readyState === WEB_SOCKET_OPEN) {
      this.socket.send(JSON.stringify(frame));
    }
  }
}

async function createWebSocketServer(
  ServerConstructor: WebSocketServerConstructor,
  options: { host: string; port: number }
): Promise<{ server: WebSocketServerLike; url: string }> {
  const server = new ServerConstructor(options);

  const url = await new Promise<string>((resolve, reject) => {
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Actor-Web gateway server did not expose a TCP address.'));
        return;
      }

      resolve(`ws://${address.address}:${address.port}`);
    });
    server.once('error', reject);
  });

  return { server, url };
}

export async function serveActorWebNode<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  topology: TTopology,
  options: ServeActorWebNodeOptions<TTopology>
): Promise<ServedActorWebNode<TTopology>> {
  const nodeDefinition = getActorWebNodeDefinition(topology, options.node);

  const host = options.host ?? '127.0.0.1';
  const transportListen = options.transport?.listen;
  const transport = createNodeWebSocketMessageTransport({
    nodeAddress: nodeDefinition.address,
    heartbeatIntervalMs: options.transport?.heartbeatIntervalMs ?? 0,
    heartbeatTimeoutMs: options.transport?.heartbeatTimeoutMs,
    ...(transportListen
      ? {
          listen: {
            host: typeof transportListen === 'object' ? (transportListen.host ?? host) : host,
            port: typeof transportListen === 'object' ? (transportListen.port ?? 0) : 0,
          },
        }
      : {}),
  });
  const system = createActorSystem({ nodeAddress: nodeDefinition.address, transport });
  const actors = new Map<string, ActorRef<unknown, ActorMessage>>();
  const exposedActorKeys = new Set<string>(
    options.gateway?.expose ??
      getOwnedActorWebActors(topology, options.node)
        .filter(([, actorDescriptor]) => actorDescriptor.gateway)
        .map(([key]) => key)
  );

  let gatewayServer: WebSocketServerLike | null = null;
  let gatewayUrl: string | null = null;
  let running = false;

  const hub = createRuntimeGatewayHub({
    resolveScope: async (scope) => {
      const customSource = await options.gateway?.resolveScope?.(scope, {});
      if (customSource) {
        return customSource;
      }

      for (const actorKey of Array.from(exposedActorKeys)) {
        const actorDescriptor = topology.actors[actorKey];
        if (!actorDescriptor) {
          continue;
        }

        if (scope.kind !== actorKey && scope.kind !== actorDescriptor.gateway?.scope.kind) {
          continue;
        }

        const actorRef = actors.get(actorKey);
        if (!actorRef) {
          return null;
        }

        return createRuntimeGatewaySource(actorRef, {
          workflowId: actorKey,
          taskId: actorDescriptor.id,
          taskTitle: actorDescriptor.id,
          sourceActor: actorDescriptor.address.path,
        });
      }

      throw new RuntimeGatewayScopeError('invalid_scope', `Unsupported scope ${scope.kind}.`);
    },
  });

  const start = async (): Promise<void> => {
    if (running) {
      return;
    }

    await transport.start();
    await system.start();

    await spawnOwnedActorWebActors(system, topology, options.node, actors);

    if (options.gateway) {
      const { WebSocketServer } = await import('ws');
      const created = await createWebSocketServer(WebSocketServer as WebSocketServerConstructor, {
        host: options.gateway.host ?? host,
        port: options.gateway.port ?? 0,
      });
      gatewayServer = created.server;
      gatewayUrl = created.url;
      gatewayServer.on('connection', (socket) => {
        hub.attach(new ActorWebNodeGatewayConnection(socket));
      });
    }

    running = true;
  };

  const stop = async (): Promise<void> => {
    const activeGatewayServer = gatewayServer;
    gatewayServer = null;
    gatewayUrl = null;
    running = false;
    actors.clear();

    if (activeGatewayServer) {
      await new Promise<void>((resolve, reject) => {
        activeGatewayServer.close((error) => {
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
  };

  const servedNode: ServedActorWebNode<TTopology> = {
    system,
    transport,
    start,
    stop,
    getGatewayUrl(): string | null {
      return gatewayUrl;
    },
    getTransportUrl(): string | null {
      return transport.getListeningUrl();
    },
    getActor(key) {
      return actors.get(key);
    },
  };

  await servedNode.start();
  return servedNode;
}
