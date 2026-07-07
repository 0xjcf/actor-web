import { type ServedActorWebNode, serveNode } from '@actor-web/runtime/node';
import { pong } from '../pong-topology';
import {
  flushMeshPongCluster,
  type StartedMeshPongCluster,
  stopMeshPongCluster,
} from './broadcast';

function requireTransportUrl(node: ServedActorWebNode<typeof pong>, label: string): string {
  const url = node.getTransportUrl();
  if (!url) {
    throw new Error(`Mesh Pong ${label} WebSocket node did not expose a transport URL.`);
  }
  return url;
}

export async function startMeshPongWebSocketLoopback(): Promise<StartedMeshPongCluster> {
  const startedNodes: Array<{ stop(): Promise<void> }> = [];

  try {
    const b = await serveNode(pong, {
      node: 'b',
      transport: { listen: true, heartbeatIntervalMs: 0 },
    });
    startedNodes.push(b);

    const a = await serveNode(pong, {
      node: 'a',
      transport: { listen: true, heartbeatIntervalMs: 0 },
      peers: {
        b: requireTransportUrl(b, 'b'),
      },
      connect: ['b'],
    });
    startedNodes.push(a);

    const server = await serveNode(pong, {
      node: 'server',
      transport: { listen: true, heartbeatIntervalMs: 0 },
      peers: {
        a: requireTransportUrl(a, 'a'),
        b: requireTransportUrl(b, 'b'),
      },
      connect: ['a', 'b'],
    });
    startedNodes.push(server);

    const cluster: StartedMeshPongCluster = {
      mode: 'websocket',
      server,
      a,
      b,
      flush: () => flushMeshPongCluster(cluster),
      stop: () => stopMeshPongCluster(cluster),
    };

    await cluster.flush();
    return cluster;
  } catch (error) {
    await Promise.allSettled(startedNodes.map((nodeRuntime) => nodeRuntime.stop()));
    throw error;
  }
}
