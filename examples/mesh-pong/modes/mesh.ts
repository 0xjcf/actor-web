import { createLabsMesh, type LabsMesh } from '@actor-web/labs-mesh';
import { PONG_NODE_ADDRESSES } from '../pong-contract';
import {
  type MeshPongBroadcastOptions,
  type StartedMeshPongCluster,
  startMeshPongBroadcast,
} from './broadcast';

export interface StartedMeshPongMesh extends Omit<StartedMeshPongCluster, 'mode'> {
  readonly mode: 'mesh';
  readonly meshes: {
    readonly server: LabsMesh;
    readonly a: LabsMesh;
    readonly b: LabsMesh;
  };
}

function createMeshOverlay(localNode: string): LabsMesh {
  const seenAt = 1;
  return createLabsMesh({
    localNode,
    membership: [
      { nodeAddress: PONG_NODE_ADDRESSES.server, incarnation: 1, state: 'alive', seenAt },
      { nodeAddress: PONG_NODE_ADDRESSES.a, incarnation: 1, state: 'alive', seenAt },
      { nodeAddress: PONG_NODE_ADDRESSES.b, incarnation: 1, state: 'alive', seenAt },
    ],
    adjacency: {
      [PONG_NODE_ADDRESSES.server]: [PONG_NODE_ADDRESSES.a, PONG_NODE_ADDRESSES.b],
      [PONG_NODE_ADDRESSES.a]: [PONG_NODE_ADDRESSES.server, PONG_NODE_ADDRESSES.b],
      [PONG_NODE_ADDRESSES.b]: [PONG_NODE_ADDRESSES.server, PONG_NODE_ADDRESSES.a],
    },
  });
}

export async function startMeshPongMesh(
  options: MeshPongBroadcastOptions = {}
): Promise<StartedMeshPongMesh> {
  const cluster = await startMeshPongBroadcast({
    ...options,
    channelName: options.channelName ?? 'mesh-pong-mesh',
  });

  return {
    ...cluster,
    mode: 'mesh',
    meshes: {
      server: createMeshOverlay(PONG_NODE_ADDRESSES.server),
      a: createMeshOverlay(PONG_NODE_ADDRESSES.a),
      b: createMeshOverlay(PONG_NODE_ADDRESSES.b),
    },
  };
}
