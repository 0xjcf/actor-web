import type { ActorRef } from './actor-ref.js';
import type { ActorSystem, MessageTransport } from './actor-system.js';
import { createActorSystem } from './actor-system-impl.js';
import type { ActorToolRegistry } from './actor-tools.js';
import {
  type ActorWebNodeActorHandles,
  type ActorWebNodeActorMap,
  createActorWebNodeActorHandles,
  createActorWebNodeToolAccess,
  getActorWebNodeDefinition,
  spawnOwnedActorWebActors,
} from './actor-web-node-runtime.js';
import { createBrowserWebSocketMessageTransport } from './browser-websocket-message-transport.js';
import type { RuntimeTransportAuthProvider } from './runtime-auth.js';
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
  ActorWebActorMessage,
  ActorWebTopology,
  ActorWebTopologyInput,
} from './topology.js';

export interface ActorWebBrowserNodeTransportOptions {
  readonly peers?: Record<string, string>;
  readonly peerUrlResolver?: (
    nodeAddress: string
  ) => string | undefined | Promise<string | undefined>;
  readonly connect?: readonly string[];
  readonly nodeId?: string;
  readonly incarnation?: string;
  readonly capabilities?: readonly string[];
  readonly connectTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
  readonly idempotencyWindowSize?: number;
  readonly idempotencyProvider?: RuntimeTransportIdempotencyProvider;
  readonly telemetry?: RuntimeTransportTelemetryObserver;
  readonly webSocketFactory?: (url: string) => WebSocket;
  readonly auth?: RuntimeTransportAuthProvider;
}

type StartableMessageTransport = MessageTransport & {
  start?: () => Promise<void>;
  stop?: () => Promise<void>;
  destroy?: () => Promise<void> | void;
};

const DEFAULT_TRANSPORT_HEARTBEAT_INTERVAL_MS = 15_000;

export interface StartActorWebNodeOptions<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
> {
  readonly node: keyof TTopology['nodes'] & string;
  readonly peers?: Partial<Record<keyof TTopology['nodes'] & string, string>>;
  readonly connect?: readonly (keyof TTopology['nodes'] & string)[];
  readonly transport?: ActorWebBrowserNodeTransportOptions | MessageTransport;
  readonly discovery?: RuntimePeerDiscoveryProvider;
  readonly tools?: ActorToolRegistry;
}

export interface StartedActorWebNode<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
  TTransport extends MessageTransport = MessageTransport,
> {
  readonly system: ActorSystem;
  readonly transport: TTransport;
  readonly actors: ActorWebNodeActorHandles<TTopology>;
  start(): Promise<void>;
  stop(): Promise<void>;
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

function isMessageTransport(value: unknown): value is MessageTransport {
  return (
    typeof value === 'object' &&
    value !== null &&
    'send' in value &&
    'subscribe' in value &&
    'connect' in value &&
    'disconnect' in value
  );
}

function createTopologyTransport(
  nodeAddress: string,
  transportOptions: ActorWebBrowserNodeTransportOptions | MessageTransport | undefined,
  transportPeers: Record<string, string>,
  discoveryPeerUrls: ReadonlyMap<string, string>,
  useDiscoveryPeerUrlResolver: boolean
): MessageTransport {
  if (isMessageTransport(transportOptions)) {
    return transportOptions;
  }

  return createBrowserWebSocketMessageTransport({
    nodeAddress,
    ...(transportOptions?.nodeId ? { nodeId: transportOptions.nodeId } : {}),
    ...(transportOptions?.incarnation ? { incarnation: transportOptions.incarnation } : {}),
    ...(transportOptions?.capabilities ? { capabilities: transportOptions.capabilities } : {}),
    ...(Object.keys(transportPeers).length > 0 ? { peers: transportPeers } : {}),
    ...(transportOptions?.peerUrlResolver
      ? {
          peerUrlResolver: async (nodeAddress) =>
            transportPeers[nodeAddress] ??
            discoveryPeerUrls.get(nodeAddress) ??
            (await transportOptions.peerUrlResolver?.(nodeAddress)),
        }
      : useDiscoveryPeerUrlResolver
        ? {
            peerUrlResolver: (nodeAddress) =>
              transportPeers[nodeAddress] ?? discoveryPeerUrls.get(nodeAddress),
          }
        : {}),
    ...(transportOptions?.connectTimeoutMs !== undefined
      ? { connectTimeoutMs: transportOptions.connectTimeoutMs }
      : {}),
    ...(transportOptions?.heartbeatIntervalMs !== undefined
      ? { heartbeatIntervalMs: transportOptions.heartbeatIntervalMs }
      : {}),
    ...(transportOptions?.heartbeatTimeoutMs !== undefined
      ? { heartbeatTimeoutMs: transportOptions.heartbeatTimeoutMs }
      : {}),
    ...(transportOptions?.idempotencyWindowSize !== undefined
      ? { idempotencyWindowSize: transportOptions.idempotencyWindowSize }
      : {}),
    ...(transportOptions?.idempotencyProvider
      ? { idempotencyProvider: transportOptions.idempotencyProvider }
      : {}),
    ...(transportOptions?.telemetry ? { telemetry: transportOptions.telemetry } : {}),
    ...(transportOptions?.auth ? { auth: transportOptions.auth } : {}),
    ...(transportOptions?.webSocketFactory
      ? { webSocketFactory: transportOptions.webSocketFactory }
      : {}),
  });
}

export async function startActorWebNode<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  topology: TTopology,
  options: StartActorWebNodeOptions<TTopology> & {
    readonly transport?: ActorWebBrowserNodeTransportOptions;
  }
): Promise<StartedActorWebNode<TTopology, MessageTransport>>;
export async function startActorWebNode<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
  TTransport extends MessageTransport,
