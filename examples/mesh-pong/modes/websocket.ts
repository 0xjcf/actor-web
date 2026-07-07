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
  const b = await serveNode(pong, {
    node: 'b',
    transport: { listen: true, heartbeatIntervalMs: 0 },
  });
  const a = await serveNode(pong, {
    node: 'a',
    transport: { listen: true, heartbeatIntervalMs: 0 },
    peers: {
      b: requireTransportUrl(b, 'b'),
    },
    connect: ['b'],
  });
  const server = await serveNode(pong, {
    node: 'server',
    transport: { listen: true, heartbeatIntervalMs: 0 },
    peers: {
      a: requireTransportUrl(a, 'a'),
      b: requireTransportUrl(b, 'b'),
    },
    connect: ['a', 'b'],
  });

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
}
