import type { ActorRef } from './actor-ref.js';
import type { ActorMessage, ActorSystem, MessageTransport } from './actor-system.js';
import { createActorSystem } from './actor-system-impl.js';
import type { ActorToolRegistry } from './actor-tools.js';
import {
  type ActorWebNodeActorHandles,
  createActorWebNodeActorHandles,
  createActorWebNodeToolAccess,
  getActorWebNodeDefinition,
  spawnOwnedActorWebActors,
} from './actor-web-node-runtime.js';
import { createNodeWebSocketMessageTransport } from './node-websocket-message-transport.js';
import {
  createRuntimeGatewayHub,
  createRuntimeGatewaySource,
  type RuntimeGatewayClientFrame,
  type RuntimeGatewayConnectionAdapter,
  RuntimeGatewayScopeError,
  type RuntimeGatewayScopeResolver,
  type RuntimeGatewaySource,
} from './runtime-gateway.js';
import type {
  ActorWebActorContext,
  ActorWebActorDescriptor,
  ActorWebActorMessage,
  ActorWebTopology,
  ActorWebTopologyInput,
} from './topology.js';

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
  readonly peerUrlResolver?: (
    nodeAddress: string
  ) => string | undefined | Promise<string | undefined>;
  readonly connectTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
}

export interface ServeActorWebNodeOptions<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
> {
  readonly node: keyof TTopology['nodes'] & string;
  readonly host?: string;
  readonly gateway?: boolean | ActorWebNodeGatewayOptions<keyof TTopology['actors'] & string>;
  readonly transport?: boolean | ActorWebNodeTransportOptions;
  readonly peers?: Partial<Record<keyof TTopology['nodes'] & string, string>>;
  readonly connect?: readonly (keyof TTopology['nodes'] & string)[];
  readonly tools?: ActorToolRegistry;
}

export interface ServedActorWebNode<TTopology extends ActorWebTopology<ActorWebTopologyInput>> {
  readonly system: ActorSystem;
  readonly transport: MessageTransport;
  readonly actors: ActorWebNodeActorHandles<TTopology>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getGatewayUrl(): string | null;
  getTransportUrl(): string | null;
  getActor<TKey extends keyof TTopology['actors'] & string>(
    key: TKey
  ):
    | ActorRef<
        ActorWebActorContext<TTopology['actors'][TKey]>,
        ActorWebActorMessage<TTopology['actors'][TKey]>
      >
    | undefined;
  requireActor<TKey extends keyof TTopology['actors'] & string>(
    key: TKey
  ): ActorRef<
    ActorWebActorContext<TTopology['actors'][TKey]>,
    ActorWebActorMessage<TTopology['actors'][TKey]>
  >;
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
const GATEWAY_ACTOR_LOOKUP_ATTEMPTS = 20;
const GATEWAY_ACTOR_LOOKUP_DELAY_MS = 25;

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

function normalizeGatewayOptions<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  gateway: ServeActorWebNodeOptions<TTopology>['gateway']
): ActorWebNodeGatewayOptions<keyof TTopology['actors'] & string> | undefined {
  return gateway === true ? {} : gateway || undefined;
}

function normalizeTransportOptions(
  transport: boolean | ActorWebNodeTransportOptions | undefined
): ActorWebNodeTransportOptions | undefined {
  return transport === true ? { listen: true } : transport || undefined;
}

function resolveTopologyPeerUrls<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  topology: TTopology,
  peers: Partial<Record<keyof TTopology['nodes'] & string, string>> | undefined
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(peers ?? {}).flatMap(([nodeKey, url]) => {
      if (!url) {
        return [];
      }

      const nodeDefinition = topology.nodes[nodeKey];
      if (!nodeDefinition) {
        throw new Error(`Unknown Actor-Web peer node "${nodeKey}".`);
      }

      return [[nodeDefinition.address, url]];
    })
  );
}

