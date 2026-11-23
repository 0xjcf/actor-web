import { type StartedActorWebNode, startActorWebNode } from '@actor-web/runtime/browser';
import {
  type ActorToolRegistry,
  type ServedActorWebNode,
  serveNode,
} from '@actor-web/runtime/node';
import { PONG_NODE_ADDRESSES } from '../pong-contract';
import { createPongControllerTools } from '../pong-controller';
import { createPongTopology, pong } from '../pong-topology';

type StartedPongNode = StartedActorWebNode<never>;
type ServedPongNode = ServedActorWebNode<never>;
type FlushableNode = {
  stop(): Promise<void>;
  system: {
    flush(): Promise<void>;
  };
};

export interface MeshPongWebSocketLoopbackOptions {
  readonly tools?: ActorToolRegistry;
}

export interface StartedMeshPongWebSocketHost {
  readonly mode: 'websocket';
  readonly clientNodeAddress: string;
  readonly client: StartedPongNode;
  readonly lookupNode: StartedPongNode;
  readonly server: ServedPongNode;
  readonly a: ServedPongNode;
  readonly b: ServedPongNode;
  readonly transportUrl: string;
  readonly matchAddress: string;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

function requireTransportUrl(node: ServedPongNode, label: string): string {
  const url = node.getTransportUrl();
  if (!url) {
    throw new Error(`Mesh Pong ${label} WebSocket node did not expose a transport URL.`);
  }
  return url;
}

async function ensureGlobalWebSocket(): Promise<void> {
  if (typeof globalThis.WebSocket === 'function') {
    return;
  }
  const ws = await import('ws');
  globalThis.WebSocket = ws.WebSocket as typeof globalThis.WebSocket;
}

async function flushHostNodes(nodes: readonly FlushableNode[]): Promise<void> {
  await Promise.all(nodes.map((nodeRuntime) => nodeRuntime.system.flush()));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(nodes.map((nodeRuntime) => nodeRuntime.system.flush()));
}

async function stopHostNodes(nodes: readonly FlushableNode[]): Promise<void> {
  await Promise.allSettled([...nodes].reverse().map((nodeRuntime) => nodeRuntime.stop()));
}

export async function startMeshPongWebSocketHost(
  options: MeshPongWebSocketLoopbackOptions = {}
): Promise<StartedMeshPongWebSocketHost> {
  const startedNodes: FlushableNode[] = [];
  const tools = createPongControllerTools(options.tools);
  const clientNodeAddress = PONG_NODE_ADDRESSES.localClient;
  const topology = createPongTopology({ clientNodeAddress });
  await ensureGlobalWebSocket();

  try {
    const b = await serveNode(pong as never, {
      node: 'b',
      transport: { listen: true, heartbeatIntervalMs: 0 },
      tools,
    });
    startedNodes.push(b);

    const a = await serveNode(pong as never, {
      node: 'a',
      transport: { listen: true, heartbeatIntervalMs: 0 },
      tools,
      peers: {
        b: requireTransportUrl(b, 'b'),
      },
      connect: ['b'],
    });
    startedNodes.push(a);

    const server = await serveNode(pong as never, {
      node: 'server',
      transport: { listen: true, heartbeatIntervalMs: 0 },
      tools,
      peers: {
        a: requireTransportUrl(a, 'a'),
        b: requireTransportUrl(b, 'b'),
      },
      connect: ['a', 'b'],
    });
    startedNodes.push(server);

    const client = await startActorWebNode(topology as never, {
      node: 'client',
      peers: {
        server: requireTransportUrl(server, 'server'),
      },
      connect: ['server'],
      transport: {
        incarnation: `${clientNodeAddress}-host`,
        heartbeatIntervalMs: 0,
      },
    });
    startedNodes.push(client);

    const transportUrl = requireTransportUrl(server, 'server');
    const matchAddress = server.requireActor('matchCoordinator').address;
    const runtime: StartedMeshPongWebSocketHost = {
      mode: 'websocket',
      clientNodeAddress,
      client,
      lookupNode: client,
      server,
      a,
      b,
      transportUrl,
      matchAddress,
      flush: () => flushHostNodes(startedNodes),
      stop: () => stopHostNodes(startedNodes),
    };
    await runtime.flush();
    return runtime;
  } catch (error) {
    await stopHostNodes(startedNodes);
    throw error;
  }
}

export const startMeshPongWebSocketLoopback = startMeshPongWebSocketHost;
