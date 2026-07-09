import type { PongTransportMode } from './pong-contract';

export type BrowserPongTransportMode = PongTransportMode;

export interface MeshPongSharedParityProof {
  readonly topologyFile: string;
  readonly behaviorFile: string;
  readonly actors: readonly string[];
  readonly validationGate: string;
}

export interface MeshPongModeParityProof {
  readonly mode: BrowserPongTransportMode;
  readonly startupFile: string;
  readonly startupCall: string;
  readonly transportBoundary: string;
  readonly nodeLayout: string;
}

export const MESH_PONG_SHARED_PARITY_PROOF: MeshPongSharedParityProof = {
  topologyFile: 'pong-topology.ts',
  behaviorFile: 'pong-behaviors.ts',
  actors: ['matchCoordinator', 'playerSession', 'controllerLeft', 'controllerRight'],
  validationGate: 'mesh-pong.test.ts: lifecycle + score parity across local, broadcast, websocket',
};

export const MESH_PONG_MODE_PARITY_PROOF: Record<
  BrowserPongTransportMode,
  MeshPongModeParityProof
> = {
  local: {
    mode: 'local',
    startupFile: 'modes/local.ts',
    startupCall: 'startRuntime(pong)',
    transportBoundary: 'in-process runtime',
    nodeLayout: 'server / a / b',
  },
  broadcast: {
    mode: 'broadcast',
    startupFile: 'modes/broadcast.ts',
    startupCall: 'startActorWebNode(pong, { transport })',
    transportBoundary: 'BroadcastChannel transport',
    nodeLayout: 'server / a / b',
  },
  mesh: {
    mode: 'mesh',
    startupFile: 'modes/mesh.ts',
    startupCall: 'startMeshPongBroadcast(...) + createLabsMesh(...)',
    transportBoundary: 'labs-mesh overlay on BroadcastChannel peers',
    nodeLayout: 'server / a / b',
  },
  websocket: {
    mode: 'websocket',
    startupFile: 'modes/websocket.ts',
    startupCall: 'startMeshPongBrowserWebSocket(...)',
    transportBoundary: 'browser WebSocket peers connected outbound-only to a Node server helper',
    nodeLayout: 'server / a / b',
  },
};

export function parityProofForMode(mode: BrowserPongTransportMode): MeshPongModeParityProof {
  return MESH_PONG_MODE_PARITY_PROOF[mode];
}
