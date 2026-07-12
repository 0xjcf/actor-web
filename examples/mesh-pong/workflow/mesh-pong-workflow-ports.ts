import type { PongRoomCommand, PongRoomState } from '../pong-room-contract';
import type {
  MeshPongConnectionState,
  MeshPongMatchProjection,
  MeshPongWorkflowProjection,
} from './mesh-pong-workflow-core';

export interface MeshPongRoomCommandPort {
  send(command: PongRoomCommand): Promise<unknown>;
}

export interface MeshPongRoomProjectionPort {
  snapshot(): PongRoomState | null;
  subscribe(listener: (room: PongRoomState | null) => void): () => void;
}

export interface MeshPongMatchProjectionPort {
  snapshot(): MeshPongMatchProjection;
  subscribe(listener: (match: MeshPongMatchProjection) => void): () => void;
}

export interface MeshPongConnectionProjectionPort {
  snapshot(): MeshPongConnectionState;
  subscribe(listener: (state: MeshPongConnectionState) => void): () => void;
}

export interface MeshPongRoomIdentityPort {
  createRoomId(): string;
  createRoomCode(): string;
}

export interface MeshPongWorkflowRendererPort {
  render(projection: MeshPongWorkflowProjection): void;
}