function resolveTopologyNodeAddresses<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  topology: TTopology,
  nodeKeys: readonly (keyof TTopology['nodes'] & string)[]
): string[] {
  return nodeKeys.map((nodeKey) => {
    const nodeDefinition = topology.nodes[nodeKey];
    if (!nodeDefinition) {
      throw new Error(`Unknown Actor-Web peer node "${nodeKey}".`);
    }

    return nodeDefinition.address;
  });
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export async function serveActorWebNode<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  topology: TTopology,
  options: ServeActorWebNodeOptions<TTopology>
): Promise<ServedActorWebNode<TTopology>> {
  const nodeDefinition = getActorWebNodeDefinition(topology, options.node);

  const host = options.host ?? '127.0.0.1';
  const gatewayOptions = normalizeGatewayOptions(options.gateway);
  const transportOptions = normalizeTransportOptions(options.transport);
  const topologyPeers = resolveTopologyPeerUrls(topology, options.peers);
  const transportListen = transportOptions?.listen;
  const transport = createNodeWebSocketMessageTransport({
    nodeAddress: nodeDefinition.address,
    peers: topologyPeers,
    peerUrlResolver: transportOptions?.peerUrlResolver,
    connectTimeoutMs: transportOptions?.connectTimeoutMs,
    heartbeatIntervalMs: transportOptions?.heartbeatIntervalMs ?? 0,
    heartbeatTimeoutMs: transportOptions?.heartbeatTimeoutMs,
    ...(transportListen
      ? {
          listen: {
            host: typeof transportListen === 'object' ? (transportListen.host ?? host) : host,
            port: typeof transportListen === 'object' ? (transportListen.port ?? 0) : 0,
          },
        }
      : {}),
  });
  const toolAccess = createActorWebNodeToolAccess(topology, options.node);
  const system = createActorSystem({
    nodeAddress: nodeDefinition.address,
    transport,
    ...(options.tools ? { tools: options.tools } : {}),
    toolAccess,
  });
  const actors = new Map<string, ActorRef<unknown, ActorMessage>>();
  const actorHandles = createActorWebNodeActorHandles(
    system,
    topology,
    options.node,
    actors,
    toolAccess,
    options.tools
  );
  const exposedActorKeys = new Set<string>(
    gatewayOptions?.expose ??
      Object.entries(topology.actors)
        .filter(([, actorDescriptor]) => actorDescriptor.gateway)
        .map(([key]) => key)
  );

  let gatewayServer: WebSocketServerLike | null = null;
  let gatewayUrl: string | null = null;
  let running = false;

  const resolveActorGatewaySource = async (
    actorKey: string,
    actorDescriptor: ActorWebActorDescriptor
  ): Promise<RuntimeGatewaySource | null> => {
    let actorRef = actors.get(actorKey);
    for (let attempt = 0; !actorRef && attempt < GATEWAY_ACTOR_LOOKUP_ATTEMPTS; attempt += 1) {
      actorRef = await system.lookup(actorDescriptor.address.path);
      if (!actorRef) {
        await wait(GATEWAY_ACTOR_LOOKUP_DELAY_MS);
      }
    }

    if (!actorRef) {
      return null;
    }

    return createRuntimeGatewaySource(actorRef, {
      workflowId: actorKey,
      taskId: actorDescriptor.address.id,
      taskTitle: actorDescriptor.address.id,
      sourceActor: actorDescriptor.address.path,
    });
  };

  const hub = createRuntimeGatewayHub({
    resolveScope: async (scope) => {
      const customSource = await gatewayOptions?.resolveScope?.(scope, {});
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

        return resolveActorGatewaySource(actorKey, actorDescriptor);
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

    await spawnOwnedActorWebActors(system, topology, options.node, actors, options.tools);

    if (gatewayOptions) {
      const { WebSocketServer } = await import('ws');
      const created = await createWebSocketServer(WebSocketServer as WebSocketServerConstructor, {
        host: gatewayOptions.host ?? host,
        port: gatewayOptions.port ?? 0,
      });
      gatewayServer = created.server;
      gatewayUrl = created.url;
      gatewayServer.on('connection', (socket) => {
        hub.attach(new ActorWebNodeGatewayConnection(socket));
      });
    }

    const connectTargets = options.connect
      ? resolveTopologyNodeAddresses(topology, options.connect)
      : Object.keys(topologyPeers);
    if (connectTargets.length > 0) {
      await system.join(connectTargets);
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
    actors: actorHandles,
    start,
    stop,
    getGatewayUrl(): string | null {
      return gatewayUrl;
    },
    getTransportUrl(): string | null {
      return transport.getListeningUrl();
    },
    getActor(key) {
      return actors.get(key) as
        | ActorRef<
            ActorWebActorContext<TTopology['actors'][typeof key]>,
            ActorWebActorMessage<TTopology['actors'][typeof key]>
          >
        | undefined;
    },
    requireActor(key) {
      const actor = this.getActor(key);
      if (!actor) {
        throw new Error(`Actor-Web node did not spawn actor "${key}".`);
      }

      return actor;
    },
  };

  await servedNode.start();
  return servedNode;
}
