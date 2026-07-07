import type { MessageTransport } from '@actor-web/runtime/browser';
import {
  type BroadcastChannelLike,
  createBroadcastChannelMessageTransport,
  type StartedActorWebNode,
  startActorWebNode,
} from '@actor-web/runtime/browser';
import { PONG_NODE_ADDRESSES } from '../pong-contract';
import { pong } from '../pong-topology';

export interface MeshPongBroadcastOptions {
  readonly channelName?: string;
  readonly broadcastChannelFactory?: (channelName: string) => BroadcastChannelLike;
}

export interface StartedMeshPongCluster {
  readonly mode: 'broadcast' | 'websocket' | 'mesh';
  readonly server: StartedActorWebNode<typeof pong, MessageTransport>;
  readonly a: StartedActorWebNode<typeof pong, MessageTransport>;
  readonly b: StartedActorWebNode<typeof pong, MessageTransport>;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export async function connectMeshPongCluster(
  cluster: Pick<StartedMeshPongCluster, 'server' | 'a' | 'b'>
): Promise<void> {
  await Promise.all([
    cluster.server.system.join([PONG_NODE_ADDRESSES.a, PONG_NODE_ADDRESSES.b]),
    cluster.a.system.join([PONG_NODE_ADDRESSES.server, PONG_NODE_ADDRESSES.b]),
    cluster.b.system.join([PONG_NODE_ADDRESSES.server, PONG_NODE_ADDRESSES.a]),
  ]);
}

export async function flushMeshPongCluster(
  cluster: Pick<StartedMeshPongCluster, 'server' | 'a' | 'b'>
): Promise<void> {
  await Promise.all([
    cluster.server.system.flush(),
    cluster.a.system.flush(),
    cluster.b.system.flush(),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all([
    cluster.server.system.flush(),
    cluster.a.system.flush(),
    cluster.b.system.flush(),
  ]);
}

export async function stopMeshPongCluster(
  cluster: Pick<StartedMeshPongCluster, 'server' | 'a' | 'b'>
): Promise<void> {
  await Promise.allSettled([cluster.b.stop(), cluster.a.stop(), cluster.server.stop()]);
}

function createBroadcastTransport(
  nodeAddress: string,
  options: MeshPongBroadcastOptions
): MessageTransport {
  return createBroadcastChannelMessageTransport({
    nodeAddress,
    incarnation: `${nodeAddress}-mesh-pong`,
    channelName: options.channelName ?? 'mesh-pong',
    heartbeatIntervalMs: 0,
    ...(options.broadcastChannelFactory
      ? { broadcastChannelFactory: options.broadcastChannelFactory }
      : {}),
  });
}

export async function startMeshPongBroadcast(
  options: MeshPongBroadcastOptions = {}
): Promise<StartedMeshPongCluster> {
  const server = await startActorWebNode(pong, {
    node: 'server',
    transport: createBroadcastTransport(PONG_NODE_ADDRESSES.server, options),
  });
  const a = await startActorWebNode(pong, {
    node: 'a',
    transport: createBroadcastTransport(PONG_NODE_ADDRESSES.a, options),
  });
  const b = await startActorWebNode(pong, {
    node: 'b',
    transport: createBroadcastTransport(PONG_NODE_ADDRESSES.b, options),
  });

  const cluster: StartedMeshPongCluster = {
    mode: 'broadcast',
    server,
    a,
    b,
    flush: () => flushMeshPongCluster(cluster),
    stop: () => stopMeshPongCluster(cluster),
  };

  await connectMeshPongCluster(cluster);
  await cluster.flush();
  return cluster;
}
