import type { ActorRef } from './actor-ref.js';
import type { ActorMessage, ActorSystem } from './actor-system.js';
import { createActorSystem } from './actor-system-impl.js';
import type { ActorToolRegistry } from './actor-tools.js';
import {
  type ActorWebNodeActorMap,
  createActorWebNodeToolAccess,
  getActorWebNodeDefinition,
  spawnOwnedActorWebActors,
} from './actor-web-node-runtime.js';
import {
  type BrowserWebSocketMessageTransport,
  createBrowserWebSocketMessageTransport,
} from './browser-websocket-message-transport.js';
import type { RuntimeTransportTelemetryObserver } from './runtime-transport-telemetry.js';
import type { ActorWebTopology, ActorWebTopologyInput } from './topology.js';

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
  readonly telemetry?: RuntimeTransportTelemetryObserver;
  readonly webSocketFactory?: (url: string) => WebSocket;
}

export interface StartActorWebNodeOptions<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
> {
  readonly node: keyof TTopology['nodes'] & string;
  readonly peers?: Partial<Record<keyof TTopology['nodes'] & string, string>>;
  readonly connect?: readonly (keyof TTopology['nodes'] & string)[];
  readonly transport?: ActorWebBrowserNodeTransportOptions;
  readonly tools?: ActorToolRegistry;
}

export interface StartedActorWebNode<TTopology extends ActorWebTopology<ActorWebTopologyInput>> {
  readonly system: ActorSystem;
  readonly transport: BrowserWebSocketMessageTransport;
  start(): Promise<void>;
  stop(): Promise<void>;
  getActor<TKey extends keyof TTopology['actors'] & string>(
    key: TKey
  ): ActorRef<unknown, ActorMessage> | undefined;
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

export async function startActorWebNode<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  topology: TTopology,
  options: StartActorWebNodeOptions<TTopology>
): Promise<StartedActorWebNode<TTopology>> {
  const nodeDefinition = getActorWebNodeDefinition(topology, options.node);
  const transportOptions = options.transport;
  const topologyPeers = resolveTopologyPeerUrls(topology, options.peers);
  const transportPeers = {
    ...(transportOptions?.peers ?? {}),
    ...topologyPeers,
  };
  const transport = createBrowserWebSocketMessageTransport({
    nodeAddress: nodeDefinition.address,
    ...(transportOptions?.nodeId ? { nodeId: transportOptions.nodeId } : {}),
    ...(transportOptions?.incarnation ? { incarnation: transportOptions.incarnation } : {}),
    ...(transportOptions?.capabilities ? { capabilities: transportOptions.capabilities } : {}),
    ...(Object.keys(transportPeers).length > 0 ? { peers: transportPeers } : {}),
    ...(transportOptions?.peerUrlResolver
      ? { peerUrlResolver: transportOptions.peerUrlResolver }
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
    ...(transportOptions?.telemetry ? { telemetry: transportOptions.telemetry } : {}),
    ...(transportOptions?.webSocketFactory
      ? { webSocketFactory: transportOptions.webSocketFactory }
      : {}),
  });
  const system = createActorSystem({
    nodeAddress: nodeDefinition.address,
    transport,
    ...(options.tools ? { tools: options.tools } : {}),
    toolAccess: createActorWebNodeToolAccess(topology, options.node),
  });
  const actors: ActorWebNodeActorMap<TTopology> = new Map();
  let running = false;

  const start = async (): Promise<void> => {
    if (running) {
      return;
    }

    await transport.start();
    await system.start();
    await spawnOwnedActorWebActors(system, topology, options.node, actors, options.tools);

    const connectTargets = options.connect
      ? resolveTopologyNodeAddresses(topology, options.connect)
      : (transportOptions?.connect ?? Object.keys(transportPeers));
    if (connectTargets.length > 0) {
      await system.join([...connectTargets]);
    }

    running = true;
  };

  const stop = async (): Promise<void> => {
    running = false;
    actors.clear();
    await system.stop();
    await transport.stop();
  };

  const startedNode: StartedActorWebNode<TTopology> = {
    system,
    transport,
    start,
    stop,
    getActor(key) {
      return actors.get(key);
    },
  };

  await startedNode.start();
  return startedNode;
}
