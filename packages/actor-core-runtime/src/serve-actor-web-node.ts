import type { ActorRef } from './actor-ref.js';
import type { ActorMessage, ActorSystem, MessageTransport } from './actor-system.js';
import { createActorSystem } from './actor-system-impl.js';
import type { ActorToolRegistry } from './actor-tools.js';
import {
  type ActorWebNodeActorHandles,
  type ActorWebSubscriptionTeardown,
  createActorWebNodeActorHandles,
  createActorWebNodeToolAccess,
  getActorWebNodeDefinition,
  resolveOwnedActorWebSupervisorGroups,
  spawnOwnedActorWebActors,
  wireOwnedActorWebSubscriptions,
} from './actor-web-node-runtime.js';
import { createNodeWebSocketMessageTransport } from './node-websocket-message-transport.js';
import type { RuntimeGatewayAuthProvider, RuntimeTransportAuthProvider } from './runtime-auth.js';
import {
  createRuntimeGatewayHub,
  createRuntimeGatewaySource,
  type RuntimeGatewayClientFrame,
  type RuntimeGatewayConnectionAdapter,
  type RuntimeGatewayInvalidFrameEvent,
  type RuntimeGatewayObserverEvent,
  RuntimeGatewayScopeError,
  type RuntimeGatewayScopeResolver,
  type RuntimeGatewaySource,
} from './runtime-gateway.js';
import type {
  RuntimePeerDiscoveryProvider,
  RuntimePeerDiscoveryRecord,
} from './runtime-peer-discovery.js';
import type { RuntimeTransportIdempotencyProvider } from './runtime-transport-idempotency.js';
import {
  getRuntimePeerStatus,
  getRuntimeTransportStatus,
  type RuntimePeerStatus,
  type RuntimeTransportStatus,
} from './runtime-transport-status.js';
import type { RuntimeTransportTelemetryObserver } from './runtime-transport-telemetry.js';
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
  readonly inboundQueueLimit?: number;
  readonly observer?: (event: RuntimeGatewayObserverEvent) => void;
  readonly auth?: RuntimeGatewayAuthProvider<{
    readonly connectionId: string;
    readonly clientVersion?: string;
  }>;
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
  readonly outboundQueueLimit?: number;
  readonly idempotencyWindowSize?: number;
  readonly idempotencyProvider?: RuntimeTransportIdempotencyProvider;
  readonly auth?: RuntimeTransportAuthProvider;
  readonly telemetry?: RuntimeTransportTelemetryObserver;
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
  readonly discovery?: RuntimePeerDiscoveryProvider;
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
  getTransportStatus(): RuntimeTransportStatus;
  getPeerStatus(nodeAddress: string): RuntimePeerStatus;
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
  close(): void;
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
const DEFAULT_TRANSPORT_HEARTBEAT_INTERVAL_MS = 15_000;

class ActorWebNodeGatewayConnection implements RuntimeGatewayConnectionAdapter {
  readonly authContext = {};

  constructor(private readonly socket: WebSocketLike) {}

