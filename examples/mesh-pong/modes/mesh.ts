import { createLabsMesh, type LabsMesh } from '@actor-web/labs-mesh';
import { PONG_NODE_ADDRESSES } from '../pong-contract';
import {
  type MeshPongBroadcastOptions,
  type StartedMeshPongBroadcast,
  startMeshPongBroadcast,
  startMeshPongBroadcastClient,
  startMeshPongBroadcastHost,
} from './broadcast';

export interface StartedMeshPongMesh extends Omit<StartedMeshPongBroadcast, 'mode'> {
  readonly mode: 'mesh';
  readonly meshes: Partial<Record<'server' | 'a' | 'b' | 'client', LabsMesh>>;
}

function createMeshOverlay(localNode: string, membership: readonly string[]): LabsMesh {
  const seenAt = 1;
  const adjacency = Object.fromEntries(
    membership.map((nodeAddress) => [
      nodeAddress,
      membership.filter((candidate) => candidate !== nodeAddress),
    ])
  ) as Record<string, string[]>;

  return createLabsMesh({
    localNode,
    membership: membership.map((nodeAddress) => ({
      nodeAddress,
      incarnation: 1,
      state: 'alive',
      seenAt,
    })),
    adjacency,
  });
}

export function createMeshOverlayForStartedNodes(
  runtime: StartedMeshPongBroadcast
): Partial<Record<'server' | 'a' | 'b' | 'client', LabsMesh>> {
  const membership = [
    runtime.server ? PONG_NODE_ADDRESSES.server : null,
    runtime.a ? PONG_NODE_ADDRESSES.a : null,
    runtime.b ? PONG_NODE_ADDRESSES.b : null,
    runtime.clientNodeAddress,
  ].filter((value): value is string => Boolean(value));

  return {
    ...(runtime.server
      ? { server: createMeshOverlay(PONG_NODE_ADDRESSES.server, membership) }
      : {}),
    ...(runtime.a ? { a: createMeshOverlay(PONG_NODE_ADDRESSES.a, membership) } : {}),
    ...(runtime.b ? { b: createMeshOverlay(PONG_NODE_ADDRESSES.b, membership) } : {}),
    client: createMeshOverlay(runtime.clientNodeAddress, membership),
  };
}

async function decorateMeshRuntime(
  runtime: StartedMeshPongBroadcast
): Promise<StartedMeshPongMesh> {
  return {
    ...runtime,
    mode: 'mesh',
    meshes: createMeshOverlayForStartedNodes(runtime),
  };
}

export async function startMeshPongMeshHost(
  options: MeshPongBroadcastOptions = {}
): Promise<StartedMeshPongMesh> {
  return decorateMeshRuntime(await startMeshPongBroadcastHost(options));
}

export async function startMeshPongMeshClient(
  options: MeshPongBroadcastOptions = {}
): Promise<StartedMeshPongMesh> {
  return decorateMeshRuntime(await startMeshPongBroadcastClient(options));
}

export async function startMeshPongMesh(
  options: MeshPongBroadcastOptions = {}
): Promise<StartedMeshPongMesh> {
  return decorateMeshRuntime(
    await startMeshPongBroadcast({
      ...options,
      channelName: options.channelName ?? 'mesh-pong-mesh',
    })
  );
}
