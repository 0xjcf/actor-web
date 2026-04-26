import type { ActorRef } from './actor-ref.js';
import type { ActorMessage, ActorSystem } from './actor-system.js';
import { createActorSystem } from './actor-system-impl.js';
import type { ActorToolRegistry } from './actor-tools.js';
import {
  type ActorWebNodeActorMap,
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

export async function startActorWebNode<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  topology: TTopology,
  options: StartActorWebNodeOptions<TTopology>
): Promise<StartedActorWebNode<TTopology>> {
  const nodeDefinition = getActorWebNodeDefinition(topology, options.node);
  const transportOptions = options.transport;
  const transport = createBrowserWebSocketMessageTransport({
    nodeAddress: nodeDefinition.address,
    ...(transportOptions?.nodeId ? { nodeId: transportOptions.nodeId } : {}),
    ...(transportOptions?.incarnation ? { incarnation: transportOptions.incarnation } : {}),
    ...(transportOptions?.capabilities ? { capabilities: transportOptions.capabilities } : {}),
    ...(transportOptions?.peers ? { peers: transportOptions.peers } : {}),
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

    const connectTargets = transportOptions?.connect ?? Object.keys(transportOptions?.peers ?? {});
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