  receive(
    listener: (frame: RuntimeGatewayClientFrame) => void,
    onInvalidFrame?: (event: RuntimeGatewayInvalidFrameEvent) => void
  ): () => void {
    const onMessage = (data: unknown): void => {
      const text =
        typeof data === 'string'
          ? data
          : data instanceof Buffer
            ? data.toString('utf8')
            : Array.isArray(data)
              ? Buffer.concat(data).toString('utf8')
              : Buffer.from(data as ArrayBuffer).toString('utf8');
      try {
        listener(JSON.parse(text) as RuntimeGatewayClientFrame);
      } catch (error) {
        onInvalidFrame?.({
          reason: 'Gateway frame must be valid JSON.',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
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

  close(): void {
    this.socket.close();
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

async function closeWebSocketServer(server: WebSocketServerLike): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
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

export async function serveNode<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  topology: TTopology,
  options: ServeActorWebNodeOptions<TTopology>
): Promise<ServedActorWebNode<TTopology>> {
  const nodeDefinition = getActorWebNodeDefinition(topology, options.node);

  const host = options.host ?? '127.0.0.1';
  const gatewayOptions = normalizeGatewayOptions(options.gateway);
  const transportOptions = normalizeTransportOptions(options.transport);
  const topologyPeers = resolveTopologyPeerUrls(topology, options.peers);
  const discoveryPeerUrls = new Map<string, string>();
  const transportListen = transportOptions?.listen;
  const heartbeatIntervalMs =
    transportOptions?.heartbeatIntervalMs ?? DEFAULT_TRANSPORT_HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs = transportOptions?.heartbeatTimeoutMs ?? heartbeatIntervalMs * 2;
  const transportStatusStaleAfterMs =
    heartbeatIntervalMs <= 0 ? 0 : heartbeatIntervalMs + heartbeatTimeoutMs;
  const transport = createNodeWebSocketMessageTransport({
    nodeAddress: nodeDefinition.address,
    peers: topologyPeers,
    peerUrlResolver: async (nodeAddress) =>
      topologyPeers[nodeAddress] ??
      discoveryPeerUrls.get(nodeAddress) ??
      (await transportOptions?.peerUrlResolver?.(nodeAddress)),
    connectTimeoutMs: transportOptions?.connectTimeoutMs,
    ...(transportOptions?.heartbeatIntervalMs !== undefined
      ? { heartbeatIntervalMs: transportOptions.heartbeatIntervalMs }
      : {}),
    ...(transportOptions?.heartbeatTimeoutMs !== undefined
      ? { heartbeatTimeoutMs: transportOptions.heartbeatTimeoutMs }
      : {}),
    ...(transportOptions?.outboundQueueLimit !== undefined
      ? { outboundQueueLimit: transportOptions.outboundQueueLimit }
      : {}),
    ...(transportOptions?.idempotencyWindowSize !== undefined
      ? { idempotencyWindowSize: transportOptions.idempotencyWindowSize }
      : {}),
    ...(transportOptions?.idempotencyProvider
      ? { idempotencyProvider: transportOptions.idempotencyProvider }
      : {}),
    ...(transportOptions?.telemetry ? { telemetry: transportOptions.telemetry } : {}),
    ...(transportOptions?.auth ? { auth: transportOptions.auth } : {}),
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
    supervisors: resolveOwnedActorWebSupervisorGroups(topology, options.node),
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
  let unsubscribeDiscovery: (() => void) | undefined;
  let subscriptionTeardowns: ActorWebSubscriptionTeardown[] = [];

  const teardownTopologySubscriptions = async (
    onError: (error: unknown) => void
  ): Promise<void> => {
    const activeTeardowns = subscriptionTeardowns;
    subscriptionTeardowns = [];
    for (const teardown of activeTeardowns) {
      try {
        await teardown();
      } catch (error) {
        onError(error);
      }
    }
  };

  const allowedDiscoveryTargets = options.connect
    ? new Set(resolveTopologyNodeAddresses(topology, options.connect))
    : null;

  const shouldConnectDiscoveredPeer = (nodeAddress: string): boolean =>
    nodeAddress !== nodeDefinition.address &&
    (!allowedDiscoveryTargets || allowedDiscoveryTargets.has(nodeAddress));

  const connectDiscoveredPeer = async (peer: RuntimePeerDiscoveryRecord): Promise<void> => {
    if (!shouldConnectDiscoveredPeer(peer.nodeAddress)) {
      return;
    }

    discoveryPeerUrls.set(peer.nodeAddress, peer.url);
    await system.join([peer.nodeAddress]);
  };

  const resolveActorGatewaySource = async (
    actorKey: string,
    actorDescriptor: ActorWebActorDescriptor
  ): Promise<RuntimeGatewaySource | null> => {
    let actorRef = actors.get(actorKey);
    for (let attempt = 0; !actorRef && attempt < GATEWAY_ACTOR_LOOKUP_ATTEMPTS; attempt += 1) {
      actorRef = await system.lookup(actorDescriptor.address);
      if (!actorRef) {
        await wait(GATEWAY_ACTOR_LOOKUP_DELAY_MS);
      }
    }

    if (!actorRef) {
      return null;
    }

    return createRuntimeGatewaySource(actorRef, {
      sourceActor: actorDescriptor.address,
    });
  };

  const hub = createRuntimeGatewayHub({
    ...(gatewayOptions?.auth ? { auth: gatewayOptions.auth } : {}),
    ...(gatewayOptions?.inboundQueueLimit !== undefined
      ? { inboundQueueLimit: gatewayOptions.inboundQueueLimit }
      : {}),
    ...(gatewayOptions?.observer ? { observer: gatewayOptions.observer } : {}),
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

    let transportStarted = false;
    let systemStarted = false;
    let registeredSelf = false;

    try {
      await transport.start();
      transportStarted = true;

      await system.start();
      systemStarted = true;

      await spawnOwnedActorWebActors(system, topology, options.node, actors, options.tools);
      subscriptionTeardowns = await wireOwnedActorWebSubscriptions(
        system,
        topology,
        options.node,
        actors
      );

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

      const discoveryPeers = options.discovery ? await options.discovery.getPeers() : [];
      for (const peer of discoveryPeers) {
        await connectDiscoveredPeer(peer);
      }
      unsubscribeDiscovery = options.discovery?.subscribe?.((event) => {
        if (event.type === 'peer.unavailable') {
          discoveryPeerUrls.delete(event.nodeAddress);
          void transport.disconnect(event.nodeAddress).catch(() => {});
          return;
        }

        discoveryPeerUrls.set(event.peer.nodeAddress, event.peer.url);
        if (shouldConnectDiscoveredPeer(event.peer.nodeAddress)) {
          void system.join([event.peer.nodeAddress]).catch(() => {});
        }
      });

      const connectTargets = options.connect
        ? resolveTopologyNodeAddresses(topology, options.connect)
        : Object.keys(topologyPeers);
      if (connectTargets.length > 0) {
        await system.join(connectTargets);
      }

      const transportUrl = transport.getListeningUrl();
      if (transportUrl) {
        await options.discovery?.registerSelf?.({
          nodeAddress: nodeDefinition.address,
          url: transportUrl,
        });
        registeredSelf = true;
      }

      running = true;
    } catch (startupError) {
      running = false;

      if (registeredSelf) {
        try {
          await options.discovery?.unregisterSelf?.(nodeDefinition.address);
        } catch {}
      }

      const activeUnsubscribe = unsubscribeDiscovery;
      unsubscribeDiscovery = undefined;
      if (activeUnsubscribe) {
        try {
          activeUnsubscribe();
        } catch {}
      }

      const activeGatewayServer = gatewayServer;
      gatewayServer = null;
      gatewayUrl = null;
      if (activeGatewayServer) {
        try {
          await closeWebSocketServer(activeGatewayServer);
        } catch {}
      }

      await teardownTopologySubscriptions(() => {});

      if (systemStarted) {
        try {
          await system.stop();
        } catch {}
      }

      if (transportStarted) {
        try {
          await transport.stop();
        } catch {}
      }

      discoveryPeerUrls.clear();
      actors.clear();
      throw startupError;
    }
  };

  const stop = async (): Promise<void> => {
    const activeGatewayServer = gatewayServer;
    const activeUnsubscribe = unsubscribeDiscovery;
    gatewayServer = null;
    gatewayUrl = null;
    running = false;
    unsubscribeDiscovery = undefined;

    let stopError: unknown;

    if (activeGatewayServer) {
      try {
        await closeWebSocketServer(activeGatewayServer);
      } catch (error) {
        stopError ??= error;
      }
    }

    try {
      await options.discovery?.unregisterSelf?.(nodeDefinition.address);
    } catch (error) {
      stopError ??= error;
    }

    await teardownTopologySubscriptions((error) => {
      stopError ??= error;
    });

    try {
      await system.stop();
    } catch (error) {
      stopError ??= error;
    }

    try {
      await transport.stop();
    } catch (error) {
      stopError ??= error;
    }

    try {
      activeUnsubscribe?.();
    } catch (error) {
      stopError ??= error;
    }

    discoveryPeerUrls.clear();
    actors.clear();

    if (stopError) {
      throw stopError;
    }
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
    getTransportStatus(): RuntimeTransportStatus {
      return getRuntimeTransportStatus(transport, {
        staleAfterMs: transportStatusStaleAfterMs,
      });
    },
    getPeerStatus(nodeAddress: string): RuntimePeerStatus {
      return getRuntimePeerStatus(transport, nodeAddress, {
        staleAfterMs: transportStatusStaleAfterMs,
      });
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