>(
  topology: TTopology,
  options: StartActorWebNodeOptions<TTopology> & { readonly transport: TTransport }
): Promise<StartedActorWebNode<TTopology, TTransport>>;

export async function startActorWebNode<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  topology: TTopology,
  options: StartActorWebNodeOptions<TTopology>
): Promise<StartedActorWebNode<TTopology, MessageTransport>> {
  const nodeDefinition = getActorWebNodeDefinition(topology, options.node);
  const transportOptions = options.transport;
  const topologyPeers = resolveTopologyPeerUrls(topology, options.peers);
  const websocketTransportOptions = isMessageTransport(transportOptions)
    ? undefined
    : transportOptions;
  const discoveryPeerUrls = new Map<string, string>();
  const transportPeers = {
    ...(websocketTransportOptions?.peers ?? {}),
    ...topologyPeers,
  };
  const heartbeatIntervalMs =
    websocketTransportOptions?.heartbeatIntervalMs ?? DEFAULT_TRANSPORT_HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs =
    websocketTransportOptions?.heartbeatTimeoutMs ?? heartbeatIntervalMs * 2;
  const transportStatusStaleAfterMs =
    heartbeatIntervalMs <= 0 ? 0 : heartbeatIntervalMs + heartbeatTimeoutMs;
  const transport = createTopologyTransport(
    nodeDefinition.address,
    transportOptions,
    transportPeers,
    discoveryPeerUrls,
    Boolean(options.discovery)
  );
  const toolAccess = createActorWebNodeToolAccess(topology, options.node);
  const system = createActorSystem({
    nodeAddress: nodeDefinition.address,
    transport,
    ...(options.tools ? { tools: options.tools } : {}),
    toolAccess,
  });
  const actors: ActorWebNodeActorMap<TTopology> = new Map();
  const actorHandles = createActorWebNodeActorHandles(
    system,
    topology,
    options.node,
    actors,
    toolAccess,
    options.tools
  );
  let running = false;
  let unsubscribeDiscovery: (() => void) | undefined;

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

  const start = async (): Promise<void> => {
    if (running) {
      return;
    }

    await (transport as StartableMessageTransport).start?.();
    await system.start();
    await spawnOwnedActorWebActors(system, topology, options.node, actors, options.tools);

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
      : (websocketTransportOptions?.connect ?? Object.keys(transportPeers));
    if (connectTargets.length > 0) {
      await system.join([...connectTargets]);
    }

    running = true;
  };

  const stop = async (): Promise<void> => {
    running = false;
    unsubscribeDiscovery?.();
    unsubscribeDiscovery = undefined;
    discoveryPeerUrls.clear();
    actors.clear();
    await system.stop();
    const startableTransport = transport as StartableMessageTransport;
    if (startableTransport.stop) {
      await startableTransport.stop();
    } else {
      await startableTransport.destroy?.();
    }
  };

  const startedNode: StartedActorWebNode<TTopology, MessageTransport> = {
    system,
    transport,
    actors: actorHandles,
    start,
    stop,
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

  await startedNode.start();
  return startedNode;
}
